import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Gender, ProductType } from "@/lib/catalog/classify";

type StaffCtx = {
  supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => Promise<{ data: unknown }> };
  userId: string;
  claims?: { email?: string } | null;
};

/** Manutenção do catálogo é exclusiva de owner/admin. */
const staffOnly = async (context: unknown) => {
  const ctx = context as StaffCtx;
  const { data } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (!data) throw new Error("Sem permissão.");
  return ctx;
};

const FIELDS =
  "id, canonical_name, brand, brand_id, gender_norm, product_type, concentration, volume_ml, flanker, catalog_eligible, catalog_eligibility_reason, active, identity_status, canonical_identity_locked, identity_verified";

type Snapshot = Record<string, unknown> | null;

async function logHistory(
  db: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  productId: string,
  before: Snapshot,
  after: Snapshot,
  action: string,
  ctx: StaffCtx,
) {
  await db.from("product_identity_history").insert({
    product_id: productId,
    before: (before ?? {}) as never,
    after: (after ?? {}) as never,
    action,
    changed_by: ctx.userId,
    changed_by_email: ctx.claims?.email ?? null,
  });
}

/** Cria (ou reaproveita) uma marca a partir do nome digitado no painel. */
export const createCatalogBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const name = (data.name ?? "").trim();
    if (name.length < 2) throw new Error("Informe o nome da marca.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ensureBrand } = await import("@/lib/catalog/identity.server");
    const brand = await ensureBrand(supabaseAdmin, name, "painel");
    if (!brand?.id) throw new Error("Não foi possível criar a marca.");
    return { id: brand.id, name: brand.name };
  });

/**
 * Correção manual completa de um produto: nome, marca, gênero, tipo, volume,
 * concentração e visibilidade. Guarda histórico e trava a identidade para que a
 * próxima sincronização não desfaça a correção.
 */
export const saveProductMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      productId: string;
      name: string;
      brandId?: string | null;
      newBrandName?: string | null;
      gender?: Gender | "NOT_APPLICABLE" | null;
      productType?: ProductType | "FORA" | null;
      concentration?: string | null;
      volumeMl?: number | null;
      flanker?: string | null;
      /** Foto escolhida no painel; undefined = não mexe, null = remove. */
      imageUrl?: string | null;
      confirm?: boolean;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const ctx = await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { applyIdentity } = await import("@/lib/catalog/identity-run.server");
    const { ensureBrand } = await import("@/lib/catalog/identity.server");

    const { data: before } = await db.from("products").select(FIELDS).eq("id", data.productId).maybeSingle();
    if (!before) throw new Error("Produto não encontrado.");

    let brandId = data.brandId ?? null;
    let brandName: string | null = null;
    if (data.newBrandName?.trim()) {
      const created = await ensureBrand(db, data.newBrandName.trim(), "painel");
      brandId = created?.id ?? null;
      brandName = created?.name ?? data.newBrandName.trim();
    } else if (brandId) {
      const { data: b } = await db.from("brands").select("canonical_name").eq("id", brandId).maybeSingle();
      brandName = b?.canonical_name ?? null;
    }

    const name = (data.name ?? "").trim();
    if (name.length < 2) throw new Error("Informe o nome do produto.");

    const genderIn = data.gender ?? null;
    const gender: Gender | null = genderIn === "NOT_APPLICABLE" || genderIn === null ? null : genderIn;

    await applyIdentity(db, data.productId, {
      brandName,
      brandId,
      name,
      flanker: data.flanker ?? null,
      concentration: data.concentration ?? null,
      volumeMl: data.volumeMl ?? null,
      gender,
      genderConfidence: 1,
      source: "correcao-manual",
      confidence: 1,
      lock: true,
    });

    const patch: Record<string, unknown> = {
      brand_id: brandId,
      brand: brandName,
      canonical_identity_locked: true,
      identity_status: "confirmada",
      updated_at: new Date().toISOString(),
    };
    if (genderIn === "NOT_APPLICABLE") {
      patch["gender_norm"] = "UNKNOWN";
      patch["gender_confidence"] = 1;
    }
    if (data.productType === "FORA") {
      patch["catalog_eligible"] = false;
      patch["catalog_eligibility_reason"] = "excluido-manualmente";
    } else if (data.productType) {
      patch["product_type"] = data.productType;
      patch["catalog_eligible"] = true;
      patch["catalog_eligibility_reason"] = null;
    }
    if (data.confirm) {
      patch["identity_verified"] = true;
      patch["identity_verified_by"] = ctx.userId;
      patch["identity_verified_at"] = new Date().toISOString();
    }
    if (data.concentration !== undefined) patch["concentration"] = data.concentration || null;
    if (data.volumeMl !== undefined) patch["volume_ml"] = data.volumeMl ?? null;
    // Foto do painel: a sincronização só preenche imagem quando está vazia,
    // então a escolha manual permanece.
    if (data.imageUrl !== undefined) {
      patch["image_url"] = data.imageUrl || null;
      patch["image_urls"] = data.imageUrl ? [data.imageUrl] : [];
    }
    await db.from("products").update(patch as never).eq("id", data.productId);

    if (data.productType === "FORA") {
      await db.from("supplier_products").update({ catalog_excluded_manually: true }).eq("product_id", data.productId);
    }

    const { data: after } = await db.from("products").select(FIELDS).eq("id", data.productId).maybeSingle();
    await logHistory(db, data.productId, before as Snapshot, after as Snapshot, data.confirm ? "identidade confirmada" : "editar", ctx);
    return { ok: true };
  });

/** Correção rápida/em lote de marca. */
export const setProductsBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productIds: string[]; brandId?: string | null; newBrandName?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const ctx = await staffOnly(context);
    const ids = (data.productIds ?? []).filter(Boolean).slice(0, 200);
    if (!ids.length) throw new Error("Selecione pelo menos um produto.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { ensureBrand } = await import("@/lib/catalog/identity.server");
    const { applyIdentity } = await import("@/lib/catalog/identity-run.server");

    let brandId = data.brandId ?? null;
    let brandName: string | null = null;
    if (data.newBrandName?.trim()) {
      const created = await ensureBrand(db, data.newBrandName.trim(), "painel");
      brandId = created?.id ?? null;
      brandName = created?.name ?? null;
    } else if (brandId) {
      const { data: b } = await db.from("brands").select("canonical_name").eq("id", brandId).maybeSingle();
      brandName = b?.canonical_name ?? null;
    }
    if (!brandId || !brandName) throw new Error("Escolha uma marca válida.");

    for (const id of ids) {
      const { data: before } = await db.from("products").select(FIELDS).eq("id", id).maybeSingle();
      if (!before) continue;
      await applyIdentity(db, id, {
        brandName,
        brandId,
        name: (before as { canonical_name: string }).canonical_name,
        source: "correcao-manual",
        confidence: 1,
        lock: true,
      });
      await db
        .from("products")
        .update({ brand: brandName, brand_id: brandId, brand_review_required: false, identity_status: "confirmada" })
        .eq("id", id);
      const { data: after } = await db.from("products").select(FIELDS).eq("id", id).maybeSingle();
      await logHistory(db, id, before as Snapshot, after as Snapshot, "definir marca", ctx);
    }
    return { ok: true, updated: ids.length };
  });

/** Esconder do catálogo (ou voltar a publicar) sem apagar nada. */
export const setProductVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string; visible: boolean }) => data)
  .handler(async ({ data, context }) => {
    const ctx = await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: before } = await db.from("products").select(FIELDS).eq("id", data.productId).maybeSingle();
    await db
      .from("products")
      .update({
        catalog_eligible: data.visible,
        catalog_eligibility_reason: data.visible ? null : "excluido-manualmente",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.productId);
    await db
      .from("supplier_products")
      .update({ catalog_excluded_manually: !data.visible })
      .eq("product_id", data.productId);
    const { data: after } = await db.from("products").select(FIELDS).eq("id", data.productId).maybeSingle();
    await logHistory(db, data.productId, before as Snapshot, after as Snapshot, data.visible ? "publicar" : "ocultar", ctx);
    return { ok: true };
  });

/** Exclusão: primeiro desativa (reversível); definitiva só com confirmação explícita. */
export const deleteCatalogProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string; permanent?: boolean }) => data)
  .handler(async ({ data, context }) => {
    const ctx = await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: before } = await db.from("products").select(FIELDS).eq("id", data.productId).maybeSingle();
    if (!before) throw new Error("Produto não encontrado.");

    if (!data.permanent) {
      await db
        .from("products")
        .update({
          active: false,
          catalog_eligible: false,
          catalog_eligibility_reason: "excluido-manualmente",
          in_stock: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.productId);
      await db.from("supplier_products").update({ catalog_excluded_manually: true }).eq("product_id", data.productId);
      await logHistory(db, data.productId, before as Snapshot, null, "excluir (reversível)", ctx);
      return { ok: true, permanent: false };
    }

    const { count } = await db
      .from("catalog_order_items")
      .select("id", { count: "exact", head: true })
      .eq("product_id", data.productId);
    if ((count ?? 0) > 0) {
      throw new Error("Este produto já aparece em pedidos: mantenha oculto para preservar o histórico.");
    }
    await logHistory(db, data.productId, before as Snapshot, null, "exclusão definitiva", ctx);
    await db.from("supplier_products").update({ product_id: null, catalog_excluded_manually: true }).eq("product_id", data.productId);
    await db.from("product_costs").delete().eq("product_id", data.productId);
    await db.from("products").delete().eq("id", data.productId);
    return { ok: true, permanent: true };
  });

/** "Não são iguais": guarda a decisão para o par não voltar a ser sugerido. */
export const dismissDuplicatePair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pairId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await db
      .from("product_duplicates")
      .update({ status: "descartado", reviewed_by: ctx.userId })
      .eq("id", data.pairId);
    return { ok: true };
  });

/** Pesquisa a identidade de um produto (marca/nome) com evidências, sem aplicar nada. */
export const researchProductIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { researchIdentity } = await import("@/lib/catalog/research.server");
    const { data: product } = await db
      .from("products")
      .select("id, canonical_name, raw_name, brand")
      .eq("id", data.productId)
      .maybeSingle();
    if (!product) throw new Error("Produto não encontrado.");
    const { data: offers } = await db
      .from("supplier_products")
      .select("supplier_product_name")
      .eq("product_id", data.productId)
      .limit(4);
    const title = product.raw_name || offers?.[0]?.supplier_product_name || product.canonical_name;
    const res = await researchIdentity({
      title,
      currentBrand: product.brand,
      currentName: product.canonical_name,
      siblingTitles: (offers ?? []).map((o) => o.supplier_product_name),
    });
    return {
      brand: res.candidate?.brand ?? null,
      name: res.candidate?.name ?? null,
      confidence: res.candidate?.confidence ?? 0,
      sources: (res.candidate?.sources ?? res.results.slice(0, 3)).map((e) => ({
        title: e.title ?? "",
        url: e.url,
      })),
      queries: res.queries,
    };
  });

/**
 * Limpeza em massa por marca/tipo. "Excluir do catálogo" nunca apaga histórico
 * de fornecedor ou custo: marca a decisão como manual, e essa decisão vence a
 * classificação automática na próxima sincronização.
 */
export const bulkCatalogExclusion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { productIds: string[]; mode: "excluir" | "ocultar" | "restaurar"; blockBrands?: boolean }) => data,
  )
  .handler(async ({ data, context }) => {
    const ctx = await staffOnly(context);
    const ids = [...new Set((data.productIds ?? []).filter(Boolean))].slice(0, 1000);
    if (!ids.length) throw new Error("Selecione pelo menos um produto.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const restore = data.mode === "restaurar";
    const patch = restore
      ? {
          active: true,
          catalog_eligible: true,
          catalog_eligibility_reason: null,
          catalog_excluded_manually: false,
          updated_at: new Date().toISOString(),
        }
      : {
          // "Ocultar" mantém o produto ativo (reversível); "Excluir" tira de circulação.
          ...(data.mode === "excluir" ? { active: false, in_stock: false } : {}),
          catalog_eligible: false,
          catalog_eligibility_reason: "excluido-manualmente",
          catalog_excluded_manually: true,
          updated_at: new Date().toISOString(),
        };

    const { data: before } = await db.from("products").select(`${FIELDS}, product_type`).in("id", ids);
    const rows = (before ?? []) as unknown as Array<Record<string, unknown>>;

    // Em lotes: uma marca inteira pode ter centenas de produtos.
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      await db.from("products").update(patch as never).in("id", chunk);
      await db
        .from("supplier_products")
        .update({ catalog_excluded_manually: !restore })
        .in("product_id", chunk);
    }

    for (const row of rows) {
      const { data: after } = await db.from("products").select(FIELDS).eq("id", row["id"] as string).maybeSingle();
      await logHistory(
        db,
        row["id"] as string,
        row as Snapshot,
        after as Snapshot,
        restore ? "restaurar no catálogo" : data.mode === "excluir" ? "excluir do catálogo (lote)" : "ocultar (lote)",
        ctx,
      );
    }

    // Trava de marca: perfumes novos daquela marca nascem fora do catálogo.
    let brandsBlocked = 0;
    if (data.blockBrands && !restore) {
      const brandIds = [
        ...new Set(rows.filter((r) => r["product_type"] === "PERFUME").map((r) => r["brand_id"] as string | null)),
      ].filter((b): b is string => !!b);
      for (const brandId of brandIds) {
        // Só trava a marca quando não sobrou nenhum perfume publicado dela.
        const { count } = await db
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("brand_id", brandId)
          .eq("product_type", "PERFUME")
          .eq("catalog_eligible", true);
        if ((count ?? 0) > 0) continue;
        await db.from("brands").update({ allow_perfumes: false }).eq("id", brandId);
        brandsBlocked++;
      }
    }

    return { ok: true, updated: ids.length, brandsBlocked };
  });

/**
 * Exclusão definitiva: o produto sai da Orium de verdade e entra na lista de
 * bloqueio permanente, para que MRX/Smart Mania não o recriem na próxima
 * sincronização. Pedidos antigos continuam existindo com seus snapshots
 * (nome, preço, quantidade e variante) — a referência vira nula, nunca cascade.
 */
export const hardDeleteProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const ctx = await staffOnly(context);
    const ids = Array.from(new Set((data.productIds ?? []).filter(Boolean))).slice(0, 1000);
    if (!ids.length) throw new Error("Selecione pelo menos um produto.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: prods } = await db
      .from("products")
      .select("id, canonical_name, brand, slug, identity_key, dedupe_key")
      .in("id", ids);
    if (!prods?.length) throw new Error("Produtos não encontrados.");

    const { data: offers } = await db
      .from("supplier_products")
      .select("id, product_id, supplier_id, supplier_sku, url, normalized_name, supplier_product_name")
      .in("product_id", ids);

    // 1) bloqueio permanente antes de apagar (fingerprint canônico + chave do fornecedor)
    const blocks: Record<string, unknown>[] = [];
    for (const p of prods) {
      const own = (offers ?? []).filter((o) => o.product_id === p.id);
      const base = {
        identity_key: p.identity_key,
        dedupe_key: p.dedupe_key,
        canonical_name: p.canonical_name,
        brand: p.brand,
        slug: p.slug,
        reason: "excluido-definitivamente",
        created_by: ctx.userId,
        created_by_email: ctx.claims?.email ?? null,
      };
      if (!own.length) blocks.push({ ...base, normalized_name: null });
      for (const o of own) {
        blocks.push({
          ...base,
          supplier_id: o.supplier_id,
          supplier_sku: o.supplier_sku,
          supplier_url: o.url,
          normalized_name: o.normalized_name ?? o.supplier_product_name,
        });
      }
    }
    if (blocks.length) await db.from("permanent_catalog_blocklist").insert(blocks as never);

    // 2) promoções deixam de apontar para produtos que não existem mais
    const { data: promos } = await db.from("promotions").select("id, product_ids");
    for (const promo of promos ?? []) {
      const list = (promo.product_ids ?? []) as string[];
      const kept = list.filter((pid) => !ids.includes(pid));
      if (kept.length !== list.length) {
        await db.from("promotions").update({ product_ids: kept }).eq("id", promo.id);
      }
    }

    // 3) registros que só existem por causa deste produto
    await db.from("cart_items").delete().in("product_id", ids);
    await db.from("favorites").delete().in("product_id", ids);
    await db.from("back_in_stock_subscriptions").delete().in("product_id", ids);
    await db.from("supplier_products").delete().in("product_id", ids);
    // fragrância, notas, acordes, custos, visualizações e histórico saem em cascade

    // 4) o produto em si (pedidos guardam o snapshot e a referência fica nula)
    const { error } = await db.from("products").delete().in("id", ids);
    if (error) throw new Error(error.message);

    return { ok: true, deleted: prods.length, blocked: blocks.length };
  });

/** Bloqueios permanentes: o painel pode revisar e liberar depois. */
export const listCatalogBlocklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data } = await db
      .from("permanent_catalog_blocklist")
      .select("id, canonical_name, brand, normalized_name, supplier_sku, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    return { rows: data ?? [] };
  });

/** Mudou de ideia: libera o bloqueio e a sincronização pode trazer o produto de volta. */
export const removeCatalogBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { blockId: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { error } = await db.from("permanent_catalog_blocklist").delete().eq("id", data.blockId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
