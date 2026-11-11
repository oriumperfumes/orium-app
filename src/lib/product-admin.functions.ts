/** Ações manuais de produto no Admin. Mesmos serviços usados pelo Copilot. */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

async function ctx() {
  const { copilotContext, bearer } = await import("@/lib/copilot/context.server");
  const req = getRequest();
  return copilotContext(req ? bearer(req) : null);
}

const id = z.string().uuid();
const availabilityMode = z.enum(["AUTO", "FORCE_AVAILABLE", "FORCE_UNAVAILABLE"]);

/** Estado completo para o editor: estoque Orium, disponibilidade, preços, fornecedores e histórico. */
export const productAdminState = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ productId: id }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    const db = c.adminDb;
    const { automaticPrice, productHistory, OVERRIDE_TO_MODE } = await import("@/lib/product-admin.server");
    const [{ data: p }, { data: o }, { data: cost }, auto, history, { data: offers }] = await Promise.all([
      db
        .from("products")
        .select("id, local_stock, availability_override, supplier_available, availability_source, in_stock, sale_mode, decant_available, decant_ml_consumed, volume_ml, manual_pricing, manual_cost, retail_price, wholesale_price, decant_price_2ml, decant_price_5ml, decant_price_10ml, active, catalog_eligible")
        .eq("id", data.productId)
        .single(),
      db.from("pricing_overrides").select("fixed_retail_price, fixed_wholesale_price").eq("product_id", data.productId).maybeSingle(),
      db.from("product_costs").select("best_cost, best_supplier_id").eq("product_id", data.productId).maybeSingle(),
      automaticPrice(c, data.productId),
      productHistory(c, data.productId),
      db.from("supplier_products").select("id, supplier_id, supplier_product_name, price, in_stock, last_synced_at, suppliers(name)").eq("product_id", data.productId),
    ]);
    const num = (v: unknown) => (v == null ? null : Number(v));
    return {
      localStock: Number(p.local_stock ?? 0),
      mode: OVERRIDE_TO_MODE[p.availability_override] ?? "AUTO",
      source: String(p.availability_source ?? "none"),
      supplierAvailable: p.supplier_available === true,
      inStock: p.in_stock === true,
      public: p.in_stock && p.active && p.catalog_eligible ? "Disponível" : "Indisponível",
      saleMode: String(p.sale_mode ?? "BOTH"),
      decantAvailable: p.decant_available === true,
      decantMlConsumed: num(p.decant_ml_consumed) ?? 0,
      volumeMl: num(p.volume_ml),
      manualPricing: p.manual_pricing === true,
      customRetail: o?.fixed_retail_price != null,
      customWholesale: o?.fixed_wholesale_price != null,
      retail: num(p.retail_price),
      wholesale: num(p.wholesale_price),
      decant: { d2: num(p.decant_price_2ml), d5: num(p.decant_price_5ml), d10: num(p.decant_price_10ml) },
      cost: num(p.manual_cost) ?? num(cost?.best_cost),
      bestSupplierId: (cost?.best_supplier_id ?? null) as string | null,
      auto: auto ? { retail: num(auto.retail), wholesale: num(auto.wholesale) } : null,
      offers: (offers ?? []).map((x: any): { id: string; supplierId: string; supplier: string; name: string; price: number | null; inStock: boolean; syncedAt: string | null } => ({
        id: x.id as string,
        supplierId: x.supplier_id as string,
        supplier: (x.suppliers?.name ?? "Fornecedor") as string,
        name: x.supplier_product_name as string,
        price: num(x.price),
        inStock: x.in_stock === true,
        syncedAt: (x.last_synced_at ?? null) as string | null,
      })),
      history,
    };
  });

export const productSetLocalStock = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ productId: id, mode: z.enum(["set", "add", "remove"]), quantity: z.number().int().min(0).max(9999), reason: z.string().max(120).nullable().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const c = await ctx();
    const { setLocalStock } = await import("@/lib/product-admin.server");
    return setLocalStock(c, { productId: data.productId, mode: data.mode, quantity: data.quantity, reason: data.reason ?? null, source: "painel" });
  });

export const productSetAvailability = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ productIds: z.array(id).min(1).max(500), mode: availabilityMode }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    const { setAvailabilityMode } = await import("@/lib/product-admin.server");
    let ok = 0;
    const failed: string[] = [];
    for (const productId of data.productIds) {
      try {
        await setAvailabilityMode(c, { productId, mode: data.mode, source: "painel" });
        ok++;
      } catch {
        failed.push(productId);
      }
    }
    return { ok, failed };
  });

export const productUpdatePrice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        productId: id,
        kind: z.enum(["pix", "wholesale", "decant_2", "decant_5", "decant_10", "auto", "auto_wholesale"]),
        value: z.number().positive().max(100000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const c = await ctx();
    const { updateProductPrice } = await import("@/lib/product-admin.server");
    await updateProductPrice(c, { productId: data.productId, kind: data.kind, value: data.value, source: "painel" });
    return { ok: true };
  });

/** Volta vários produtos ao preço automático (sem preço fixado). */
export const productsResetPrice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ productIds: z.array(id).min(1).max(500) }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    const { updateProductPrice } = await import("@/lib/product-admin.server");
    let ok = 0;
    for (const productId of data.productIds) {
      try {
        await updateProductPrice(c, { productId, kind: "auto", value: null, source: "painel" });
        ok++;
      } catch {
        /* produto manual não tem automático */
      }
    }
    return { ok };
  });
