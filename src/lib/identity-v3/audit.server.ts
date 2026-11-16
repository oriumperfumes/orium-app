/**
 * IDENTITY_BACKFILL_V3 — auditoria completa do catálogo.
 *
 * Modos:
 *  - dry_run: só calcula e devolve o relatório (nenhuma alteração além do registro da execução).
 *  - audit:   snapshot das associações + grava fila de revisão.
 *  - apply:   aplica apenas vínculos de oferta de altíssima confiança (com limite e log reversível).
 */
import {
  CandidateIndex,
  ENGINE_VERSION,
  compare,
  decideOffer,
  extractAttributes,
  key,
  pairKey,
  type Attributes,
  type BrandDict,
  type Reason,
} from "./engine";

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

type ProductRow = {
  id: string;
  canonical_name: string;
  brand: string | null;
  flanker: string | null;
  concentration: string | null;
  volume_ml: number | null;
  image_url: string | null;
  canonical_identity_locked: boolean | null;
  catalog_eligible: boolean | null;
};
type OfferRow = {
  id: string;
  product_id: string | null;
  supplier_id: string;
  supplier_product_name: string | null;
  brand: string | null;
  ean: string | null;
  volume_ml: number | null;
  concentration: string | null;
  price: number | null;
  link_locked: boolean | null;
};

async function all<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await fetchPage(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadBrandDict(db: Db): Promise<{ dict: BrandDict; aliasOf: (a: string, b: string) => boolean }> {
  const [brands, aliases, v3] = await Promise.all([
    all<{ id: string; name: string }>((f, t) =>
      db.from("brands").select("id, canonical_name").order("id").range(f, t).then((r) => ({ data: (r.data ?? []).map((b) => ({ id: b.id, name: b.canonical_name })) })),
    ),
    all<{ brand_id: string; alias: string }>((f, t) => db.from("brand_aliases").select("brand_id, alias").order("brand_id").order("alias").range(f, t)),
    all<{ brand_id: string | null; alias: string }>((f, t) =>
      db.from("catalog_aliases").select("brand_id, alias").eq("alias_type", "brand").order("alias").order("brand_id").range(f, t),
    ),
  ]);
  const nameById = new Map(brands.map((b) => [b.id, b.name]));
  const byKey = new Map<string, string>();
  for (const b of brands) if (key(b.name).length >= 3) byKey.set(key(b.name), b.name);
  for (const a of [...aliases, ...v3]) {
    const official = a.brand_id ? nameById.get(a.brand_id) : null;
    if (official && key(a.alias).length >= 3) byKey.set(key(a.alias), official);
  }
  const aliasOf = (a: string, b: string) => {
    const oa = byKey.get(a), ob = byKey.get(b);
    return !!oa && !!ob && key(oa) === key(ob);
  };
  return { dict: { byKey }, aliasOf };
}

export type AuditReport = {
  engineVersion: string;
  analyzed: { products: number; offers: number };
  probableDuplicates: number;
  suspiciousMerges: number;
  unlinkedOffers: number;
  safeAutoLinks: number;
  reviewLinks: number;
  newCanonicalCandidates: number;
  missingBrand: number;
  correctableBrands: number;
  ignoredClosePairs: number;
  samples: {
    duplicates: Array<{ a: string; b: string; recommendation: string; reasons: string[] }>;
    inconsistencies: Array<{ product: string; offers: string[]; reasons: string[] }>;
    autoLinks: Array<{ offer: string; product: string; score: number }>;
  };
};

type ReviewDraft = {
  kind: "POSSIBLE_DUPLICATE_CANONICAL" | "CANONICAL_INCONSISTENCY" | "UNMATCHED_OFFER" | "MISSING_BRAND";
  product_a: string | null;
  product_b: string | null;
  supplier_product_id: string | null;
  recommendation: "SAME" | "DIFFERENT" | "REVIEW" | "LINK" | "NEW";
  score: number | null;
  reasons: Reason[];
  details: Record<string, unknown>;
  pair_key: string;
};

export async function runIdentityAudit(
  db: Db,
  mode: "dry_run" | "audit" | "apply",
  userId: string | null,
): Promise<{ runId: string; report: AuditReport; applied: number | undefined }> {
  const { data: run } = await db
    .from("identity_runs")
    .insert({ mode, engine_version: ENGINE_VERSION, started_by: userId })
    .select("id")
    .single();
  const runId = run!.id;

  try {
    const [{ dict, aliasOf }, products, offers, negatives, mappings, settings] = await Promise.all([
      loadBrandDict(db),
      all<ProductRow>((f, t) =>
        db
          .from("products")
          .select("id, canonical_name, brand, flanker, concentration, volume_ml, image_url, canonical_identity_locked, catalog_eligible")
          .eq("active", true)
          .order("id")
          .range(f, t),
      ),
      all<OfferRow>((f, t) =>
        db
          .from("supplier_products")
          .select("id, product_id, supplier_id, supplier_product_name, brand, ean, volume_ml, concentration, price, link_locked")
          .eq("active", true)
          .order("id")
          .range(f, t),
      ),
      all<{ product_a: string; product_b: string }>((f, t) => db.from("identity_negative_pairs").select("product_a, product_b").order("product_a").order("product_b").range(f, t)),
      all<{ supplier_product_id: string; product_id: string | null; state: string }>((f, t) =>
        db.from("identity_mappings").select("supplier_product_id, product_id, state").order("supplier_product_id").range(f, t),
      ),
      db.from("identity_settings").select("*").maybeSingle(),
    ]);

    const negative = new Set(negatives.map((n) => pairKey(n.product_a, n.product_b)));
    const manualMap = new Map(mappings.filter((m) => m.state.startsWith("MANUALLY") || m.state === "BLOCKED").map((m) => [m.supplier_product_id, m]));
    const cmpOpts = { brandAliases: aliasOf };

    // ---- atributos
    const pAttr = new Map<string, Attributes>();
    const index = new CandidateIndex<ProductRow>();
    for (const p of products) {
      const a = extractAttributes(
        { title: p.canonical_name, brand: p.brand, flanker: p.flanker, concentration: p.concentration, volumeMl: p.volume_ml },
        dict,
      );
      pAttr.set(p.id, a);
      index.add(p, a);
    }
    const oAttr = new Map<string, Attributes>();
    for (const o of offers) {
      oAttr.set(
        o.id,
        extractAttributes(
          { title: o.supplier_product_name ?? "", brand: o.brand, concentration: o.concentration, volumeMl: o.volume_ml, ean: o.ean },
          dict,
        ),
      );
    }
    const pName = (id: string) => {
      const p = products.find((x) => x.id === id);
      return p ? `${p.canonical_name}${p.brand ? ` · ${p.brand}` : ""}` : id;
    };

    const drafts: ReviewDraft[] = [];
    const report: AuditReport = {
      engineVersion: ENGINE_VERSION,
      analyzed: { products: products.length, offers: offers.length },
      probableDuplicates: 0,
      suspiciousMerges: 0,
      unlinkedOffers: 0,
      safeAutoLinks: 0,
      reviewLinks: 0,
      newCanonicalCandidates: 0,
      missingBrand: 0,
      correctableBrands: 0,
      ignoredClosePairs: 0,
      samples: { duplicates: [], inconsistencies: [], autoLinks: [] },
    };

    // ---- Fase 1: marcas
    for (const p of products) {
      const a = pAttr.get(p.id)!;
      if (!p.brand) {
        report.missingBrand++;
        const offerBrand = offers.find((o) => o.product_id === p.id && oAttr.get(o.id)?.brand)?.id;
        const guess = offerBrand ? oAttr.get(offerBrand)!.brand : a.brand;
        if (guess) report.correctableBrands++;
        drafts.push({
          kind: "MISSING_BRAND", product_a: p.id, product_b: null, supplier_product_id: null,
          recommendation: guess ? "LINK" : "REVIEW", score: null,
          reasons: [{ field: "brand", label: guess ? `Marca provável: ${guess}` : "Marca não identificada", ok: null }],
          details: { suggestedBrand: guess }, pair_key: p.id,
        });
      } else if (a.brand && key(a.brand) !== key(p.brand)) {
        report.correctableBrands++;
      }
    }

    // ---- Fase 4: duplicados entre canônicos
    const seen = new Set<string>();
    for (const p of products) {
      const a = pAttr.get(p.id)!;
      for (const c of index.candidates(a, 12)) {
        if (c.item.id === p.id) continue;
        const pk = pairKey(p.id, c.item.id);
        if (seen.has(pk) || negative.has(pk)) continue;
        seen.add(pk);
        const cmp = compare(a, c.attrs, { ...cmpOpts, level: "canonical" });
        if (cmp.verdict === "DIFFERENT") {
          if (cmp.score >= 0.6) report.ignoredClosePairs++;
          continue;
        }
        if (cmp.score < 0.75) continue;
        // apresentações diferentes (30ml × 100ml, EDT × Parfum) são produtos comerciais separados
        if (!cmp.samePresentation) { report.ignoredClosePairs++; continue; }
        report.probableDuplicates++;
        const rec = cmp.verdict === "SAME" ? "SAME" : "REVIEW";
        drafts.push({
          kind: "POSSIBLE_DUPLICATE_CANONICAL", product_a: p.id, product_b: c.item.id, supplier_product_id: null,
          recommendation: rec, score: cmp.score, reasons: cmp.reasons, details: {}, pair_key: pk,
        });
        if (report.samples.duplicates.length < 25)
          report.samples.duplicates.push({ a: pName(p.id), b: pName(c.item.id), recommendation: rec, reasons: cmp.reasons.map((r) => r.label) });
      }
    }

    // ---- Fase 5: merges suspeitos (consistência interna)
    const offersByProduct = new Map<string, OfferRow[]>();
    for (const o of offers) if (o.product_id) (offersByProduct.get(o.product_id) ?? offersByProduct.set(o.product_id, []).get(o.product_id)!).push(o);
    for (const [pid, list] of offersByProduct) {
      const pa = pAttr.get(pid);
      if (!pa) continue;
      const conflicts: Array<{ offerId: string; reasons: string[] }> = [];
      for (const o of list) {
        const oa = oAttr.get(o.id)!;
        if (!oa.base.length) continue;
        const cmp = compare(pa, oa, { ...cmpOpts, level: "offer" });
        const hard = cmp.reasons.filter((r) => r.hard && r.ok === false && r.field !== "base");
        const pres = cmp.reasons.filter((r) => (r.field === "volume" || r.field === "concentration") && r.ok === false);
        if (hard.length || pres.length) conflicts.push({ offerId: o.id, reasons: [...hard, ...pres].map((r) => r.label) });
      }
      if (!conflicts.length) continue;
      report.suspiciousMerges++;
      drafts.push({
        kind: "CANONICAL_INCONSISTENCY", product_a: pid, product_b: null, supplier_product_id: null,
        recommendation: "REVIEW", score: null,
        reasons: Array.from(new Set(conflicts.flatMap((c) => c.reasons))).slice(0, 8).map((label) => ({ field: "offer", label, ok: false })),
        details: { conflicts }, pair_key: pid,
      });
      if (report.samples.inconsistencies.length < 25)
        report.samples.inconsistencies.push({
          product: pName(pid),
          offers: conflicts.map((c) => list.find((o) => o.id === c.offerId)?.supplier_product_name ?? "").slice(0, 5),
          reasons: Array.from(new Set(conflicts.flatMap((c) => c.reasons))).slice(0, 5),
        });
    }

    // ---- Fase 3: ofertas sem vínculo
    const autoLinks: Array<{ offerId: string; productId: string; score: number; reasons: Reason[] }> = [];
    for (const o of offers) {
      if (o.product_id) continue;
      report.unlinkedOffers++;
      if (manualMap.has(o.id) || o.link_locked) continue;
      const oa = oAttr.get(o.id)!;
      if (!oa.base.length) continue;
      const d = decideOffer(oa, index, cmpOpts);
      if (d.state === "AUTO_MATCHED" && d.productId) {
        report.safeAutoLinks++;
        autoLinks.push({ offerId: o.id, productId: d.productId, score: d.score, reasons: d.reasons });
        if (report.samples.autoLinks.length < 40)
          report.samples.autoLinks.push({ offer: o.supplier_product_name ?? "", product: pName(d.productId), score: d.score });
      } else if (d.state === "REVIEW_REQUIRED" && d.productId) {
        report.reviewLinks++;
        drafts.push({
          kind: "UNMATCHED_OFFER", product_a: d.productId, product_b: null, supplier_product_id: o.id,
          recommendation: "REVIEW", score: d.score, reasons: d.reasons, details: { alternatives: d.alternatives }, pair_key: o.id,
        });
      } else report.newCanonicalCandidates++;
    }

    let applied: number | undefined;
    if (mode !== "dry_run") {
      // snapshot lógico das associações antes de qualquer alteração
      await db.from("identity_snapshots").insert({
        run_id: runId,
        label: `Antes da auditoria ${mode}`,
        data: {
          offers: offers.map((o) => [o.id, o.product_id]),
          negatives: negatives.length,
          mappings: mappings.length,
        } as never,
        created_by: userId,
      });

      // fila de revisão (não reabre itens já decididos)
      const { data: existing } = await db.from("identity_review_items").select("kind, pair_key, status");
      const decided = new Set((existing ?? []).filter((e) => e.status !== "pending").map((e) => `${e.kind}:${e.pair_key}`));
      const fresh = drafts.filter((d) => !decided.has(`${d.kind}:${d.pair_key}`));
      // limpa pendências que deixaram de existir
      const current = new Set(drafts.map((d) => `${d.kind}:${d.pair_key}`));
      const stale = (existing ?? []).filter((e) => e.status === "pending" && !current.has(`${e.kind}:${e.pair_key}`));
      for (const s of stale) await db.from("identity_review_items").update({ status: "dismissed", resolution: "auto: não se aplica mais" }).eq("kind", s.kind).eq("pair_key", s.pair_key);
      for (let i = 0; i < fresh.length; i += 200) {
        await db.from("identity_review_items").upsert(
          fresh.slice(i, i + 200).map((d) => ({ ...d, reasons: d.reasons as never, details: d.details as never, run_id: runId, engine_version: ENGINE_VERSION, status: "pending" })),
          { onConflict: "kind,pair_key" },
        );
      }

      if (mode === "apply") {
        const cap = settings.data?.max_auto_merges_per_run ?? 50;
        const batch = autoLinks.slice(0, cap);
        for (const l of batch) {
          await db.from("supplier_products").update({ product_id: l.productId }).eq("id", l.offerId).is("product_id", null);
          await db.from("identity_mappings").upsert(
            {
              supplier_product_id: l.offerId, product_id: l.productId, state: "AUTO_MATCHED", score: l.score,
              signals: { reasons: l.reasons } as never, engine_version: ENGINE_VERSION, decided_by: userId, updated_at: new Date().toISOString(),
            },
            { onConflict: "supplier_product_id" },
          );
        }
        if (batch.length)
          await db.from("identity_merge_log").insert({
            action: "link", target_product_id: null, reason: "Vínculos de altíssima confiança (auditoria V3)",
            payload: { links: batch.map((l) => ({ offerId: l.offerId, productId: l.productId, score: l.score })), runId } as never,
            created_by: userId,
          });
        applied = batch.length;
      }
    }

    await db.from("identity_runs").update({ status: "done", report: report as never, finished_at: new Date().toISOString() }).eq("id", runId);
    return { runId, report, applied };
  } catch (e) {
    await db.from("identity_runs").update({ status: "error", report: { error: e instanceof Error ? e.message : String(e) } as never, finished_at: new Date().toISOString() }).eq("id", runId);
    throw e;
  }
}
