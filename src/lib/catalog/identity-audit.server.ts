/**
 * PerfumeIdentityAuditEngine
 *
 * Percorre TODO o catálogo de perfumes (não só os novos) e revisa marca, nome
 * oficial, versão/flanker, concentração, volume e gênero.
 *
 * Ordem das evidências:
 *  1. identidade travada/confirmada pelo dono  -> nunca é alterada
 *  2. base de identidades confirmadas (registry + aliases)
 *  3. dicionário de marcas do banco + aliases  (motor local)
 *  4. produto equivalente no outro fornecedor
 *  5. pesquisa externa em várias consultas (Fragrantica, Parfumo, site oficial…)
 *
 * Decisão por faixa de confiança:
 *  >= 0.95            -> corrige sozinho
 *  0.80 – 0.94        -> corrige se houver 2+ fontes independentes
 *  0.60 – 0.79        -> vai para "Revisar identidade"
 *  < 0.60             -> não altera nada; marca IDENTITY_UNRESOLVED
 *  marca atual ≠ marca encontrada -> BRAND_CONFLICT (sempre revisão)
 */
import { AUTO_APPLY, ensureBrand, loadBrandDictionary, registerBrandAlias, resolveIdentity, type BrandDictionary } from "./identity.server";
import { applyIdentity } from "./identity-run.server";
import { lookupRegistry, saveRegistry, aliasKey } from "./registry.server";
import { researchIdentity, type ResearchCandidate, type WebResult } from "./research.server";
import { cleanText } from "@/lib/suppliers/normalize.server";
import type { Gender } from "./classify";

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const AUTO_HIGH = 0.95;
export const AUTO_MULTI = 0.8;
export const REVIEW_FLOOR = 0.6;

export type AuditReport = {
  analyzed: number;
  autoIdentified: number;
  brandsFixed: number;
  namesFixed: number;
  missingBefore: number;
  missingAfter: number;
  conflicts: number;
  review: number;
  unresolved: number;
  remaining: number;
  done: boolean;
  message: string;
};

const emptyReport = (): AuditReport => ({
  analyzed: 0,
  autoIdentified: 0,
  brandsFixed: 0,
  namesFixed: 0,
  missingBefore: 0,
  missingAfter: 0,
  conflicts: 0,
  review: 0,
  unresolved: 0,
  remaining: 0,
  done: true,
  message: "",
});

/** "Lattafa Perfumes" volta a ser "Lattafa" quando a marca base já existe. */
export function preferCanonicalBrand(dict: BrandDictionary, raw: string | null) {
  if (!raw) return null;
  const name = cleanText(raw);
  const direct = dict.byKey.get(aliasKey(name));
  if (direct) return direct.name;
  const base = name.replace(/\s+(perfumes?|parfums?|fragrances?|group|paris|london)$/i, "").trim();
  if (base && base !== name) {
    const hit = dict.byKey.get(aliasKey(base));
    if (hit) return hit.name;
  }
  return name;
}

/** Nunca deixar a marca dentro do nome. */
export function stripBrandFromName(brand: string | null, name: string) {
  if (!brand) return cleanText(name);
  const bWords = cleanText(brand).toLowerCase().split(/\s+/).filter(Boolean);
  const nWords = cleanText(name).split(/\s+/);
  let i = 0;
  while (i < nWords.length && i < bWords.length && aliasKey(nWords[i] ?? "") === aliasKey(bWords[i] ?? "")) i++;
  const rest = nWords.slice(i).join(" ").trim();
  return rest.length >= 2 ? rest : cleanText(name);
}

type ProductRow = {
  id: string;
  canonical_name: string;
  brand: string | null;
  brand_id: string | null;
  gender_norm: string | null;
  canonical_identity_locked: boolean | null;
  identity_status: string | null;
};

async function queue(
  db: Db,
  product: ProductRow,
  offer: { id: string | null; title: string },
  data: {
    kind: "missing_brand" | "brand_conflict" | "unresolved";
    brand: string | null;
    brandId?: string | null;
    name: string;
    flanker?: string | null;
    concentration?: string | null;
    volumeMl?: number | null;
    gender?: Gender | null;
    confidence: number;
    source: string;
    sources?: unknown;
    queries?: string[];
    reason?: string;
    aliases?: string[];
  },
) {
  await db.from("product_identity_suggestions").delete().eq("product_id", product.id).eq("status", "pending");
  await db.from("product_identity_suggestions").insert({
    product_id: product.id,
    supplier_product_id: offer.id,
    supplier_title: offer.title,
    current_brand: product.brand,
    current_name: product.canonical_name,
    suggested_brand: data.brand,
    suggested_brand_id: data.brandId ?? null,
    suggested_name: data.name,
    suggested_flanker: data.flanker ?? null,
    suggested_concentration: data.concentration ?? null,
    suggested_volume_ml: data.volumeMl ?? null,
    suggested_gender: data.gender ?? null,
    confidence: data.confidence,
    source: data.source,
    status: "pending",
    kind: data.kind,
    sources: (data.sources ?? []) as never,
    queries: (data.queries ?? []) as never,
    details: { reason: data.reason ?? null, aliases: data.aliases ?? [] } as never,
  });
  await db
    .from("products")
    .update({
      identity_status: data.kind === "brand_conflict" ? "conflito" : data.kind === "unresolved" ? "nao_identificada" : "revisar",
      identity_confidence: data.confidence,
    })
    .eq("id", product.id);
}

/** Auditoria de um único perfume (usada pelo lote e pelo botão "Pesquisar novamente"). */
export async function auditProduct(
  db: Db,
  dict: BrandDictionary,
  product: ProductRow,
  options: { web?: boolean; force?: boolean } = {},
): Promise<{
  outcome: "locked" | "applied" | "review" | "conflict" | "unresolved";
  brandChanged: boolean;
  nameChanged: boolean;
  candidate?: ResearchCandidate | null;
  results?: WebResult[];
  detail: string;
}> {
  if (product.canonical_identity_locked && !options.force) {
    return { outcome: "locked", brandChanged: false, nameChanged: false, detail: "identidade travada" };
  }

  const { data: offers } = await db
    .from("supplier_products")
    .select("id, supplier_product_name, brand, url, categories, ean, price, supplier_id")
    .eq("product_id", product.id)
    .eq("active", true)
    .order("price", { ascending: true });

  const offerList = offers ?? [];
  const offer = offerList[0] ?? null;
  const rawTitle = offer?.supplier_product_name ?? product.canonical_name;
  const siblingTitles = offerList.slice(1).map((o) => o.supplier_product_name);
  const siblingBrand = offerList.find((o) => cleanText(o.brand ?? ""))?.brand ?? null;

  const finish = async (
    brand: string | null,
    name: string,
    extra: {
      confidence: number;
      source: string;
      flanker?: string | null;
      concentration?: string | null;
      volumeMl?: number | null;
      gender?: Gender | null;
      aliases?: string[];
      referenceUrl?: string | null;
      sources?: unknown;
    },
  ) => {
    const brandName = preferCanonicalBrand(dict, brand);
    const cleanName = stripBrandFromName(brandName, name);
    const brandChanged = aliasKey(product.brand ?? "") !== aliasKey(brandName ?? "");
    const nameChanged = aliasKey(product.canonical_name) !== aliasKey(cleanName);

    let brandId: string | null = null;
    if (brandName) {
      const ensured = await ensureBrand(db, brandName, extra.source);
      brandId = ensured?.id ?? null;
      if (brandId) {
        await registerBrandAlias(db, brandId, brandName, extra.source);
        if (siblingBrand) await registerBrandAlias(db, brandId, siblingBrand, "supplier");
      }
    }

    await applyIdentity(db, product.id, {
      brandName,
      brandId,
      name: cleanName,
      flanker: extra.flanker ?? null,
      concentration: extra.concentration ?? null,
      volumeMl: extra.volumeMl ?? null,
      gender: extra.gender && extra.gender !== "UNKNOWN" ? extra.gender : null,
      genderConfidence: 0.9,
      aliases: Array.from(new Set([...(extra.aliases ?? []), rawTitle, ...siblingTitles])),
      source: extra.source,
      confidence: extra.confidence,
    });

    await saveRegistry(db, {
      name: cleanName,
      brandId,
      brandName,
      concentration: extra.concentration ?? null,
      volumeMl: extra.volumeMl ?? null,
      gender: extra.gender ?? null,
      referenceUrl: extra.referenceUrl ?? null,
      sources: extra.sources,
      source: extra.source,
      confidence: extra.confidence,
      aliases: [rawTitle, ...siblingTitles, product.canonical_name],
    });

    return { outcome: "applied" as const, brandChanged, nameChanged, detail: extra.source };
  };

  // 2) base de identidades confirmadas
  const hit = await lookupRegistry(db, [rawTitle, product.canonical_name, ...siblingTitles]);
  if (hit && hit.brand_name && (hit.verified || hit.confidence >= AUTO_MULTI)) {
    const same =
      aliasKey(product.brand ?? "") === aliasKey(hit.brand_name) &&
      aliasKey(product.canonical_name) === aliasKey(hit.canonical_name);
    if (same) {
      await db
        .from("products")
        .update({ identity_status: "confirmada", identity_confidence: hit.confidence, identity_source: hit.source })
        .eq("id", product.id);
      return { outcome: "applied", brandChanged: false, nameChanged: false, detail: "registro" };
    }
    return finish(hit.brand_name, hit.canonical_name, {
      confidence: Math.max(hit.confidence, 0.95),
      source: hit.verified ? "registro-confirmado" : "registro",
      concentration: hit.concentration,
      volumeMl: hit.volume_ml,
      gender: (hit.gender as Gender | null) ?? null,
      referenceUrl: hit.external_reference_url,
    });
  }

  // 3) motor local (dicionário de marcas + aliases + produto equivalente)
  const local = resolveIdentity(dict, {
    title: rawTitle,
    supplierBrand: offer?.brand ?? null,
    url: offer?.url ?? null,
    categories: (offer?.categories as string[] | null) ?? [],
    ean: offer?.ean ?? null,
    siblings: siblingTitles.map((t) => ({ name: t, brand: siblingBrand })),
  });

  const localBrandOk = !!local.brandName && local.confidence >= AUTO_HIGH;
  const localAgreesWithCurrent = !!product.brand && aliasKey(product.brand) === aliasKey(local.brandName ?? "");
  if (localBrandOk && (localAgreesWithCurrent || !product.brand_id)) {
    return finish(local.brandName, local.name, {
      confidence: local.confidence,
      source: local.source,
      flanker: local.flanker,
      concentration: local.concentration,
      volumeMl: local.volumeMl,
      gender: local.gender,
      aliases: local.aliases,
    });
  }

  // 5) pesquisa externa
  if (options.web === false) {
    await queue(db, product, { id: offer?.id ?? null, title: rawTitle }, {
      kind: local.brandName ? "missing_brand" : "unresolved",
      brand: local.brandName,
      brandId: local.brandId,
      name: local.name,
      flanker: local.flanker,
      concentration: local.concentration,
      volumeMl: local.volumeMl,
      gender: local.gender,
      confidence: local.confidence,
      source: local.source,
      aliases: local.aliases,
    });
    return { outcome: local.brandName ? "review" : "unresolved", brandChanged: false, nameChanged: false, detail: "sem pesquisa externa" };
  }

  const { candidate, results, queries } = await researchIdentity({
    title: rawTitle,
    currentBrand: product.brand,
    currentName: product.canonical_name,
    siblingTitles,
    siblingBrand,
  });

  if (!candidate) {
    // sem evidência externa: fica com o que o motor local achou, mas sem aplicar marca duvidosa
    if (local.brandName && local.confidence >= AUTO_MULTI && !product.brand_id) {
      await queue(db, product, { id: offer?.id ?? null, title: rawTitle }, {
        kind: "missing_brand",
        brand: local.brandName,
        brandId: local.brandId,
        name: local.name,
        flanker: local.flanker,
        concentration: local.concentration,
        volumeMl: local.volumeMl,
        gender: local.gender,
        confidence: local.confidence,
        source: local.source,
        queries,
        reason: "pesquisa externa sem resultado claro",
        aliases: local.aliases,
      });
      return { outcome: "review", brandChanged: false, nameChanged: false, results, detail: "sem evidência externa" };
    }
    await queue(db, product, { id: offer?.id ?? null, title: rawTitle }, {
      kind: "unresolved",
      brand: local.brandName,
      name: local.name,
      confidence: Math.min(local.confidence, 0.55),
      source: local.source,
      queries,
      reason: "não foi possível confirmar a marca por pesquisa",
    });
    return { outcome: "unresolved", brandChanged: false, nameChanged: false, results, candidate: null, detail: "não identificado" };
  }

  const foundBrand = preferCanonicalBrand(dict, candidate.brand);
  const conflict =
    !!product.brand && !!foundBrand && aliasKey(product.brand) !== aliasKey(foundBrand) && !!product.brand_id;
  const distinctDomains = new Set(candidate.sources.map((s) => s.domain)).size;
  const localConfirms = !!local.brandName && aliasKey(local.brandName) === aliasKey(foundBrand ?? "");
  const score = Math.min(0.99, candidate.confidence + (localConfirms ? 0.04 : 0));

  if (conflict) {
    await queue(db, product, { id: offer?.id ?? null, title: rawTitle }, {
      kind: "brand_conflict",
      brand: foundBrand,
      name: candidate.name ?? local.name,
      concentration: candidate.concentration,
      volumeMl: candidate.volumeMl,
      gender: candidate.gender,
      confidence: score,
      source: "pesquisa-externa",
      sources: candidate.sources,
      queries: candidate.queries,
      reason: candidate.reason,
    });
    return { outcome: "conflict", brandChanged: false, nameChanged: false, candidate, results, detail: "BRAND_CONFLICT" };
  }

  const canAuto = score >= AUTO_HIGH || (score >= AUTO_MULTI && distinctDomains >= 2);
  if (canAuto && foundBrand && candidate.name) {
    const res = await finish(foundBrand, candidate.name, {
      confidence: score,
      source: "pesquisa-externa",
      concentration: candidate.concentration,
      volumeMl: candidate.volumeMl,
      gender: candidate.gender,
      referenceUrl: candidate.referenceUrl,
      sources: candidate.sources,
      aliases: local.aliases,
    });
    return { ...res, candidate, results };
  }

  await queue(db, product, { id: offer?.id ?? null, title: rawTitle }, {
    kind: score >= REVIEW_FLOOR ? "missing_brand" : "unresolved",
    brand: foundBrand,
    name: candidate.name ?? local.name,
    concentration: candidate.concentration,
    volumeMl: candidate.volumeMl,
    gender: candidate.gender,
    confidence: score,
    source: "pesquisa-externa",
    sources: candidate.sources,
    queries: candidate.queries,
    reason: candidate.reason,
  });
  return {
    outcome: score >= REVIEW_FLOOR ? "review" : "unresolved",
    brandChanged: false,
    nameChanged: false,
    candidate,
    results,
    detail: candidate.reason,
  };
}

/**
 * Full Perfume Identity Audit em lotes.
 * scope "missing": prioridade absoluta para perfumes sem marca.
 * scope "all": revisa também os que já têm marca, procurando inconsistências.
 */
export async function runIdentityAudit(options: {
  scope?: "missing" | "all";
  limit?: number;
  web?: boolean;
} = {}): Promise<AuditReport> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const scope = options.scope ?? "missing";
  const limit = Math.min(options.limit ?? 8, 20);
  const dict = await loadBrandDictionary(db);
  const report = emptyReport();

  const { count: missingBefore } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .eq("product_type", "PERFUME")
    .is("brand_id", null);
  report.missingBefore = missingBefore ?? 0;

  const base = () =>
    db
      .from("products")
      .select("id, canonical_name, brand, brand_id, gender_norm, canonical_identity_locked, identity_status")
      .eq("active", true)
      .eq("product_type", "PERFUME")
      .or("canonical_identity_locked.is.null,canonical_identity_locked.eq.false");

  let rows: ProductRow[] = [];
  if (scope === "missing") {
    const { data } = await base().is("brand_id", null).limit(limit);
    rows = (data ?? []) as ProductRow[];
    if (!rows.length) {
      // sem marca resolvido: segue para os pendentes/conflitos ainda não auditados
      const { data: next } = await base().in("identity_status", ["pendente", "nao_identificada"]).limit(limit);
      rows = (next ?? []) as ProductRow[];
    }
  } else {
    const { data } = await base()
      .not("identity_status", "in", '("confirmada","revisar","conflito")')
      .order("brand_id", { ascending: true, nullsFirst: true })
      .limit(limit);
    rows = (data ?? []) as ProductRow[];
  }

  for (const product of rows) {
    try {
      const res = await auditProduct(db, dict, product, { web: options.web ?? true });
      report.analyzed++;
      if (res.outcome === "applied") {
        report.autoIdentified++;
        if (res.brandChanged) report.brandsFixed++;
        if (res.nameChanged) report.namesFixed++;
      } else if (res.outcome === "conflict") report.conflicts++;
      else if (res.outcome === "review") report.review++;
      else if (res.outcome === "unresolved") report.unresolved++;
    } catch {
      report.unresolved++;
    }
  }

  const { count: missingAfter } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .eq("product_type", "PERFUME")
    .is("brand_id", null);
  report.missingAfter = missingAfter ?? 0;

  const { count: remaining } =
    scope === "missing"
      ? await db
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("active", true)
          .eq("product_type", "PERFUME")
          .is("brand_id", null)
      : await db
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("active", true)
          .eq("product_type", "PERFUME")
          .not("identity_status", "in", '("confirmada","revisar","conflito")');
  report.remaining = remaining ?? 0;
  report.done = rows.length === 0;
  report.message = `${report.analyzed} perfumes auditados · ${report.autoIdentified} identificados · ${report.review + report.conflicts} para revisar · ${report.unresolved} sem identificação · faltam ${report.remaining}`;
  return report;
}
