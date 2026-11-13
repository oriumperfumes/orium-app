import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BrandSegment } from "@/lib/catalog/brand-segment";

/**
 * Classificação de marca + elegibilidade do catálogo (staff-only).
 * A publicação é decidida pelo gatilho do banco a partir do segmento da marca;
 * aqui só classificamos marcas, simulamos e aplicamos com confirmação.
 */

type Ctx = {
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
  userId: string;
};
const staff = async (c: unknown) => {
  const ctx = c as Ctx;
  const { data } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (!data) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { db: supabaseAdmin as any, userId: ctx.userId, ctx };
};

const SEGMENTS: BrandSegment[] = ["ARABIC", "DESIGNER", "NICHE", "UNKNOWN"];

async function loadAll(db: any) {
  const [{ data: brands }, { data: rules }] = await Promise.all([
    db.from("brands").select("id, canonical_name, segment, segment_source, segment_reviewed_by"),
    db.from("brand_segment_rules").select("rule_key, label, kind, segment, target_brand"),
  ]);
  const products: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("products")
      .select("id, canonical_name, brand_id, product_type, active, catalog_eligible, catalog_eligibility_reason")
      .order("id")
      .range(from, from + 999);
    products.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { brands: (brands ?? []) as any[], rules: (rules ?? []) as any[], products };
}

export type CleanupBrand = {
  id: string;
  name: string;
  current: BrandSegment;
  proposed: BrandSegment;
  manual: boolean;
  perfumes: number;
  publicPerfumes: number;
  suggestion: { targetBrand: string; line: string } | null;
};

/** Simular limpeza Designer/Nicho — nada é alterado. */
export const simulateSegmentCleanup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await staff(context);
    const { classifySegment, suggestRealBrand } = await import("@/lib/identity-v3/eligibility");
    const { brands, rules, products } = await loadAll(db);
    const byBrand = new Map<string, any[]>();
    for (const p of products) if (p.brand_id) byBrand.set(p.brand_id, [...(byBrand.get(p.brand_id) ?? []), p]);

    const rows: CleanupBrand[] = brands.map((b) => {
      const manual = Boolean(b.segment_reviewed_by);
      const guess = classifySegment(b.canonical_name, rules);
      const proposed: BrandSegment = manual ? b.segment : guess.segment !== "UNKNOWN" ? guess.segment : b.segment;
      const ps = (byBrand.get(b.id) ?? []).filter((p) => p.product_type === "PERFUME");
      const suggestion = proposed === "UNKNOWN" ? suggestRealBrand(b.canonical_name, ps[0]?.canonical_name, rules) : null;
      return {
        id: b.id,
        name: b.canonical_name,
        current: b.segment,
        proposed,
        manual,
        perfumes: ps.length,
        publicPerfumes: ps.filter((p) => p.active && p.catalog_eligible).length,
        suggestion: suggestion ? { targetBrand: suggestion.targetBrand, line: suggestion.line } : null,
      };
    });
    const of = (s: BrandSegment) => rows.filter((r) => r.proposed === s);
    const sum = (rs: CleanupBrand[], k: "perfumes" | "publicPerfumes") => rs.reduce((a, r) => a + r[k], 0);
    return {
      designerBrands: of("DESIGNER").length,
      designerPerfumes: sum(of("DESIGNER"), "perfumes"),
      nicheBrands: of("NICHE").length,
      nichePerfumes: sum(of("NICHE"), "perfumes"),
      toHide: sum([...of("DESIGNER"), ...of("NICHE")], "publicPerfumes"),
      doubtful: sum(of("UNKNOWN"), "publicPerfumes"),
      changes: rows.filter((r) => r.proposed !== r.current),
      unknown: of("UNKNOWN").filter((r) => r.perfumes > 0).sort((a, b) => b.publicPerfumes - a.publicPerfumes),
    };
  });

/** Aplica apenas a classificação segura (nunca oculta marca desconhecida). */
export const applySegmentCleanup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db, userId } = await staff(context);
    const { classifySegment } = await import("@/lib/identity-v3/eligibility");
    const { brands, rules, products } = await loadAll(db);
    const before = products.filter((p) => p.active && p.catalog_eligible).length;
    const changed: { id: string; name: string; from: string; to: string }[] = [];
    for (const b of brands) {
      if (b.segment_reviewed_by) continue;
      const g = classifySegment(b.canonical_name, rules);
      if (g.segment === "UNKNOWN" || g.segment === b.segment) continue;
      await db.from("brands").update({ segment: g.segment, segment_source: g.source, segment_updated_at: new Date().toISOString() }).eq("id", b.id);
      changed.push({ id: b.id, name: b.canonical_name, from: b.segment, to: g.segment });
    }
    const { count: after } = await db.from("products").select("id", { count: "exact", head: true }).eq("public_visible", true);
    await db.from("identity_runs").insert({
      mode: "apply",
      status: "done",
      started_by: userId,
      finished_at: new Date().toISOString(),
      report: { kind: "segment_cleanup", changed, publicBefore: before, publicAfter: after ?? 0 },
    });
    return { changed: changed.length, hidden: Math.max(0, before - (after ?? 0)) };
  });

/** Alterar segmento de várias marcas (decisão manual; reprocessa os perfumes). */
export const setBrandsSegmentBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[]; segment: BrandSegment; remember?: boolean }) => {
    if (!Array.isArray(d.ids) || d.ids.length === 0 || d.ids.length > 500) throw new Error("Selecione as marcas.");
    if (!SEGMENTS.includes(d.segment)) throw new Error("Segmento inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { db, userId } = await staff(context);
    const { segmentKey } = await import("@/lib/catalog/brand-segment");
    const { data: rows } = await db.from("brands").select("id, canonical_name").in("id", data.ids);
    await db
      .from("brands")
      .update({ segment: data.segment, segment_source: "equipe", segment_reviewed_by: userId, segment_updated_at: new Date().toISOString() })
      .in("id", data.ids);
    // lembra a decisão como regra, para marcas criadas depois com o mesmo nome
    if (data.remember !== false) {
      const up = (rows ?? []).map((b: any) => ({ rule_key: segmentKey(b.canonical_name), label: b.canonical_name, kind: "brand", segment: data.segment, source: "equipe", created_by: userId }));
      if (up.length) await db.from("brand_segment_rules").upsert(up, { onConflict: "rule_key" });
    }
    return { updated: rows?.length ?? 0 };
  });

/** Corrige marca cadastrada errada ("212 Vi" → Carolina Herrera). */
export const fixWrongBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { brandId: string; targetName: string }) => d)
  .handler(async ({ data, context }) => {
    const { db, ctx } = await staff(context);
    const { brandKey } = await import("@/lib/suppliers/normalize.server");
    const { classifySegment } = await import("@/lib/identity-v3/eligibility");
    const { data: all } = await db.from("brands").select("id, canonical_name");
    let target = (all ?? []).find((b: any) => brandKey(b.canonical_name) === brandKey(data.targetName));
    if (!target) {
      const { ensureBrand } = await import("@/lib/catalog/identity.server");
      const b = await ensureBrand(db, data.targetName, "painel");
      if (!b?.id) throw new Error("Não foi possível criar a marca.");
      target = { id: b.id, canonical_name: b.name };
    }
    const { data: rules } = await db.from("brand_segment_rules").select("rule_key, label, kind, segment, target_brand");
    const seg = classifySegment(target.canonical_name, rules ?? []);
    if (seg.segment !== "UNKNOWN") await db.from("brands").update({ segment: seg.segment, segment_source: seg.source }).eq("id", target.id).is("segment_reviewed_by", null);
    const { error } = await ctx.supabase.rpc("admin_brand_merge", { p_from: data.brandId, p_to: target.id });
    if (error) throw new Error(error.message);
    return { to: target.canonical_name, segment: seg.segment };
  });

/** Números do catálogo para a Integridade. */
export const getEligibilityHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await staff(context);
    const head = { count: "exact" as const, head: true };
    const c = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    const [designer, niche, review, unknownBrands, publicCount] = await Promise.all([
      c(db.from("products").select("id", head).eq("catalog_eligibility_reason", "marca-designer-fora-do-posicionamento")),
      c(db.from("products").select("id", head).eq("catalog_eligibility_reason", "marca-nicho-fora-do-posicionamento")),
      c(db.from("products").select("id", head).eq("catalog_eligibility_reason", "marca-em-revisao")),
      c(db.from("brands").select("id", head).eq("segment", "UNKNOWN")),
      c(db.from("products").select("id", head).eq("public_visible", true)),
    ]);
    return { designer, niche, review, unknownBrands, publicCount };
  });
