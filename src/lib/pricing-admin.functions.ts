/**
 * CENTRAL DE PREÇOS (Admin) — leitura e escrita.
 *
 * Toda conta usa a MESMA fórmula do catálogo e do pedido:
 *   custo do fornecedor vencedor + margem → preço comercial (final ,90)
 * (`src/lib/pricing.server.ts` + `src/lib/commercial-price.ts`).
 * Aqui não existe fórmula nova: só consulta, simulação e gravação.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { commercialPrice, type PsychSettings } from "@/lib/commercial-price";
import { bestPromotion, isRunning, applyPercent, type Promotion } from "@/lib/promotions";

const money = (v: number) => Number(v.toFixed(2));

type Ctx = { supabase: any; userId: string };

async function assertStaff({ supabase, userId }: Ctx) {
  const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!isStaff) throw new Error("Sem permissão.");
}

async function loadRules(db: any) {
  const { data } = await db.from("pricing_settings").select("*").maybeSingle();
  return {
    retailMarkup: Number(data?.retail_markup ?? 120),
    wholesaleMarkup: Number(data?.wholesale_markup ?? 50),
    wholesaleMinQuantity: Number(data?.wholesale_min_quantity ?? 6),
    pixDiscountPercent: Number(data?.pix_discount_percent ?? 5),
    pixDiscountActive: data?.pix_discount_active !== false,
    psych: {
      active: data?.psych_pricing_active === true,
      strategy: String(data?.psych_strategy ?? "ends_90"),
      maxReduction: Number(data?.psych_max_reduction ?? 0),
    } as PsychSettings,
  };
}

export type PricingSearchRow = {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
  cost: number | null;
  retail: number | null;
  wholesale: number | null;
  custom: boolean;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Busca tolerante a erro de digitação, sobre o catálogo ativo. */
export const pricingSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { term: string }) => data)
  .handler(async ({ data, context }): Promise<PricingSearchRow[]> => {
    await assertStaff(context as Ctx);
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
    const term = norm(data.term ?? "");
    if (term.length < 2) return [];
    const tokens = term.split(" ").filter((t) => t.length >= 2);
    const first = tokens[0] ?? term;

    const { data: rows } = await db
      .from("products")
      .select(
        "id, canonical_name, brand, image_url, retail_price, wholesale_price, manual_pricing, search_text, product_costs(best_cost), pricing_overrides(fixed_retail_price)",
      )
      .eq("active", true)
      .ilike("search_text", `%${first}%`)
      .limit(60);

    const scored = (rows ?? [])
      .map((p: any) => {
        const hay = norm(`${p.brand ?? ""} ${p.canonical_name}`);
        const hits = tokens.filter((t) => hay.includes(t)).length;
        return { p, score: hits + (hay.startsWith(first) ? 0.5 : 0) };
      })
      .filter((r: any) => r.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 8);

    return scored.map(({ p }: any) => ({
      id: p.id,
      name: p.canonical_name,
      brand: p.brand,
      image: p.image_url,
      cost: p.product_costs?.best_cost != null ? Number(p.product_costs.best_cost) : null,
      retail: p.retail_price != null ? Number(p.retail_price) : null,
      wholesale: p.wholesale_price != null ? Number(p.wholesale_price) : null,
      custom: p.manual_pricing === true || p.pricing_overrides?.fixed_retail_price != null,
    }));
  });

export type PricingOfferRow = {
  supplierName: string;
  price: number | null;
  inStock: boolean;
  best: boolean;
};

export type PricingSnapshot = {
  productId: string;
  name: string;
  brand: string | null;
  image: string | null;
  volumeMl: number | null;
  concentration: string | null;
  /** "manual" = cadastro manual; senão vem de fornecedor */
  source: string;
  saleMode: string;
  cost: number | null;
  costUpdatedAt: string | null;
  supplierName: string | null;
  usedOutOfStockCost: boolean;
  retailMarkup: number;
  wholesaleMarkup: number;
  wholesaleMinQuantity: number;
  baseRetail: number | null;
  retail: number | null;
  baseWholesale: number | null;
  wholesale: number | null;
  psych: PsychSettings;
  pixDiscountPercent: number;
  pixDiscountActive: boolean;
  /** preço fixado à mão (override) ou produto manual */
  customRetail: number | null;
  manualPricing: boolean;
  offers: PricingOfferRow[];
  costHistory: Array<{ at: string; price: number; supplierName: string }>;
  decants: Array<{ ml: number; price: number; custom: boolean }>;
  promotion: { name: string; percent: number; endsAt: string | null; price: number } | null;
};

/** Tudo que o Admin precisa saber sobre o preço de um perfume. */
export const pricingSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string }) => data)
  .handler(async ({ data, context }): Promise<PricingSnapshot | null> => {
    await assertStaff(context as Ctx);
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
    const { calculateProductPricing } = await import("@/lib/pricing.server");

    const [{ data: product }, rules, { data: decantSettings }, { data: promoRows }] = await Promise.all([
      db
        .from("products")
        .select(
          "id, canonical_name, brand, image_url, volume_ml, concentration, source, sale_mode, manual_pricing, manual_cost, retail_price, wholesale_price, base_retail_price, base_wholesale_price, decant_price_2ml, decant_price_5ml, decant_price_10ml, product_costs(best_cost, updated_at, suppliers(name)), pricing_overrides(fixed_retail_price, fixed_wholesale_price)",
        )
        .eq("id", data.productId)
        .maybeSingle(),
      loadRules(db),
      db.from("decant_settings").select("*").maybeSingle(),
      db.from("promotions").select("*").eq("active", true),
    ]);
    if (!product) return null;

    const manual = product.manual_pricing === true;
    const calc = manual ? null : await calculateProductPricing(db, data.productId);

    const cost = manual
      ? product.manual_cost != null
        ? Number(product.manual_cost)
        : null
      : (calc?.baseCost ?? null);

    const winnerId = calc?.offers.find((o) => o.supplierId === calc?.winningSupplierId)?.supplierProductId ?? null;
    const offers: PricingOfferRow[] = (calc?.offers ?? []).map((o) => ({
      supplierName: o.supplierName ?? "Fornecedor",
      price: o.supplierPrice,
      inStock: o.inStock,
      best: o.supplierProductId === winnerId,
    }));

    let costHistory: PricingSnapshot["costHistory"] = [];
    if (!manual) {
      const { data: sp } = await db
        .from("supplier_products")
        .select("id, suppliers(name)")
        .eq("product_id", data.productId);
      const ids = (sp ?? []).map((r: any) => r.id);
      const nameById = new Map((sp ?? []).map((r: any) => [r.id, r.suppliers?.name ?? "Fornecedor"]));
      if (ids.length) {
        const { data: hist } = await db
          .from("supplier_price_history")
          .select("recorded_at, price, supplier_product_id")
          .in("supplier_product_id", ids)
          .not("price", "is", null)
          .order("recorded_at", { ascending: false })
          .limit(10);
        costHistory = (hist ?? []).map((h: any) => ({
          at: h.recorded_at,
          price: Number(h.price),
          supplierName: nameById.get(h.supplier_product_id) ?? "Fornecedor",
        }));
      }
    }

    const retail = product.retail_price != null ? Number(product.retail_price) : (calc?.retailPrice ?? null);
    const now = Date.now();
    const promos = ((promoRows ?? []) as Promotion[]).filter((p) => isRunning(p, now));
    const promo = bestPromotion(promos, { productId: data.productId, variant: "FULL" }, now);

    const globalDecant = (ml: number) => {
      const g = decantSettings?.[`price_${ml}ml`];
      return g != null && Number(g) > 0 ? Number(g) : ml === 2 ? 19.9 : ml === 5 ? 39.9 : 69.9;
    };

    return {
      productId: product.id,
      name: product.canonical_name,
      brand: product.brand,
      image: product.image_url,
      volumeMl: product.volume_ml,
      concentration: product.concentration,
      source: product.source,
      saleMode: product.sale_mode,
      cost,
      costUpdatedAt: product.product_costs?.updated_at ?? null,
      supplierName: manual ? null : (calc?.winningSupplierName ?? product.product_costs?.suppliers?.name ?? null),
      usedOutOfStockCost: calc?.usedOutOfStockCost ?? false,
      retailMarkup: calc?.retailMarkup ?? rules.retailMarkup,
      wholesaleMarkup: calc?.wholesaleMarkup ?? rules.wholesaleMarkup,
      wholesaleMinQuantity: rules.wholesaleMinQuantity,
      baseRetail: manual ? retail : (calc?.baseRetailPrice ?? null),
      retail,
      baseWholesale: manual
        ? product.wholesale_price != null
          ? Number(product.wholesale_price)
          : null
        : (calc?.baseWholesalePrice ?? null),
      wholesale:
        product.wholesale_price != null ? Number(product.wholesale_price) : (calc?.wholesalePrice ?? null),
      psych: rules.psych,
      pixDiscountPercent: rules.pixDiscountPercent,
      pixDiscountActive: rules.pixDiscountActive,
      customRetail:
        product.pricing_overrides?.fixed_retail_price != null
          ? Number(product.pricing_overrides.fixed_retail_price)
          : manual
            ? retail
            : null,
      manualPricing: manual,
      offers,
      costHistory,
      decants: [2, 5, 10].map((ml) => {
        const own = product[`decant_price_${ml}ml`];
        const custom = own != null && Number(own) > 0;
        return { ml, price: custom ? Number(own) : globalDecant(ml), custom };
      }),
      promotion: promo
        ? {
            name: promo.name,
            percent: Number(promo.discount_percent),
            endsAt: promo.ends_at,
            price: applyPercent(retail ?? 0, Number(promo.discount_percent)),
          }
        : null,
    };
  });

export type ImpactRow = { id: string; name: string; brand: string | null; from: number; to: number };
export type PricingImpact = { checked: number; affected: number; sample: ImpactRow[]; delta: number };

/** Quantos produtos mudam de preço com a nova regra — antes de salvar nada. */
export const pricingImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { retailMarkup: number; psychActive: boolean; psychMaxReduction: number }) => data,
  )
  .handler(async ({ data, context }): Promise<PricingImpact> => {
    await assertStaff(context as Ctx);
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
    const psych: PsychSettings = {
      active: data.psychActive,
      strategy: "ends_90",
      maxReduction: Number(data.psychMaxReduction) || 0,
    };

    const { data: rows } = await db
      .from("products")
      .select("id, canonical_name, brand, retail_price, manual_pricing, product_costs(best_cost)")
      .eq("active", true)
      .eq("manual_pricing", false)
      .limit(3000);

    const changes: ImpactRow[] = [];
    let checked = 0;
    let delta = 0;
    for (const p of rows ?? []) {
      const cost = (p as any).product_costs?.best_cost;
      if (cost == null) continue;
      checked++;
      const next = commercialPrice(money(Number(cost) + Number(data.retailMarkup)), psych);
      const from = p.retail_price != null ? Number(p.retail_price) : null;
      if (next == null || from == null || money(from) === money(next)) continue;
      delta += next - from;
      changes.push({ id: p.id, name: p.canonical_name, brand: p.brand, from: money(from), to: money(next) });
    }

    changes.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
    return {
      checked,
      affected: changes.length,
      sample: changes.slice(0, 8),
      delta: money(changes.length ? delta / changes.length : 0),
    };
  });

/** Preço fixado à mão para um produto (sobrevive à sincronização). */
export const setProductPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string; retailPrice: number | null }) => data)
  .handler(async ({ data, context }) => {
    await assertStaff(context as Ctx);
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
    const { persistProductPricing } = await import("@/lib/pricing.server");

    const { data: product } = await db
      .from("products")
      .select("id, canonical_name, manual_pricing, retail_price")
      .eq("id", data.productId)
      .maybeSingle();
    if (!product) throw new Error("Produto não encontrado.");

    if (product.manual_pricing === true) {
      if (data.retailPrice == null) throw new Error("Produto manual precisa de um preço.");
      const value = money(Number(data.retailPrice));
      const { error } = await db
        .from("products")
        .update({ retail_price: value, base_retail_price: value, updated_at: new Date().toISOString() })
        .eq("id", data.productId);
      if (error) throw new Error(error.message);
    } else if (data.retailPrice == null) {
      const { data: current } = await db
        .from("pricing_overrides")
        .select("id, fixed_wholesale_price, retail_markup, wholesale_markup")
        .eq("product_id", data.productId)
        .maybeSingle();
      if (current) {
        const empty =
          current.fixed_wholesale_price == null && current.retail_markup == null && current.wholesale_markup == null;
        if (empty) await db.from("pricing_overrides").delete().eq("product_id", data.productId);
        else await db.from("pricing_overrides").update({ fixed_retail_price: null }).eq("product_id", data.productId);
      }
      await persistProductPricing(db, data.productId);
    } else {
      const { error } = await db
        .from("pricing_overrides")
        .upsert(
          { product_id: data.productId, fixed_retail_price: money(Number(data.retailPrice)) },
          { onConflict: "product_id" },
        );
      if (error) throw new Error(error.message);
      await persistProductPricing(db, data.productId);
    }

    await db.from("activity_logs").insert({
      user_id: context.userId,
      action: data.retailPrice == null ? "preço voltou ao automático" : "preço personalizado",
      entity: "products",
      entity_id: data.productId,
      details: { product: product.canonical_name, from: product.retail_price, to: data.retailPrice },
    });

    return { ok: true };
  });

export type OverrideRow = {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
  retail: number | null;
  cost: number | null;
  kind: "override" | "manual";
};

/** Produtos que não seguem a regra automática. */
export const pricingOverrides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OverrideRow[]> => {
    await assertStaff(context as Ctx);
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

    const [{ data: fixed }, { data: manual }] = await Promise.all([
      db
        .from("pricing_overrides")
        .select("product_id, fixed_retail_price, products(canonical_name, brand, image_url, retail_price, product_costs(best_cost))")
        .not("fixed_retail_price", "is", null)
        .limit(60),
      db
        .from("products")
        .select("id, canonical_name, brand, image_url, retail_price, manual_cost")
        .eq("active", true)
        .eq("manual_pricing", true)
        .limit(60),
    ]);

    const rows: OverrideRow[] = [];
    for (const o of fixed ?? []) {
      const p = (o as any).products;
      if (!p) continue;
      rows.push({
        id: o.product_id,
        name: p.canonical_name,
        brand: p.brand,
        image: p.image_url,
        retail: p.retail_price != null ? Number(p.retail_price) : null,
        cost: p.product_costs?.best_cost != null ? Number(p.product_costs.best_cost) : null,
        kind: "override",
      });
    }
    for (const p of manual ?? []) {
      rows.push({
        id: p.id,
        name: p.canonical_name,
        brand: p.brand,
        image: p.image_url,
        retail: p.retail_price != null ? Number(p.retail_price) : null,
        cost: p.manual_cost != null ? Number(p.manual_cost) : null,
        kind: "manual",
      });
    }
    return rows;
  });

/** Regras globais (margens, Pix, preço comercial, decants) — mesmo serviço usado pelo Copilot. */
export const updatePricingRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: import("@/lib/pricing-rules.server").RulesPatch) => data)
  .handler(async ({ data, context }) => {
    await assertStaff(context as Ctx);
    const { applyRules } = await import("@/lib/pricing-rules.server");
    const r = await applyRules((context as Ctx).supabase, (context as Ctx).userId, data, "admin");
    return { changes: r.changes.length, recalculated: r.recalculated };
  });

/**
 * Chave geral "Preços sob consulta" (Admin → Precificação). Ligada, a loja
 * mostra "Sob consulta" no lugar de todos os preços e não fecha pedido pelo site.
 * Grava com o cliente do usuário: a política do banco só deixa o dono alterar.
 */
export const setPricesOnRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { on: boolean }) => ({ on: data?.on === true }))
  .handler(async ({ data, context }) => {
    await assertStaff(context as Ctx);
    const { supabase, userId } = context as Ctx;
    const { data: rows, error } = await supabase
      .from("pricing_settings")
      .update({ prices_on_request: data.on, updated_at: new Date().toISOString() })
      .eq("id", true)
      .select("prices_on_request");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Só o dono da loja pode mudar esta opção.");
    await supabase.from("activity_logs").insert({
      user_id: userId,
      action: "pricing_rules_update",
      entity: "pricing_settings",
      entity_id: null,
      details: { source: "admin", changes: [{ key: "prices_on_request", to: data.on }] },
    });
    return { on: data.on };
  });

/**
 * Abertura da Home em modo Black (Admin → Precificação). Ligada e com uma
 * campanha "Black" em vigor, o vídeo do topo vira a chamada da Black November.
 */
export const setBlackHero = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { on: boolean }) => ({ on: data?.on === true }))
  .handler(async ({ data, context }) => {
    await assertStaff(context as Ctx);
    const { supabase, userId } = context as Ctx;
    const { data: rows, error } = await (supabase as any)
      .from("pricing_settings")
      .update({ black_hero: data.on, updated_at: new Date().toISOString() })
      .eq("id", true)
      .select("black_hero");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Só o dono da loja pode mudar esta opção.");
    await supabase.from("activity_logs").insert({
      user_id: userId,
      action: "pricing_rules_update",
      entity: "pricing_settings",
      entity_id: null,
      details: { source: "admin", changes: [{ key: "black_hero", to: data.on }] },
    });
    return { on: data.on };
  });
