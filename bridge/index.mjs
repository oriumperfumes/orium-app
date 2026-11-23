/**
 * Ponte WhatsApp → CRM Orium.
 * - Mantém a sessão do WhatsApp da loja (pasta ./auth, nunca vai pro git).
 * - Grava conversas 1:1 no Supabase via wa_bridge_ingest (grupos e status são ignorados).
 * - Entrega o que o Admin coloca na fila (wa_outbox), uma mensagem por vez, com pausa.
 * - Publica status e QR code (wa_bridge_heartbeat) para o Admin mostrar.
 * Usa só a chave pública do Supabase + BRIDGE_TOKEN (o banco confere o hash).
 */
import { readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";

const here = dirname(fileURLToPath(import.meta.url));
// .env simples (KEY=valor), sem dependência extra
const envFile = join(here, ".env");
if (existsSync(envFile))
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }

const { SUPABASE_URL, SUPABASE_KEY, BRIDGE_TOKEN } = process.env;
if (!SUPABASE_URL || !SUPABASE_KEY || !BRIDGE_TOKEN) {
  console.error("Faltam SUPABASE_URL, SUPABASE_KEY ou BRIDGE_TOKEN no bridge/.env");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const log = pino({ level: process.env.LOG_LEVEL || "warn" });
const AUTH_DIR = join(here, "auth");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sock = null;
let state = { status: "connecting", qr: null, phone: null };
let sending = false;
let fetchingAvatars = false;
const pendingContacts = new Map();

async function heartbeat() {
  const { error } = await db.rpc("wa_bridge_heartbeat", { p_token: BRIDGE_TOKEN, p_status: state.status, p_qr: state.qr, p_phone: state.phone });
  if (error) console.error("heartbeat:", error.message);
}
function setState(patch) {
  state = { ...state, ...patch };
  void heartbeat();
}

/** jid de telefone (55...@s.whatsapp.net). Converte @lid quando o WhatsApp esconde o número. */
async function phoneJid(key) {
  const cands = [key.remoteJid, key.remoteJidAlt, key.senderPn, key.participantPn].filter(Boolean);
  const pn = cands.find((j) => j.endsWith("@s.whatsapp.net"));
  if (pn) return pn.replace(/:\d+@/, "@");
  const lid = cands.find((j) => j.endsWith("@lid"));
  if (lid && sock?.signalRepository?.lidMapping?.getPNForLID) {
    try {
      const got = await sock.signalRepository.lidMapping.getPNForLID(lid);
      if (got) return String(got).replace(/:\d+@/, "@");
    } catch {}
  }
  return null;
}

function unwrap(message) {
  let m = message;
  for (let i = 0; i < 4 && m; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

function contentOf(message) {
  const m = unwrap(message);
  if (!m) return null;
  if (m.conversation) return { kind: "text", body: m.conversation };
  if (m.extendedTextMessage) return { kind: "text", body: m.extendedTextMessage.text ?? "" };
  if (m.imageMessage) return { kind: "image", body: m.imageMessage.caption ?? "" };
  if (m.videoMessage) return { kind: "video", body: m.videoMessage.caption ?? "" };
  if (m.audioMessage) return { kind: "audio", body: "" };
  if (m.stickerMessage) return { kind: "sticker", body: "" };
  if (m.documentMessage) return { kind: "document", body: m.documentMessage.fileName ?? "" };
  if (m.locationMessage) return { kind: "location", body: "" };
  if (m.contactMessage) return { kind: "contact", body: m.contactMessage.displayName ?? "" };
  if (m.buttonsResponseMessage) return { kind: "text", body: m.buttonsResponseMessage.selectedDisplayText ?? "" };
  if (m.listResponseMessage) return { kind: "text", body: m.listResponseMessage.title ?? "" };
  return null; // reações, protocolo, enquetes etc. não entram no CRM
}

const tsOf = (t) => (typeof t === "number" ? t : Number(t?.low ?? t ?? 0)) || Math.floor(Date.now() / 1000);

async function toRows(msgs, history) {
  const rows = [];
  for (const msg of msgs) {
    const key = msg.key ?? {};
    if (!key.id || !key.remoteJid) continue;
    if (key.remoteJid.endsWith("@g.us") || key.remoteJid === "status@broadcast" || key.remoteJid.endsWith("@newsletter") || key.remoteJid.endsWith("@broadcast")) continue;
    const c = contentOf(msg.message);
    if (!c) continue;
    const jid = await phoneJid(key);
    if (!jid) continue;
    rows.push({ id: key.id, jid, from_me: !!key.fromMe, body: c.body, kind: c.kind, ts: tsOf(msg.messageTimestamp), push_name: key.fromMe ? null : msg.pushName ?? null, history });
  }
  return rows;
}

async function ingest(rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await db.rpc("wa_bridge_ingest", { p_token: BRIDGE_TOKEN, p_messages: chunk });
    if (error) console.error("ingest:", error.message);
  }
}

/** Fila de saída: uma mensagem por vez, com pausa humana entre elas. */
async function drainOutbox() {
  if (sending || state.status !== "online" || !sock) return;
  sending = true;
  try {
    const { data, error } = await db.rpc("wa_bridge_claim_outbox", { p_token: BRIDGE_TOKEN });
    if (error) throw new Error(error.message);
    for (const o of data ?? []) {
      try {
        await sock.presenceSubscribe(o.jid).catch(() => {});
        await sock.sendPresenceUpdate("composing", o.jid).catch(() => {});
        await sleep(Math.min(3500, 600 + o.body.length * 25));
        const sent = await sock.sendMessage(o.jid, { text: o.body });
        await sock.sendPresenceUpdate("paused", o.jid).catch(() => {});
        await db.rpc("wa_bridge_outbox_result", { p_token: BRIDGE_TOKEN, p_id: o.id, p_ok: true, p_wa_id: sent?.key?.id ?? null });
        if (sent) await ingest(await toRows([sent], false));
      } catch (e) {
        await db.rpc("wa_bridge_outbox_result", { p_token: BRIDGE_TOKEN, p_id: o.id, p_ok: false, p_error: String(e?.message ?? e) });
      }
      await sleep(1200 + Math.random() * 1500);
    }
  } catch (e) {
    console.error("fila:", e.message);
  } finally {
    sending = false;
  }
}

/** Nome da agenda e do perfil: junta e manda em lote a cada poucos segundos. */
function queueContacts(list) {
  for (const c of list ?? []) {
    const cands = [c.id, c.phoneNumber, c.jid].filter(Boolean).map(String);
    const jid = cands.find((j) => j.endsWith("@s.whatsapp.net"));
    if (!jid) continue;
    const key = jid.replace(/:\d+@/, "@");
    const prev = pendingContacts.get(key) ?? {};
    pendingContacts.set(key, {
      jid: key,
      saved_name: c.name ?? prev.saved_name ?? null,
      push_name: c.notify ?? c.verifiedName ?? prev.push_name ?? null,
    });
  }
}
async function flushContacts() {
  if (!pendingContacts.size) return;
  const batch = [...pendingContacts.values()].slice(0, 300);
  for (const c of batch) pendingContacts.delete(c.jid);
  const { error } = await db.rpc("wa_bridge_contacts", { p_token: BRIDGE_TOKEN, p_contacts: batch });
  if (error) console.error("contatos:", error.message);
}

/**
 * Fotos de perfil: devagar (uma a cada ~2 s) para não parecer robô.
 * Miniatura ("preview") guardada no banco; renovada a cada 7 dias.
 */
async function fetchAvatars() {
  if (fetchingAvatars || state.status !== "online" || !sock) return;
  fetchingAvatars = true;
  try {
    const { data, error } = await db.rpc("wa_bridge_avatar_targets", { p_token: BRIDGE_TOKEN, p_limit: 10 });
    if (error) throw new Error(error.message);
    for (const t of data ?? []) {
      if (state.status !== "online") break;
      let jid = t.jid;
      let exists = true;
      if (t.kind === "customer") {
        const [r] = await sock.onWhatsApp(jid.split("@")[0]).catch(() => []);
        exists = !!r?.exists;
        if (r?.jid) jid = r.jid;
      }
      let avatar = null;
      if (exists) {
        const url = await sock.profilePictureUrl(jid, "preview").catch(() => null);
        if (url) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length < 140_000) avatar = `data:${res.headers.get("content-type") || "image/jpeg"};base64,${buf.toString("base64")}`;
            }
          } catch {}
        }
      }
      await db.rpc("wa_bridge_set_avatar", { p_token: BRIDGE_TOKEN, p_kind: t.kind, p_id: t.id, p_avatar: avatar, p_exists: exists });
      await sleep(1600 + Math.random() * 900);
    }
  } catch (e) {
    console.error("fotos:", e.message);
  } finally {
    fetchingAvatars = false;
  }
}

async function start() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  sock = makeWASocket({
    auth,
    version,
    logger: log,
    browser: Browsers.macOS("Orium CRM"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    printQRInTerminal: false,
  });
  setState({ status: "connecting", qr: null });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (u) => {
    if (u.qr) {
      const dataUrl = await QRCode.toDataURL(u.qr, { margin: 1, width: 360 });
      console.log("QR novo: abra Admin → Clientes → Conversas e escaneie.");
      setState({ status: "qr", qr: dataUrl });
    }
    if (u.connection === "open") {
      const me = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
      console.log("WhatsApp conectado:", me);
      setState({ status: "online", qr: null, phone: me });
    }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log("Conexão fechada", code, loggedOut ? "(desconectado no celular)" : "");
      setState({ status: "offline", qr: null });
      if (loggedOut) rmSync(AUTH_DIR, { recursive: true, force: true });
      setTimeout(() => start().catch((e) => console.error(e)), loggedOut ? 1500 : 4000);
    }
  });

  sock.ev.on("contacts.upsert", (list) => queueContacts(list));
  sock.ev.on("contacts.update", (list) => queueContacts(list));
  sock.ev.on("messaging-history.set", async ({ messages, contacts }) => {
    queueContacts(contacts);
    // só os últimos 30 dias do histórico entram no CRM
    const since = Date.now() / 1000 - 30 * 86400;
    const rows = (await toRows(messages ?? [], true)).filter((r) => r.ts >= since);
    if (rows.length) {
      console.log("histórico:", rows.length, "mensagens");
      await ingest(rows);
    }
  });
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    const rows = await toRows(messages ?? [], type !== "notify");
    if (rows.length) await ingest(rows);
  });
}

setInterval(() => void heartbeat(), 20_000);
setInterval(() => void drainOutbox(), 2_000);
setInterval(() => void flushContacts(), 5_000);
setInterval(() => void fetchAvatars(), 15_000);
process.on("unhandledRejection", (e) => console.error("erro:", e?.message ?? e));
start().catch((e) => {
  console.error(e);
  process.exit(1);
});
