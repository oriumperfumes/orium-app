/** Datas de entrega: previsão é data de calendário (Brasília); conclusão é timestamp. */
export type DeliveryState = "late" | "today" | "tomorrow" | "upcoming" | "done" | "none";

const TZ = "America/Sao_Paulo";

/** Hoje em Brasília como "YYYY-MM-DD". */
export function todayBR(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Converte "YYYY-MM-DD" para Date ao meio-dia UTC (sem pular de dia). */
function asDate(ymd: string) {
  const [y = 1970, m = 1, d = 1] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function fmtDeliveryDate(ymd?: string | null) {
  if (!ymd) return "";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function fmtTime(t?: string | null) {
  return t ? t.slice(0, 5) : "";
}

export function weekdayName(ymd: string) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(asDate(ymd));
}

export function dayNumber(ymd: string) {
  return Number(ymd.slice(8, 10));
}

export function deliveryState(o: { status?: string | null; expected_delivery_date?: string | null }): DeliveryState {
  if (o.status === "entregue") return "done";
  const d = o.expected_delivery_date?.slice(0, 10);
  if (!d || o.status === "cancelado") return "none";
  const today = todayBR();
  if (d < today) return "late";
  if (d === today) return "today";
  if (d === todayBR(1)) return "tomorrow";
  return "upcoming";
}

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  late: "Entrega atrasada",
  today: "Entrega hoje",
  tomorrow: "Entrega amanhã",
  upcoming: "Próxima entrega",
  done: "Entregue",
  none: "Sem data",
};

export const DELIVERY_CLASS: Record<DeliveryState, string> = {
  late: "border-transparent bg-[#2A1A18] text-[#FF9A8A]",
  today: "border-transparent bg-[#FFD599] text-[#15130F]",
  tomorrow: "border-transparent bg-[#2A2418] text-[#FFD599]",
  upcoming: "border-transparent bg-[#262626] text-[#A9A9A9]",
  done: "border-transparent bg-[#262626] text-[#8C8C8C]",
  none: "border-transparent bg-[#262626] text-[#8C8C8C]",
};

const RANK: Record<DeliveryState, number> = { late: 0, today: 1, tomorrow: 2, upcoming: 3, none: 4, done: 5 };
export const deliveryRank = (o: any) => RANK[deliveryState(o)];

/** Fim da semana corrente (domingo) em Brasília. */
export function endOfWeekBR() {
  const t = todayBR();
  const dow = asDate(t).getUTCDay(); // 0 = domingo
  return todayBR(dow === 0 ? 0 : 7 - dow);
}

export const DELIVERY_FILTERS: Array<{ key: string; label: string; test: (o: any) => boolean }> = [
  { key: "dl_today", label: "Entregas de hoje", test: (o) => deliveryState(o) === "today" },
  { key: "dl_tomorrow", label: "Amanhã", test: (o) => deliveryState(o) === "tomorrow" },
  {
    key: "dl_week",
    label: "Esta semana",
    test: (o) => {
      const s = deliveryState(o);
      return (s === "today" || s === "tomorrow" || s === "upcoming") && o.expected_delivery_date.slice(0, 10) <= endOfWeekBR();
    },
  },
  { key: "dl_late", label: "Atrasadas", test: (o) => deliveryState(o) === "late" },
  {
    key: "dl_none",
    label: "Sem data definida",
    test: (o) => !o.expected_delivery_date && o.status !== "entregue" && o.status !== "cancelado",
  },
];
