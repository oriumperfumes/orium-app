/**
 * REGRAS GLOBAIS DE PREÇO — escrita única (painel manual E Copilot).
 *
 * margens varejo/atacado, preço comercial (,90), desconto Pix e preços globais
 * dos decants. Nenhuma fórmula nova: o recálculo usa `recompute_all_pricing`
 * (mesma regra do catálogo/pedido) e a prévia usa `commercialPrice`.
 */
import { commercialPrice, type PsychSettings } from "@/lib/commercial-price";

const money = (v: number) => Number(v.toFixed(2));

export type RulesPatch = {
  retail_markup?: number;
  wholesale_markup?: number;
  wholesale_min_quantity?: number;
  psych_pricing_active?: boolean;
  psych_max_reduction?: number;
  pix_discount_percent?: number;
  pix_discount_active?: boolean;
  decant_2?: number;
  decant_5?: number;
  decant_10?: number;
};

export type RulesState = Required<RulesPatch>;

type Db = any;

export async function getRules(db: Db): Promise<RulesState> {
  const [{ data: s }, { data: d }] = await Promise.all([
    db.from("pricing_settings").select("*").eq("id", true).maybeSingle(),
    db.from("decant_settings").select("*").eq("id", true).maybeSingle(),
  ]);
  return {
    retail_markup: Number(s?.retail_markup ?? 120),
    wholesale_markup: Number(s?.wholesale_markup ?? 50),
    wholesale_min_quantity: Number(s?.wholesale_min_quantity ?? 6),
    psych_pricing_active: s?.psych_pricing_active === true,
    psych_max_reduction: Number(s?.psych_max_reduction ?? 0),
    pix_discount_percent: Number(s?.pix_discount_percent ?? 5),
    pix_discount_active: s?.pix_discount_active !== false,
    decant_2: Number(d?.price_2ml ?? 19.9),
    decant_5: Number(d?.price_5ml ?? 39.9),
    decant_10: Number(d?.price_10ml ?? 69.9),
  };
}

export const RULE_LABEL: Record<keyof RulesPatch, string> = {
  retail_markup: "Margem de varejo (custo + R$)",
  wholesale_markup: "Margem de atacado (custo + R$)",
  wholesale_min_quantity: "Mínimo para atacado (unid.)",
  psych_pricing_active: "Preço comercial (final ,90)",
  psych_max_reduction: "Ajuste máximo do preço comercial",
  pix_discount_percent: "Desconto Pix (%)",
  pix_discount_active: "Desconto Pix ligado",
  decant_2: "Decant 2ml (global)",
  decant_5: "Decant 5ml (global)",
  decant_10: "Decant 10ml (global)",
};

function validate(p: RulesPatch) {
  const pos = (k: keyof RulesPatch, v: unknown, min = 0) => {
    if (v != null && !(Number(v) >= min && Number.isFinite(Number(v)))) throw new Error(`${RULE_LABEL[k]}: valor inválido.`);
  };
  pos("retail_markup", p.retail_markup);
  pos("wholesale_markup", p.wholesale_markup);
  pos("wholesale_min_quantity", p.wholesale_min_quantity, 1);
  pos("psych_max_reduction", p.psych_max_reduction);
  if (p.pix_discount_percent != null && !(p.pix_discount_percent >= 0 && p.pix_discount_percent < 100)) throw new Error("Desconto Pix precisa ficar entre 0 e 99%.");
  for (const k of ["decant_2", "decant_5", "decant_10"] as const) if (p[k] != null && !(Number(p[k]) > 0)) throw new Error(`${RULE_LABEL[k]}: preço inválido.`);
}

/** Só as chaves que realmente mudam. */
export function diffRules(before: RulesState, patch: RulesPatch) {
  const out: Array<{ key: keyof RulesPatch; label: string; from: number | boolean; to: number | boolean }> = [];
  for (const k of Object.keys(patch) as Array<keyof RulesPatch>) {
    const v = patch[k];
    if (v == null || v === before[k]) continue;
    out.push({ key: k, label: RULE_LABEL[k], from: before[k], to: v });
  }
  return out;
}

export type RulesImpact = {
  affected: number;
  checked: number;
  sample: Array<{ id: string; name: string; from: number; to: number; cost: number | null; below_cost: boolean }>;
  below_cost: number;
  decant_affected: number;
  pix_affected: number;
};

/** Quantos produtos mudam — antes de gravar nada. */
export async function rulesImpact(db: Db, patch: RulesPatch): Promise<RulesImpact> {
  const before = await getRules(db);
  const next = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)) } as RulesState;
  const markupChanged =
    next.retail_markup !== before.retail_markup ||
    next.wholesale_markup !== before.wholesale_markup ||
    next.psych_pricing_active !== before.psych_pricing_active ||
    next.psych_max_reduction !== before.psych_max_reduction;
  const decantChanged = next.decant_2 !== before.decant_2 || next.decant_5 !== before.decant_5 || next.decant_10 !== before.decant_10;
  const pixChanged = next.pix_discount_percent !== before.pix_discount_percent || next.pix_discount_active !== before.pix_discount_active;

  const sample: RulesImpact["sample"] = [];
  let affected = 0;
  let checked = 0;
  let belowCost = 0;
  if (markupChanged) {
    const psych: PsychSettings = { active: next.psych_pricing_active, strategy: "ends_90", maxReduction: next.psych_max_reduction };
    const { data: rows } = await db
      .from("products")
      .select("id, canonical_name, retail_price, product_costs(best_cost), pricing_overrides(fixed_retail_price, retail_markup)")
      .eq("active", true)
      .eq("manual_pricing", false)
      .limit(5000);
    for (const p of rows ?? []) {
      const cost = (p as any).product_costs?.best_cost;
      const o = Array.isArray((p as any).pricing_overrides) ? (p as any).pricing_overrides[0] : (p as any).pricing_overrides;
      if (cost == null || o?.fixed_retail_price != null) continue;
      checked++;
      const markup = o?.retail_markup != null ? Number(o.retail_markup) : next.retail_markup;
      const to = commercialPrice(money(Number(cost) + markup), psych);
      const from = p.retail_price != null ? Number(p.retail_price) : null;
      if (to == null || from == null || money(from) === money(to)) continue;
      affected++;
      const below = to < Number(cost);
      if (below) belowCost++;
      sample.push({ id: p.id, name: p.canonical_name, from: money(from), to: money(to), cost: Number(cost), below_cost: below });
    }
    sample.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  }
  let decantAffected = 0;
  if (decantChanged) {
    const sizes = ([2, 5, 10] as const).filter((ml) => next[`decant_${ml}`] !== before[`decant_${ml}`]);
    const or = sizes.map((ml) => `decant_price_${ml}ml.is.null`).join(",");
    const { count } = await db.from("products").select("id", { count: "exact", head: true }).eq("active", true).eq("decant_available", true).or(or);
    decantAffected = count ?? 0;
  }
  let pixAffected = 0;
  if (pixChanged) {
    const { count } = await db.from("products").select("id", { count: "exact", head: true }).eq("active", true).not("retail_price", "is", null);
    pixAffected = count ?? 0;
  }
  return { affected, checked, sample: sample.slice(0, 8), below_cost: belowCost, decant_affected: decantAffected, pix_affected: pixAffected };
}

/**
 * Grava as regras. `userDb` é o cliente com o token do Admin (RLS + is_staff);
 * o recálculo do catálogo roda no banco com a mesma fórmula de sempre.
 */
export async function applyRules(userDb: Db, userId: string, patch: RulesPatch, source: "admin" | "copilot") {
  validate(patch);
  const before = await getRules(userDb);
  const changes = diffRules(before, patch);
  if (!changes.length) return { before, after: before, changes, recalculated: false };

  const s: Record<string, unknown> = {};
  const d: Record<string, unknown> = {};
  for (const c of changes) {
    if (c.key.startsWith("decant_")) d[`price_${c.key.split("_")[1]}ml`] = c.to;
    else s[c.key] = c.to;
  }
  const now = new Date().toISOString();
  if (Object.keys(s).length) {
    const { error } = await userDb.from("pricing_settings").update({ ...s, psych_strategy: "ends_90", updated_at: now }).eq("id", true);
    if (error) throw new Error(error.message);
  }
  if (Object.keys(d).length) {
    const { error } = await userDb.from("decant_settings").update({ ...d, updated_at: now }).eq("id", true);
    if (error) throw new Error(error.message);
  }
  const recalc = ["retail_markup", "wholesale_markup", "psych_pricing_active", "psych_max_reduction"].some((k) => k in s);
  if (recalc) {
    // Atualização em massa pelo custo já apurado (rápida/atômica), sem iterar
    // centenas de produtos e estourar o timeout do painel administrativo.
    const { error } = await userDb.rpc("bulk_reprice_from_cached_costs");
    if (error) throw new Error(`Regras salvas, mas o recálculo falhou: ${error.message}`);
  }
  await userDb.from("activity_logs").insert({
    user_id: userId,
    action: "pricing_rules_update",
    entity: "pricing_settings",
    entity_id: null,
    details: { source, changes },
  });
  return { before, after: await getRules(userDb), changes, recalculated: recalc };
}
