/**
 * Frete de abastecimento (fornecedor → Orium). O frete pertence à REMESSA:
 * é rateado entre os itens, nunca somado por inteiro a cada perfume.
 */
export type AllocMethod = "units" | "value" | "weight";
export const ALLOC_LABEL: Record<AllocMethod, string> = { units: "por unidades", value: "por valor dos produtos", weight: "por peso" };

export type AllocItem = { key: string; qty: number; unitPrice: number | null; unitWeightG?: number | null };
export type AllocLine = { key: string; qty: number; total: number; perUnit: number };

const cents = (n: number) => Math.round(n * 100);

/** Rateio exato em centavos: a soma das linhas é sempre igual ao frete total. */
export function allocateFreight(total: number, items: AllocItem[], method: AllocMethod = "units"): { method: AllocMethod; lines: AllocLine[] } {
  const live = items.filter((i) => i.qty > 0);
  let used: AllocMethod = method;
  if (used === "weight" && !live.every((i) => (i.unitWeightG ?? 0) > 0)) used = "units";
  if (used === "value" && !live.every((i) => (i.unitPrice ?? 0) > 0)) used = "units";
  const weight = (i: AllocItem) => (used === "units" ? i.qty : used === "value" ? i.qty * (i.unitPrice ?? 0) : i.qty * (i.unitWeightG ?? 0));
  const sum = live.reduce((s, i) => s + weight(i), 0);
  const totalC = cents(Math.max(0, total));
  if (!live.length || sum <= 0) return { method: used, lines: [] };
  const raw = live.map((i) => (totalC * weight(i)) / sum);
  const base = raw.map(Math.floor);
  let left = totalC - base.reduce((s, n) => s + n, 0);
  // maiores restos recebem os centavos que sobraram
  const order = raw.map((r, idx) => ({ idx, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (left <= 0) break;
    base[o.idx]! += 1;
    left--;
  }
  return {
    method: used,
    lines: live.map((i, idx) => ({ key: i.key, qty: i.qty, total: base[idx]! / 100, perUnit: Math.round(base[idx]! / i.qty) / 100 })),
  };
}

export type SupplyPackageInput = {
  pkg_height_cm?: number | null;
  pkg_width_cm?: number | null;
  pkg_length_cm?: number | null;
  unit_weight_g?: number | null;
  units_per_package?: number | null;
};

/** Volumes da remessa a partir dos dados INFORMADOS do fornecedor. Faltou dado → lista o que falta. */
export function buildSupplyPackages(s: SupplyPackageInput, units: number):
  | { ok: true; packages: Array<{ weightKg: number; heightCm: number; widthCm: number; lengthCm: number }>; totalWeightKg: number }
  | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!(Number(s.pkg_height_cm) > 0)) missing.push("altura da embalagem");
  if (!(Number(s.pkg_width_cm) > 0)) missing.push("largura da embalagem");
  if (!(Number(s.pkg_length_cm) > 0)) missing.push("comprimento da embalagem");
  if (!(Number(s.unit_weight_g) > 0)) missing.push("peso por frasco");
  if (!(units > 0)) missing.push("quantidade de frascos");
  if (missing.length) return { ok: false, missing };
  const per = Math.max(1, Number(s.units_per_package) || units);
  const packages = [];
  for (let left = units; left > 0; left -= per) {
    const n = Math.min(per, left);
    packages.push({
      weightKg: Number(Math.max(0.3, (n * Number(s.unit_weight_g)) / 1000).toFixed(3)),
      heightCm: Number(s.pkg_height_cm),
      widthCm: Number(s.pkg_width_cm),
      lengthCm: Number(s.pkg_length_cm),
    });
  }
  return { ok: true, packages, totalWeightKg: Number(packages.reduce((t, p) => t + p.weightKg, 0).toFixed(3)) };
}

/** Margem sobre o preço de venda (0–1). null quando falta dado. */
export function marginOf(salePrice: number | null | undefined, cost: number | null | undefined): number | null {
  if (salePrice == null || cost == null || !(salePrice > 0)) return null;
  return (salePrice - cost) / salePrice;
}
