import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => Promise<{ data: unknown }> }; userId: string };
const staff = async (c: unknown) => {
  const ctx = c as Ctx;
  const { data } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (!data) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { db: supabaseAdmin, userId: ctx.userId };
};

/** Saúde da identidade do catálogo. */
export const getIdentityHealthV3 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await staff(context);
    const c = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    const head = { count: "exact" as const, head: true };
    const pending = (kind: string) => db.from("identity_review_items").select("id", head).eq("status", "pending").eq("kind", kind);
    const [products, offers, unlinked, dup, inc, unmatched, missingBrand, locks, mappings, negatives, merges, lastRun, settings] = await Promise.all([
      c(db.from("products").select("id", head).eq("active", true)),
      c(db.from("supplier_products").select("id", head).eq("active", true)),
      c(db.from("supplier_products").select("id", head).eq("active", true).is("product_id", null)),
      c(pending("POSSIBLE_DUPLICATE_CANONICAL")),
      c(pending("CANONICAL_INCONSISTENCY")),
      c(pending("UNMATCHED_OFFER")),
      c(db.from("products").select("id", head).eq("active", true).is("brand", null)),
      c(db.from("products").select("id", head).eq("canonical_identity_locked", true)),
      c(db.from("identity_mappings").select("id", head)),
      c(db.from("identity_negative_pairs").select("id", head)),
      c(db.from("identity_merge_log").select("id", head).eq("action", "merge").is("reverted_at", null)),
      db.from("identity_runs").select("id, mode, status, report, started_at, finished_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("identity_settings").select("*").maybeSingle(),
    ]);
    return {
      products, offers, unlinked, duplicates: dup, inconsistencies: inc, unmatched, missingBrand, locks, mappings, negatives, merges,
      lastRun: lastRun.data as null | { id: string; mode: string; status: string; report: any; started_at: string; finished_at: string | null },
      v3Enabled: settings.data?.v3_enabled ?? false,
    };
  });

/** dry_run = simular; audit = gerar fila; apply = aplicar vínculos seguros (com limite). */
export const runIdentityAuditV3 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { mode: "dry_run" | "audit" | "apply" }) => d)
  .handler(async ({ data, context }) => {
    const { db, userId } = await staff(context);
    const { runIdentityAudit } = await import("@/lib/identity-v3/audit.server");
    const r = await runIdentityAudit(db, data.mode, userId);
    return JSON.parse(JSON.stringify(r)) as typeof r;
  });

export type ReviewProduct = {
  id: string; name: string; brand: string | null; concentration: string | null; volume: number | null; image: string | null;
  offers: Array<{ id: string; title: string; supplier: string; price: number | null }>;
};

export const listIdentityReviewV3 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind?: string; status?: string; limit?: number }) => d)
  .handler(async ({ data, context }) => {
    const { db } = await staff(context);
    let q = db.from("identity_review_items").select("*").eq("status", data.status ?? "pending").order("score", { ascending: false, nullsFirst: false }).limit(data.limit ?? 40);
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: items } = await q;
    const list = items ?? [];
    const pids = Array.from(new Set(list.flatMap((i) => [i.product_a, i.product_b]).filter(Boolean))) as string[];
    const oids = list.map((i) => i.supplier_product_id).filter(Boolean) as string[];
    const [{ data: products }, { data: offers }, { data: extra }, { data: suppliers }] = await Promise.all([
      pids.length ? db.from("products").select("id, canonical_name, brand, concentration, volume_ml, image_url").in("id", pids) : Promise.resolve({ data: [] as any[] }),
      pids.length ? db.from("supplier_products").select("id, product_id, supplier_product_name, supplier_id, price").in("product_id", pids).eq("active", true) : Promise.resolve({ data: [] as any[] }),
      oids.length ? db.from("supplier_products").select("id, product_id, supplier_product_name, supplier_id, price, image_url, volume_ml, concentration, brand").in("id", oids) : Promise.resolve({ data: [] as any[] }),
      db.from("suppliers").select("id, name"),
    ]);
    const sName = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
    const prod = new Map<string, ReviewProduct>();
    for (const p of products ?? [])
      prod.set(p.id, { id: p.id, name: p.canonical_name, brand: p.brand, concentration: p.concentration, volume: p.volume_ml, image: p.image_url, offers: [] });
    for (const o of offers ?? []) prod.get(o.product_id!)?.offers.push({ id: o.id, title: o.supplier_product_name ?? "", supplier: sName.get(o.supplier_id) ?? "", price: o.price });
    const offerMap = new Map((extra ?? []).map((o) => [o.id, { ...o, supplier: sName.get(o.supplier_id) ?? "" }]));
    return list.map((i) => ({
      id: i.id, kind: i.kind, recommendation: i.recommendation, score: i.score, reasons: i.reasons as Array<{ label: string; ok: boolean | null; hard?: boolean }>,
      details: i.details as any,
      a: i.product_a ? prod.get(i.product_a) ?? null : null,
      b: i.product_b ? prod.get(i.product_b) ?? null : null,
      offer: i.supplier_product_id ? offerMap.get(i.supplier_product_id) ?? null : null,
    }));
  });

export const resolveIdentityReviewV3 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; decision: "same" | "different" | "later"; keep?: "a" | "b"; brand?: string }) => d)
  .handler(async ({ data, context }) => {
    const { db, userId } = await staff(context);
    const ops = await import("@/lib/identity-v3/ops.server");
    const { data: item } = await db.from("identity_review_items").select("*").eq("id", data.id).maybeSingle();
    if (!item) throw new Error("Item não encontrado.");
    let resolution = data.decision;
    if (data.decision === "later") {
      await db.from("identity_review_items").update({ status: "later", reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq("id", data.id);
      return { ok: true };
    }
    if (item.kind === "POSSIBLE_DUPLICATE_CANONICAL" && item.product_a && item.product_b) {
      if (data.decision === "different") await ops.addNegativePair(db, item.product_a, item.product_b, "Revisão: produtos diferentes", userId);
      else {
        const keep = data.keep === "b" ? item.product_b : item.product_a;
        const drop = keep === item.product_a ? item.product_b : item.product_a;
        await ops.mergeProductsV3(db, keep, drop, { by: userId, reason: "Revisão: mesmo produto", score: Number(item.score ?? 1) });
      }
    } else if (item.kind === "UNMATCHED_OFFER" && item.supplier_product_id) {
      if (data.decision === "same" && item.product_a) await ops.linkOfferV3(db, item.supplier_product_id, item.product_a, userId);
      else await ops.separateOfferV3(db, item.supplier_product_id, item.product_a, userId);
    } else if (item.kind === "MISSING_BRAND" && item.product_a && data.decision === "same") {
      const brand = (data.brand ?? (item.details as any)?.suggestedBrand ?? "").trim();
      if (!brand) throw new Error("Informe a marca.");
      const { data: br } = await db.from("brands").select("id, canonical_name").ilike("canonical_name", brand).maybeSingle();
      const b = br ? { id: br.id, name: br.canonical_name } : null;
      await db.from("products").update({ brand: b?.name ?? brand, brand_id: b?.id ?? null, brand_review_required: !b }).eq("id", item.product_a);
      await db.from("product_field_provenance").upsert({ product_id: item.product_a, field: "brand", source: "manual", locked: true, value: (b?.name ?? brand) as never, updated_by: userId });
    } else if (item.kind === "CANONICAL_INCONSISTENCY" && data.decision === "same") {
      resolution = "same"; // confirmado como consistente
      if (item.product_a) await db.from("products").update({ canonical_identity_locked: true }).eq("id", item.product_a);
    }
    await db.from("identity_review_items").update({ status: "resolved", resolution, reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq("id", data.id);
    return { ok: true };
  });

export const splitProductV3Fn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { productId: string; offerIds: string[]; name: string; flanker?: string | null; reviewId?: string }) => d)
  .handler(async ({ data, context }) => {
    const { db, userId } = await staff(context);
    const { splitProductV3 } = await import("@/lib/identity-v3/ops.server");
    const r = await splitProductV3(db, { ...data, by: userId });
    if (data.reviewId) await db.from("identity_review_items").update({ status: "resolved", resolution: "split", reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq("id", data.reviewId);
    return r;
  });

export const listIdentityLogV3 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await staff(context);
    const { data } = await db.from("identity_merge_log").select("id, action, source_product_ids, target_product_id, reason, score, created_at, reverted_at, payload").order("created_at", { ascending: false }).limit(40);
    return (data ?? []).map((l) => ({
      ...l,
      payload: undefined,
      dropName: l.action === "merge" ? ((l.payload as any)?.dropProduct?.canonical_name as string | undefined) : undefined,
      links: l.action === "link" ? (((l.payload as any)?.links?.length as number | undefined) ?? 1) : undefined,
    }));
  });

export const undoMergeV3Fn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { logId: string }) => d)
  .handler(async ({ data, context }) => {
    const { db, userId } = await staff(context);
    const { undoMergeV3 } = await import("@/lib/identity-v3/ops.server");
    return undoMergeV3(db, data.logId, userId);
  });
