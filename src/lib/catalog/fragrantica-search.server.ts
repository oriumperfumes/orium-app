/**
 * FRAGRANTICA SEARCH ENGINE V3 — localizar a página correta do perfume.
 *
 * Diferenças em relação ao V2:
 *  - índice local persistido no banco (fragrantica_index) — a maioria dos
 *    perfumes é resolvida sem nenhuma requisição externa;
 *  - páginas de marca cacheadas no banco (fragrantica_brand_pages) com cooldown;
 *  - busca em etapas: URL conhecida -> índice local -> página da marca ->
 *    aliases de marca -> fuzzy (trigrama) -> consulta alternativa;
 *  - concorrência controlada (várias leituras ao mesmo tempo, com espaçamento);
 *  - separa falha técnica (TEMPORARY_FAILURE) de "realmente não existe".
 */

import { identityScore, type Candidate } from "./fragrantica-audit.server";

type Db = { from: (t: string) => any };

export const SEARCH_VERSION = "fragrantica-search-v3.0";

export type SearchStatus =
  | "VERIFIED"
  | "CANDIDATE_FOUND"
  | "REVIEW_REQUIRED"
  | "NOT_FOUND"
  | "TEMPORARY_FAILURE";

export type SearchOutcome = {
  status: SearchStatus;
  url: string | null;
  title: string | null;
  score: number;
  stage: string;
  reason: string;
  query: string;
  requests: number;
  fromCache: boolean;
  durationMs: number;
};

export type SearchProduct = {
  id: string;
  canonical_name: string;
  brand: string | null;
  flanker: string | null;
  concentration: string | null;
  gender_norm: string | null;
  raw_name?: string | null;
  search_aliases?: string[] | null;
};

const BASE = "https://www.fragrantica.com.br";
const BRAND_COOLDOWN_MS = 7 * 24 * 60 * 60_000;

/* ----------------------------- normalização ------------------------------ */

export const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const norm = (s: string) =>
  stripAccents(String(s ?? ""))
    .toLowerCase()
    .replace(/&amp;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const SUPPLIER_NOISE =
  /\b(perfume|perfumes|parfum|parfums|fragrancia|fragrancias|masculino|feminino|unissex|importado|original|lacrado|kit|promocao|frasco|spray|vaporizador|edp|edt|edc|eau|de|parfum|toilette|cologne|extrait)\b/g;

/** "Perfume Masculino Lattafa ASAD EDP 100ml" -> "lattafa asad" */
export function cleanSupplierName(raw: string): string {
  return norm(raw)
    .replace(/\b\d{1,4}\s?(ml|g)\b/g, " ")
    .replace(SUPPLIER_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------ similaridade (trigrama) ------------------------ */

function trigrams(s: string): Set<string> {
  const t = ` ${s.replace(/\s+/g, " ")} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = trigrams(a);
  const B = trigrams(b);
  let hits = 0;
  for (const g of A) if (B.has(g)) hits++;
  return hits / (A.size + B.size - hits);
}

/* --------------------- leitura externa com concorrência ------------------ */

const AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const MAX_CONCURRENCY = 2;

/* ------------- limite de tempo e bloqueio do lote inteiro (modo "estrito") -------------
 * Cada leitura limita a si mesma (20 s), mas tentativas, esperas e leitor alternativo somados
 * passavam de 5 min numa única página. No modo estrito (agendamento na Edge Function) o lote
 * inteiro tem um prazo: leituras e esperas são cortadas pelo tempo restante, 403/429 encerram o
 * lote na hora e falhas seguidas também. Nada disso marca perfume como inexistente.
 */
export type BatchStop = { reason: "deadline" | "blocked" | "consecutive-failures"; httpStatus: number | null; detail: string };

/** Menos que isso restando: não começa outra leitura. */
export const MIN_FETCH_MS = 6_000;
const MAX_CONSECUTIVE_FAILURES = 3;

let batchDeadline: number | null = null;
let batchStop: BatchStop | null = null;
let consecutiveFailures = 0;

const strictBatch = () => batchDeadline !== null;
export const remainingMs = () => (batchDeadline === null ? Number.POSITIVE_INFINITY : batchDeadline - Date.now());
export const currentBatchStop = () => batchStop;

export function stopBatch(stop: BatchStop) {
  if (!batchStop) batchStop = stop;
}

/** Começa um lote com prazo (ms absolutos). Zera o ritmo adaptativo, que sobrevive entre chamadas na mesma instância. */
export function beginBatch(deadlineAt: number) {
  batchDeadline = deadlineAt;
  batchStop = null;
  consecutiveFailures = 0;
  limit = MAX_CONCURRENCY;
  gapMs = 2500;
  cooldownUntil = 0;
  streak = 0;
}

export function endBatch(): BatchStop | null {
  const stop = batchStop;
  batchDeadline = null;
  batchStop = null;
  return stop;
}

/** Verifica prazo e bloqueio antes de qualquer leitura externa. */
function batchGate(): BatchStop | null {
  if (batchStop) return batchStop;
  if (remainingMs() < MIN_FETCH_MS) {
    stopBatch({ reason: "deadline", httpStatus: null, detail: "tempo do lote esgotado antes de nova leitura" });
  }
  return batchStop;
}

function noteFetchFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    stopBatch({ reason: "consecutive-failures", httpStatus: null, detail: `${consecutiveFailures} leituras seguidas sem resposta útil` });
  }
}

const boundedSleep = (ms: number) => (strictBatch() ? Math.min(ms, Math.max(0, remainingMs() - MIN_FETCH_MS)) : ms);

/**
 * Ritmo adaptativo: começa rápido e desacelera sozinho quando a fonte reclama
 * (429/403/timeout), voltando a acelerar depois de uma sequência de sucessos.
 * É isso que evita transformar limite de acesso em "perfume não encontrado".
 */
let limit = MAX_CONCURRENCY;
let gapMs = 2500;
let cooldownUntil = 0;
let streak = 0;

function slowDown() {
  streak = 0;
  limit = 1;
  gapMs = Math.min(12_000, Math.round(gapMs * 1.5));
  if (!strictBatch()) cooldownUntil = Date.now() + 60_000;
}

function speedUp() {
  streak++;
  if (streak % 3 === 0) {
    gapMs = Math.max(2000, Math.round(gapMs * 0.85));
    limit = Math.min(MAX_CONCURRENCY, limit + 1);
  }
}

let active = 0;
const waiting: Array<() => void> = [];
let lastStart = 0;

async function acquire() {
  while (active >= limit) await new Promise<void>((r) => waiting.push(r));
  active++;
  const wait = Math.max(gapMs - (Date.now() - lastStart), cooldownUntil - Date.now());
  if (wait > 0) await sleep(boundedSleep(wait));
  lastStart = Date.now();
}

function release() {
  active--;
  waiting.shift()?.();
}

const htmlCache = new Map<string, { at: number; html: string | null }>();
const CACHE_TTL = 12 * 60 * 60_000;

export type PageFetch = {
  html: string | null;
  httpStatus: number | null;
  fromCache: boolean;
  failed: boolean;
  via?: "direto" | "leitor-de-texto";
};

/** Caminhos alternativos usados quando a fonte recusa o servidor. */
const READERS = [
  (u: string) => ({ url: `https://r.jina.ai/${u}`, headers: { Accept: "text/plain", "x-respond-with": "markdown" } }),
  (u: string) => ({ url: `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, headers: {} as Record<string, string> }),
];

async function readerFallback(url: string, minLength: number): Promise<{ text: string | null; status: number | null }> {
  let last: number | null = null;
  for (let attempt = 0; attempt < READERS.length * 2; attempt++) {
    const reader = READERS[attempt % READERS.length]!(url);
    try {
      const res = await fetch(reader.url, { headers: reader.headers, signal: AbortSignal.timeout(45_000) });
      last = res.status;
      if (res.status === 404) return { text: null, status: 404 };
      if (res.ok) {
        const text = await res.text();
        if (text.length >= Math.min(minLength, 8_000)) return { text, status: res.status };
      }
    } catch {
      /* leitor indisponível */
    }
    await sleep(2500 + attempt * 2500);
  }
  return { text: null, status: last };
}

/** Leitura com pool adaptativo, retentativas, caminho alternativo e cache de 12h. */
export async function fetchPage(url: string, opts: { minLength?: number; force?: boolean } = {}): Promise<PageFetch> {
  const minLength = opts.minLength ?? 20_000;
  const hit = htmlCache.get(url);
  if (!opts.force && hit && Date.now() - hit.at < CACHE_TTL) {
    return { html: hit.html, httpStatus: hit.html ? 200 : 404, fromCache: true, failed: false };
  }

  if (strictBatch()) {
    const stop = batchGate();
    if (stop) return { html: null, httpStatus: stop.httpStatus, fromCache: false, failed: true };
  }

  await acquire();
  try {
    if (strictBatch()) {
      const stop = batchGate();
      if (stop) return { html: null, httpStatus: stop.httpStatus, fromCache: false, failed: true };
    }
    let httpStatus: number | null = null;
    let blocked = false;
    let blockedStatus: number | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (strictBatch() && attempt > 0 && (batchStop || remainingMs() < MIN_FETCH_MS)) break;
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": AGENTS[attempt % AGENTS.length]!,
            "Accept-Language": "pt-BR,pt;q=0.9",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(strictBatch() ? Math.max(1_000, Math.min(20_000, remainingMs() - 1_500)) : 20_000),
        });
        httpStatus = res.status;
        if (res.status === 404) {
          consecutiveFailures = 0;
          htmlCache.set(url, { at: Date.now(), html: null });
          speedUp();
          return { html: null, httpStatus, fromCache: false, failed: false, via: "direto" };
        }
        const text = await res.text();
        if (res.status === 200) {
          consecutiveFailures = 0;
          speedUp();
          if (text.length >= minLength) {
            htmlCache.set(url, { at: Date.now(), html: text });
            return { html: text, httpStatus, fromCache: false, failed: false, via: "direto" };
          }
          // respondeu, mas não é a página esperada: não é bloqueio
          htmlCache.set(url, { at: Date.now(), html: null });
          return { html: null, httpStatus, fromCache: false, failed: false, via: "direto" };
        }
        if (res.status === 403 || res.status === 429) {
          if (strictBatch()) {
            // Lote com prazo: a fonte recusou — encerra o lote, sem esperar nem insistir; os dados existentes ficam como estão.
            const retryAfter = res.headers.get("retry-after");
            stopBatch({ reason: "blocked", httpStatus: res.status, detail: `Fragrantica respondeu ${res.status}${retryAfter ? ` (retry-after ${retryAfter})` : ""} em ${url}` });
            return { html: null, httpStatus: res.status, fromCache: false, failed: true, via: "direto" };
          }
          // limite de acesso da fonte: espera e tenta de novo antes do caminho alternativo
          slowDown();
          blocked = true;
          if (attempt < 2) {
            await sleep(20_000 + attempt * 20_000);
            continue;
          }
          break;
        }
        if (res.status >= 500) slowDown();
      } catch (e) {
        slowDown();
        // Lote com prazo: quem não respondeu em 20 s não responde 2 s depois — falha temporária, sem nova tentativa.
        const name = (e as { name?: string } | null)?.name;
        if (strictBatch() && (name === "TimeoutError" || name === "AbortError")) break;
      }
      await sleep(boundedSleep(1000 + attempt * 1500 + Math.random() * 700));
    }

    if (blocked) {
      const alt = await readerFallback(url, minLength);
      if (alt.text) {
        htmlCache.set(url, { at: Date.now(), html: alt.text });
        return { html: alt.text, httpStatus: 200, fromCache: false, failed: false, via: "leitor-de-texto" };
      }
      if (alt.status && alt.status !== 404) blockedStatus = alt.status;
      if (alt.status === 404) {
        htmlCache.set(url, { at: Date.now(), html: null });
        return { html: null, httpStatus: 404, fromCache: false, failed: false, via: "leitor-de-texto" };
      }
    }
    // não conseguimos ler: falha técnica (timeout incluído), nunca "não encontrado"

    if (strictBatch()) noteFetchFailure();
    slowDown();
    return { html: null, httpStatus: blockedStatus ?? httpStatus, fromCache: false, failed: true };
  } finally {
    release();
  }
}


/* --------------------------- aliases de marca ---------------------------- */

let brandAliasCache: { at: number; map: Map<string, string[]> } | null = null;

/** marca normalizada -> variações conhecidas (brands + brand_aliases). */
async function brandVariants(db: Db, brand: string): Promise<string[]> {
  if (!brandAliasCache || Date.now() - brandAliasCache.at > 300_000) {
    const [{ data: brands }, { data: aliases }] = await Promise.all([
      db.from("brands").select("id, canonical_name"),
      db.from("brand_aliases").select("brand_id, alias"),
    ]);
    const byId = new Map<string, string>();
    for (const b of (brands ?? []) as Array<{ id: string; canonical_name: string }>) byId.set(b.id, b.canonical_name);
    const map = new Map<string, string[]>();
    const push = (key: string, value: string) => {
      const list = map.get(key) ?? [];
      if (!list.includes(value)) list.push(value);
      map.set(key, list);
    };
    for (const b of (brands ?? []) as Array<{ canonical_name: string }>) push(norm(b.canonical_name), b.canonical_name);
    for (const a of (aliases ?? []) as Array<{ brand_id: string; alias: string }>) {
      const canonical = byId.get(a.brand_id);
      if (!canonical) continue;
      push(norm(canonical), a.alias);
      push(norm(a.alias), canonical);
    }
    brandAliasCache = { at: Date.now(), map };
  }
  const key = norm(brand);
  const out = [brand, ...(brandAliasCache.map.get(key) ?? [])];
  const short = brand.replace(/\s+(Perfumes?|Parfums?|Paris|Fragrances?|Cosmetics)$/i, "").trim();
  if (short && short !== brand) out.push(short);
  return [...new Set(out.filter(Boolean))];
}

function brandSlugs(brand: string): string[] {
  const clean = stripAccents(brand).replace(/&/g, "and").replace(/[^A-Za-z0-9 ]+/g, " ").trim();
  const dashed = clean.replace(/\s+/g, "-");
  const short = dashed.replace(/-(Perfumes|Perfume|Parfums|Paris|Fragrances|Cosmetics)$/i, "");
  return [...new Set([dashed, short, `${short}-Perfumes`, `${short}-Parfums`])].filter(Boolean);
}

/* ------------------------- índice local (banco) -------------------------- */

export type IndexRow = {
  url: string;
  brand: string | null;
  name: string;
  normalized_name: string;
  gender: string | null;
  year: number | null;
};

const toCandidate = (r: IndexRow): Candidate => ({
  url: r.url,
  title: r.name,
  gender: r.gender,
  year: r.year,
});

async function readIndex(db: Db, brandNorm: string): Promise<IndexRow[]> {
  const { data } = await db
    .from("fragrantica_index")
    .select("url, brand, name, normalized_name, gender, year")
    .eq("brand_norm", brandNorm)
    .limit(1000);
  return (data ?? []) as IndexRow[];
}

async function saveIndex(db: Db, brand: string, list: Candidate[]) {
  if (!list.length) return;
  const rows = list.map((c) => ({
    url: c.url,
    brand,
    brand_norm: norm(brand),
    name: c.title,
    normalized_name: cleanSupplierName(c.title),
    gender: c.gender,
    year: c.year,
    last_seen_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 200) {
    await db.from("fragrantica_index").upsert(rows.slice(i, i + 200), { onConflict: "url" });
  }
}

function parseBrandPage(html: string): Candidate[] {
  const items = new Map<string, Candidate>();
  const re = /href="(\/perfume\/[^"]+\.html)"[^>]*?title="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = `${BASE}${m[1]}`;
    const title = decodeEntities(m[2]!);
    const gender = title.match(/\b(Masculino|Feminino|Unissex)\b/i)?.[1] ?? null;
    const year = Number(title.match(/\b(19|20)\d{2}\b/)?.[0]) || null;
    if (!items.has(url)) items.set(url, { url, title, gender, year });
  }
  return [...items.values()];
}

/**
 * Candidatos de uma marca: índice local primeiro; página da marca só quando o
 * índice está vazio ou vencido (cooldown de 7 dias).
 */
export async function brandCandidates(
  db: Db,
  brand: string,
  opts: { force?: boolean } = {},
): Promise<{ candidates: Candidate[]; requests: number; fromCache: boolean; failed: boolean }> {
  const brandNorm = norm(brand);
  const { data: page } = await db
    .from("fragrantica_brand_pages")
    .select("url, perfumes, status, fetched_at")
    .eq("brand_norm", brandNorm)
    .maybeSingle();

  const fresh = page?.fetched_at && Date.now() - new Date(page.fetched_at).getTime() < BRAND_COOLDOWN_MS;
  if (!opts.force && fresh) {
    const rows = await readIndex(db, brandNorm);
    if (rows.length || page?.status === "not-found") {
      return { candidates: rows.map(toCandidate), requests: 0, fromCache: true, failed: false };
    }
  }

  let requests = 0;
  let failed = false;
  const variants = (await brandVariants(db, brand)).slice(0, 4);
  outer: for (const variant of variants) {
    for (const slug of brandSlugs(variant).slice(0, 3)) {
      for (const path of [`${BASE}/desenhista/${slug}.html`, `${BASE}/designers/${slug}.html`]) {
        const res = await fetchPage(path, { minLength: 15_000, force: opts.force ?? false });
        if (!res.fromCache) requests++;
        if (res.failed) {
          failed = true;
          if (strictBatch() && (batchStop || remainingMs() < MIN_FETCH_MS)) break outer;
        }
        if (!res.html) continue;
        const candidates = parseBrandPage(res.html);
        if (candidates.length) {
          await saveIndex(db, brand, candidates);
          await db.from("fragrantica_brand_pages").upsert(
            {
              brand_norm: brandNorm,
              brand,
              url: path,
              perfumes: candidates.length,
              status: "ok",
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "brand_norm" },
          );
          return { candidates, requests, fromCache: false, failed: false };
        }
      }
    }
  }

  // nada encontrado: registra para não repetir a cada rodada
  await db.from("fragrantica_brand_pages").upsert(
    {
      brand_norm: brandNorm,
      brand,
      url: null,
      perfumes: 0,
      status: failed ? "temporary-failure" : "not-found",
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "brand_norm" },
  );
  const rows = await readIndex(db, brandNorm);
  return { candidates: rows.map(toCandidate), requests, fromCache: false, failed };
}

/* -------------------------- busca em várias etapas ----------------------- */

/** Consultas prováveis para o produto (canônica, fornecedor, aliases). */
export function queryVariants(p: SearchProduct): string[] {
  const brand = p.brand ?? "";
  const out: string[] = [];
  const push = (s: string) => {
    const v = cleanSupplierName(s);
    if (v && !out.includes(v)) out.push(v);
  };
  push(`${brand} ${p.canonical_name} ${p.flanker ?? ""}`);
  push(`${brand} ${p.canonical_name}`);
  push(p.canonical_name);
  if (p.raw_name) push(p.raw_name);
  for (const alias of p.search_aliases ?? []) push(`${brand} ${alias}`);
  return out;
}

function rank(p: SearchProduct, candidates: Candidate[]) {
  const queries = queryVariants(p);
  return candidates
    .map((c) => {
      const identity = identityScore(p as never, c);
      const target = cleanSupplierName(c.title);
      const fuzzy = Math.max(...queries.map((q) => similarity(q, target)), 0);
      // identidade manda; a similaridade textual só resgata grafias diferentes
      const score = Math.max(identity, Math.round(fuzzy * 88));
      return { c, score, identity, fuzzy };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Encontra a página do perfume. Só devolve NOT_FOUND depois de esgotar
 * índice local, página da marca, aliases e comparação aproximada.
 */
export async function findFragranticaPage(
  db: Db,
  p: SearchProduct,
  opts: { knownUrl?: string | null; force?: boolean } = {},
): Promise<SearchOutcome> {
  const started = Date.now();
  const queries = queryVariants(p);
  const base: Omit<SearchOutcome, "status" | "reason" | "stage"> = {
    url: null,
    title: null,
    score: 0,
    query: queries[0] ?? "",
    requests: 0,
    fromCache: true,
    durationMs: 0,
  };
  const done = (o: Partial<SearchOutcome> & { status: SearchStatus; stage: string; reason: string }): SearchOutcome => ({
    ...base,
    ...o,
    durationMs: Date.now() - started,
  });

  // Stage 1 — URL já conhecida
  if (opts.knownUrl && !opts.force && /^https:\/\/www\.fragrantica\.com\.br\/perfume\/.+\.html$/i.test(opts.knownUrl)) {
    return done({ status: "VERIFIED", stage: "1-url-conhecida", reason: "endereço já validado", url: opts.knownUrl, score: 100 });
  }

  if (!p.brand) {
    return done({ status: "REVIEW_REQUIRED", stage: "0-sem-marca", reason: "marca ausente no cadastro" });
  }

  // Stage 2 — índice local (sem requisição externa)
  const brandNorm = norm(p.brand);
  let candidates = (await readIndex(db, brandNorm)).map(toCandidate);
  let requests = 0;
  let failed = false;
  let stage = "2-indice-local";

  let ranked = candidates.length ? rank(p, candidates) : [];

  // Stage 3/4 — página da marca + aliases quando o índice não resolve
  if (!ranked.length || (ranked[0]?.score ?? 0) < 88 || opts.force) {
    const r = await brandCandidates(db, p.brand, { force: opts.force ?? false });
    requests += r.requests;
    failed = r.failed;
    if (r.candidates.length) {
      const merged = new Map<string, Candidate>();
      for (const c of [...candidates, ...r.candidates]) merged.set(c.url, c);
      candidates = [...merged.values()];
      ranked = rank(p, candidates);
      stage = r.fromCache ? "3-marca-cache" : "4-marca-online";
    }
  }

  if (!candidates.length) {
    return done({
      status: failed ? "TEMPORARY_FAILURE" : "NOT_FOUND",
      stage: "4-marca-online",
      reason: failed ? "fonte indisponível ao listar a marca" : "marca não localizada na fonte",
      requests,
      fromCache: false,
    });
  }

  const best = ranked[0]!;
  const bestKey = cleanSupplierName(best.c.title);
  const runnerUp = ranked.slice(1).find((r) => cleanSupplierName(r.c.title) !== bestKey)?.score ?? 0;
  const margin = best.score - runnerUp;

  // Stage 5/6 — validação do candidato
  if (best.score >= 92 && margin >= 2) {
    return done({
      status: "VERIFIED",
      stage,
      reason: "candidato validado (marca, nome, versão e concentração)",
      url: best.c.url,
      title: best.c.title,
      score: best.score,
      requests,
      fromCache: requests === 0,
    });
  }
  if (best.score >= 80) {
    return done({
      status: margin < 2 ? "REVIEW_REQUIRED" : "CANDIDATE_FOUND",
      stage,
      reason: margin < 2 ? "dois candidatos muito parecidos" : "candidato forte, confirmação recomendada",
      url: best.c.url,
      title: best.c.title,
      score: best.score,
      requests,
      fromCache: requests === 0,
    });
  }
  if (best.score >= 55) {
    return done({
      status: "REVIEW_REQUIRED",
      stage: "5-aproximado",
      reason: "melhor candidato com semelhança baixa",
      url: best.c.url,
      title: best.c.title,
      score: best.score,
      requests,
      fromCache: requests === 0,
    });
  }

  return done({
    status: failed ? "TEMPORARY_FAILURE" : "NOT_FOUND",
    stage: "6-esgotado",
    reason: failed ? "leitura da fonte falhou durante a busca" : "nenhum candidato confiável na marca",
    score: best.score,
    requests,
    fromCache: requests === 0,
  });
}

/** Registro de cada busca, para métricas reais no Admin. */
export async function logSearch(db: Db, productId: string, o: SearchOutcome) {
  await db.from("fragrantica_search_log").insert({
    product_id: productId,
    status: o.status,
    score: o.score,
    url: o.url,
    query: o.query,
    stage: o.stage,
    from_cache: o.fromCache,
    requests: o.requests,
    duration_ms: o.durationMs,
    reason: o.reason,
  });
}
