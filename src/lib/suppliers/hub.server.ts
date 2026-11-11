import { leadDays, leadText } from "@/lib/supplier-lead";
import { allocateFreight, marginOf } from "./freight";
import { shipmentFreightFromData } from "./freight.server";

export type HubOffer = {
  offer_id: string;
  image_url: string | null;
  supplier_id: string;
  supplier_name: string;
  priority: string;
  price: number | null;
  promo: boolean;
  availability: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  url: string | null;
  last_synced_at: string | null;
  supply_mode: string;
  origin: string | null;
  lead_days: number | null;
  lead_text: string;
  shipping: number | null;
  shipping_text: string;
  /** frete da remessa rateado por unidade (null = a consultar) */
  freight_per_unit: number | null;
  effective_unit_cost: number | null;
  min_order: number | null;
  use_for_purchasing: boolean;
  use_for_pricing: boolean;
  preference: "preferred" | "blocked" | null;
  catalog: { mode: string; decision: "allow" | "deny" | null; public: boolean };
  margin: number | null;
  min_margin: number | null;
  below_margin: boolean;
  stale: boolean;
  labels: Array<"Mais barato" | "Preferencial" | "Menor prazo">;
};

const STALE_MS = 72 * 3600_000;

/** Comparação de ofertas de um perfume. Só dados sincronizados; frete desconhecido nunca vira custo. */
export async function buildOfferComparison(db: any, productId: string, units = 1) {
  const qty = Math.max(1, Math.min(999, Math.round(units) || 1));
  const [{ data: product }, { data: offers }, { data: prefs }, { data: ps }] = await Promise.all([
    db.from("products").select("id, canonical_name, brand, volume_ml, image_url, local_stock, availability_source, retail_price, in_stock").eq("id", productId).maybeSingle(),
    db
      .from("supplier_products")
      .select("id, supplier_id, image_url, price, supplier_promotional_price, availability_status, in_stock, url, last_synced_at, active, suppliers(name, priority, show_in_comparison, use_for_purchasing, use_for_pricing, supply_mode, state, city, prep_days, transit_days, pickup_schedule, shipping_cost, travel_cost, min_order, catalog_mode, min_margin_pct), supplier_offer_catalog(decision)")
      .eq("product_id", productId)
      .eq("active", true),
    db.from("supplier_product_preferences").select("supplier_id, mode").eq("product_id", productId),
    db.from("purchase_settings").select("min_margin_pct").maybeSingle(),
  ]);
  if (!product) throw new Error("Perfume não encontrado.");
  const supplierIds = [...new Set((offers ?? []).map((o: any) => o.supplier_id))];
  const { data: quotes } = supplierIds.length
    ? await db.from("supplier_freight_quotes").select("supplier_id, price, units, source, status, created_at").in("supplier_id", supplierIds).order("created_at", { ascending: false })
    : { data: [] };
  const latest = new Map<string, any>();
  for (const q of quotes ?? []) if (!latest.has(q.supplier_id)) latest.set(q.supplier_id, q);
  const pref = new Map<string, "preferred" | "blocked">((prefs ?? []).map((p: any) => [p.supplier_id, p.mode]));
  const sale = product.retail_price != null ? Number(product.retail_price) : null;
  const globalMin = ps?.min_margin_pct != null ? Number(ps.min_margin_pct) : null;
  const list: HubOffer[] = [];
  for (const o of offers ?? []) {
    const s = o.suppliers;
    if (!s || !s.show_in_comparison || s.priority === "inactive") continue;
    const mode = s.supply_mode ?? "a_combinar";
    const price = o.price != null ? Number(o.price) : null;
    const fr = shipmentFreightFromData(s, latest.get(o.supplier_id) ?? null);
    const perUnit = fr.amount == null ? null : allocateFreight(fr.amount, [{ key: "x", qty, unitPrice: price }]).lines[0]?.perUnit ?? 0;
    const stale = !o.last_synced_at || Date.now() - Date.parse(o.last_synced_at) > STALE_MS;
    const decRow = Array.isArray(o.supplier_offer_catalog) ? o.supplier_offer_catalog[0] : o.supplier_offer_catalog;
    const decision = (decRow?.decision ?? null) as "allow" | "deny" | null;
    const catMode = s.catalog_mode ?? "all";
    const effective = price != null && perUnit != null && !stale ? Math.round((price + perUnit) * 100) / 100 : null;
    const minM = s.min_margin_pct != null ? Number(s.min_margin_pct) : globalMin;
    const margin = marginOf(sale, effective);
    list.push({
      offer_id: o.id,
      image_url: (o.image_url ?? null) as string | null,
      supplier_id: o.supplier_id,
      supplier_name: s.name,
      priority: s.priority,
      price,
      promo: o.supplier_promotional_price != null,
      availability: (o.availability_status ?? (o.in_stock ? "AVAILABLE" : "UNAVAILABLE")) as HubOffer["availability"],
      url: o.url,
      last_synced_at: o.last_synced_at,
      supply_mode: mode,
      origin: [s.city, s.state].filter(Boolean).join("/") || null,
      lead_days: leadDays(s),
      lead_text: leadText(s),
      shipping: fr.amount,
      shipping_text: fr.label + (fr.amount != null && qty > 1 ? ` · rateado em ${qty} un.` : ""),
      freight_per_unit: perUnit,
      effective_unit_cost: effective,
      min_order: s.min_order != null ? Number(s.min_order) : null,
      use_for_purchasing: s.use_for_purchasing,
      use_for_pricing: s.use_for_pricing,
      preference: pref.get(o.supplier_id) ?? null,
      catalog: { mode: catMode, decision, public: decision === "allow" ? true : decision === "deny" ? false : catMode === "all" },
      margin,
      min_margin: minM,
      below_margin: margin != null && minM != null && margin * 100 < minM,
      stale,
      labels: [],
    });
  }
  const usable = list.filter((o) => o.preference !== "blocked" && o.price != null && o.availability !== "UNAVAILABLE");
  // "Mais barato" pelo custo total estimado quando conhecido; senão pelo preço anunciado.
  const cost = (o: HubOffer) => o.effective_unit_cost ?? o.price! + 1e6;
  const cheapest = [...usable].sort((a, b) => cost(a) - cost(b))[0];
  if (cheapest) cheapest.labels.push("Mais barato");
  const preferred = usable.find((o) => o.preference === "preferred") ?? usable.find((o) => o.priority === "preferred");
  if (preferred) preferred.labels.push("Preferencial");
  const fastest = [...usable].filter((o) => o.lead_days != null).sort((a, b) => a.lead_days! - b.lead_days!)[0];
  if (fastest) fastest.labels.push("Menor prazo");
  list.sort((a, b) => (a.preference === "blocked" ? 1 : 0) - (b.preference === "blocked" ? 1 : 0) || (a.effective_unit_cost ?? a.price ?? 1e9) - (b.effective_unit_cost ?? b.price ?? 1e9));
  return {
    product: { id: product.id, name: product.canonical_name, brand: product.brand, volume_ml: product.volume_ml, image_url: (product.image_url ?? null) as string | null, sale_price: sale, public: !!product.in_stock },
    units: qty,
    // Frasco lacrado na loja dispensa fornecedor: prazo de fornecedor não se aplica.
    localStock: product.local_stock ?? 0,
    offers: list,
    suggestion: preferred?.supplier_id ?? cheapest?.supplier_id ?? null,
  };
}
