import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Central de Fornecedores — análise por URL, cadastro, prioridades, logística,
 * preferência por perfume e comparação de ofertas. Tudo exclusivo da equipe.
 */
async function assertStaff(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!data) throw new Error("Sem permissão.");
}

export const analyzeSupplierUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string }) => {
    if (typeof d?.url !== "string" || d.url.length > 300) throw new Error("Endereço inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { analyzeKyte, parseKyteUrl } = await import("@/lib/suppliers/kyte-connector.server");
    let store;
    try {
      store = parseKyteUrl(data.url);
    } catch (e) {
      return { ok: false, platform: "desconhecida", message: e instanceof Error ? e.message : "Endereço inválido." } as const;
    }
    const { data: existing } = store
      ? await context.supabase.from("suppliers").select("id, name").ilike("website", `${store.base}%`).maybeSingle()
      : { data: null };
    const analysis = await analyzeKyte(data.url);
    return { ...analysis, existing: existing ?? null };
  });

const PRIORITIES = ["preferred", "secondary", "reference", "inactive"] as const;
const MODES = ["pickup", "carrier", "supplier_delivery", "a_combinar"] as const;

export const createSupplierFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string; name: string; aid: string; priority: (typeof PRIORITIES)[number]; state?: string | null; city?: string | null; supplyMode?: (typeof MODES)[number] }) => {
    if (!d?.name?.trim() || d.name.length > 80) throw new Error("Informe o nome.");
    if (!PRIORITIES.includes(d.priority)) throw new Error("Prioridade inválida.");
    if (!/^[A-Za-z0-9]{8,32}$/.test(d.aid ?? "")) throw new Error("Catálogo não identificado.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { parseKyteUrl } = await import("@/lib/suppliers/kyte-connector.server");
    const store = parseKyteUrl(data.url);
    if (!store) throw new Error("Só lojas Kyte podem ser integradas automaticamente por enquanto.");
    const reference = data.priority === "reference" || data.priority === "inactive";
    const slug = store.slug.toLowerCase();
    const { data: row, error } = await context.supabase
      .from("suppliers")
      .insert({
        name: data.name.trim(),
        slug,
        website: store.base,
        active: data.priority !== "inactive",
        adapter: "kyte-connector",
        platform: "kyte",
        adapter_config: { aid: data.aid },
        priority: data.priority,
        use_for_purchasing: !reference,
        use_for_pricing: false,
        use_for_availability: false,
        show_in_comparison: true,
        auto_sync: data.priority !== "inactive",
        creates_catalog_products: false,
        state: data.state?.trim() || null,
        city: data.city?.trim() || null,
        supply_mode: data.supplyMode && MODES.includes(data.supplyMode) ? data.supplyMode : "a_combinar",
        sync_interval_minutes: 360,
        allows_pickup: data.supplyMode === "pickup",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.code === "23505" ? "Este fornecedor já está cadastrado." : error.message);
    return { id: row.id as string };
  });

const EDITABLE = [
  "name", "priority", "active", "use_for_purchasing", "use_for_pricing", "show_in_comparison", "use_for_availability", "auto_sync",
  "sync_interval_minutes", "state", "city", "address", "supply_mode", "prep_days", "transit_days", "shipping_cost", "min_order",
  "operating_days", "pickup_schedule", "travel_cost", "logistics_notes", "phone", "notes",
  "catalog_mode", "origin_cep", "freight_services", "pkg_height_cm", "pkg_width_cm", "pkg_length_cm", "unit_weight_g",
  "units_per_package", "declared_value", "min_margin_pct",
] as const;

export const updateSupplierSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; patch: Record<string, unknown> }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) if (k in data.patch) patch[k] = data.patch[k];
    if (patch["priority"] && !PRIORITIES.includes(patch["priority"] as never)) throw new Error("Prioridade inválida.");
    if (patch["supply_mode"] && !MODES.includes(patch["supply_mode"] as never)) throw new Error("Modalidade inválida.");
    if (patch["catalog_mode"] && !["all", "selected", "none"].includes(patch["catalog_mode"] as string)) throw new Error("Opção de catálogo inválida.");
    if ("origin_cep" in patch && patch["origin_cep"]) {
      const cep = String(patch["origin_cep"]).replace(/\D/g, "");
      if (cep.length !== 8) throw new Error("CEP de origem inválido.");
      patch["origin_cep"] = cep;
    }
    for (const k of ["prep_days", "transit_days", "sync_interval_minutes", "units_per_package"]) {
      if (k in patch && patch[k] !== null && patch[k] !== "") {
        const n = Number(patch[k]);
        if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new Error("Prazo inválido.");
        patch[k] = n;
      } else if (k in patch) patch[k] = null;
    }
    for (const k of ["shipping_cost", "min_order", "travel_cost", "pkg_height_cm", "pkg_width_cm", "pkg_length_cm", "unit_weight_g", "declared_value", "min_margin_pct"]) {
      if (k in patch && patch[k] !== null && patch[k] !== "") {
        const n = Number(patch[k]);
        if (!Number.isFinite(n) || n < 0) throw new Error("Valor inválido.");
        patch[k] = n;
      } else if (k in patch) patch[k] = null;
    }
    if (patch["priority"] === "inactive") patch["active"] = false;
    const { error } = await context.supabase.from("suppliers").update(patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Tirar um fornecedor (ou trazer de volta). Não apaga nada: o fornecedor e as
 * ofertas ficam desligados — sem sincronizar, sem preço, sem compra, fora do
 * Novo pedido. Pedidos e compras antigos continuam com o nome dele.
 */
export const setSupplierRemoved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; removed: boolean }) => {
    if (typeof d?.id !== "string") throw new Error("Fornecedor inválido.");
    return { id: d.id, removed: d.removed === true };
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const patch = data.removed
      ? { active: false, priority: "inactive", auto_sync: false }
      : { active: true, priority: "secondary", auto_sync: true };
    const { error } = await db.from("suppliers").update(patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    await db.from("supplier_products").update({ active: !data.removed }).eq("supplier_id", data.id);
    return { ok: true as const };
  });

export const setProductSupplierPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { productId: string; supplierId: string; mode: "preferred" | "blocked" | null }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const db = context.supabase;
    if (data.mode === null) {
      await db.from("supplier_product_preferences").delete().eq("product_id", data.productId).eq("supplier_id", data.supplierId);
      return { ok: true };
    }
    if (data.mode === "preferred") {
      await db.from("supplier_product_preferences").delete().eq("product_id", data.productId).eq("mode", "preferred").neq("supplier_id", data.supplierId);
    }
    const { error } = await db
      .from("supplier_product_preferences")
      .upsert({ product_id: data.productId, supplier_id: data.supplierId, mode: data.mode, created_by: context.userId }, { onConflict: "product_id,supplier_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const compareProductOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { productId: string; units?: number }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { buildOfferComparison } = await import("@/lib/suppliers/hub.server");
    // A comparação lê colunas internas de products (estoque local, origem da disponibilidade): cliente de serviço após assertStaff.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return buildOfferComparison(supabaseAdmin, data.productId, data.units ?? 1);
  });

/* ---------- Catálogo público por oferta ---------- */

export const listSupplierCatalogOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { supplierId: string; search?: string; filter?: "all" | "public" | "hidden" | "linked"; page?: number }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { listCatalogOffers } = await import("@/lib/suppliers/catalog.server");
    // O catálogo do fornecedor mostra o estoque local do produto vinculado (coluna interna): cliente de serviço após assertStaff.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return listCatalogOffers(supabaseAdmin, data);
  });

export const setOfferCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { supplierId: string; offerIds: string[]; decision: "allow" | "deny" | "inherit" }) => {
    if (!Array.isArray(d?.offerIds) || d.offerIds.length > 2000) throw new Error("Seleção inválida.");
    if (!["allow", "deny", "inherit"].includes(d.decision)) throw new Error("Opção inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { applyOfferDecision } = await import("@/lib/suppliers/catalog.server");
    return applyOfferDecision(context.supabase, data.supplierId, data.offerIds, data.decision, context.userId);
  });

/* ---------- Frete de abastecimento ---------- */

export const quoteSupplierFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { supplierId: string; units: number; declaredValue?: number | null }) => {
    const u = Number(d?.units);
    if (!Number.isInteger(u) || u < 1 || u > 500) throw new Error("Quantidade inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { quoteSupplyFreight } = await import("@/lib/suppliers/freight.server");
    return quoteSupplyFreight(context.supabase, data.supplierId, data.units, { declaredValue: data.declaredValue ?? null });
  });

export const saveFreightQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { supplierId: string; source: "superfrete" | "supplier"; status?: "estimated" | "confirmed"; price: number; days?: number | null; service?: string | null; carrier?: string | null; units?: number | null; weightKg?: number | null; originCep?: string | null; destinationCep?: string | null; note?: string | null }) => {
    if (!(Number(d?.price) >= 0) || Number(d.price) > 100000) throw new Error("Valor de frete inválido.");
    if (!["superfrete", "supplier"].includes(d.source)) throw new Error("Origem inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { error } = await context.supabase.from("supplier_freight_quotes").insert({
      supplier_id: data.supplierId,
      source: data.source,
      status: data.status === "confirmed" ? "confirmed" : "estimated",
      price: Number(data.price),
      days: data.days ?? null,
      service: data.service?.slice(0, 80) ?? null,
      carrier: data.carrier?.slice(0, 80) ?? null,
      units: data.units ?? null,
      weight_kg: data.weightKg ?? null,
      origin_cep: data.originCep ?? null,
      destination_cep: data.destinationCep ?? null,
      note: data.note?.slice(0, 300) ?? null,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listFreightQuotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { supplierId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const [{ data: rows }, { receivingCep }] = await Promise.all([
      context.supabase.from("supplier_freight_quotes").select("*").eq("supplier_id", data.supplierId).order("created_at", { ascending: false }).limit(20),
      import("@/lib/suppliers/freight.server"),
    ]);
    return { quotes: rows ?? [], destinationCep: await receivingCep(context.supabase) };
  });

export const getHubSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context);
    const [{ data: ship }, { data: ps }] = await Promise.all([
      context.supabase.from("shipping_settings").select("receiving_cep, origin_cep").maybeSingle(),
      context.supabase.from("purchase_settings").select("min_margin_pct, block_below_margin").maybeSingle(),
    ]);
    return { receivingCep: ship?.receiving_cep ?? null, storeCep: ship?.origin_cep ?? null, minMarginPct: ps?.min_margin_pct ?? null, blockBelowMargin: !!ps?.block_below_margin };
  });

export const updateHubSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingCep?: string | null; minMarginPct?: number | null }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    if ("receivingCep" in data) {
      const cep = String(data.receivingCep ?? "").replace(/\D/g, "");
      if (cep && cep.length !== 8) throw new Error("CEP inválido.");
      const { error } = await context.supabase.from("shipping_settings").update({ receiving_cep: cep || null }).eq("id", true);
      if (error) throw new Error(error.message);
    }
    if ("minMarginPct" in data) {
      const m = data.minMarginPct == null ? null : Number(data.minMarginPct);
      if (m != null && !(m >= 0 && m < 100)) throw new Error("Margem inválida.");
      const { error } = await context.supabase.from("purchase_settings").update({ min_margin_pct: m }).eq("id", true);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** Frete da REMESSA (Reposição): um valor para o grupo inteiro, rateado entre os itens. */
export const shipmentFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { supplierId: string; lines: Array<{ key: string; qty: number; unit: number }>; method?: "units" | "value" | "weight"; live?: boolean }) => {
    if (!Array.isArray(d?.lines) || d.lines.length > 300) throw new Error("Remessa inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const db = context.supabase;
    const { shipmentFreightFromData, quoteSupplyFreight } = await import("@/lib/suppliers/freight.server");
    const { allocateFreight, ALLOC_LABEL } = await import("@/lib/suppliers/freight");
    const units = data.lines.reduce((s, l) => s + Math.max(0, l.qty), 0);
    const { data: s } = await db.from("suppliers").select("name, supply_mode, shipping_cost, travel_cost, unit_weight_g").eq("id", data.supplierId).maybeSingle();
    if (!s) throw new Error("Fornecedor não encontrado.");
    let live: Awaited<ReturnType<typeof quoteSupplyFreight>> | null = null;
    let amount: number | null;
    let label: string;
    if (data.live && units > 0) {
      const subtotal = data.lines.reduce((t, l) => t + l.qty * l.unit, 0);
      live = await quoteSupplyFreight(db, data.supplierId, units, { declaredValue: subtotal });
    }
    if (live?.ok) {
      const best = live.options[0]!;
      amount = best.price;
      label = `SuperFrete ${best.carrier} ${best.service} · ${units} un. · ${best.days ?? "?"} dia(s) útil(eis)`;
    } else {
      const { data: q } = await db.from("supplier_freight_quotes").select("price, units, source, status, created_at").eq("supplier_id", data.supplierId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const fr = shipmentFreightFromData(s, q ?? null);
      amount = fr.amount;
      label = fr.label;
    }
    const alloc = amount != null ? allocateFreight(amount, data.lines.map((l) => ({ key: l.key, qty: l.qty, unitPrice: l.unit, unitWeightG: s.unit_weight_g })), data.method ?? "units") : null;
    return {
      units,
      amount,
      label,
      liveError: live && !live.ok ? live.message : null,
      method: alloc?.method ?? null,
      methodLabel: alloc ? ALLOC_LABEL[alloc.method] : null,
      lines: alloc?.lines ?? [],
    };
  });
