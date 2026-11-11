/**
 * Full Perfume Identity Reclassification.
 *
 * Roda em blocos: lê os perfumes atuais (prioridade para os SEM marca), identifica
 * marca e nome oficial, aplica sozinho quando a confiança é alta e manda o resto
 * para "Produtos para revisar".
 *
 * Nunca mexe em produto com identidade travada pelo dono.
 */
import {
  AUTO_APPLY,
  enrichWithKnowledge,
  ensureBrand,
  loadBrandDictionary,
  registerBrandAlias,
  resolveIdentity,
  type BrandDictionary,
  type Identity,
} from "./identity.server";
import { cleanText } from "@/lib/suppliers/normalize.server";
import { normalizeName } from "@/lib/format";
import type { Gender } from "./classify";

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export type IdentityRunResult = {
  processed: number;
  applied: number;
  review: number;
  cursor: number;
  done: boolean;
  message: string;
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70);

/** Grava marca + nome oficial no produto canônico (sem criar produto novo). */
export async function applyIdentity(
  db: Db,
  productId: string,
  fields: {
    brandName?: string | null;
    brandId?: string | null;
    name: string;
    flanker?: string | null;
    concentration?: string | null;
    volumeMl?: number | null;
    gender?: Gender | null;
    genderConfidence?: number;
    aliases?: string[];
    source: string;
    confidence: number;
    lock?: boolean;
  },
) {
  const { data: current } = await db
    .from("products")
    .select("id, canonical_name, slug, search_aliases, gender_norm, brand_id")
    .eq("id", productId)
    .maybeSingle();
  if (!current) return;

  let brandId = fields.brandId ?? null;
  let brandName = fields.brandName ? cleanText(fields.brandName) : null;
  if (brandName && !brandId) {
    const ensured = await ensureBrand(db, brandName, fields.source);
    brandId = ensured?.id ?? null;
    brandName = ensured?.name ?? brandName;
  }
  if (brandId && brandName) await registerBrandAlias(db, brandId, brandName, fields.source);

  const aliases = Array.from(
    new Set([...(current.search_aliases ?? []), ...(fields.aliases ?? []), current.canonical_name].filter(Boolean)),
  ).slice(0, 12);

  const name = cleanText(fields.name) || current.canonical_name;
  const slugBase = slugify(`${brandName ?? ""} ${name}`) || slugify(name);
  const slug = slugBase && slugBase !== current.slug ? `${slugBase}-${productId.slice(0, 6)}` : current.slug;

  const keepGender = (current.gender_norm ?? "UNKNOWN") !== "UNKNOWN" && !fields.gender;
  await db
    .from("products")
    .update({
      canonical_name: name,
      brand: brandName,
      brand_id: brandId,
      flanker: fields.flanker ?? null,
      ...(fields.concentration ? { concentration: fields.concentration } : {}),
      ...(fields.volumeMl ? { volume_ml: fields.volumeMl } : {}),
      ...(keepGender || !fields.gender
        ? {}
        : { gender_norm: fields.gender, gender_confidence: fields.genderConfidence ?? 0.9 }),
      search_aliases: aliases,
      identity_source: fields.source,
      identity_confidence: fields.confidence,
      identity_status: fields.lock ? "confirmada" : fields.confidence >= AUTO_APPLY ? "confirmada" : "revisar",
      brand_review_required: !brandId,
      ...(fields.lock ? { canonical_identity_locked: true } : {}),
      slug,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId);

  await db
    .from("product_identity_suggestions")
    .update({ status: "applied", reviewed_at: new Date().toISOString() })
    .eq("product_id", productId)
    .eq("status", "pending");
}

async function queueSuggestion(
  db: Db,
  product: { id: string; canonical_name: string; brand: string | null },
  offer: { id: string | null; title: string },
  identity: Identity,
) {
  await db.from("product_identity_suggestions").delete().eq("product_id", product.id).eq("status", "pending");
  await db.from("product_identity_suggestions").insert({
    product_id: product.id,
    supplier_product_id: offer.id,
    supplier_title: offer.title,
    current_brand: product.brand,
    current_name: product.canonical_name,
    suggested_brand: identity.brandName,
    suggested_brand_id: identity.brandId,
    suggested_name: identity.name,
    suggested_flanker: identity.flanker,
    suggested_concentration: identity.concentration,
    suggested_volume_ml: identity.volumeMl,
    suggested_gender: identity.gender,
    confidence: identity.confidence,
    source: identity.source,
    status: "pending",
    details: { aliases: identity.aliases },
  });
  await db.from("products").update({ identity_status: "revisar" }).eq("id", product.id);
}

const BATCH = 40;

/** Um bloco do reprocessamento completo. Chame em laço até done. */
export async function runIdentityBackfill(cursor = 0, useKnowledge = true): Promise<IdentityRunResult> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const dict: BrandDictionary = await loadBrandDictionary(db);

  // garante as marcas obrigatórias antes de tudo
  for (const must of ["Bidaya", "Al Wataniah"]) {
    const ensured = await ensureBrand(db, must, "seed");
    if (ensured?.id) dict.byKey.set(must.toLowerCase().replace(/[^a-z0-9]/g, ""), {
      id: ensured.id,
      name: ensured.name,
      words: must.toLowerCase().split(/\s+/),
    });
  }

  // Trabalha sempre pela fila de pendentes: cada perfume sai da fila ao ser resolvido,
  // então a paginação não "pula" itens enquanto gravamos.
  const { count: pendingTotal } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .eq("identity_status", "pendente");

  const { data: rows } = await db
    .from("products")
    .select("id, canonical_name, brand, brand_id, product_type, gender_norm, canonical_identity_locked")
    .eq("active", true)
    .eq("identity_status", "pendente")
    .order("brand_id", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(BATCH);

  const list = (rows ?? []).filter((p) => !p.canonical_identity_locked);
  let applied = 0;
  let review = 0;
  const pending: Array<{ product: (typeof list)[number]; offer: { id: string | null; title: string }; identity: Identity }> = [];

  for (const product of list) {
    const { data: offers } = await db
      .from("supplier_products")
      .select("id, supplier_product_name, brand, url, categories, ean, price")
      .eq("product_id", product.id)
      .eq("active", true)
      .order("price", { ascending: true });

    const offer = (offers ?? [])[0] ?? null;
    const rawTitle = offer?.supplier_product_name ?? product.canonical_name;

    const { data: siblingRows } = await db
      .from("products")
      .select("canonical_name, brand")
      .not("brand", "is", null)
      .ilike("canonical_name", `%${normalizeName(product.canonical_name).split(" ")[0] ?? ""}%`)
      .limit(5);

    const identity = resolveIdentity(dict, {
      title: rawTitle,
      supplierBrand: offer?.brand ?? null,
      url: offer?.url ?? null,
      categories: (offer?.categories as string[] | null) ?? [],
      ean: offer?.ean ?? null,
      siblings: (siblingRows ?? []).map((s) => ({ name: s.canonical_name, brand: s.brand })),
    });

    if (identity.confidence >= AUTO_APPLY && identity.brandName) {
      await applyIdentity(db, product.id, {
        brandName: identity.brandName,
        brandId: identity.brandId,
        name: identity.name,
        flanker: identity.flanker,
        concentration: identity.concentration,
        volumeMl: identity.volumeMl,
        gender: identity.gender === "UNKNOWN" ? null : identity.gender,
        genderConfidence: identity.genderConfidence,
        aliases: identity.aliases,
        source: identity.source,
        confidence: identity.confidence,
      });
      applied++;
    } else {
      pending.push({ product, offer: { id: offer?.id ?? null, title: rawTitle }, identity });
    }
  }

  // enriquecimento externo controlado apenas para o que ficou em dúvida
  if (useKnowledge && pending.length) {
    const knowledge = await enrichWithKnowledge(
      pending.map((p) => ({ id: p.product.id, title: p.offer.title })),
    );
    for (const item of pending) {
      const hit = knowledge.get(item.product.id);
      if (hit?.brand && hit.confidence >= 0.9) {
        await applyIdentity(db, item.product.id, {
          brandName: hit.brand,
          name: hit.name ?? item.identity.name,
          flanker: item.identity.flanker,
          concentration: item.identity.concentration,
          volumeMl: item.identity.volumeMl,
          gender: hit.gender && hit.gender !== "UNKNOWN" ? hit.gender : null,
          genderConfidence: 0.9,
          aliases: item.identity.aliases,
          source: "base-externa",
          confidence: Number(hit.confidence.toFixed(2)),
        });
        applied++;
        continue;
      }
      const merged: Identity = hit?.brand
        ? { ...item.identity, brandName: hit.brand, name: hit.name ?? item.identity.name, confidence: hit.confidence, source: "base-externa" }
        : item.identity;
      await queueSuggestion(db, item.product, item.offer, merged);
      review++;
    }
  } else {
    for (const item of pending) {
      await queueSuggestion(db, item.product, item.offer, item.identity);
      review++;
    }
  }

  const total = pendingTotal ?? 0;
  const done = (rows ?? []).length === 0;
  return {
    processed: list.length,
    applied,
    review,
    cursor: cursor + list.length,
    done,
    message: `${list.length} perfumes conferidos · ${applied} corrigidos · ${review} para revisar · faltam ${Math.max(total - list.length, 0)}`,
  };
}
