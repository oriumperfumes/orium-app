/**
 * WIDGETS — o resumo dos pedidos que vai para a tela do celular/PC.
 *
 * Mesma regra do Painel de Pedidos (fase = journeyOf, urgência por dia de
 * entrega), calculada aqui no servidor para os widgets que leem sem login
 * (iPhone/Scriptable, Windows, Android) por uma chave secreta (widget_keys).
 * Nada de preço de custo ou dado pessoal além do primeiro nome do cliente.
 */
const TZ = "America/Sao_Paulo";

export type WidgetPhase = "pagamento" | "comprar" | "chegando" | "entregar";
export const PHASE_LABEL: Record<WidgetPhase, string> = {
  pagamento: "Esperando pagamento",
  comprar: "Falta pedir no fornecedor",
  chegando: "Vindo do fornecedor",
  entregar: "Pronto para entregar",
};

export type WidgetOrder = {
  id: string;
  name: string;
  first: string;
  date: string | null;
  time: string | null;
  when: string;
  /** versão curta para widget pequeno: "Atrasado" · "14:00" · "Amanhã" · "Sex 14" */
  short: string;
  group: "late" | "today" | "tomorrow" | "week" | "later" | "none";
  phase: WidgetPhase;
  phaseLabel: string;
  total: number;
  due: number;
  items: string;
};

export type WidgetSummary = {
  generatedAt: string;
  today: string;
  /** frase pronta, ex.: "5 pedidos para amanhã" */
  title: string;
  sub: string;
  tone: "red" | "gold" | "green";
  focus: "today" | "tomorrow" | "week" | "none";
  focusCount: number;
  counts: { late: number; today: number; tomorrow: number; week: number; open: number; toBuy: number; arriving: number; ready: number; owing: number };
  receivable: number;
  /** próximas entregas, da mais urgente para a menos */
  next: WidgetOrder[];
  /** hoje + 6 dias: quantas entregas em cada um */
  week: Array<{ date: string; day: string; label: string; count: number }>;
  /** eventos para gravar no calendário do aparelho (iPhone/Android) */
  agenda?: AgendaEvent[];
};

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const wd = (s: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${s}T12:00:00Z`)).replace(".", "");
const wdLong = (s: string) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${s}T12:00:00Z`)).replace("-feira", "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function buildWidgetSummary(db: any): Promise<WidgetSummary> {
  const now = new Date();
  const t = ymd(now);
  const tomorrow = addDays(t, 1);

  const { data: orders } = await db
    .from("catalog_orders")
    .select("id, customer_name, status, deleted_at, expected_delivery_date, expected_delivery_time, final_total, grand_total, sales_total, amount_paid, created_at")
    .is("deleted_at", null)
    .neq("status", "cancelado")
    .order("created_at", { ascending: false })
    .limit(400);
  const live = (orders ?? []) as any[];
  const ids = live.map((o) => o.id);

  const [{ data: items }, { data: sources }] = await Promise.all([
    ids.length ? db.from("catalog_order_items").select("order_id, product_name_snapshot, quantity").in("order_id", ids) : { data: [] },
    ids.length ? db.from("restock_item_sources").select("order_id, restock_item_id, quantity").in("order_id", ids) : { data: [] },
  ]);
  const restockIds = [...new Set(((sources ?? []) as any[]).map((s) => s.restock_item_id))];
  const { data: restock } = restockIds.length ? await db.from("restock_items").select("id, status").in("id", restockIds) : { data: [] };
  const rStatus = new Map<string, string>(((restock ?? []) as any[]).map((r) => [r.id, r.status]));
  const buy = new Map<string, { toBuy: number; arriving: number }>();
  ((sources ?? []) as any[]).forEach((s) => {
    const cur = buy.get(s.order_id) ?? { toBuy: 0, arriving: 0 };
    const st = rStatus.get(s.restock_item_id);
    if (st === "a comprar") cur.toBuy += Number(s.quantity ?? 0);
    else if (st === "pedido feito") cur.arriving += Number(s.quantity ?? 0);
    buy.set(s.order_id, cur);
  });
  const names = new Map<string, string[]>();
  ((items ?? []) as any[]).forEach((i) => names.set(i.order_id, [...(names.get(i.order_id) ?? []), i.product_name_snapshot].filter(Boolean)));

  let receivable = 0;
  let owing = 0;
  const open: WidgetOrder[] = [];
  for (const o of live) {
    const total = r2(Number(o.final_total ?? o.grand_total ?? o.sales_total ?? 0));
    const paid = r2(Number(o.amount_paid ?? 0));
    const due = r2(Math.max(0, total - paid));
    if (due > 0.009) {
      receivable += due;
      owing += 1;
    }
    if (o.status === "entregue") continue;
    const b = buy.get(o.id);
    const phase: WidgetPhase = o.status === "pendente" && paid <= 0 ? "pagamento" : b?.toBuy ? "comprar" : b?.arriving ? "chegando" : "entregar";
    const d = o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : null;
    const time = o.expected_delivery_time ? String(o.expected_delivery_time).slice(0, 5) : null;
    const group: WidgetOrder["group"] = !d ? "none" : d < t ? "late" : d === t ? "today" : d === tomorrow ? "tomorrow" : diffDays(t, d) <= 7 ? "week" : "later";
    const when =
      group === "late"
        ? `Atrasado ${plural(diffDays(d!, t), "dia", "dias")}`
        : group === "today"
          ? `Hoje${time ? ` · ${time}` : ""}`
          : group === "tomorrow"
            ? `Amanhã${time ? ` · ${time}` : ""}`
            : d
              ? `${cap(wd(d))} ${d.slice(8, 10)}/${d.slice(5, 7)}${time ? ` · ${time}` : ""}`
              : "Sem dia";
    const short =
      group === "late" ? "Atrasado" : group === "today" ? (time ?? "Hoje") : group === "tomorrow" ? "Amanhã" : d ? `${cap(wd(d))} ${d.slice(8, 10)}` : "Sem dia";
    const name = String(o.customer_name ?? "Cliente").trim() || "Cliente";
    open.push({
      id: o.id,
      name,
      first: name.split(/\s+/)[0]!,
      date: d,
      time,
      when,
      short,
      group,
      phase,
      phaseLabel: PHASE_LABEL[phase],
      total,
      due,
      items: (names.get(o.id) ?? []).join(", "),
    });
  }
  const order = ["late", "today", "tomorrow", "week", "later", "none"];
  open.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || (a.date ?? "9").localeCompare(b.date ?? "9") || (a.time ?? "99").localeCompare(b.time ?? "99"));

  const c = (g: WidgetOrder["group"]) => open.filter((o) => o.group === g).length;
  const counts = {
    late: c("late"),
    today: c("today"),
    tomorrow: c("tomorrow"),
    week: c("week"),
    open: open.length,
    toBuy: open.filter((o) => o.phase === "comprar").length,
    arriving: open.filter((o) => o.phase === "chegando").length,
    ready: open.filter((o) => o.phase === "entregar").length,
    owing,
  };

  // frase principal: o que é mais urgente agora
  let focus: WidgetSummary["focus"] = "none";
  let focusCount = 0;
  let title = "Nenhuma entrega marcada";
  let sub = counts.open ? `${plural(counts.open, "pedido", "pedidos")} em andamento` : "Tudo em dia";
  let tone: WidgetSummary["tone"] = "green";
  const urgent = counts.late + counts.today;
  if (urgent) {
    focus = "today";
    focusCount = urgent;
    title = `${plural(urgent, "pedido", "pedidos")} para hoje`;
    sub = counts.late ? `${plural(counts.late, "atrasado", "atrasados")} · resolva primeiro` : `${plural(open.filter((o) => (o.group === "today" || o.group === "late") && o.phase === "entregar").length, "pronto", "prontos")} para entregar`;
    tone = counts.late ? "red" : "gold";
  } else if (counts.tomorrow) {
    focus = "tomorrow";
    focusCount = counts.tomorrow;
    title = `${plural(counts.tomorrow, "pedido", "pedidos")} para amanhã`;
    const notReady = open.filter((o) => o.group === "tomorrow" && o.phase !== "entregar").length;
    sub = notReady ? `${notReady} ${notReady === 1 ? "precisa" : "precisam"} de você hoje` : "Tudo pronto";
    tone = notReady ? "gold" : "green";
  } else if (counts.week) {
    const nextDay = open.find((o) => o.group === "week")!.date!;
    const n = open.filter((o) => o.date === nextDay).length;
    focus = "week";
    focusCount = n;
    title = `${plural(n, "pedido", "pedidos")} para ${wdLong(nextDay)}`;
    sub = `Próxima entrega: ${nextDay.slice(8, 10)}/${nextDay.slice(5, 7)}`;
    tone = "green";
  }

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(t, i);
    return { date: d, day: d.slice(8, 10), label: i === 0 ? "Hoje" : cap(wd(d)), count: open.filter((o) => o.date === d || (i === 0 && o.group === "late")).length };
  });

  return {
    generatedAt: now.toISOString(),
    today: t,
    title,
    sub,
    tone,
    focus,
    focusCount,
    counts,
    receivable: r2(receivable),
    next: open.slice(0, 8),
    week,
  };
}

/* ─────────────── chaves ─────────────── */

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newWidgetToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return "ow_" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Valida a chave (hash) e marca o último uso. */
export async function checkWidgetKey(db: any, token: string | null) {
  if (!token || !/^ow_[A-Za-z0-9_-]{20,}$/.test(token)) return false;
  const hash = await sha256(token);
  const { data } = await db.from("widget_keys").select("id, revoked_at").eq("token_hash", hash).maybeSingle();
  if (!data || data.revoked_at) return false;
  await db.from("widget_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return true;
}

/**
 * Formato texto para o Rainmeter (widget no desktop do Windows):
 * rótulo|título|frase|cor|número|legenda|prontos|a receber|(quando|nome|corQuando|corFase) × 3
 */
export function widgetText(s: WidgetSummary) {
  const clean = (v: unknown) => String(v ?? "").replace(/[|\r\n]+/g, " ").trim();
  const rgb = { red: "255,138,117", gold: "255,213,153", green: "127,207,159" } as const;
  const phaseRgb: Record<WidgetPhase, string> = { pagamento: "212,212,212", comprar: rgb.red, chegando: rgb.gold, entregar: "255,255,255" };
  const label = s.focus === "today" ? "Hoje" : s.focus === "tomorrow" ? "Amanhã" : s.focus === "week" ? "Próxima entrega" : "Tudo em dia";
  const g = s.focus === "today" ? ["late", "today"] : s.focus === "tomorrow" ? ["tomorrow"] : [];
  const focusList = s.next.filter((o) => g.includes(o.group));
  const ready = focusList.filter((o) => o.phase === "entregar").length;
  const count = s.focusCount || s.counts.open;
  const caption = s.focus === "none" ? "pedidos em andamento" : count === 1 ? "pedido para entregar" : "pedidos para entregar";
  const money = "R$ " + s.receivable.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fields: string[] = [label, s.title, s.sub, rgb[s.tone], String(count), caption, focusList.length ? `${ready}/${focusList.length} prontos` : "", money];
  for (let i = 0; i < 3; i++) {
    const o = s.next[i];
    if (o) fields.push(o.short, o.name, o.group === "late" ? rgb.red : o.group === "today" ? rgb.gold : "170,170,170", phaseRgb[o.phase]);
    else fields.push("", "", "20,20,20", "20,20,20");
  }
  return fields.map(clean).join("|");
}

/* ─────────────── agenda (calendário do celular/PC) ─────────────── */

/**
 * Eventos da agenda da Orium — uma lista só, usada por:
 *  - iPhone: o widget (Scriptable) grava no calendário "Orium · Pedidos";
 *  - Android: o app Orium Widgets grava no calendário do celular;
 *  - Windows/Outlook/Google: assinatura .ics (/api/public/agenda).
 * UID fixo por evento: mudou a data, o evento se move; entregou/cancelou, some.
 */
export type AgendaEvent = {
  uid: string;
  title: string;
  notes: string;
  url: string;
  date: string; // AAAA-MM-DD
  time: string | null; // HH:MM (null = dia inteiro)
  /** lembretes em minutos ANTES do início (negativo = depois do início; ex.: -540 = 9h no dia inteiro) */
  alarms: number[];
};

export async function buildAgenda(db: any, adminUrl: string): Promise<AgendaEvent[]> {
  const t = ymd(new Date());
  const from = addDays(t, -7);
  const until = addDays(t, 60);
  const money = (n: number) => "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const { data: orders } = await db
    .from("catalog_orders")
    .select("id, order_number, customer_name, status, expected_delivery_date, expected_delivery_time, payment_due_date, fulfillment_type, final_total, grand_total, sales_total, amount_paid")
    .is("deleted_at", null)
    .not("status", "in", "(entregue,cancelado)")
    .limit(500);
  const live = (orders ?? []) as any[];
  const ids = live.map((o) => o.id);
  const { data: items } = ids.length ? await db.from("catalog_order_items").select("order_id, product_name_snapshot, quantity").in("order_id", ids) : { data: [] };
  const names = new Map<string, string[]>();
  ((items ?? []) as any[]).forEach((i) => names.set(i.order_id, [...(names.get(i.order_id) ?? []), `${Number(i.quantity ?? 1) > 1 ? `${i.quantity}× ` : ""}${i.product_name_snapshot ?? ""}`]));

  const events: AgendaEvent[] = [];
  for (const o of live) {
    const name = String(o.customer_name ?? "Cliente").trim() || "Cliente";
    const total = Number(o.final_total ?? o.grand_total ?? o.sales_total ?? 0);
    const due = Math.max(0, Math.round((total - Number(o.amount_paid ?? 0)) * 100) / 100);
    const list = names.get(o.id) ?? [];
    const url = `${adminUrl}?pedido=${o.id}`;
    const d = o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : null;
    if (d && d >= from && d <= until) {
      const time = o.expected_delivery_time ? String(o.expected_delivery_time).slice(0, 5) : null;
      const verb = o.fulfillment_type === "PICKUP" ? "Retirada" : "Entregar";
      const [h, m] = (time ?? "00:00").split(":").map(Number);
      events.push({
        uid: `entrega-${o.id}`,
        title: `🚚 ${verb} · ${name}${list.length ? ` (${list.length} ${list.length === 1 ? "perfume" : "perfumes"})` : ""}`,
        notes: [list.join(", "), due > 0.009 ? `Falta receber ${money(due)}` : "Pago", `Pedido ${o.order_number ?? ""}`].filter(Boolean).join("\n"),
        url,
        date: d,
        time,
        // com horário: 1h antes e na véspera às 18h · dia inteiro: véspera 18h e 9h do dia
        alarms: time ? [60, h! * 60 + m! + 6 * 60] : [6 * 60, -9 * 60],
      });
    }
    const pd = o.payment_due_date ? String(o.payment_due_date).slice(0, 10) : null;
    if (pd && due > 0.009 && pd >= from && pd <= until) {
      events.push({ uid: `pagamento-${o.id}`, title: `💰 Cobrar ${name} · ${money(due)}`, notes: `Pagamento combinado do pedido ${o.order_number ?? ""}`, url, date: pd, time: null, alarms: [-10 * 60] });
    }
  }

  const { data: buys } = await db
    .from("restock_items")
    .select("id, planned_purchase_date, quantity, suppliers(name), products(canonical_name)")
    .eq("status", "a comprar")
    .not("planned_purchase_date", "is", null)
    .gte("planned_purchase_date", from)
    .lte("planned_purchase_date", until);
  const byDay = new Map<string, { supplier: string; items: string[]; units: number }>();
  ((buys ?? []) as any[]).forEach((b) => {
    const supplier = b.suppliers?.name ?? "Fornecedor";
    const k = `${b.planned_purchase_date}|${supplier}`;
    const cur = byDay.get(k) ?? { supplier, items: [], units: 0 };
    cur.items.push(b.products?.canonical_name ?? "Perfume");
    cur.units += Number(b.quantity ?? 1);
    byDay.set(k, cur);
  });
  for (const [k, v] of byDay) {
    const day = k.split("|")[0]!;
    events.push({
      uid: `compra-${day.replace(/-/g, "")}-${v.supplier.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}`,
      title: `🛒 Pedir na ${v.supplier} · ${v.units} ${v.units === 1 ? "perfume" : "perfumes"}`,
      notes: v.items.join(", "),
      url: adminUrl,
      date: day,
      time: null,
      alarms: [-9 * 60],
    });
  }
  return events.sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
}

/** Agenda em formato de calendário (.ics) para assinar no Outlook/Google/iPhone. */
export async function buildCalendar(db: any, adminUrl: string): Promise<string> {
  const events = await buildAgenda(db, adminUrl);
  const BS = String.fromCharCode(92); // barra invertida (escape do formato .ics)
  const esc = (v: string) => v.split(BS).join(BS + BS).replace(/;/g, BS + ";").replace(/,/g, BS + ",").replace(/\r?\n/g, BS + "n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dd = (d: string) => d.replace(/-/g, "");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orium Perfumes//Agenda de pedidos//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Orium · Pedidos",
    "X-WR-TIMEZONE:America/Sao_Paulo",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "BEGIN:VTIMEZONE",
    "TZID:America/Sao_Paulo",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0300",
    "TZOFFSETTO:-0300",
    "TZNAME:-03",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@oriumperfumes.com`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(`${e.notes}\n${e.url}`)}`, `URL:${e.url}`);
    if (e.time) {
      const [h, m] = e.time.split(":").map(Number);
      const end = `${String(Math.min(23, h! + 1)).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
      lines.push(`DTSTART;TZID=America/Sao_Paulo:${dd(e.date)}T${e.time.replace(":", "")}00`, `DTEND;TZID=America/Sao_Paulo:${dd(e.date)}T${end}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dd(e.date)}`, `DTEND;VALUE=DATE:${dd(addDays(e.date, 1))}`);
    }
    for (const a of e.alarms) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:${a >= 0 ? "-" : ""}PT${Math.abs(a)}M`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const fold = (line: string) => {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out: string[] = [];
    let cur = "";
    for (const ch of line) {
      if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
        out.push(cur);
        cur = ch;
      } else cur += ch;
    }
    out.push(cur);
    return out.join("\r\n ");
  };
  return lines.map(fold).join("\r\n") + "\r\n";
}
