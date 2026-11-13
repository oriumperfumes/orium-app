/**
 * ASSISTENTE DE COMPRAS — Admin/Owner apenas.
 * Mensagem → intenção → busca no catálogo → ofertas do banco → cálculo no servidor.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BasketItem, Comparison } from "@/lib/purchase/compare.server";
import type { PurchaseRoute } from "@/lib/purchase/route.server";

type Ctx = { supabase: any; userId: string };

async function staffDb(context: Ctx) {
  const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!isStaff) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const BasketSchema = z.array(
  z.object({
    key: z.string().max(64),
    query: z.string().max(200),
    quantity: z.number().int().min(1).max(999),
    product_id: z.string().uuid().nullable(),
    forced_supplier_id: z.string().uuid().nullable(),
  }),
).max(200);

export type ChatReply = {
  kind: "compare" | "route" | "history" | "added" | "info" | "error";
  text: string;
  basket: BasketItem[];
  exclude: string[];
  comparison: Comparison | null;
  route: PurchaseRoute | null;
  history: { product: string; rows: Array<{ supplier_name: string; points: Array<{ price: number; at: string }> }> } | null;
  focus: "cheapest" | "fewest" | null;
};

let seq = 0;
const newKey = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

export const purchaseChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        message: z.string().min(1).max(8000),
        basket: BasketSchema,
        exclude: z.array(z.string().uuid()).max(20),
        option: z.enum(["cheapest", "fewest"]).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ChatReply> => {
    const db = await staffDb(context as Ctx);
    const { compareBasket, priceHistory } = await import("@/lib/purchase/compare.server");
    const { commandIntent, listIntent, aiExtract } = await import("@/lib/purchase/intent.server");
    const { data: sups } = await db.from("suppliers").select("id, name").eq("active", true);
    const suppliers = (sups ?? []) as Array<{ id: string; name: string }>;
    let basket: BasketItem[] = data.basket;
    let exclude = data.exclude;
    const out = (p: Partial<ChatReply>): ChatReply => ({
      kind: "info",
      text: "",
      basket,
      exclude,
      comparison: null,
      route: null,
      history: null,
      focus: null,
      ...p,
    });
    const compare = async () => compareBasket(db, basket, { exclude });

    const intent = listIntent(data.message) ?? commandIntent(data.message, suppliers.map((s) => s.name));

    if (intent && intent.kind !== "compare") {
      if (!basket.length && intent.kind !== "history")
        return out({ text: "Ainda não há perfumes na compra. Digite um perfume ou cole uma lista." });
      switch (intent.kind) {
        case "exclude": {
          const s = suppliers.find((x) => x.name === intent.supplier);
          if (s && !exclude.includes(s.id)) exclude = [...exclude, s.id];
          const c = await compare();
          return out({ kind: "compare", comparison: c, text: `Recalculei sem ${intent.supplier}.` });
        }
        case "swap": {
          const s = suppliers.find((x) => x.name === intent.supplier);
          const c0 = await compare();
          const { flat } = await import("@/lib/store-sales-phonetics");
          const target = c0.items.find((i) => i.product && flat(i.product.name).includes(flat(intent.product)));
          if (!s || !target) return out({ kind: "compare", comparison: c0, text: "Não encontrei esse perfume na compra atual." });
          if (!target.offers.some((o) => o.supplier_id === s.id))
            return out({ kind: "compare", comparison: c0, text: `${s.name} não tem oferta de ${target.product!.name}.` });
          basket = basket.map((b) => (b.key === target.key || b.product_id === target.product!.id ? { ...b, product_id: target.product!.id, forced_supplier_id: s.id } : b));
          return out({ kind: "compare", comparison: await compare(), text: `${target.product!.name} agora vem de ${s.name} (escolha manual).` });
        }
        case "history": {
          const c = basket.length ? await compare() : null;
          const { flat } = await import("@/lib/store-sales-phonetics");
          let pid: string | null = null;
          let pname = "";
          const hit = c?.items.find((i) => i.product && intent.product && flat(i.product.name).includes(flat(intent.product)));
          if (hit?.product) {
            pid = hit.product.id;
            pname = hit.product.name;
          } else if (intent.product) {
            const { resolveProductCandidates } = await import("@/lib/store-sales-match.server");
            const r = await resolveProductCandidates(db, intent.product);
            if (r[0]) {
              pid = r[0].product_id;
              pname = r[0].name;
            }
          }
          if (!pid) return out({ text: "Não encontrei esse perfume para ver o histórico." });
          const rows = await priceHistory(db, pid);
          return out({ kind: "history", history: { product: pname, rows }, text: rows.some((r) => r.points.length > 1) ? "" : "Ainda há poucas leituras de preço para mostrar tendência." });
        }
        case "fewest": {
          const c = await compare();
          return out({ kind: "compare", comparison: c, focus: "fewest", text: c.fewest ? "" : "Não dá para reduzir fornecedores sem deixar perfumes de fora." });
        }
        case "totals":
        case "only_stock":
          return out({ kind: "compare", comparison: await compare(), text: intent.kind === "only_stock" ? "A compra sugerida já usa apenas ofertas disponíveis." : "" });
        case "route":
          return out({ kind: "route", comparison: await compare(), text: "" });
        case "add_to_restock":
          return out({ kind: "compare", comparison: await compare(), focus: intent.option, text: "Confira e toque em Adicionar à reposição." });
      }
    }

    let items = intent?.kind === "compare" ? intent.items : [];
    let replace = true;
    if (!items.length) {
      try {
        const r = await aiExtract(data.message);
        items = r.items;
        replace = !r.add;
      } catch (e) {
        return out({ kind: "error", text: e instanceof Error ? e.message : "Não consegui entender." });
      }
    }
    if (!items.length)
      return out({ text: "Não identifiquei perfumes nessa mensagem. Digite o nome ou cole a lista (um por linha)." });
    // uma pergunta sobre 1 perfume vira foco; lista substitui a compra
    const fresh = items.map((i) => ({ key: newKey(), query: i.name, quantity: i.quantity, product_id: null, forced_supplier_id: null }));
    basket = replace && (items.length > 1 || !basket.length) ? fresh : [...basket, ...fresh];
    if (replace) exclude = [];
    const c = await compare();
    // fixa o produto resolvido para não pesquisar de novo
    basket = basket.map((b) => {
      const r = c.items.find((i) => i.key === b.key);
      return r?.product && !b.product_id ? { ...b, product_id: r.product.id } : b;
    });
    await db.from("purchase_comparisons").insert({
      created_by: (context as Ctx).userId,
      request_text: data.message.slice(0, 4000),
      items: basket as never,
      result: { total: c.cheapest.total, groups: c.cheapest.groups, generated_at: c.generated_at } as never,
    });
    return out({ kind: "compare", comparison: c, text: "" });
  });

/** Admin escolhe o perfume certo quando o nome era ambíguo. */
export const purchaseResolve = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ basket: BasketSchema, exclude: z.array(z.string().uuid()).max(20), key: z.string(), product_id: z.string().uuid().nullable(), supplier_id: z.string().uuid().nullable().optional(), quantity: z.number().int().min(0).max(999).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await staffDb(context as Ctx);
    const { compareBasket } = await import("@/lib/purchase/compare.server");
    let basket = data.basket.map((b) =>
      b.key === data.key
        ? {
            ...b,
            product_id: data.product_id ?? b.product_id,
            forced_supplier_id: data.supplier_id !== undefined ? data.supplier_id : b.forced_supplier_id,
            quantity: data.quantity ?? b.quantity,
          }
        : b,
    );
    basket = basket.filter((b) => b.quantity > 0);
    return { basket, comparison: await compareBasket(db, basket, { exclude: data.exclude }) };
  });

export const purchaseRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ supplier_ids: z.array(z.string().uuid()).min(1).max(10), origin: z.string().max(300).nullable(), return_to_origin: z.boolean().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await staffDb(context as Ctx);
    const { buildPurchaseRoute } = await import("@/lib/purchase/route.server");
    try {
      return await buildPurchaseRoute(db, data.supplier_ids, { originAddress: data.origin, returnToOrigin: data.return_to_origin });
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Falha ao calcular a rota.", origin: null, stops: [], return_to_origin: true, distance_km: null, duration_min: null, legs: [], tolls: null, travel_cost: null, maps_url: null, missing: [] } satisfies PurchaseRoute;
    }
  });

export const purchaseAddToRestock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        lines: z
          .array(z.object({ product_id: z.string().uuid(), supplier_id: z.string().uuid(), quantity: z.number().int().min(1).max(999), unit_cost: z.number().min(0), manual: z.boolean() }))
          .min(1)
          .max(300),
        request_id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await staffDb(context as Ctx);
    const { openRestockList } = await import("@/lib/orders-restock.server");
    // idempotência: o mesmo pedido de inclusão não entra duas vezes
    const { data: done } = await db.from("activity_logs").select("id").eq("action", "purchase_restock").eq("entity_id", data.request_id).limit(1);
    if (done?.length) return { added: 0, updated: 0, already: true };
    const listId = await openRestockList(db, (context as Ctx).userId);
    const { data: current } = await db.from("restock_items").select("id, product_id, supplier_id, quantity").eq("restock_list_id", listId).eq("status", "a comprar");
    let added = 0;
    let updated = 0;
    for (const l of data.lines) {
      const ex = (current ?? []).find((c: any) => c.product_id === l.product_id && c.supplier_id === l.supplier_id);
      if (ex) {
        await db.from("restock_items").update({ quantity: Number(ex.quantity ?? 0) + l.quantity, unit_cost: l.unit_cost, manual_choice: l.manual }).eq("id", ex.id);
        updated++;
      } else {
        await db.from("restock_items").insert({ restock_list_id: listId, product_id: l.product_id, supplier_id: l.supplier_id, quantity: l.quantity, unit_cost: l.unit_cost, cost_locked: true, manual_choice: l.manual });
        added++;
      }
    }
    await db.from("activity_logs").insert({ action: "purchase_restock", entity_id: data.request_id, user_id: (context as Ctx).userId, details: { lines: data.lines.length } as never }).then(() => null, () => null);
    return { added, updated, already: false };
  });

/** Configurações de compra + endereços dos fornecedores. */
export const purchaseSettingsGet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await staffDb(context as Ctx);
    const [{ data: s }, { data: sups }] = await Promise.all([
      db.from("purchase_settings").select("*").maybeSingle(),
      db
        .from("suppliers")
        .select("id, name, slug, website, pickup_address, latitude, longitude, phone, opening_hours, allows_pickup, notes, update_mode, last_successful_sync_at, sync_status, sync_message, last_catalog_size, ingestion_stats")
        .order("name"),
    ]);
    return { settings: s, suppliers: sups ?? [] };
  });

export const purchaseSettingsSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        origin_address: z.string().max(300).nullable(),
        return_to_origin: z.boolean(),
        cost_per_km: z.number().min(0).max(100).nullable(),
        fuel_km_per_liter: z.number().min(0).max(100).nullable(),
        fuel_price: z.number().min(0).max(100).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await staffDb(context as Ctx);
    const { data: prev } = await db.from("purchase_settings").select("origin_address").maybeSingle();
    const reset = (prev?.origin_address ?? null) !== data.origin_address ? { origin_latitude: null, origin_longitude: null } : {};
    await db.from("purchase_settings").update({ ...data, ...reset, updated_at: new Date().toISOString() }).eq("id", true);
    return { ok: true };
  });

export const supplierProfileSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        pickup_address: z.string().max(300).nullable(),
        phone: z.string().max(60).nullable(),
        opening_hours: z.string().max(200).nullable(),
        allows_pickup: z.boolean(),
        notes: z.string().max(1000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await staffDb(context as Ctx);
    const { data: prev } = await db.from("suppliers").select("pickup_address").eq("id", data.id).maybeSingle();
    const reset = (prev?.pickup_address ?? null) !== data.pickup_address ? { latitude: null, longitude: null } : {};
    const { id, ...rest } = data;
    await db.from("suppliers").update({ ...rest, ...reset }).eq("id", id);
    if (data.pickup_address && reset.latitude === null) {
      try {
        const { geocode } = await import("@/lib/purchase/route.server");
        const g = await geocode(data.pickup_address);
        if (g) await db.from("suppliers").update({ latitude: g.lat, longitude: g.lng }).eq("id", id);
        return { ok: true, geocoded: Boolean(g) };
      } catch {
        return { ok: true, geocoded: false };
      }
    }
    return { ok: true, geocoded: null };
  });

/**
 * Atualização manual assistida (quando o site bloqueia a leitura automática).
 * Uma linha por produto: "Nome ; preço ; disponível" (disponível = sim/não, opcional).
 * O preço é gravado exatamente como informado — custo real, sem ajuste.
 */
export const supplierManualImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ supplier_id: z.string().uuid(), text: z.string().min(3).max(200_000) }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await staffDb(context as Ctx);
    const { resolveProductCandidates, confidenceOf } = await import("@/lib/store-sales-match.server");
    const { cleanText } = await import("@/lib/suppliers/normalize.server");
    const rows = data.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2000);
    const stats = { lidos: 0, associados: 0, revisar: 0, ignorados: 0, precosAtualizados: 0 };
    const review: string[] = [];
    const now = new Date().toISOString();
    for (const row of rows) {
      const parts = row.split(/\t|;|\|/).map((p) => p.trim());
      const name = cleanText(parts[0] ?? "");
      const priceRaw = (parts[1] ?? "").replace(/r\$\s*/i, "").replace(/\./g, "").replace(",", ".");
      const price = Number(priceRaw);
      if (!name || !Number.isFinite(price) || price <= 0) {
        stats.ignorados++;
        continue;
      }
      stats.lidos++;
      const availability = !parts[2]
        ? "UNKNOWN"
        : /^(n|nao|não|0|indispon|esgot)/i.test(parts[2])
          ? "UNAVAILABLE"
          : /^(s|sim|1|dispon)/i.test(parts[2])
            ? "AVAILABLE"
            : "UNKNOWN";
      const avail = availability === "AVAILABLE";
      const externalKey = `manual:${name.toLowerCase().replace(/\s+/g, " ")}`;
      const { data: existing } = await db
        .from("supplier_products")
        .select("id, product_id, price, link_locked")
        .eq("supplier_id", data.supplier_id)
        .eq("supplier_sku", externalKey)
        .maybeSingle();
      let productId: string | null = existing?.product_id ?? null;
      if (!productId) {
        const c = await resolveProductCandidates(db, name);
        if (c[0] && confidenceOf(c) === "high") productId = c[0].product_id;
      }
      if (productId) stats.associados++;
      else {
        stats.revisar++;
        if (review.length < 30) review.push(name);
      }
      const payload = {
        supplier_id: data.supplier_id,
        supplier_sku: externalKey,
        supplier_product_name: name,
        normalized_name: name.toLowerCase(),
        price,
        raw_supplier_price: price,
        normalized_cost: price,
        cost_source: "manual",
        in_stock: avail,
        availability_status: availability,
        active: true,
        product_id: productId,
        offer_source: "manual",
        last_synced_at: now,
        cost_captured_at: now,
        catalog_eligible: false,
        catalog_eligibility_reason: "oferta-manual",
      };
      let offerId = existing?.id as string | undefined;
      if (existing) await db.from("supplier_products").update(payload).eq("id", existing.id);
      else {
        const { data: ins } = await db.from("supplier_products").insert(payload).select("id").single();
        offerId = ins?.id;
      }
      if (offerId && Number(existing?.price ?? 0) !== price) {
        stats.precosAtualizados++;
        await db.from("supplier_price_history").insert({ supplier_product_id: offerId, price, in_stock: avail, source: "manual" });
      }
    }
    await db
      .from("suppliers")
      .update({ update_mode: "manual", last_successful_sync_at: now, ingestion_stats: { ...stats, at: now, origem: "manual" } as never })
      .eq("id", data.supplier_id);
    return { ...stats, review };
  });
