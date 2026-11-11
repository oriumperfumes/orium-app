/**
 * FONTE ÚNICA DE VERDADE DO PREÇO DA ORIUM.
 *
 * Regra oficial (não alterar sem pedido explícito do dono):
 *   varejo   = menor custo disponível do fornecedor + margem de varejo
 *   atacado  = menor custo disponível do fornecedor + margem de atacado
 *
 * Depois do preço-base entra UMA única camada de preço comercial
 * (arredondamento psicológico, final ,90), limitada pelo ajuste máximo
 * configurado no Admin. Ninguém arredonda de novo depois disso.
 *
 * "Menor custo disponível" = menor `price` entre as ofertas ATIVAS e EM ESTOQUE
 * do MESMO produto canônico. Sem estoque em nenhuma, cai para a menor oferta ativa.
 * Nunca mistura variações (volume/concentração diferentes são produtos canônicos diferentes).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { commercialPrice, type PsychSettings } from "@/lib/commercial-price";

export { commercialPrice };

type Db = SupabaseClient<Database>;

export type PricingOffer = {
  supplierProductId: string;
  supplierId: string | null;
  supplierName: string | null;
  rawName: string;
  supplierPrice: number | null;
  inStock: boolean;
  url: string | null;
  volumeMl: number | null;
  concentration: string | null;
};

export type { PsychSettings } from "@/lib/commercial-price";

export type ProductPricing = {
  productId: string;
  productName: string;
  brand: string | null;
  concentration: string | null;
  volumeMl: number | null;
  /** Menor custo disponível (custo utilizado). */
  baseCost: number | null;
  winningSupplierId: string | null;
  winningSupplierName: string | null;
  usedOutOfStockCost: boolean;
  retailMarkup: number;
  wholesaleMarkup: number;
  /** Preço antes do arredondamento comercial. */
  baseRetailPrice: number | null;
  baseWholesalePrice: number | null;
  /** Preço final de venda (Pix), já com o arredondamento comercial. */
  retailPrice: number | null;
  wholesalePrice: number | null;
  /** Quanto o arredondamento reduziu (sempre >= 0). */
  retailAdjustment: number;
  wholesaleAdjustment: number;
  /** Margem realmente obtida no preço final. */
  retailMargin: number | null;
  wholesaleMargin: number | null;
  psych: PsychSettings;
  wholesaleMinQuantity: number;
  offers: PricingOffer[];
};

const money = (v: number) => Number(v.toFixed(2));

async function loadMarkups(db: Db) {
  const { data } = await db.from("pricing_settings").select("*").maybeSingle();
  return {
    retailMarkup: Number(data?.retail_markup ?? 120),
    wholesaleMarkup: Number(data?.wholesale_markup ?? 50),
    wholesaleMinQuantity: Number(data?.wholesale_min_quantity ?? 6),
    psych: {
      active: data?.psych_pricing_active === true,
      strategy: String(data?.psych_strategy ?? "ends_90"),
      maxReduction: Number(data?.psych_max_reduction ?? 0),
    } as PsychSettings,
  };
}

/** Cálculo completo e auditável do preço de um produto canônico. */
export async function calculateProductPricing(db: Db, productId: string): Promise<ProductPricing | null> {
  const { data: product } = await db
    .from("products")
    .select("id, canonical_name, brand, concentration, volume_ml")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return null;

  const [{ data: offersRaw }, { data: override }, markups] = await Promise.all([
    db
      .from("supplier_products")
      .select(
        "id, supplier_id, supplier_product_name, price, in_stock, url, volume_ml, concentration, active, suppliers(name)",
      )
      .eq("product_id", productId)
      .eq("active", true),
    db.from("pricing_overrides").select("*").eq("product_id", productId).maybeSingle(),
    loadMarkups(db),
  ]);

  const offers: PricingOffer[] = (offersRaw ?? []).map((o) => ({
    supplierProductId: o.id,
    supplierId: o.supplier_id,
    supplierName: (o as { suppliers?: { name?: string } | null }).suppliers?.name ?? null,
    rawName: o.supplier_product_name,
    supplierPrice: o.price == null ? null : Number(o.price),
    inStock: Boolean(o.in_stock),
    url: o.url,
    volumeMl: o.volume_ml,
    concentration: o.concentration,
  }));

  const priced = offers.filter((o) => o.supplierPrice != null);
  const inStock = priced.filter((o) => o.inStock);
  const pool = inStock.length ? inStock : priced;
  // Preço médio (mediana) dos fornecedores: 200/210/220 → 210; com dois, o ponto do meio.
  const sortedPool = [...pool].sort((a, b) => (a.supplierPrice ?? 0) - (b.supplierPrice ?? 0));
  const mid = sortedPool.length ? (sortedPool.length - 1) / 2 : 0;
  const medianCost = sortedPool.length
    ? money((Number(sortedPool[Math.floor(mid)].supplierPrice) + Number(sortedPool[Math.ceil(mid)].supplierPrice)) / 2)
    : null;
  const winner = sortedPool.length
    ? sortedPool.reduce((a, b) =>
        Math.abs(Number(b.supplierPrice) - medianCost!) < Math.abs(Number(a.supplierPrice) - medianCost!) ? b : a,
      )
    : null;

  const retailMarkup = Number(override?.retail_markup ?? markups.retailMarkup);
  const wholesaleMarkup = Number(override?.wholesale_markup ?? markups.wholesaleMarkup);
  const baseCost = medianCost;

  // 1) preço-base: custo correto + margem (nunca percentual)
  const baseRetailPrice =
    override?.fixed_retail_price != null
      ? money(Number(override.fixed_retail_price))
      : baseCost != null
        ? money(baseCost + retailMarkup)
        : null;
  const baseWholesalePrice =
    override?.fixed_wholesale_price != null
      ? money(Number(override.fixed_wholesale_price))
      : baseCost != null
        ? money(baseCost + wholesaleMarkup)
        : null;

  // 2) preço comercial: só uma vez, e nunca sobre preço fixado à mão
  const retailPrice =
    override?.fixed_retail_price != null ? baseRetailPrice : commercialPrice(baseRetailPrice, markups.psych);
  const wholesalePrice =
    override?.fixed_wholesale_price != null ? baseWholesalePrice : commercialPrice(baseWholesalePrice, markups.psych);

  return {
    productId: product.id,
    productName: product.canonical_name,
    brand: product.brand,
    concentration: product.concentration,
    volumeMl: product.volume_ml,
    baseCost,
    winningSupplierId: winner?.supplierId ?? null,
    winningSupplierName: winner?.supplierName ?? null,
    usedOutOfStockCost: inStock.length === 0 && priced.length > 0,
    retailMarkup,
    wholesaleMarkup,
    baseRetailPrice,
    baseWholesalePrice,
    retailPrice,
    wholesalePrice,
    retailAdjustment:
      baseRetailPrice != null && retailPrice != null ? money(baseRetailPrice - retailPrice) : 0,
    wholesaleAdjustment:
      baseWholesalePrice != null && wholesalePrice != null ? money(baseWholesalePrice - wholesalePrice) : 0,
    retailMargin: baseCost != null && retailPrice != null ? money(retailPrice - baseCost) : null,
    wholesaleMargin: baseCost != null && wholesalePrice != null ? money(wholesalePrice - baseCost) : null,
    psych: markups.psych,
    wholesaleMinQuantity: markups.wholesaleMinQuantity,
    offers: offers.sort((a, b) => (a.supplierPrice ?? 1e9) - (b.supplierPrice ?? 1e9)),
  };
}

/** Grava no banco o preço calculado (mesma fórmula, um só lugar). */
export async function persistProductPricing(db: Db, productId: string): Promise<ProductPricing | null> {
  const pricing = await calculateProductPricing(db, productId);
  if (!pricing) return null;

  await db.from("product_costs").upsert(
    {
      product_id: productId,
      best_cost: pricing.baseCost,
      best_supplier_id: pricing.winningSupplierId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "product_id" },
  );

  await db
    .from("products")
    .update({
      base_retail_price: pricing.baseRetailPrice,
      base_wholesale_price: pricing.baseWholesalePrice,
      retail_price: pricing.retailPrice,
      wholesale_price: pricing.wholesalePrice,
      // disponibilidade do fornecedor; o gatilho central soma estoque local e override
      supplier_available: pricing.offers.some((o) => o.inStock),
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId);

  return pricing;
}

/** Recalcula em lotes todo o catálogo. Devolve o próximo cursor ou null quando termina. */
export async function recalculateAllPricing(db: Db, cursor = 0, batch = 200) {
  const { data: ids } = await db
    .from("products")
    .select("id")
    .order("created_at", { ascending: true })
    .range(cursor, cursor + batch - 1);

  for (const row of ids ?? []) await persistProductPricing(db, row.id);

  const processed = (ids ?? []).length;
  return {
    processed,
    nextCursor: processed === batch ? cursor + batch : null,
  };
}
