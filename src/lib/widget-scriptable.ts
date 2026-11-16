/**
 * Widget do iPhone via app Scriptable (grátis, sem App Store/Mac).
 * Gera o script já com o endereço e a chave; o dono só cola no Scriptable e
 * adiciona o widget na tela de início. O "Parâmetro" do widget troca o modelo
 * (foco, foco-claro, receber, proximas, semana, fases, painel).
 */
export function scriptableCode({ endpoint, key, adminUrl, model }: { endpoint: string; key: string; adminUrl: string; model: string }) {
  return `// Orium · Widget de pedidos
// Cole no app Scriptable, toque em ▶ para testar e adicione o widget na tela de início.
// Dica: no widget, em "Parâmetro", escreva: foco · foco-claro · receber · proximas · semana · fases · painel
const ENDPOINT = ${JSON.stringify(endpoint)};
const KEY = ${JSON.stringify(key)};
const ADMIN = ${JSON.stringify(adminUrl)};
const MODEL = (args.widgetParameter || ${JSON.stringify(model)}).trim().toLowerCase();
// Agenda: grava entregas, cobranças e compras no calendário "Orium · Pedidos" (com lembretes)
const SYNC_CALENDAR = true;
const CALENDAR_NAME = "Orium · Pedidos";

const C = {
  bg: new Color("#141414"), light: new Color("#F4F1EA"), ink: new Color("#15130F"),
  white: Color.white(), dim: new Color("#FFFFFF", 0.5), faint: new Color("#FFFFFF", 0.06),
  gold: new Color("#FFD599"), red: new Color("#FF8A75"), green: new Color("#7FCF9F"), track: new Color("#2E2E2E"),
};
const TONE = { red: C.red, gold: C.gold, green: C.green };
const PHASE = { pagamento: new Color("#D4D4D4"), comprar: C.red, chegando: C.gold, entregar: C.white };

async function load() {
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.cacheDirectory(), "orium-widget.json");
  try {
    const r = new Request(ENDPOINT + "?agenda=1&key=" + encodeURIComponent(KEY));
    r.timeoutInterval = 15;
    const data = await r.loadJSON();
    if (data && data.error) throw new Error(data.error);
    fm.writeString(cache, JSON.stringify(data));
    return data;
  } catch (e) {
    if (fm.fileExists(cache)) return JSON.parse(fm.readString(cache));
    throw e;
  }
}

function brl(n) { return "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function text(stack, value, size, color, weight) {
  const t = stack.addText(String(value));
  t.font = weight === "bold" ? Font.boldSystemFont(size) : weight === "heavy" ? Font.heavySystemFont(size) : weight === "medium" ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  return t;
}
function dot(stack, color, size) {
  const s = stack.addStack(); s.size = new Size(size, size); s.cornerRadius = size / 2; s.backgroundColor = color; return s;
}
function ring(value, total, size, light) {
  const d = new DrawContext(); d.size = new Size(size * 3, size * 3); d.opaque = false; d.respectScreenScale = true;
  const c = size * 1.5, r = size * 1.25, w = size * 0.32;
  const steps = 72, p = total > 0 ? Math.min(1, value / total) : 0;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI - Math.PI / 2;
    const x = c + r * Math.cos(a) - w / 2, y = c + r * Math.sin(a) - w / 2;
    d.setFillColor(i / steps < p ? C.gold : (light ? new Color("#15130F", 0.12) : C.track));
    d.fillEllipse(new Rect(x, y, w, w));
  }
  d.setFont(Font.boldSystemFont(size * 0.75)); d.setTextColor(light ? C.ink : C.white); d.setTextAlignedCenter();
  d.drawTextInRect(value + "/" + total, new Rect(0, c - size * 0.45, size * 3, size));
  return d.getImage();
}
function focusLabel(s) { return s.focus === "today" ? "Hoje" : s.focus === "tomorrow" ? "Amanhã" : s.focus === "week" ? "Próxima entrega" : "Tudo em dia"; }
function focusReady(s) {
  const g = s.focus === "today" ? ["late", "today"] : s.focus === "tomorrow" ? ["tomorrow"] : [];
  const list = s.next.filter((o) => g.includes(o.group));
  return { ready: list.filter((o) => o.phase === "entregar").length, total: list.length };
}
function header(w, s, light) {
  const h = w.addStack(); h.centerAlignContent();
  dot(h, TONE[s.tone], 7); h.addSpacer(5);
  text(h, focusLabel(s), 12, light ? C.ink : C.white, "bold");
  h.addSpacer();
  return h;
}
function mark(stack, light) { text(stack, "ORIUM", 9, light ? new Color("#15130F", 0.45) : new Color("#FFFFFF", 0.35), "bold"); }
function orderRow(w, o, wide) {
  const row = w.addStack(); row.centerAlignContent(); row.backgroundColor = C.faint; row.cornerRadius = 10;
  row.setPadding(6, 8, 6, 8);
  const when = row.addStack(); when.size = new Size(wide ? 70 : 62, 0);
  text(when, o.short || o.when, 11, o.group === "late" ? C.red : o.group === "today" ? C.gold : C.dim, "bold");
  row.addSpacer(6);
  const col = row.addStack(); col.layoutVertically();
  text(col, o.name, 13, C.white, "bold");
  if (wide) text(col, o.phaseLabel, 10, C.dim);
  row.addSpacer();
  dot(row, PHASE[o.phase], 7);
  return row;
}

function foco(w, s, light) {
  w.backgroundColor = light ? C.light : C.bg;
  const fr = focusReady(s);
  const h = header(w, s, light);
  if (fr.total) h.addImage(ring(fr.ready, fr.total, 14, light)).imageSize = new Size(40, 40);
  w.addSpacer();
  text(w, s.focusCount || s.counts.open, 50, light ? C.ink : C.white, "bold");
  text(w, s.focus === "none" ? "pedidos em andamento" : s.focusCount === 1 ? "pedido para entregar" : "pedidos para entregar", 13, light ? C.ink : C.white, "bold");
  text(w, s.sub, 11, light ? new Color("#15130F", 0.55) : C.dim);
}
function receber(w, s) {
  w.backgroundColor = C.bg;
  const h = w.addStack(); text(h, "A receber", 12, new Color("#FFFFFF", 0.7), "bold"); h.addSpacer(); mark(h);
  w.addSpacer();
  text(w, brl(s.receivable), 26, C.gold, "bold");
  w.addSpacer(4);
  text(w, s.counts.owing + (s.counts.owing === 1 ? " cliente devendo" : " clientes devendo"), 12, C.white, "bold");
  w.addSpacer(6);
  const bars = w.addStack();
  for (let i = 0; i < 8; i++) { const b = bars.addStack(); b.size = new Size(14, 7); b.cornerRadius = 4; b.backgroundColor = i < Math.min(8, s.counts.owing) ? C.gold : C.track; if (i < 7) bars.addSpacer(3); }
}
function proximas(w, s) {
  w.backgroundColor = C.bg;
  const h = w.addStack(); h.centerAlignContent(); dot(h, TONE[s.tone], 7); h.addSpacer(5); text(h, s.title, 13, C.white, "bold"); h.addSpacer(); mark(h);
  w.addSpacer(8);
  const list = s.next.slice(0, 3);
  if (!list.length) { w.addSpacer(); text(w, "Nenhuma entrega marcada 👌", 13, C.dim); w.addSpacer(); return; }
  list.forEach((o, i) => { orderRow(w, o, false); if (i < list.length - 1) w.addSpacer(5); });
  w.addSpacer();
}
function semana(w, s) {
  w.backgroundColor = C.bg;
  const total = s.week.reduce((a, d) => a + d.count, 0);
  const h = w.addStack(); text(h, total + " entregas nos próximos 7 dias", 13, C.white, "bold"); h.addSpacer(); mark(h);
  w.addSpacer();
  const row = w.addStack();
  s.week.forEach((d, i) => {
    const col = row.addStack(); col.layoutVertically(); col.centerAlignContent();
    const l = col.addStack(); l.addSpacer(); text(l, d.label, 10, i === 0 ? C.white : C.dim, "bold"); l.addSpacer();
    col.addSpacer(4);
    const c = col.addStack(); c.size = new Size(38, 38); c.cornerRadius = 19; c.centerAlignContent();
    c.backgroundColor = d.count ? C.gold : new Color("#222222");
    if (i === 0) { c.borderWidth = 2; c.borderColor = C.white; }
    c.addSpacer(); text(c, d.day, 14, d.count ? C.ink : C.dim, "bold"); c.addSpacer();
    col.addSpacer(3);
    const n = col.addStack(); n.addSpacer(); text(n, d.count ? String(d.count) : " ", 10, C.gold, "bold"); n.addSpacer();
    if (i < 6) row.addSpacer();
  });
}
function fases(w, s) {
  w.backgroundColor = C.bg;
  const main = w.addStack();
  const left = main.addStack(); left.layoutVertically(); left.size = new Size(104, 0);
  mark(left); left.addSpacer();
  text(left, s.counts.open, 44, C.white, "bold");
  text(left, "pedidos em andamento", 12, new Color("#FFFFFF", 0.7), "bold");
  main.addSpacer(12);
  const bars = [
    ["Pagto", Math.max(0, s.counts.open - s.counts.toBuy - s.counts.arriving - s.counts.ready), PHASE.pagamento],
    ["Fornec.", s.counts.toBuy, PHASE.comprar], ["A caminho", s.counts.arriving, PHASE.chegando], ["Pronto", s.counts.ready, PHASE.entregar],
  ];
  const max = Math.max(1, ...bars.map((b) => b[1]));
  bars.forEach((b, i) => {
    const col = main.addStack(); col.layoutVertically(); col.bottomAlignContent();
    const n = col.addStack(); n.addSpacer(); text(n, b[1], 13, C.white, "bold"); n.addSpacer();
    col.addSpacer(3);
    const track = col.addStack(); track.size = new Size(44, 78); track.cornerRadius = 10; track.backgroundColor = new Color("#222222"); track.layoutVertically();
    track.addSpacer();
    const fill = track.addStack(); fill.size = new Size(44, Math.max(6, (b[1] / max) * 78)); fill.cornerRadius = 10; fill.backgroundColor = b[2];
    col.addSpacer(3);
    const l = col.addStack(); l.addSpacer(); text(l, b[0], 9, C.dim, "bold"); l.addSpacer();
    if (i < 3) main.addSpacer(6);
  });
}
function painel(w, s) {
  w.backgroundColor = C.bg;
  const fr = focusReady(s);
  const top = w.addStack();
  const t = top.addStack(); t.layoutVertically();
  const l = t.addStack(); l.centerAlignContent(); dot(l, TONE[s.tone], 7); l.addSpacer(5); text(l, focusLabel(s), 12, new Color("#FFFFFF", 0.7), "bold");
  text(t, s.title, 21, C.white, "bold"); text(t, s.sub, 12, C.dim);
  top.addSpacer();
  if (fr.total) top.addImage(ring(fr.ready, fr.total, 17)).imageSize = new Size(52, 52); else mark(top);
  w.addSpacer(10);
  const row = w.addStack();
  s.week.forEach((d, i) => {
    const col = row.addStack(); col.layoutVertically();
    const lb = col.addStack(); lb.addSpacer(); text(lb, d.label, 9, C.dim, "bold"); lb.addSpacer();
    col.addSpacer(3);
    const c = col.addStack(); c.size = new Size(30, 30); c.cornerRadius = 15; c.centerAlignContent(); c.backgroundColor = d.count ? C.gold : new Color("#222222");
    if (i === 0) { c.borderWidth = 2; c.borderColor = new Color("#FFFFFF", 0.7); }
    c.addSpacer(); text(c, d.day, 12, d.count ? C.ink : C.dim, "bold"); c.addSpacer();
    if (i < 6) row.addSpacer();
  });
  w.addSpacer(10);
  s.next.slice(0, 3).forEach((o, i) => { orderRow(w, o, true); if (i < 2) w.addSpacer(5); });
  w.addSpacer();
  const f = w.addStack(); text(f, "A receber ", 11, C.dim); text(f, brl(s.receivable), 11, C.gold, "bold"); f.addSpacer(); mark(f);
}

/* ── agenda: cria/atualiza/remove eventos no calendário do iPhone ── */
async function syncCalendar(events) {
  if (!SYNC_CALENDAR || !Array.isArray(events)) return;
  const fm = FileManager.local();
  const stampFile = fm.joinPath(fm.cacheDirectory(), "orium-agenda-sync.txt");
  // no máximo a cada 10 min (o widget atualiza mais vezes)
  if (config.runsInWidget && fm.fileExists(stampFile) && Date.now() - Number(fm.readString(stampFile)) < 10 * 60 * 1000) return;
  let cal;
  try { cal = await Calendar.forEventsByTitle(CALENDAR_NAME); } catch (e) { cal = null; }
  if (!cal) { cal = await Calendar.createForEvents(CALENDAR_NAME); cal.color = new Color("#FFD599"); try { cal.save(); } catch (e) {} }
  const start = new Date(Date.now() - 8 * 86400000), end = new Date(Date.now() + 62 * 86400000);
  const existing = await CalendarEvent.between(start, end, [cal]);
  const byUid = {};
  for (const ev of existing) { const m = /orium:([\\w-]+)/.exec(ev.notes || ""); if (m) byUid[m[1]] = ev; }
  const seen = {};
  for (const e of events) {
    seen[e.uid] = true;
    const ev = byUid[e.uid] || new CalendarEvent();
    ev.calendar = cal;
    ev.title = e.title;
    ev.notes = e.notes + "\\n" + e.url + "\\norium:" + e.uid;
    const [y, mo, d] = e.date.split("-").map(Number);
    if (e.time) {
      const [h, mi] = e.time.split(":").map(Number);
      ev.isAllDay = false;
      ev.startDate = new Date(y, mo - 1, d, h, mi);
      ev.endDate = new Date(y, mo - 1, d, h + 1, mi);
    } else {
      ev.isAllDay = true;
      ev.startDate = new Date(y, mo - 1, d, 0, 0);
      ev.endDate = new Date(y, mo - 1, d, 23, 59);
    }
    ev.removeAllAlarms && ev.removeAllAlarms();
    for (const a of e.alarms || []) ev.addAlarm(Alarm.fromRelativeOffset(-a * 60));
    ev.save();
  }
  for (const uid in byUid) if (!seen[uid]) { try { byUid[uid].remove(); } catch (e) {} }
  fm.writeString(stampFile, String(Date.now()));
}

async function build() {
  const w = new ListWidget();
  w.setPadding(14, 14, 14, 14);
  w.url = ADMIN;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  let s;
  try {
    s = await load();
    try { await syncCalendar(s.agenda); } catch (e) { /* sem permissão do Calendário: o widget continua */ }
  } catch (e) {
    w.backgroundColor = C.bg; text(w, "Orium", 14, C.gold, "bold"); w.addSpacer(4);
    text(w, "Não deu para carregar os pedidos.", 12, C.white); text(w, String(e.message || e), 10, C.dim); return w;
  }
  const family = config.widgetFamily || (MODEL === "painel" ? "large" : ["proximas", "semana", "fases"].includes(MODEL) ? "medium" : "small");
  const fits = { small: ["foco", "foco-claro", "receber"], medium: ["proximas", "semana", "fases"], large: ["painel"] };
  const model = (fits[family] || []).includes(MODEL) ? MODEL : (fits[family] || ["foco"])[0];
  ({ foco: () => foco(w, s, false), "foco-claro": () => foco(w, s, true), receber: () => receber(w, s), proximas: () => proximas(w, s), semana: () => semana(w, s), fases: () => fases(w, s), painel: () => painel(w, s) })[model]();
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else {
  const fam = MODEL === "painel" ? "presentLarge" : ["proximas", "semana", "fases"].includes(MODEL) ? "presentMedium" : "presentSmall";
  await widget[fam]();
}
Script.complete();
`;
}
