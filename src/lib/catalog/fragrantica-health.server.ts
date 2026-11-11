/**
 * Saúde da importação Fragrantica (V2): métricas reais, reprocessamento em
 * lote, histórico e restauração de versão anterior.
 */
import { PARSER_VERSION } from "./fragrantica-v2.server";
import { applyFragranticaUrl } from "./fragrantica-import.server";

type Db = { from: (t: string) => any };

export type ImportHealth = {
  parserVersion: string;
  catalog: {
    perfumes: number;
    withAccords: number;
    withPyramid: number;
    accordsWithoutPyramid: number;
    withoutAnything: number;
    complete: number;
    partial: number;
    review: number;
    currentParser: number;
  };
  recent: {
    total: number;
    complete: number;
    partial: number;
    failed: number;
    reviewRequired: number;
    blocked: number;
    avgCompleteness: number;
    avgDurationMs: number;
    pyramidRate: number;
    byStrategy: Array<{ strategy: string; count: number }>;
    topIssues: Array<{ issue: string; count: number }>;
  };
  alerts: string[];
};

/** Perfumes com acordes mas sem pirâmide — a falha que motivou o V2. */
export async function accordsWithoutPyramid(db: Db, limit = 200) {
  const [{ data: perfumes }, { data: accords }, { data: notes }] = await Promise.all([
    db.from("products").select("id, canonical_name, brand").eq("product_type", "PERFUME").eq("active", true),
    db.from("fragrance_accords").select("product_id"),
    db.from("fragrance_notes").select("product_id, pyramid_level"),
  ]);
  const hasAccord = new Set(((accords ?? []) as Array<{ product_id: string }>).map((a) => a.product_id));
  const pyramid = new Set(
    ((notes ?? []) as Array<{ product_id: string; pyramid_level: string }>)
      .filter((n) => n.pyramid_level === "TOP" || n.pyramid_level === "HEART" || n.pyramid_level === "BASE")
      .map((n) => n.product_id),
  );
  return ((perfumes ?? []) as Array<{ id: string; canonical_name: string; brand: string | null }>)
    .filter((p) => hasAccord.has(p.id) && !pyramid.has(p.id))
    .slice(0, limit);
}

export async function fragranticaImportHealth(db: Db): Promise<ImportHealth> {
  const [{ data: perfumes }, { data: accords }, { data: notes }, { data: details }, { data: logs }] = await Promise.all([
    db.from("products").select("id").eq("product_type", "PERFUME").eq("active", true),
    db.from("fragrance_accords").select("product_id"),
    db.from("fragrance_notes").select("product_id, pyramid_level"),
    db.from("fragrance_details").select("product_id, status, source_primary"),
    db
      .from("fragrantica_import_logs")
      .select("status, completeness, duration_ms, strategy_used, structure, issues, applied, parser_version")
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const ids = new Set(((perfumes ?? []) as Array<{ id: string }>).map((p) => p.id));
  const hasAccord = new Set(((accords ?? []) as Array<{ product_id: string }>).map((a) => a.product_id));
  const noteRows = (notes ?? []) as Array<{ product_id: string; pyramid_level: string }>;
  const pyramid = new Set(
    noteRows.filter((n) => n.pyramid_level !== "NOTE").map((n) => n.product_id),
  );
  const anyNote = new Set(noteRows.map((n) => n.product_id));
  const detailRows = ((details ?? []) as Array<{ product_id: string; status: string; source_primary: string | null }>).filter((d) =>
    ids.has(d.product_id),
  );

  const withAccords = [...hasAccord].filter((id) => ids.has(id)).length;
  const withPyramid = [...pyramid].filter((id) => ids.has(id)).length;
  const catalog = {
    perfumes: ids.size,
    withAccords,
    withPyramid,
    accordsWithoutPyramid: [...hasAccord].filter((id) => ids.has(id) && !pyramid.has(id)).length,
    withoutAnything: [...ids].filter((id) => !hasAccord.has(id) && !anyNote.has(id)).length,
    complete: detailRows.filter((d) => d.status === "completo").length,
    partial: detailRows.filter((d) => d.status === "parcial").length,
    review: detailRows.filter((d) => d.status === "revisar" || d.status === "nao_encontrado").length,
    currentParser: detailRows.filter((d) => (d.source_primary ?? "").includes(PARSER_VERSION)).length,
  };

  const rows = (logs ?? []) as Array<{
    status: string;
    completeness: number;
    duration_ms: number | null;
    strategy_used: string | null;
    structure: string;
    issues: string[] | null;
    applied: boolean;
  }>;
  const byStrategyMap = new Map<string, number>();
  const issueMap = new Map<string, number>();
  for (const r of rows) {
    const key = r.strategy_used ?? "nenhuma";
    byStrategyMap.set(key, (byStrategyMap.get(key) ?? 0) + 1);
    for (const i of r.issues ?? []) issueMap.set(i, (issueMap.get(i) ?? 0) + 1);
  }
  const avg = (list: number[]) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0);
  const recent = {
    total: rows.length,
    complete: rows.filter((r) => r.status === "COMPLETE").length,
    partial: rows.filter((r) => r.status === "PARTIAL").length,
    failed: rows.filter((r) => r.status === "FAILED").length,
    reviewRequired: rows.filter((r) => r.status === "REVIEW_REQUIRED").length,
    blocked: rows.filter((r) => r.status === "BLOCKED").length,
    avgCompleteness: avg(rows.map((r) => r.completeness)),
    avgDurationMs: avg(rows.filter((r) => r.duration_ms != null).map((r) => r.duration_ms!)),
    pyramidRate: rows.length ? Math.round((rows.filter((r) => r.structure === "PYRAMID").length / rows.length) * 100) : 0,
    byStrategy: [...byStrategyMap.entries()]
      .map(([strategy, count]) => ({ strategy, count }))
      .sort((a, b) => b.count - a.count),
    topIssues: [...issueMap.entries()]
      .map(([issue, count]) => ({ issue, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  };

  const alerts: string[] = [];
  const last30 = rows.slice(0, 30);
  if (last30.length >= 10) {
    const failRate = last30.filter((r) => r.status === "FAILED").length / last30.length;
    const noNotes = last30.filter((r) => r.structure === "NONE").length / last30.length;
    if (failRate >= 0.3) alerts.push("PARSER_DEGRADATION_DETECTED: muitas leituras falharam nas últimas importações.");
    if (noNotes >= 0.4) alerts.push("PARSER_DEGRADATION_DETECTED: muitas páginas sem nenhuma nota — a fonte pode ter mudado.");
  }
  if (catalog.accordsWithoutPyramid > 0)
    alerts.push(`${catalog.accordsWithoutPyramid} perfumes têm acordes mas nenhuma pirâmide.`);

  return { parserVersion: PARSER_VERSION, catalog, recent, alerts };
}

/** Reprocessa em lote usando o link já salvo de cada perfume. */
export async function reprocessBatch(
  db: Db,
  scope: "partial" | "accords-without-pyramid" | "all",
  limit: number,
  userId: string | null,
) {
  let productIds: string[] = [];

  if (scope === "accords-without-pyramid") {
    productIds = (await accordsWithoutPyramid(db, limit * 3)).map((p) => p.id);
  } else {
    const q = db.from("fragrance_details").select("product_id, status, locked, fragrantica_url, source_primary");
    const { data } = await q;
    const rows = ((data ?? []) as Array<{
      product_id: string;
      status: string;
      locked: boolean;
      fragrantica_url: string | null;
      source_primary: string | null;
    }>).filter((r) => !r.locked && r.fragrantica_url);
    productIds = rows
      .filter((r) =>
        scope === "all" ? !(r.source_primary ?? "").includes(PARSER_VERSION) : r.status !== "completo",
      )
      .map((r) => r.product_id);
  }

  const { data: links } = await db
    .from("fragrance_details")
    .select("product_id, fragrantica_url, locked")
    .in("product_id", productIds.slice(0, limit * 3));
  const linkMap = new Map(
    ((links ?? []) as Array<{ product_id: string; fragrantica_url: string | null; locked: boolean }>)
      .filter((l) => l.fragrantica_url && !l.locked)
      .map((l) => [l.product_id, l.fragrantica_url!]),
  );

  const results: Array<{ productId: string; status: string; completeness: number; error: string | null }> = [];
  let processed = 0;
  for (const id of productIds) {
    if (processed >= limit) break;
    const url = linkMap.get(id);
    if (!url) continue;
    processed++;
    const r = await applyFragranticaUrl(db, id, url, { userId, forceFetch: true });
    results.push({ productId: id, status: r.status, completeness: r.completeness, error: r.error });
  }

  const remaining = productIds.filter((id) => linkMap.has(id)).length - processed;
  return { processed, remaining: Math.max(0, remaining), results, parserVersion: PARSER_VERSION };
}

/** Histórico de importações de um perfume (para "Restaurar versão anterior"). */
export async function fragranceHistory(db: Db, productId: string) {
  const { data } = await db
    .from("fragrance_audit_log")
    .select("id, created_at, status, match_confidence, changed, before, after, changes, fragrantica_url")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []) as Array<{
    id: string;
    created_at: string;
    status: string;
    match_confidence: number;
    changed: boolean;
    changes: string[] | null;
    fragrantica_url: string | null;
  }>;
}

/** Restaura os acordes/pirâmide gravados antes de uma importação. */
export async function restoreFragranceSnapshot(db: Db, productId: string, logId: string) {
  const { data: log } = await db
    .from("fragrance_audit_log")
    .select("before")
    .eq("id", logId)
    .eq("product_id", productId)
    .maybeSingle();
  const before = (log?.before ?? null) as
    | { accords?: Array<{ name: string; intensity: number }>; top?: string[]; heart?: string[]; base?: string[] }
    | null;
  if (!before) return { ok: false, error: "Versão anterior não encontrada." };

  await db.from("fragrance_accords").delete().eq("product_id", productId);
  if (before.accords?.length) {
    await db.from("fragrance_accords").insert(
      before.accords.map((a, i) => ({
        product_id: productId,
        accord_name: a.name,
        intensity: a.intensity,
        position: i,
        source: "Restaurado do histórico",
      })),
    );
  }
  await db.from("fragrance_notes").delete().eq("product_id", productId);
  const rows: Array<Record<string, unknown>> = [];
  for (const [level, list] of [
    ["TOP", before.top ?? []],
    ["HEART", before.heart ?? []],
    ["BASE", before.base ?? []],
  ] as Array<[string, string[]]>) {
    list.forEach((label, i) =>
      rows.push({
        product_id: productId,
        note_label: label,
        pyramid_level: level,
        position: i,
        source: "Restaurado do histórico",
      }),
    );
  }
  if (rows.length) await db.from("fragrance_notes").insert(rows);
  return { ok: true, error: null, accords: before.accords?.length ?? 0, notes: rows.length };
}
