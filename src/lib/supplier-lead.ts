/** Prazos de abastecimento em dias úteis (seg–sex), calendário de Brasília. Sempre previsão, nunca promessa. */
export type SupplyMode = "pickup" | "carrier" | "supplier_delivery" | "a_combinar";

export const SUPPLY_MODE_LABEL: Record<SupplyMode, string> = {
  pickup: "Retirada própria",
  carrier: "Transportadora / Correios",
  supplier_delivery: "Entrega do fornecedor",
  a_combinar: "A combinar",
};

export const PRIORITY_LABEL: Record<string, string> = {
  preferred: "Preferencial",
  secondary: "Secundário",
  reference: "Somente referência",
  inactive: "Inativo",
};

/** Data de hoje em Brasília (YYYY-MM-DD). */
export function todayBrasilia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addBusinessDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12));
  let left = days;
  while (left > 0) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    const wd = dt.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return dt.toISOString().slice(0, 10);
}

/** Prazo total estimado; null quando faltam dados (nunca inventa). */
export function leadDays(s: { supply_mode?: string | null; prep_days?: number | null; transit_days?: number | null }): number | null {
  if (s.supply_mode === "pickup") return s.prep_days ?? null;
  if (s.prep_days == null && s.transit_days == null) return null;
  return (s.prep_days ?? 0) + (s.transit_days ?? 0);
}

export function leadText(s: { supply_mode?: string | null; prep_days?: number | null; transit_days?: number | null; pickup_schedule?: string | null }): string {
  const n = leadDays(s);
  if (s.supply_mode === "pickup") return s.pickup_schedule ? `Retirada: ${s.pickup_schedule}` : n != null ? `Retirada em ~${n} dia(s) útil(eis)` : "Retirada a combinar";
  return n != null ? `Previsão: ${n} dia(s) útil(eis)` : "Prazo a consultar";
}
