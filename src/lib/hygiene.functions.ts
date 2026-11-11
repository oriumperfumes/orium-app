import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BrandSegment } from "@/lib/catalog/brand-segment";

type Ctx = {
  supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => Promise<{ data: unknown }> };
  userId: string;
};

const staffOnly = async (context: Ctx) => {
  const { data } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!data) throw new Error("Sem permissão.");
};

/** Auditoria de duplicados do catálogo: une alta confiança e monta a fila de revisão. */
export const runDuplicateCleanup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { maxMerges?: number } | undefined) => data ?? {})
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { runDuplicateAudit } = await import("@/lib/catalog/hygiene.server");
    return runDuplicateAudit(db as never, {
      maxMerges: Math.min(200, Math.max(10, data.maxMerges ?? 120)),
      by: context.userId,
    });
  });

/** Classifica marcas e aplica o posicionamento (só perfumes designer saem). */
export const runBrandPositioning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { runBrandSegmentation } = await import("@/lib/catalog/hygiene.server");
    return runBrandSegmentation(db as never);
  });

/** Números do painel de higiene. */
export const getHygieneMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { hygieneMetrics } = await import("@/lib/catalog/hygiene.server");
    return hygieneMetrics(db as never);
  });

export type DuplicateCandidate = {
  id: string;
  score: number;
  level: string;
  signals: Record<string, string | number | boolean | null>;
  a: CandidateSide;
  b: CandidateSide;
};

export type CandidateSide = {
  id: string;
  name: string;
  brand: string | null;
  slug: string;
  image: string | null;
  concentration: string | null;
  volumeMl: number | null;
  inStock: boolean;
  offers: number;
  locked: boolean;
};

/** Possíveis duplicados aguardando decisão, com os dois lados lado a lado. */
export const listDuplicateCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DuplicateCandidate[]> => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await db
      .from("product_duplicates")
      .select("id, product_a, product_b, score, level, signals")
      .eq("status", "pending")
      .order("score", { ascending: false })
      .limit(80);

    const ids = Array.from(new Set((rows ?? []).flatMap((r) => [r.product_a, r.product_b])));
    if (!ids.length) return [];
    const { data: products } = await db
      .from("products")
      .select(
        "id, canonical_name, brand, slug, image_url, concentration, volume_ml, in_stock, canonical_identity_locked, identity_verified",
      )
      .in("id", ids);
    const { data: offers } = await db
      .from("supplier_products")
      .select("product_id")
      .in("product_id", ids);

    const offerCount = new Map<string, number>();
    for (const o of offers ?? []) {
      if (!o.product_id) continue;
      offerCount.set(o.product_id, (offerCount.get(o.product_id) ?? 0) + 1);
    }

    const side = (id: string): CandidateSide | null => {
      const p = (products ?? []).find((x) => x.id === id);
      if (!p) return null;
      return {
        id: p.id,
        name: p.canonical_name,
        brand: p.brand,
        slug: p.slug,
        image: p.image_url,
        concentration: p.concentration,
        volumeMl: p.volume_ml,
        inStock: Boolean(p.in_stock),
        offers: offerCount.get(p.id) ?? 0,
        locked: Boolean(p.canonical_identity_locked || p.identity_verified),
      };
    };

    return (rows ?? []).flatMap((r) => {
      const a = side(r.product_a);
      const b = side(r.product_b);
      if (!a || !b) return [];
      return [
        {
          id: r.id,
          score: Number(r.score),
          level: r.level ?? "REVIEW_REQUIRED",
          signals: (r.signals as Record<string, string | number | boolean | null>) ?? {},
          a,
          b,
        },
      ];
    });
  });

/** Decisão da equipe: unificar (escolhendo o canônico) ou manter separados para sempre. */
export const decideDuplicate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; action: "merge" | "keep"; keepId?: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { mergeInto } = await import("@/lib/catalog/dedupe.server");

    const { data: row } = await db
      .from("product_duplicates")
      .select("id, product_a, product_b, score, signals")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Par não encontrado.");

    if (data.action === "keep") {
      // Decisão registrada: este par não volta para a fila.
      await db
        .from("product_duplicates")
        .update({
          status: "ignored",
          reviewed_by: context.userId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return { ok: true, merged: false };
    }

    const keepId = data.keepId === row.product_b ? row.product_b : row.product_a;
    const dropId = keepId === row.product_a ? row.product_b : row.product_a;
    await mergeInto(db as never, keepId, dropId, {
      score: Number(row.score),
      signals: { ...((row.signals as Record<string, unknown>) ?? {}), decisao: "manual" },
      by: context.userId,
    });
    await db
      .from("product_duplicates")
      .update({
        status: "merged",
        reviewed_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return { ok: true, merged: true };
  });

export type BrandRow = {
  id: string;
  name: string;
  segment: BrandSegment;
  allowPerfumes: boolean;
  perfumes: number;
  outros: number;
  reviewed: boolean;
};

/** Lista de marcas com contagem de perfumes e de cosméticos. */
export const listBrandSegments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrandRow[]> => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: brands } = await db
      .from("brands")
      .select("id, canonical_name, segment, allow_perfumes, segment_reviewed_by")
      .order("canonical_name");
    const { data: products } = await db.from("products").select("brand_id, product_type");

    const perfumes = new Map<string, number>();
    const outros = new Map<string, number>();
    for (const p of products ?? []) {
      if (!p.brand_id) continue;
      const map = p.product_type === "PERFUME" ? perfumes : outros;
      map.set(p.brand_id, (map.get(p.brand_id) ?? 0) + 1);
    }

    return (brands ?? []).map((b) => ({
      id: b.id,
      name: b.canonical_name,
      segment: (b.segment as BrandSegment) ?? "UNKNOWN",
      allowPerfumes: b.allow_perfumes !== false,
      perfumes: perfumes.get(b.id) ?? 0,
      outros: outros.get(b.id) ?? 0,
      reviewed: Boolean(b.segment_reviewed_by),
    }));
  });

/** Classificação manual da marca e permissão de mostrar seus perfumes. */
export const setBrandSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { brandId: string; segment?: BrandSegment; allowPerfumes?: boolean }) => data,
  )
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { runBrandSegmentation } = await import("@/lib/catalog/hygiene.server");
    await db
      .from("brands")
      .update({
        ...(data.segment ? { segment: data.segment } : {}),
        ...(data.allowPerfumes === undefined ? {} : { allow_perfumes: data.allowPerfumes }),
        segment_source: "equipe",
        segment_reviewed_by: context.userId,
        segment_updated_at: new Date().toISOString(),
      })
      .eq("id", data.brandId);
    return runBrandSegmentation(db as never);
  });

export type MergeRow = {
  id: string;
  nomeUnido: string;
  nomeAtual: string;
  marca: string | null;
  slugAtual: string;
  canonicalId: string;
  quando: string;
  score: number;
  /** Versões (Elixir, Bourbon, Tous…) que diferem entre os dois nomes. */
  diferencaVersao: string[];
  suspeito: boolean;
};

/** Unificações já feitas, marcando as que juntaram versões diferentes da mesma linha. */
export const listMerges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MergeRow[]> => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { flankerDifference } = await import("@/lib/catalog/flankers");

    const { data: rows } = await db
      .from("product_merges")
      .select("id, merged_name, canonical_product_id, score, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    const ids = Array.from(new Set((rows ?? []).map((r) => r.canonical_product_id)));
    if (!ids.length) return [];
    const { data: products } = await db
      .from("products")
      .select("id, canonical_name, brand, slug")
      .in("id", ids);

    return (rows ?? []).flatMap((r) => {
      const p = (products ?? []).find((x) => x.id === r.canonical_product_id);
      if (!p) return [];
      const diff = flankerDifference(r.merged_name ?? "", p.canonical_name);
      return [
        {
          id: r.id,
          nomeUnido: r.merged_name ?? "—",
          nomeAtual: p.canonical_name,
          marca: p.brand,
          slugAtual: p.slug,
          canonicalId: p.id,
          quando: r.created_at,
          score: Number(r.score ?? 0),
          diferencaVersao: diff,
          suspeito: diff.length > 0,
        },
      ];
    });
  });

/** Separa novamente dois perfumes unidos por engano, preservando tudo do produto que ficou. */
export const splitMerge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { unmergeProduct } = await import("@/lib/catalog/dedupe.server");
    return unmergeProduct(db as never, data.id);
  });
