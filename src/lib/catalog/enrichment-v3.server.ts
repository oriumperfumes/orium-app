/**
 * FRAGRANTICA ENRICHMENT ENGINE V3 — executor.
 *
 * Por perfume: busca (índice local -> marca -> fuzzy) -> leitura da página
 * (motor V2, várias estratégias) -> gravação com quality guard -> descrição
 * própria da Orium. Roda em lotes com concorrência controlada e checkpoint:
 * o progresso fica no próprio banco (search_status), então nada recomeça
 * do zero e perfumes completos não são reprocessados.
 */

import { extractFromHtml, qualityGuard, type Extraction } from "./fragrantica-v2.server";
import { readSnapshot, writeSnapshot, markStatus, type AuditSnapshot } from "./fragrantica-audit.server";
import { buildDescription, qualityCheck } from "./description.server";
import {
  beginBatch,
  currentBatchStop,
  endBatch,
  fetchPage,
  findFragranticaPage,
  logSearch,
  MAX_CONCURRENCY,
  remainingMs,
  type BatchStop,
  SEARCH_VERSION,
  type SearchProduct,
  type SearchStatus,
} from "./fragrantica-search.server";

type Db = { from: (t: string) => any };

export type Mode = "not-found" | "partial" | "descriptions" | "missing-url" | "all";

export type ItemResult = {
  productId: string;
  productName: string;
  searchStatus: SearchStatus | "SKIPPED";
  url: string | null;
  score: number;
  stage: string;
  reason: string;
  accords: number;
  notes: number;
  hasPyramid: boolean;
  descriptionWritten: boolean;
  descriptionReason: string;
  requests: number;
  durationMs: number;
};

export type RunResult = {
  version: string;
  processed: number;
  verified: number;
  candidates: number;
  review: number;
  notFound: number;
  temporaryFailure: number;
  skipped: number;
  descriptionsWritten: number;
  requests: number;
  cacheHits: number;
  remaining: number;
  /** Itens da fila deste lote que não chegaram a começar (prazo, bloqueio ou falhas seguidas). */
  notStarted: number;
  /** Por que o lote parou antes do fim, se parou (modo com prazo). */
  stopped: BatchStop | null;
  durationMs: number;
  perItemMs: number;
  itemsPerMinute: number;
  items: ItemResult[];
};

type Row = {
  id: string;
  canonical_name: string;
  brand: string | null;
  flanker: string | null;
  concentration: string | null;
  gender_norm: string | null;
  raw_name: string | null;
  search_aliases: string[] | null;
  details: {
    fragrantica_url: string | null;
    search_status: string | null;
    locked: boolean | null;
    description: string | null;
    status: string | null;
    last_search_at: string | null;
    search_attempts: number | null;
  } | null;
  accords: number;
  pyramid: boolean;
};

const TEMP_COOLDOWN_MS = 20 * 60_000;
const MISS_COOLDOWN_MS = 3 * 24 * 60 * 60_000;

/* ------------------------------ fila / ordem ----------------------------- */

async function loadCatalog(db: Db): Promise<Row[]> {
  const products: Array<Record<string, unknown>> = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data } = await db
      .from("products")
      .select("id, canonical_name, brand, flanker, concentration, gender_norm, raw_name, search_aliases")
      .eq("product_type", "PERFUME")
      .eq("active", true)
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    const chunk = (data ?? []) as Array<Record<string, unknown>>;
    products.push(...chunk);
    if (chunk.length < page) break;
  }

  const [{ data: details }, { data: accords }, { data: notes }] = await Promise.all([
    db
      .from("fragrance_details")
      .select("product_id, fragrantica_url, search_status, locked, description, status, last_search_at, search_attempts"),
    db.from("fragrance_accords").select("product_id"),
    db.from("fragrance_notes").select("product_id, pyramid_level"),
  ]);

  const byId = new Map<string, Row["details"]>();
  for (const d of (details ?? []) as Array<Record<string, unknown>>) byId.set(d['product_id'] as string, d as never);
  const accordCount = new Map<string, number>();
  for (const a of (accords ?? []) as Array<{ product_id: string }>) {
    accordCount.set(a.product_id, (accordCount.get(a.product_id) ?? 0) + 1);
  }
  const pyramid = new Set(
    ((notes ?? []) as Array<{ product_id: string; pyramid_level: string }>)
      .filter((n) => ["TOP", "HEART", "BASE"].includes(n.pyramid_level))
      .map((n) => n.product_id),
  );

  return products.map((p) => ({
    ...(p as unknown as Omit<Row, "details" | "accords" | "pyramid">),
    details: byId.get(p['id'] as string) ?? null,
    accords: accordCount.get(p['id'] as string) ?? 0,
    pyramid: pyramid.has(p['id'] as string),
  }));
}

const isComplete = (r: Row) => r.accords >= 3 && r.pyramid && !!r.details?.description;

/** Prioridade: sem URL, sem descrição, sem pirâmide, sem acordes, parciais, resto. */
function priority(r: Row): number {
  const d = r.details;
  if (d?.search_status === "TEMPORARY_FAILURE") return 0;
  if (!d?.fragrantica_url) return 1;
  if (!d.description) return 2;
  if (!r.pyramid) return 3;
  if (!r.accords) return 4;
  if (d.status === "parcial" || d.search_status === "CANDIDATE_FOUND") return 5;
  if (d.search_status === "REVIEW_REQUIRED") return 6;
  return 9;
}

function inQueue(r: Row, mode: Mode, force: boolean): boolean {
  const d = r.details;
  if (d?.locked && !force) return false;
  if (force) return true;
  if (isComplete(r) && mode !== "all") return false;

  const status = d?.search_status ?? "PENDING";
  const last = d?.last_search_at ? new Date(d.last_search_at).getTime() : 0;

  if (mode === "not-found") {
    if (status === "TEMPORARY_FAILURE") return Date.now() - last > TEMP_COOLDOWN_MS;
    return status === "NOT_FOUND" && Date.now() - last > MISS_COOLDOWN_MS;
  }
  if (mode === "partial") return !r.pyramid || r.accords < 3 || status === "CANDIDATE_FOUND" || d?.status === "parcial";
  if (mode === "descriptions") return !d?.description && (r.accords >= 2 || r.pyramid);
  if (mode === "missing-url") return !d?.fragrantica_url;
  // all: tudo que não está completo, respeitando cooldown de "não encontrado"
  if (status === "NOT_FOUND" && Date.now() - last < MISS_COOLDOWN_MS) return false;
  return !isComplete(r);
}

/* ------------------------------- um perfume ------------------------------ */

export async function enrichProductV3(
  db: Db,
  row: Row,
  opts: { force?: boolean; forceDescription?: boolean } = {},
): Promise<ItemResult> {
  const started = Date.now();
  const product: SearchProduct = {
    id: row.id,
    canonical_name: row.canonical_name,
    brand: row.brand,
    flanker: row.flanker,
    concentration: row.concentration,
    gender_norm: row.gender_norm,
    raw_name: row.raw_name,
    search_aliases: row.search_aliases,
  };
  const productName = `${row.brand ?? ""} ${row.canonical_name}`.trim();
  const out: ItemResult = {
    productId: row.id,
    productName,
    searchStatus: "SKIPPED",
    url: null,
    score: 0,
    stage: "",
    reason: "",
    accords: row.accords,
    notes: 0,
    hasPyramid: row.pyramid,
    descriptionWritten: false,
    descriptionReason: "",
    requests: 0,
    durationMs: 0,
  };

  const search = await findFragranticaPage(db, product, {
    knownUrl: row.details?.fragrantica_url ?? null,
    force: opts.force ?? false,
  });
  await logSearch(db, row.id, search);
  out.searchStatus = search.status;
  out.url = search.url;
  out.score = search.score;
  out.stage = search.stage;
  out.reason = search.reason;
  out.requests += search.requests;

  await db.from("fragrance_details").upsert(
    {
      product_id: row.id,
      search_status: search.status,
      fragrantica_match_score: search.score,
      last_search_at: new Date().toISOString(),
      search_attempts: (row.details?.search_attempts ?? 0) + 1,
      ...(search.url && search.status !== "NOT_FOUND" ? { fragrantica_url: search.url } : {}),
    },
    { onConflict: "product_id" },
  );

  const trustworthy = search.status === "VERIFIED" || search.status === "CANDIDATE_FOUND";
  if (!search.url || !trustworthy) {
    out.durationMs = Date.now() - started;
    return out;
  }

  /* leitura da página com o motor V2 */
  const fetched = await fetchPage(search.url, { force: opts.force ?? false });
  if (!fetched.fromCache) out.requests += 1;
  if (!fetched.html) {
    if (fetched.failed) {
      out.searchStatus = "TEMPORARY_FAILURE";
      out.reason = `página não pôde ser lida agora (resposta ${fetched.httpStatus ?? "sem resposta"})`;
      await db
        .from("fragrance_details")
        .upsert({ product_id: row.id, search_status: "TEMPORARY_FAILURE" }, { onConflict: "product_id" });
    }
    out.durationMs = Date.now() - started;
    return out;
  }

  const extraction = extractFromHtml(fetched.html, search.url) as Extraction;
  const after: AuditSnapshot = {
    accords: extraction.accords.map((a) => ({ name: a.name, intensity: a.intensity })),
    top: extraction.levels.TOP.map((n) => n.label),
    heart: extraction.levels.HEART.map((n) => n.label),
    base: extraction.levels.BASE.map((n) => n.label),
  };
  const flatNotes = extraction.flat.map((n) => n.label);
  if (!after.top.length && !after.heart.length && !after.base.length && flatNotes.length) {
    // fonte publica lista única: guardamos como veio, sem inventar pirâmide
    after.heart = flatNotes;
  }

  const before = await readSnapshot(db, row.id);
  const guard = qualityGuard(
    { accords: before.accords.length, notes: before.top.length + before.heart.length + before.base.length, hasPyramid: before.top.length > 0 || before.base.length > 0 },
    { accords: after.accords.length, notes: after.top.length + after.heart.length + after.base.length, hasPyramid: extraction.structure === "PYRAMID" },
    opts.force ?? false,
  );
  const allowed = guard.allow;

  if (allowed && (after.accords.length || after.top.length || after.heart.length || after.base.length)) {
    await writeSnapshot(db, row.id, after, search.url, extraction.noteImages);
    await markStatus(db, row.id, "VERIFIED_FRAGRANTICA", search.score, search.url, after);
    out.accords = after.accords.length;
    out.notes = after.top.length + after.heart.length + after.base.length;
    out.hasPyramid = extraction.structure === "PYRAMID";
  } else {
    out.reason = out.reason || "dado atual já era melhor — mantido";
  }

  /* descrição própria da Orium */
  const needsDescription = !row.details?.description || opts.forceDescription || opts.force;
  const identified = search.status === "VERIFIED" || (search.status === "CANDIDATE_FOUND" && search.score >= 88);
  if (needsDescription && identified) {
    const input = {
      name: row.canonical_name,
      brand: row.brand,
      gender: row.gender_norm,
      concentration: row.concentration,
      family: extraction.identity.family,
      accords: (out.accords ? after.accords.map((a) => a.name) : before.accords.map((a) => a.name)).slice(0, 6),
      top: after.top.length ? after.top : before.top,
      heart: after.heart.length ? after.heart : before.heart,
      base: after.base.length ? after.base : before.base,
    };
    const built = buildDescription(input);
    if (!built.ok) out.descriptionReason = built.reason;
    else {
      const check = await qualityCheck(db, input, built.text);
      if (!check.ok) out.descriptionReason = check.reason;
      else {
        await db.from("fragrance_details").upsert(
          {
            product_id: row.id,
            description: built.text,
            description_source: "orium-v3",
            description_generated_at: new Date().toISOString(),
            olfactory_family: extraction.identity.family ?? null,
          },
          { onConflict: "product_id" },
        );
        out.descriptionWritten = true;
        out.descriptionReason = "descrição Orium gerada";
      }
    }
  } else if (!needsDescription) {
    out.descriptionReason = "já possuía descrição";
  } else {
    out.descriptionReason = "identificação ainda não confirmada";
  }

  out.durationMs = Date.now() - started;
  return out;
}

/* -------------------------------- em lote -------------------------------- */

export async function runEnrichmentV3(
  db: Db,
  opts: { mode?: Mode; limit?: number; force?: boolean; concurrency?: number; deadlineMs?: number } = {},
): Promise<RunResult> {
  const started = Date.now();
  // Com `deadlineMs` o lote inteiro tem prazo (ver fragrantica-search.server.ts); sem ele, comportamento de sempre.
  const strict = typeof opts.deadlineMs === "number";
  if (strict) beginBatch(started + (opts.deadlineMs as number));
  const mode = opts.mode ?? "all";
  const limit = Math.max(1, Math.min(120, opts.limit ?? 40));
  const workers = Math.max(1, Math.min(MAX_CONCURRENCY, opts.concurrency ?? MAX_CONCURRENCY));

  const catalog = await loadCatalog(db);
  const queue = catalog
    .filter((r) => inQueue(r, mode, opts.force ?? false))
    .sort((a, b) => priority(a) - priority(b));
  const batch = queue.slice(0, limit);

  const items: ItemResult[] = [];
  let cursor = 0;
  /** Perfume novo só começa se ainda couber uma leitura e o lote não foi encerrado. */
  const canStart = () => !strict || (!currentBatchStop() && remainingMs() >= 12_000);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < batch.length && canStart()) {
        const row = batch[cursor++]!;
        try {
          items.push(
            await enrichProductV3(db, row, {
              force: opts.force ?? false,
              forceDescription: mode === "descriptions",
            }),
          );
        } catch (e) {
          items.push({
            productId: row.id,
            productName: `${row.brand ?? ""} ${row.canonical_name}`.trim(),
            searchStatus: "TEMPORARY_FAILURE",
            url: null,
            score: 0,
            stage: "erro",
            reason: e instanceof Error ? e.message : "erro inesperado",
            accords: row.accords,
            notes: 0,
            hasPyramid: row.pyramid,
            descriptionWritten: false,
            descriptionReason: "",
            requests: 0,
            durationMs: 0,
          });
        }
      }
    }),
  );

  let stopped: BatchStop | null = null;
  if (strict) {
    stopped = endBatch();
    if (!stopped && cursor < batch.length) {
      stopped = { reason: "deadline", httpStatus: null, detail: "tempo do lote esgotado; o restante fica para a próxima execução" };
    }
  }
  const durationMs = Date.now() - started;
  const count = (s: SearchStatus) => items.filter((i) => i.searchStatus === s).length;
  return {
    version: SEARCH_VERSION,
    processed: items.length,
    verified: count("VERIFIED"),
    candidates: count("CANDIDATE_FOUND"),
    review: count("REVIEW_REQUIRED"),
    notFound: count("NOT_FOUND"),
    temporaryFailure: count("TEMPORARY_FAILURE"),
    skipped: items.filter((i) => i.searchStatus === "SKIPPED").length,
    descriptionsWritten: items.filter((i) => i.descriptionWritten).length,
    requests: items.reduce((s, i) => s + i.requests, 0),
    cacheHits: items.filter((i) => i.requests === 0).length,
    remaining: Math.max(0, queue.length - batch.length),
    notStarted: Math.max(0, batch.length - cursor),
    stopped,
    durationMs,
    perItemMs: items.length ? Math.round(durationMs / items.length) : 0,
    itemsPerMinute: durationMs ? Math.round((items.length / durationMs) * 60_000) : 0,
    items,
  };
}

/* ------------------------------- progresso ------------------------------- */

export type V3Progress = {
  total: number;
  withUrl: number;
  verified: number;
  candidates: number;
  review: number;
  notFound: number;
  temporaryFailure: number;
  pending: number;
  withDescription: number;
  withoutDescription: number;
  withAccords: number;
  withPyramid: number;
  complete: number;
  queue: { notFound: number; partial: number; descriptions: number; all: number };
  search: {
    attempts: number;
    matchRate: number;
    cacheHitRate: number;
    notFoundRate: number;
    temporaryFailureRate: number;
    avgDurationMs: number;
  };
  alerts: string[];
};

export async function enrichmentProgress(db: Db): Promise<V3Progress> {
  const catalog = await loadCatalog(db);
  const total = catalog.length;
  const s = (name: string) => catalog.filter((r) => (r.details?.search_status ?? "PENDING") === name).length;

  const { data: logs } = await db
    .from("fragrantica_search_log")
    .select("status, from_cache, duration_ms")
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (logs ?? []) as Array<{ status: string; from_cache: boolean; duration_ms: number | null }>;
  const pct = (n: number) => (rows.length ? Math.round((n / rows.length) * 100) : 0);
  const matched = rows.filter((r) => r.status === "VERIFIED" || r.status === "CANDIDATE_FOUND").length;
  const notFoundRate = pct(rows.filter((r) => r.status === "NOT_FOUND").length);

  const alerts: string[] = [];
  if (rows.length >= 30 && notFoundRate > 45) {
    alerts.push("Possível problema no mecanismo de busca do Fragrantica: muitos perfumes não localizados nas últimas tentativas.");
  }
  const tempRate = pct(rows.filter((r) => r.status === "TEMPORARY_FAILURE").length);
  if (rows.length >= 20 && tempRate > 20) alerts.push("A fonte está instável agora — as falhas temporárias serão repetidas depois.");

  return {
    total,
    withUrl: catalog.filter((r) => !!r.details?.fragrantica_url).length,
    verified: s("VERIFIED"),
    candidates: s("CANDIDATE_FOUND"),
    review: s("REVIEW_REQUIRED"),
    notFound: s("NOT_FOUND"),
    temporaryFailure: s("TEMPORARY_FAILURE"),
    pending: s("PENDING"),
    withDescription: catalog.filter((r) => !!r.details?.description).length,
    withoutDescription: catalog.filter((r) => !r.details?.description).length,
    withAccords: catalog.filter((r) => r.accords > 0).length,
    withPyramid: catalog.filter((r) => r.pyramid).length,
    complete: catalog.filter(isComplete).length,
    queue: {
      notFound: catalog.filter((r) => inQueue(r, "not-found", false)).length,
      partial: catalog.filter((r) => inQueue(r, "partial", false)).length,
      descriptions: catalog.filter((r) => inQueue(r, "descriptions", false)).length,
      all: catalog.filter((r) => inQueue(r, "all", false)).length,
    },
    search: {
      attempts: rows.length,
      matchRate: pct(matched),
      cacheHitRate: pct(rows.filter((r) => r.from_cache).length),
      notFoundRate,
      temporaryFailureRate: tempRate,
      avgDurationMs: rows.length
        ? Math.round(rows.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) / rows.length)
        : 0,
    },
    alerts,
  };
}
