/**
 * Limpeza e reclassificação do catálogo.
 *
 * Etapas (executadas em blocos, sempre podendo continuar de onde parou):
 *  1. ofertas  — tipo de produto, elegibilidade e marca identificada;
 *  2. produtos — nome comercial, marca canônica, tipo, gênero, elegibilidade e chave de duplicidade;
 *  3. duplicados — unifica o que tem a mesma chave e manda o resto para revisão.
 *
 * Nada é apagado sem antes mover ofertas, histórico, pedidos e listas para o produto vencedor.
 */
import {
  ALLOWED_TYPES,
  buildCanonicalName,
  classifyGender,
  classifyType,
  coreKey,
  dedupeKey,
  detectBrandInName,
  flat,
  type Gender,
} from "./classify";
import { brandKey, canonicalBrandName, cleanText } from "@/lib/suppliers/normalize.server";

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70);

async function brandList(db: Db) {
  const { data } = await db.from("brands").select("id, canonical_name").order("canonical_name");
  return data ?? [];
}

/** Garante a marca oficial única, criando alias para cada grafia encontrada. */
export async function ensureBrand(
  db: Db,
  cache: Map<string, { id: string; name: string }>,
  rawBrand: string | null,
  supplierId: string | null = null,
): Promise<{ id: string | null; name: string | null }> {
  const canonical = canonicalBrandName(rawBrand);
  if (!canonical) return { id: null, name: null };
  const key = brandKey(canonical);
  if (!key) return { id: null, name: null };
  const cached = cache.get(key);
  if (cached) return cached;

  const { data: alias } = await db
    .from("brand_aliases")
    .select("brand_id, brands(canonical_name)")
    .eq("alias_key", key)
    .maybeSingle();
  if (alias?.brand_id) {
    const name = (alias as { brands?: { canonical_name?: string } }).brands?.canonical_name ?? canonical;
    const hit = { id: alias.brand_id, name };
    cache.set(key, hit);
    return hit;
  }

  const slug = slugify(canonical) || key;
  const { data: existing } = await db.from("brands").select("id, canonical_name").eq("slug", slug).maybeSingle();
  let id = existing?.id ?? null;
  let name = existing?.canonical_name ?? canonical;
  if (!id) {
    const { data: inserted } = await db
      .from("brands")
      .insert({ canonical_name: canonical, slug })
      .select("id, canonical_name")
      .maybeSingle();
    id = inserted?.id ?? null;
    name = inserted?.canonical_name ?? canonical;
  }
  if (!id) return { id: null, name: canonical };
  cache.set(key, { id, name });
  await db
    .from("brand_aliases")
    .upsert(
      { brand_id: id, alias: cleanText(rawBrand) || canonical, alias_key: key, supplier_id: supplierId },
      { onConflict: "alias_key" },
    );
  return { id, name };
}

export type OfferClassification = {
  productType: string;
  catalogEligible: boolean;
  /** Motivo legível da decisão — guardado no banco para auditoria. */
  reason: string;
  brandName: string | null;
  brandId: string | null;
  gender: Gender;
  genderConfidence: number;
  core: string;
  canonicalName: string;
  concentration: string | null;
  volumeMl: number | null;
  dedupe: string;
};

/** Classifica uma oferta bruta (usada pela sincronização e pela limpeza). */
export async function classifyOffer(
  db: Db,
  cache: Map<string, { id: string; name: string }>,
  knownBrands: string[],
  input: {
    name: string;
    brand?: string | null;
    categories?: string[] | null;
    url?: string | null;
    supplierId?: string | null;
  },
): Promise<OfferClassification> {
  const name = cleanText(input.name);
  const categories = (input.categories ?? []).map((c) => cleanText(String(c))).filter(Boolean);
  const extra = `${input.url ?? ""}`.replace(/[-/_]/g, " ");

  const type = classifyType(name, categories, extra);
  const gender = classifyGender(name, categories, extra);

  const rawBrand = cleanText(input.brand) || detectBrandInName(`${name} ${extra}`, knownBrands) || null;
  const brand = await ensureBrand(db, cache, rawBrand, input.supplierId ?? null);

  const built = buildCanonicalName(name, brand.name);

  return {
    productType: type.type,
    catalogEligible: type.eligible,
    reason: type.reason,
    brandName: brand.name,
    brandId: brand.id,
    gender: gender.gender,
    genderConfidence: gender.confidence,
    core: built.core,
    canonicalName: built.canonical,
    concentration: built.concentration,
    volumeMl: built.volumeMl,
    dedupe: dedupeKey({
      brand: brand.name,
      core: built.core,
      concentration: built.concentration,
      volumeMl: built.volumeMl,
      type: type.type,
    }),
  };
}

/** Move tudo de `dropId` para `keepId` e remove só o registro duplicado. */
export async function mergeProducts(db: Db, keepId: string, dropId: string) {
  if (keepId === dropId) return;
  await db.from("supplier_products").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("restock_items").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("catalog_order_items").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("product_duplicates").delete().or(`product_a.eq.${dropId},product_b.eq.${dropId}`);

  // preferências de preço: mantém a do vencedor se já existir
  const { data: keepOverride } = await db
    .from("pricing_overrides")
    .select("id")
    .eq("product_id", keepId)
    .maybeSingle();
  if (keepOverride) await db.from("pricing_overrides").delete().eq("product_id", dropId);
  else await db.from("pricing_overrides").update({ product_id: keepId }).eq("product_id", dropId);

  // imagem: se o vencedor não tem foto, aproveita a do duplicado
  const [{ data: keep }, { data: drop }] = await Promise.all([
    db.from("products").select("image_url, image_urls").eq("id", keepId).maybeSingle(),
    db.from("products").select("image_url, image_urls").eq("id", dropId).maybeSingle(),
  ]);
  if (!keep?.image_url && drop?.image_url) {
    await db.from("products").update({ image_url: drop.image_url, image_urls: drop.image_urls }).eq("id", keepId);
  }

  await db.from("product_costs").delete().eq("product_id", dropId);
  await db.from("products").delete().eq("id", dropId);
  await db.rpc("recompute_product_pricing", { p_product_id: keepId });
}

export type CleanupResult = {
  stage: "ofertas" | "produtos" | "duplicados" | "fim";
  cursor: number;
  done: boolean;
  offersProcessed: number;
  offersBlocked: number;
  productsUpdated: number;
  productsBlocked: number;
  merged: number;
  pendingReview: number;
  brandsMissing: number;
  message: string;
};

const CHUNK_OFFERS = 200;
const CHUNK_PRODUCTS = 200;

/**
 * Executa a limpeza em blocos.
 * `stage`/`cursor` vêm do retorno anterior; a tela repete até `done`.
 */
export async function runCatalogCleanup(stage: CleanupResult["stage"] = "ofertas", cursor = 0): Promise<CleanupResult> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const cache = new Map<string, { id: string; name: string }>();
  const brands = await brandList(db);
  const known = brands.map((b) => b.canonical_name);
  for (const b of brands) cache.set(brandKey(b.canonical_name), { id: b.id, name: b.canonical_name });

  const base = {
    offersProcessed: 0,
    offersBlocked: 0,
    productsUpdated: 0,
    productsBlocked: 0,
    merged: 0,
    pendingReview: 0,
    brandsMissing: 0,
  };

  // ---------- 1. ofertas ----------
  if (stage === "ofertas") {
    const { data: offers } = await db
      .from("supplier_products")
      .select("id, supplier_id, supplier_product_name, brand, categories, url")
      .order("id")
      .range(cursor, cursor + CHUNK_OFFERS - 1);
    const rows = offers ?? [];

    for (const o of rows) {
      const c = await classifyOffer(db, cache, known, {
        name: o.supplier_product_name,
        brand: o.brand,
        categories: (o.categories as string[] | null) ?? [],
        url: o.url,
        supplierId: o.supplier_id,
      });
      base.offersProcessed++;
      if (!c.catalogEligible) base.offersBlocked++;
      if (!c.brandId) base.brandsMissing++;
      await db
        .from("supplier_products")
        .update({
          product_type: c.productType,
          catalog_eligible: c.catalogEligible,
          catalog_eligibility_reason: c.reason,
          brand: c.brandName,
          brand_id: c.brandId,
          concentration: c.concentration,
          volume_ml: c.volumeMl,
        })
        .eq("id", o.id);
    }

    const done = rows.length < CHUNK_OFFERS;
    return {
      ...base,
      stage: done ? "produtos" : "ofertas",
      cursor: done ? 0 : cursor + CHUNK_OFFERS,
      done: false,
      message: `Ofertas conferidas: ${cursor + rows.length}.`,
    };
  }

  // ---------- 2. produtos ----------
  if (stage === "produtos") {
    const { data: products } = await db
      .from("products")
      .select("id, canonical_name, raw_name, slug, brand, brand_id, gender_norm, canonical_identity_locked, identity_status, catalog_excluded_manually")
      .order("id")
      .range(cursor, cursor + CHUNK_PRODUCTS - 1);
    const rows = products ?? [];

    for (const p of rows) {
      const { data: offers } = await db
        .from("supplier_products")
        .select("supplier_product_name, brand, categories, url, product_type, catalog_eligible, catalog_eligibility_reason")
        .eq("product_id", p.id);
      const list = offers ?? [];
      const source = list[0];
      const raw = p.raw_name ?? source?.supplier_product_name ?? p.canonical_name;
      const categories = list.flatMap((o) => ((o.categories as string[] | null) ?? []).map(String));
      const names = list.map((o) => o.supplier_product_name).join(" | ") || raw;

      const c = await classifyOffer(db, cache, known, {
        name: raw,
        brand: p.brand ?? source?.brand ?? null,
        categories,
        url: `${source?.url ?? ""} ${names}`,
      });

      // tipo: vale o primeiro tipo permitido encontrado entre as ofertas
      const allowed = new Set<string>(ALLOWED_TYPES);
      const fromOffers = list.find((o) => o.product_type && allowed.has(o.product_type));
      const type = fromOffers?.product_type ?? (allowed.has(c.productType) ? c.productType : "UNKNOWN");
      // Exclusão manual do painel vence qualquer reclassificação automática.
      const excludedManually = Boolean((p as { catalog_excluded_manually?: boolean }).catalog_excluded_manually);
      const eligible = allowed.has(type) && !excludedManually;
      const reason = excludedManually
        ? "excluido-manualmente"
        : eligible
          ? (fromOffers?.catalog_eligibility_reason ?? c.reason)
          : (list.find((o) => o.catalog_eligibility_reason)?.catalog_eligibility_reason ?? c.reason);

      // gênero: só faz sentido em perfume; usa o melhor sinal entre todas as ofertas
      let gender: Gender = "UNKNOWN";
      let confidence = 0;
      if (type === "PERFUME") {
        gender = c.gender;
        confidence = c.genderConfidence;
        for (const o of list) {
          const g = classifyGender(
            o.supplier_product_name,
            (o.categories as string[] | null)?.map(String) ?? [],
            `${o.url ?? ""}`.replace(/[-/_]/g, " "),
          );
          if (g.confidence > confidence) {
            gender = g.gender;
            confidence = g.confidence;
          }
        }
      }

      base.productsUpdated++;
      if (!eligible) base.productsBlocked++;
      if (!c.brandId) base.brandsMissing++;

      // identidade travada ou já confirmada: preserva marca e nome oficial
      const keepIdentity = Boolean((p as { canonical_identity_locked?: boolean; identity_status?: string }).canonical_identity_locked)
        || (p as { identity_status?: string }).identity_status === "confirmada";

      await db
        .from("products")
        .update({
          raw_name: raw,
          ...(keepIdentity
            ? {}
            : {
                canonical_name: c.canonicalName || p.canonical_name,
                brand: c.brandName,
                brand_id: c.brandId,
                brand_review_required: !c.brandId,
              }),
          product_type: type,
          gender_norm: gender,
          gender_confidence: confidence,
          concentration: c.concentration,
          volume_ml: c.volumeMl,
          catalog_eligible: eligible,
          catalog_eligibility_reason: reason,
          dedupe_key: dedupeKey({
            brand: keepIdentity ? ((p as { brand?: string | null }).brand ?? c.brandName) : c.brandName,
            core: c.core,
            concentration: c.concentration,
            volumeMl: c.volumeMl,
            type: type as never,
          }),
        })
        .eq("id", p.id);
    }

    const done = rows.length < CHUNK_PRODUCTS;
    return {
      ...base,
      stage: done ? "duplicados" : "produtos",
      cursor: done ? 0 : cursor + CHUNK_PRODUCTS,
      done: false,
      message: `Perfumes reclassificados: ${cursor + rows.length}.`,
    };
  }

  // ---------- 3. duplicados ----------
  const { data: all } = await db
    .from("products")
    .select("id, canonical_name, brand, dedupe_key, concentration, volume_ml, product_type, image_url, created_at")
    .order("created_at");
  const products = all ?? [];

  const groups = new Map<string, typeof products>();
  for (const p of products) {
    if (!p.dedupe_key) continue;
    const g = groups.get(p.dedupe_key) ?? [];
    g.push(p);
    groups.set(p.dedupe_key, g);
  }

  for (const [, group] of groups) {
    if (group.length < 2) continue;
    // vencedor: o que tem foto e o nome mais completo
    const winner = [...group].sort(
      (a, b) => Number(!!b.image_url) - Number(!!a.image_url) || b.canonical_name.length - a.canonical_name.length,
    )[0]!;
    for (const other of group) {
      if (other.id === winner.id) continue;
      await mergeProducts(db, winner.id, other.id);
      base.merged++;
    }
  }

  // pares parecidos que NÃO têm a mesma chave → revisão manual
  const remaining = products.filter((p) => !groups.get(p.dedupe_key ?? "")?.some((g) => g.id !== p.id));
  const byBrand = new Map<string, typeof products>();
  for (const p of remaining) {
    const k = flat(p.brand ?? "sem-marca");
    const g = byBrand.get(k) ?? [];
    g.push(p);
    byBrand.set(k, g);
  }
  for (const [, list] of byBrand) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.product_type !== b.product_type) continue;
        const ka = coreKey(a.canonical_name);
        const kb = coreKey(b.canonical_name);
        if (!ka || !kb || ka === kb) continue;
        const wa = new Set(ka.split(" "));
        const wb = new Set(kb.split(" "));
        const inter = [...wa].filter((w) => wb.has(w)).length;
        const score = (2 * inter) / (wa.size + wb.size);
        if (score < 0.8) continue;
        const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
        await db
          .from("product_duplicates")
          .upsert({ product_a: x, product_b: y, score }, { onConflict: "product_a,product_b", ignoreDuplicates: true });
        base.pendingReview++;
      }
    }
  }

  return {
    ...base,
    stage: "fim",
    cursor: 0,
    done: true,
    message: `Unificados ${base.merged} perfumes duplicados · ${base.pendingReview} pares para revisar.`,
  };
}
