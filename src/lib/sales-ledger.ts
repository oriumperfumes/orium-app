/**
 * VENDAS — regras do livro único (sem interface, testadas).
 *
 * As linhas vêm prontas do banco (`sales_ledger`): pedidos (site, WhatsApp,
 * manuais), balcão (frascos e decants) e Negociação. Aqui só ficam os rótulos,
 * os filtros e as somas, para a tela não recalcular nada por conta própria.
 */

export type LedgerSource = "order" | "store" | "negotiation";
export type LedgerChannel = "site" | "whatsapp" | "manual" | "balcao" | "negociacao";

export type LedgerItem = {
  name: string | null;
  image_url: string | null;
  variant: string | null;
  decant_ml: number | null;
  quantity: number;
};

export type LedgerSale = {
  source: LedgerSource;
  id: string;
  sold_at: string;
  channel: LedgerChannel;
  ref: string | null;
  customer_name: string | null;
  total: number;
  paid: number;
  due: number;
  profit: number | null;
  payment_method: string | null;
  status: string | null;
  /** soma no faturamento (pedido pendente sem confirmação = false) */
  counted: boolean;
  due_date: string | null;
  items: LedgerItem[];
};

export type UnregisteredPiece = {
  id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  updated_at: string;
};

export type LedgerResult = {
  sales: LedgerSale[];
  receivable: { total: number; count: number };
  unregistered: UnregisteredPiece[];
};

export const CHANNEL: Record<LedgerChannel, { label: string; short: string; hint: string }> = {
  site: { label: "Site", short: "Site", hint: "Pedido feito pelo site" },
  whatsapp: { label: "WhatsApp", short: "WhatsApp", hint: "Pedido pelo WhatsApp" },
  manual: { label: "Encomenda", short: "Encomenda", hint: "Pedido lançado à mão" },
  balcao: { label: "Balcão", short: "Balcão", hint: "Venda na loja física" },
  negociacao: { label: "Negociação", short: "Negociação", hint: "Peça da Negociação" },
};

export const CHANNEL_ORDER: LedgerChannel[] = [
  "balcao",
  "whatsapp",
  "site",
  "manual",
  "negociacao",
];

export type LedgerFilter = "all" | LedgerChannel | "due";

const PAY: Record<string, string> = {
  PIX: "Pix",
  CARTAO: "Cartão",
  CARD: "Cartão",
  DINHEIRO: "Dinheiro",
};
export const payLabel = (m: string | null | undefined) => (m ? (PAY[m.toUpperCase()] ?? m) : null);

const r2 = (n: number) => Math.round(n * 100) / 100;

export function matches(s: LedgerSale, f: LedgerFilter) {
  if (f === "all") return true;
  if (f === "due") return s.counted && s.due > 0.009;
  return s.channel === f;
}

/** Título curto: "2× Amnia", "Amnia + 2". */
export function saleTitle(s: Pick<LedgerSale, "items">) {
  const first = s.items[0];
  if (!first) return "Venda";
  const name = first.name ?? "Perfume";
  if (s.items.length > 1) return `${name} + ${s.items.length - 1}`;
  return first.quantity > 1 ? `${first.quantity}× ${name}` : name;
}

/** O que foi vendido, em poucas palavras: "Decant 5ml", "Frasco", "3 itens". */
export function saleKind(s: Pick<LedgerSale, "items" | "channel">) {
  if (s.items.length > 1) return `${s.items.reduce((n, i) => n + (i.quantity || 1), 0)} itens`;
  const first = s.items[0];
  if (!first) return "";
  if (first.variant === "DECANT") return `Decant ${first.decant_ml ?? ""}ml`.replace(" ml", "ml");
  if (s.channel === "negociacao") return "Peça da Negociação";
  return "Frasco";
}

/** Situação do pagamento, para o selo da linha. */
export function payState(s: Pick<LedgerSale, "total" | "paid" | "due" | "counted">) {
  if (!s.counted) return { label: "A confirmar", tone: "off" as const };
  if (s.due <= 0.009) return { label: "Pago", tone: "ok" as const };
  if (s.paid > 0) return { label: "Falta", tone: "gold" as const };
  return { label: "Não pagou", tone: "coral" as const };
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export type LedgerSummary = {
  today: { total: number; count: number };
  yesterday: number;
  period: { total: number; count: number; profit: number; withProfit: number; ticket: number };
  byChannel: Array<{ channel: LedgerChannel; total: number; count: number; share: number }>;
  toConfirm: number;
};

/** Somas do período: só vendas que contam (pedido a confirmar fica de fora). */
export function summarize(sales: LedgerSale[], now = new Date()): LedgerSummary {
  const today0 = dayStart(now);
  const yest0 = today0 - 86_400_000;
  let todayTotal = 0;
  let todayCount = 0;
  let yesterday = 0;
  let total = 0;
  let count = 0;
  let profit = 0;
  let withProfit = 0;
  let toConfirm = 0;
  const ch = new Map<LedgerChannel, { total: number; count: number }>();
  for (const s of sales) {
    if (!s.counted) {
      toConfirm += 1;
      continue;
    }
    const t = new Date(s.sold_at).getTime();
    const v = Number(s.total) || 0;
    total += v;
    count += 1;
    if (s.profit != null) {
      profit += Number(s.profit);
      withProfit += 1;
    }
    if (t >= today0) {
      todayTotal += v;
      todayCount += 1;
    } else if (t >= yest0) yesterday += v;
    const c = ch.get(s.channel) ?? { total: 0, count: 0 };
    c.total += v;
    c.count += 1;
    ch.set(s.channel, c);
  }
  const byChannel = CHANNEL_ORDER.filter((c) => ch.has(c)).map((c) => {
    const v = ch.get(c)!;
    return {
      channel: c,
      total: r2(v.total),
      count: v.count,
      share: total > 0 ? v.total / total : 0,
    };
  });
  return {
    today: { total: r2(todayTotal), count: todayCount },
    yesterday: r2(yesterday),
    period: {
      total: r2(total),
      count,
      profit: r2(profit),
      withProfit,
      ticket: count ? r2(total / count) : 0,
    },
    byChannel,
    toConfirm,
  };
}

/** Total por dia (para as barras), do mais antigo ao de hoje. */
export function dailyTotals(sales: LedgerSale[], days: number, now = new Date()) {
  const today0 = dayStart(now);
  const out = Array.from({ length: days }, (_, i) => {
    const start = today0 - (days - 1 - i) * 86_400_000;
    return { start, total: 0, today: i === days - 1 };
  });
  for (const s of sales) {
    if (!s.counted) continue;
    const t = dayStart(new Date(s.sold_at));
    const idx = days - 1 - Math.round((today0 - t) / 86_400_000);
    if (idx >= 0 && idx < days) out[idx]!.total += Number(s.total) || 0;
  }
  return out.map((d) => ({ ...d, total: r2(d.total) }));
}

/** "Hoje", "Ontem" ou "quarta-feira, 18 de novembro". */
export function dayLabel(iso: string, now = new Date()) {
  const t = dayStart(new Date(iso));
  const today0 = dayStart(now);
  if (t === today0) return "Hoje";
  if (t === today0 - 86_400_000) return "Ontem";
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

/** Agrupa por dia, mantendo a ordem (mais recente primeiro). */
export function groupByDay(sales: LedgerSale[], now = new Date()) {
  const out = new Map<string, LedgerSale[]>();
  for (const s of sales) {
    const k = dayLabel(s.sold_at, now);
    const list = out.get(k) ?? [];
    list.push(s);
    out.set(k, list);
  }
  return Array.from(out.entries()).map(([label, list]) => ({
    label,
    list,
    total: r2(list.filter((s) => s.counted).reduce((n, s) => n + (Number(s.total) || 0), 0)),
  }));
}
