/**
 * FRAGRANTICA IMPORT ENGINE V2
 *
 * Leitura de uma página de perfume da Fragrantica Brasil em camadas, com
 * validação, normalização, score de completude e detecção de falhas.
 *
 * Regras de projeto:
 *  - nenhuma estratégia é obrigatória: tentamos todas até a pirâmide aparecer;
 *  - "acordes encontrados" nunca significa importação completa;
 *  - se a fonte só publicar uma lista única de notas, guardamos assim (FLAT),
 *    sem inventar topo/coração/fundo;
 *  - nada é gravado aqui: este módulo só extrai, valida e pontua.
 */

export const PARSER_VERSION = "fragrantica-v2.1";

export type Level = "TOP" | "HEART" | "BASE";
export type NoteStructure = "PYRAMID" | "FLAT" | "NONE";
export type ExtractionStatus = "COMPLETE" | "PARTIAL" | "REVIEW_REQUIRED" | "FAILED";

export type Accord = { name: string; intensity: number; color: string | null; position: number };

export type ExtractedNote = {
  label: string;
  sourceLabel: string;
  externalId: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
};

export type StrategyReport = {
  id: string;
  label: string;
  ok: boolean;
  notes: number;
  detail: string;
};

/** Dados técnicos de uma tentativa de leitura (mostrados ao Admin quando falha). */
export type ImportDiagnostics = {
  hostname?: string;
  httpStatus?: number | null;
  contentType?: string | null;
  bytes?: number;
  redirected?: boolean;
  finalUrl?: string | null;
  challenge?: boolean;
  attempts?: number;
  durationMs?: number;
  via?: string | null;
  fromCache?: boolean;
  at?: string;
};


export type Extraction = {
  ok: boolean;
  error: string | null;
  url: string;
  httpStatus: number | null;
  fromCache: boolean;
  durationMs: number;
  parserVersion: string;
  identity: {
    perfumeName: string | null;
    brand: string | null;
    gender: string | null;
    concentration: string | null;
    family: string | null;
  };
  accords: Accord[];
  structure: NoteStructure;
  levels: Record<Level, ExtractedNote[]>;
  flat: ExtractedNote[];
  noteImages: Array<{ label: string; externalId: string; imageUrl: string; sourceUrl: string }>;
  strategies: StrategyReport[];
  strategyUsed: string | null;
  conflict: { detected: boolean; detail: string | null };
  status: ExtractionStatus;
  completeness: number;
  issues: string[];
  /** A origem recusou a leitura automática (SOURCE_BLOCKED) — não é falha de parser. */
  blocked?: boolean;
  failure?: FetchFailure | null;
  /** Método usado: leitura automática ou conteúdo fornecido pelo Admin. */
  importMethod?: "AUTO_URL" | "MANUAL_ASSISTED";
  /** Texto descritivo vindo do conteúdo fornecido (quando existir). */
  sourceDescription?: string | null;
  parserRan?: boolean;
  diagnostics?: ImportDiagnostics | null;
};


/* ------------------------------ segurança ------------------------------- */

const HOSTS = new Set(["www.fragrantica.com.br", "fragrantica.com.br", "beta.fragrantica.com.br"]);

/** Aceita apenas páginas de perfume dos domínios autorizados (proteção SSRF). */
export function validateFragranticaUrl(raw: string): string | null {
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "https:") return null;
    if (!HOSTS.has(u.hostname.toLowerCase())) return null;
    if (!/^\/perfume\/.+\.html$/i.test(u.pathname)) return null;
    return `https://www.fragrantica.com.br${u.pathname}`;
  } catch {
    return null;
  }
}

/* ------------------------- busca: fila, cache, retry --------------------- */

const AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
];

const CACHE_TTL = 12 * 60 * 60_000;
const pageCache = new Map<string, { at: number; html: string }>();
let queue: Promise<unknown> = Promise.resolve();
let lastFetchAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uma requisição por vez, espaçada — respeita o limite do site. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** Causa real da falha de leitura — nunca um erro genérico. */
export type FetchFailure =
  | "BLOQUEIO"
  | "NAO_ENCONTRADA"
  | "TEMPO_EXCEDIDO"
  | "REDE"
  | "CONTEUDO_VAZIO"
  | "ERRO_SERVIDOR_FONTE";

export type FetchResult = {
  html: string | null;
  httpStatus: number | null;
  fromCache: boolean;
  failure?: FetchFailure;
  via?: "direto" | "leitor-de-texto";
  attempts?: number;
  /** true = a origem recusou a leitura automática (não é falha de parser). */
  blocked?: boolean;
  contentType?: string | null;
  bytes?: number;
  redirected?: boolean;
  finalUrl?: string | null;
  durationMs?: number;
  challenge?: boolean;
};

/* ------------------------- circuit breaker da origem --------------------- */

type Attempt = { at: number; status: number | null; blocked: boolean; url: string };

const source = {
  blockedUntil: 0,
  consecutiveBlocks: 0,
  lastStatus: null as number | null,
  lastAt: null as number | null,
  lastOkAt: null as number | null,
  recent: [] as Attempt[],
};

/** Depois de 2 recusas seguidas paramos de bater na porta por 20 minutos. */
const BREAKER_THRESHOLD = 2;
const BREAKER_MS = 20 * 60_000;

function recordAttempt(url: string, status: number | null, blocked: boolean, ok: boolean) {
  source.lastStatus = status;
  source.lastAt = Date.now();
  source.recent.push({ at: Date.now(), status, blocked, url });
  if (source.recent.length > 20) source.recent.shift();
  if (ok) {
    source.consecutiveBlocks = 0;
    source.blockedUntil = 0;
    source.lastOkAt = Date.now();
    return;
  }
  if (blocked) {
    source.consecutiveBlocks += 1;
    if (source.consecutiveBlocks >= BREAKER_THRESHOLD) source.blockedUntil = Date.now() + BREAKER_MS;
  }
}

/** Leitura automática indisponível (circuito aberto)? */
export function isSourceBlocked(): boolean {
  return Date.now() < source.blockedUntil;
}

export function sourceStatus() {
  const blocked = isSourceBlocked();
  return {
    autoAvailable: !blocked,
    blockedUntil: blocked ? new Date(source.blockedUntil).toISOString() : null,
    consecutiveBlocks: source.consecutiveBlocks,
    lastStatus: source.lastStatus,
    lastAttemptAt: source.lastAt ? new Date(source.lastAt).toISOString() : null,
    lastSuccessAt: source.lastOkAt ? new Date(source.lastOkAt).toISOString() : null,
    recent: source.recent.slice(-10).map((a) => ({
      at: new Date(a.at).toISOString(),
      status: a.status,
      blocked: a.blocked,
    })),
  };
}

/** Fecha o circuito manualmente (usado pelo teste de conexão do Admin). */
export function resetSourceBreaker() {
  source.blockedUntil = 0;
  source.consecutiveBlocks = 0;
}

/** Caminho alternativo público de leitura, usado quando a fonte recusa o servidor. */
async function readerFallback(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "User-Agent": AGENTS[0]! },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 4_000 ? text : null;
  } catch {
    return null;
  }
}

const CHALLENGE = /cf-browser-verification|cloudflare|captcha|just a moment|attention required|access denied/i;

export async function fetchPerfumePage(url: string, force = false): Promise<FetchResult> {
  const hit = pageCache.get(url);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL) {
    return { html: hit.html, httpStatus: 200, fromCache: true, via: "direto", bytes: hit.html.length };
  }
  if (isSourceBlocked()) {
    return {
      html: null,
      httpStatus: source.lastStatus,
      fromCache: false,
      failure: "BLOQUEIO",
      blocked: true,
      attempts: 0,
      durationMs: 0,
    };
  }
  return enqueue(async () => {
    const startedAt = Date.now();
    let httpStatus: number | null = null;
    let failure: FetchFailure = "REDE";
    let attempts = 0;
    let contentType: string | null = null;
    let bytes = 0;
    let redirected = false;
    let finalUrl: string | null = null;
    let challenge = false;

    // No máximo 2 tentativas: nunca insistimos em cima de uma recusa.
    for (let attempt = 0; attempt < 2; attempt++) {
      attempts = attempt + 1;
      const wait = Math.max(0, 3000 - (Date.now() - lastFetchAt));
      if (wait) await sleep(wait);
      lastFetchAt = Date.now();
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": AGENTS[attempt % AGENTS.length]!, "Accept-Language": "pt-BR,pt;q=0.9" },
          redirect: "follow",
          signal: AbortSignal.timeout(25_000),
        });
        httpStatus = res.status;
        contentType = res.headers.get("content-type");
        redirected = res.redirected;
        finalUrl = res.url || url;
        const text = await res.text();
        bytes = text.length;
        challenge = CHALLENGE.test(text.slice(0, 4000));
        if (res.status === 200 && text.length > 20_000 && !challenge) {
          pageCache.set(url, { at: Date.now(), html: text });
          recordAttempt(url, res.status, false, true);
          return {
            html: text,
            httpStatus,
            fromCache: false,
            via: "direto",
            attempts,
            contentType,
            bytes,
            redirected,
            finalUrl,
            durationMs: Date.now() - startedAt,
          };
        }
        if (res.status === 404 || res.status === 410) {
          recordAttempt(url, res.status, false, false);
          return {
            html: null,
            httpStatus,
            fromCache: false,
            failure: "NAO_ENCONTRADA",
            attempts,
            contentType,
            bytes,
            redirected,
            finalUrl,
            durationMs: Date.now() - startedAt,
          };
        }
        if (res.status === 403 || res.status === 429 || res.status === 503 || challenge) {
          failure = "BLOQUEIO";
          if (attempt >= 1) break;
        } else if (res.status >= 500) failure = "ERRO_SERVIDOR_FONTE";
        else if (res.status === 200) failure = "CONTEUDO_VAZIO";
      } catch (e) {
        failure = e instanceof Error && e.name === "TimeoutError" ? "TEMPO_EXCEDIDO" : "REDE";
      }
      if (attempt === 0) await sleep(2000 + Math.random() * 1000);
    }

    const blocked = failure === "BLOQUEIO";
    recordAttempt(url, httpStatus, blocked, false);

    // A fonte recusou o servidor: tentamos uma única leitura alternativa pública.
    if (blocked || failure === "ERRO_SERVIDOR_FONTE" || failure === "TEMPO_EXCEDIDO") {
      const alt = await readerFallback(url);
      if (alt) {
        pageCache.set(url, { at: Date.now(), html: alt });
        recordAttempt(url, httpStatus, false, true);
        return {
          html: alt,
          httpStatus,
          fromCache: false,
          via: "leitor-de-texto",
          attempts,
          contentType,
          bytes: alt.length,
          redirected,
          finalUrl,
          durationMs: Date.now() - startedAt,
        };
      }
    }
    return {
      html: null,
      httpStatus,
      fromCache: false,
      failure,
      blocked,
      attempts,
      contentType,
      bytes,
      redirected,
      finalUrl,
      challenge,
      durationMs: Date.now() - startedAt,
    };
  });
}


/* ------------------------------ utilidades ------------------------------- */

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();

const norm = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const keyOf = (s: string) => norm(s).replace(/\s+/g, "");

/* -------------------------- normalização de notas ------------------------ */

/**
 * OlfactoryNoteNormalizer — inglês/variações para o rótulo canônico em
 * português. A origem é sempre preservada em `sourceLabel`.
 */
const NOTE_CANON: Record<string, string> = {
  vanilla: "Baunilha",
  vanillaabsolute: "Baunilha",
  tonkabean: "Fava Tonka",
  tonka: "Fava Tonka",
  musk: "Almíscar",
  whitemusk: "Almíscar Branco",
  ginger: "Gengibre",
  bergamot: "Bergamota",
  jasmine: "Jasmim",
  rose: "Rosa",
  amber: "Âmbar",
  ambergris: "Âmbar Cinzento",
  patchouli: "Patchouli",
  sandalwood: "Sândalo",
  cedar: "Cedro",
  cedarwood: "Cedro",
  oud: "Oud",
  agarwoodoud: "Oud",
  saffron: "Açafrão",
  cardamom: "Cardamomo",
  cinnamon: "Canela",
  caramel: "Caramelo",
  chocolate: "Chocolate",
  coffee: "Café",
  praline: "Praliné",
  honey: "Mel",
  leather: "Couro",
  tobacco: "Tabaco",
  vetiver: "Vetiver",
  lavender: "Lavanda",
  pineapple: "Abacaxi",
  apple: "Maçã",
  pear: "Pera",
  peach: "Pêssego",
  raspberry: "Framboesa",
  strawberry: "Morango",
  blackcurrant: "Cassis",
  lemon: "Limão",
  orange: "Laranja",
  mandarinorange: "Tangerina",
  grapefruit: "Toranja",
  pinkpepper: "Pimenta Rosa",
  blackpepper: "Pimenta Preta",
  nutmeg: "Noz-moscada",
  benzoin: "Benjoim",
  labdanum: "Labdano",
  incense: "Incenso",
  myrrh: "Mirra",
  oakmoss: "Musgo de Carvalho",
  coconut: "Coco",
  almond: "Amêndoa",
  orangeblossom: "Flor de Laranjeira",
  orangeflower: "Flor de Laranjeira",
  tuberose: "Tuberosa",
  ylangylang: "Ylang-Ylang",
  iris: "Íris",
  violet: "Violeta",
  lilyofthevalley: "Lírio-do-vale",
  geranium: "Gerânio",
  mint: "Menta",
  seanotes: "Notas Marinhas",
  aquaticnotes: "Notas Aquáticas",
  woodynotes: "Notas Amadeiradas",
  sugar: "Açúcar",
  salt: "Sal",
};

/** Textos que nunca são notas olfativas (navegação, marca, avaliações). */
const NOT_A_NOTE = [
  /\b(comprar|loja|carrinho|login|entrar|cadastr|avalia|coment|voto|votos|usuari|perfil|newsletter|cookie|publicidade|anuncio)\b/i,
  /\b(fragrantica|perfume|perfumes|colecao|colecionar|tenho|quero|favorito)\b/i,
  /^(top|middle|base|notas?|notes?)$/i,
  /^\d+$/,
];

export function normalizeNoteLabel(raw: string): { label: string; sourceLabel: string } | null {
  const sourceLabel = decode(String(raw ?? "")).replace(/\s+/g, " ").trim();
  if (sourceLabel.length < 2 || sourceLabel.length > 46) return null;
  if (NOT_A_NOTE.some((re) => re.test(sourceLabel))) return null;
  if (!/[a-zA-ZÀ-ÿ]{2}/.test(sourceLabel)) return null;
  const canon = NOTE_CANON[keyOf(sourceLabel)];
  return { label: canon ?? sourceLabel, sourceLabel };
}

function dedupe(list: ExtractedNote[]): ExtractedNote[] {
  const seen = new Set<string>();
  const out: ExtractedNote[] = [];
  for (const n of list) {
    const k = keyOf(n.label);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/* ---------------------- notas dentro de um pedaço de HTML ---------------- */

const NOTE_LINK_RE =
  /href="https:\/\/(?:www|beta)\.fragrantica\.com\.br\/notas\/([^"]*?)-(\d+)\.html"([\s\S]{0,900}?)(?:<\/a>|<a |$)/g;

/** Lê notas a partir dos links canônicos do acervo de notas da Fragrantica. */
function notesFromChunk(chunk: string): ExtractedNote[] {
  const out: ExtractedNote[] = [];
  NOTE_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NOTE_LINK_RE.exec(chunk))) {
    const id = m[2]!;
    const inner = m[3]!;
    const raw =
      inner.match(/alt="([^"]+)"/i)?.[1] ??
      inner.match(/class="[^"]*pyramid-note-label[^"]*"[^>]*>([\s\S]*?)</i)?.[1] ??
      inner.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ??
      decodeURIComponent(m[1]!).replace(/-/g, " ");
    const n = normalizeNoteLabel(raw);
    if (!n) continue;
    out.push({
      label: n.label,
      sourceLabel: n.sourceLabel,
      externalId: id,
      imageUrl: `https://fimgs.net/mdimg/sastojci/o.${id}.jpg`,
      sourceUrl: `https://www.fragrantica.com.br/notas/${m[1]}-${id}.html`,
    });
  }
  return dedupe(out);
}

/** Notas escritas apenas como texto (sem link para o acervo). */
function notesFromText(text: string): ExtractedNote[] {
  return dedupe(
    decode(text)
      .split(/,|·|•|\||;| e /i)
      .map((part) => normalizeNoteLabel(part))
      .filter((n): n is { label: string; sourceLabel: string } => !!n)
      .map((n) => ({ label: n.label, sourceLabel: n.sourceLabel, externalId: null, imageUrl: null, sourceUrl: null })),
  );
}

/* --------------------------- identificação de nível --------------------- */

const LEVEL_PATTERNS: Array<[Level, RegExp]> = [
  ["TOP", /\b(notas?\s+de\s+(topo|saida|cabeca)|top\s+notes?)\b/i],
  ["HEART", /\b(notas?\s+de\s+(coracao|meio|corpo)|middle\s+notes?|heart\s+notes?)\b/i],
  ["BASE", /\b(notas?\s+de\s+(fundo|base)|base\s+notes?)\b/i],
];

/** FragranticaPyramidParser: reconhece as variações de rótulo de cada camada. */
export function detectLevel(text: string): Level | null {
  const t = norm(text);
  for (const [level, re] of LEVEL_PATTERNS) if (re.test(t)) return level;
  if (/^(top|topo|saida|cabeca)$/.test(t)) return "TOP";
  if (/^(middle|heart|coracao|meio|corpo)$/.test(t)) return "HEART";
  if (/^(base|fundo)$/.test(t)) return "BASE";
  return null;
}

/** Remove scripts, estilos e comentários: só sobra o conteúdo visível. */
export function stripCode(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}


/* ------------------------------ estratégias ------------------------------ */

type LevelMap = Record<Level, ExtractedNote[]>;
const emptyLevels = (): LevelMap => ({ TOP: [], HEART: [], BASE: [] });
const countLevels = (l: LevelMap) => l.TOP.length + l.HEART.length + l.BASE.length;

/** Strategy A — dados estruturados / JSON embutido na página. */
function strategyStructured(html: string): { levels: LevelMap; flat: ExtractedNote[] } {
  const levels = emptyLevels();
  const flat: ExtractedNote[] = [];
  const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const script of scripts) {
    if (!/notes|notas|accords|acordes/i.test(script)) continue;
    const body = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    for (const [level, keys] of [
      ["TOP", ["top", "topNotes", "notas_topo"]],
      ["HEART", ["middle", "heart", "middleNotes", "notas_coracao"]],
      ["BASE", ["base", "baseNotes", "notas_fundo"]],
    ] as Array<[Level, string[]]>) {
      for (const k of keys) {
        const re = new RegExp(`["']${k}["']\\s*:\\s*\\[([^\\]]{0,2000})\\]`, "i");
        const m = body.match(re);
        if (!m) continue;
        for (const item of m[1]!.split(",")) {
          const raw = item.replace(/^[\s{["']+|["'\s}\]]+$/g, "").replace(/^name\s*:\s*/i, "");
          const n = normalizeNoteLabel(raw);
          if (n) levels[level].push({ label: n.label, sourceLabel: n.sourceLabel, externalId: null, imageUrl: null, sourceUrl: null });
        }
      }
    }
    const single = body.match(/["'](?:notes|notas)["']\s*:\s*\[([^\]]{0,2000})\]/i);
    if (single && countLevels(levels) === 0) {
      for (const item of single[1]!.split(",")) {
        const n = normalizeNoteLabel(item.replace(/^[\s{["']+|["'\s}\]]+$/g, ""));
        if (n) flat.push({ label: n.label, sourceLabel: n.sourceLabel, externalId: null, imageUrl: null, sourceUrl: null });
      }
    }
  }
  return {
    levels: { TOP: dedupe(levels.TOP), HEART: dedupe(levels.HEART), BASE: dedupe(levels.BASE) },
    flat: dedupe(flat),
  };
}

/** Strategy B — componente de pirâmide da própria página (host-agnóstico). */
function strategyPyramidElement(html: string): LevelMap {
  const levels = emptyLevels();
  const re = /<pyramid-level-new[^>]*notes="([^"]+)"[^>]*>([\s\S]*?)<\/pyramid-level-new>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const level = detectLevel(m[1]!);
    if (!level) continue;
    levels[level].push(...notesFromChunk(m[2]!));
  }
  return { TOP: dedupe(levels.TOP), HEART: dedupe(levels.HEART), BASE: dedupe(levels.BASE) };
}

/**
 * Strategy C — DOM semântico: fatias delimitadas pelos títulos de cada camada.
 * Só considera notas com link para o acervo de notas (evita texto de navegação).
 */
function strategyHeadings(html: string): LevelMap {
  const levels = emptyLevels();
  const marks: Array<{ at: number; level: Level }> = [];
  const re =
    /(notas?\s+de\s+(?:topo|sa[íi]da|cabe[çc]a|cora[çc][ãa]o|meio|corpo|fundo|base)|top\s+notes?|middle\s+notes?|heart\s+notes?|base\s+notes?)\s*<\//gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const level = detectLevelFromHeading(m[1]!);
    if (level) marks.push({ at: m.index + m[0].length, level });
  }
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i]!.at;
    const end = marks[i + 1]?.at ?? Math.min(html.length, start + 14_000);
    levels[marks[i]!.level].push(...notesFromChunk(html.slice(start, end)));
  }
  return { TOP: dedupe(levels.TOP), HEART: dedupe(levels.HEART), BASE: dedupe(levels.BASE) };
}

function detectLevelFromHeading(text: string): Level | null {
  const t = norm(text);
  for (const [level, re] of LEVEL_PATTERNS) if (re.test(t)) return level;
  return null;
}

/** Strategy D — containers visuais: qualquer bloco cujo atributo indique a camada. */
function strategyContainers(html: string): LevelMap {
  const levels = emptyLevels();
  // marcadores de camada: cada bloco vai do marcador até o próximo (ou +8000 chars),
  // sem depender do fechamento da tag (o HTML da fonte tem tags aninhadas).
  const re = /<(?:div|section|ul)[^>]*(?:notes|note-level|data-level)="(top|middle|heart|base)"[^>]*>/gi;
  const marks: Array<{ level: string; at: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) marks.push({ level: m[1]!, at: m.index + m[0]!.length });
  for (let i = 0; i < marks.length; i++) {
    const chunk = html.slice(marks[i]!.at, Math.min(marks[i + 1]?.at ?? html.length, marks[i]!.at + 8000));
    const raw = marks[i]!.level.toLowerCase();
    const level: Level | null =
      raw === "top" ? "TOP" : raw === "middle" || raw === "heart" ? "HEART" : raw === "base" ? "BASE" : detectLevel(raw);
    if (!level) continue;
    levels[level].push(...notesFromChunk(chunk));
  }
  return { TOP: dedupe(levels.TOP), HEART: dedupe(levels.HEART), BASE: dedupe(levels.BASE) };
}

/**
 * Strategy E — pirâmide escrita em texto corrido pela própria Fragrantica
 * ("as notas de topo são: bergamota, tangerina..."). Usada quando a pirâmide
 * visual não é renderizada no HTML.
 */
function strategyProse(html: string): LevelMap {
  const levels = emptyLevels();
  const text = decode(stripCode(html));
  const re =
    /(notas?\s+de\s+(?:topo|sa[íi]da|cabe[çc]a|cora[çc][ãa]o|meio|corpo|fundo|base))\s+(?:s[ãa]o|:)\s*:?\s*([^.;]{3,320})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const level = detectLevelFromHeading(m[1]!);
    if (!level) continue;
    levels[level].push(...notesFromText(m[2]!));
  }
  return { TOP: dedupe(levels.TOP), HEART: dedupe(levels.HEART), BASE: dedupe(levels.BASE) };
}

/** Strategy F — lista única de notas da fragrância (estrutura editorial FLAT). */
function strategyFlatSection(html: string): ExtractedNote[] {
  const single = html.match(/<pyramid-level-new[^>]*notes="(?:ingredients|notes|all)"[^>]*>([\s\S]*?)<\/pyramid-level-new>/i);
  if (single) {
    const found = notesFromChunk(single[1]!);
    if (found.length) return found;
  }
  const idx = [/Notas\s+da\s+fragr[âa]ncia/i, /Notas\s+Olfativas/i]
    .map((re) => html.search(re))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  const chunk = idx === undefined ? html : html.slice(idx, idx + 20_000);
  return notesFromChunk(chunk);
}


/* -------------------------------- acordes -------------------------------- */

/** FragranticaAccordParser: nome, ordem, predominância real e cor da barra. */
const SMALL_WORDS = new Set(["de", "da", "do", "e", "com"]);

/** Acordes com a inicial maiúscula, como aparecem no painel da Orium. */
function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function parseAccords(html: string): Accord[] {
  const out: Accord[] = [];
  const start = html.search(/Principais\s+Acordes/i);
  const block = start >= 0 ? html.slice(start, start + 20_000) : html;
  const re = /style="([^"]*?)"[^>]*>\s*<span[^>]*class="[^"]*truncate[^"]*"[^>]*>([^<]+)<\/span>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const style = m[1]!.replace(/\s+/g, " ");
    const width = Number(style.match(/width:\s*([\d.]+)%/i)?.[1]);
    const opacity = Number(style.match(/opacity:\s*([\d.]+)%/i)?.[1]);
    const relative = Number.isFinite(width) ? width : Number.isFinite(opacity) ? opacity : NaN;
    if (!Number.isFinite(relative)) continue;
    const name = titleCase(decode(m[2]!));
    if (!name || out.some((a) => keyOf(a.name) === keyOf(name))) continue;
    out.push({
      name,
      intensity: Math.max(0.05, Math.min(1, relative / 100)),
      color: style.match(/background:\s*(#[0-9a-fA-F]{3,8})/)?.[1] ?? null,
      position: out.length,
    });
    if (out.length >= 14) break;
  }
  return out;
}

/* ------------------------------- identidade ------------------------------ */

function meta(html: string, prop: string): string | null {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, "i"));
  return m ? decode(m[1]!) : null;
}

export function parseIdentity(html: string) {
  const rawTitle = meta(html, "og:title") ?? decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const desc = meta(html, "og:description") ?? meta(html, "description") ?? "";
  const hay = `${rawTitle} ${desc}`;

  const gender = /compartilh[aá]vel|unissex/i.test(hay)
    ? "Unissex"
    : /\bmasculin[oa]\b|para homens|for men\b/i.test(hay)
      ? "Masculino"
      : /\bfeminin[oa]\b|para mulheres|for women\b/i.test(hay)
        ? "Feminino"
        : null;

  const fam =
    hay.match(/[ée] um[a]? (?:perfume|fragr[âa]ncia)\s+([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2}?)\s+(?:Masculin|Feminin|Uniss|Compartilh)/i)?.[1] ??
    html.match(/Grupo[^<]{0,20}<\/[^>]+>\s*<[^>]*>([^<]{3,40})</i)?.[1] ??
    null;

  const brand =
    decode(html.match(/itemprop="brand"[\s\S]{0,200}?content="([^"]+)"/i)?.[1] ?? "") ||
    decode(html.match(/<span itemprop="name">([^<]+)<\/span>/i)?.[1] ?? "") ||
    null;

  const concentration =
    hay.match(/\b(Eau de Parfum|Eau de Toilette|Eau de Cologne|Extrait de Parfum|Parfum|Eau Fra[îi]che)\b/i)?.[1] ?? null;

  let perfumeName = rawTitle.split(/\s+perfume\s+-\s+/i)[0] ?? rawTitle;
  perfumeName = perfumeName.replace(/\s+(for women and men|for women|for men)\b.*/i, "").trim();

  return {
    perfumeName: perfumeName || null,
    brand: brand || null,
    gender,
    family: fam ? decode(fam).trim() : null,
    concentration,
  };
}

/* -------------------------- validação e completude ----------------------- */

export function scoreCompleteness(input: {
  accords: number;
  notes: number;
  structure: NoteStructure;
  identity: boolean;
  family: boolean;
  images: number;
}): number {
  let score = 0;
  score += Math.min(25, input.accords * 4);
  score += Math.min(40, input.notes * 5);
  if (input.structure === "PYRAMID") score += 10;
  else if (input.structure === "FLAT") score += 5;
  if (input.identity) score += 15;
  if (input.family) score += 5;
  if (input.images) score += 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/* ----------------------------- motor principal --------------------------- */

/** Extrai tudo de uma página de perfume, tentando todas as estratégias. */

/* ---------------- leitura alternativa (texto em markdown) ----------------- */

const ACCORD_PT: Record<string, string> = {
  citrus: "Cítrico", "white floral": "Floral Branco", fruity: "Frutado", amber: "Âmbar",
  "warm spicy": "Especiarias Quentes", sweet: "Doce", salty: "Salgado", woody: "Amadeirado",
  floral: "Floral", vanilla: "Baunilha", powdery: "Empoado", musky: "Almiscarado",
  aromatic: "Aromático", fresh: "Fresco", "fresh spicy": "Especiarias Frescas", green: "Verde",
  balsamic: "Balsâmico", leather: "Couro", tobacco: "Tabaco", animalic: "Animálico",
  smoky: "Defumado", earthy: "Terroso", oud: "Oud", rose: "Rosa", iris: "Íris",
  lavender: "Lavanda", aquatic: "Aquático", ozonic: "Ozônico", "yellow floral": "Floral Amarelo",
  "tropical fruit": "Frutas Tropicais", almond: "Amêndoa", caramel: "Caramelo", coffee: "Café",
  chocolate: "Chocolate", honey: "Mel", coconut: "Coco", nutty: "Oleaginosas", cacao: "Cacau",
  mossy: "Musgo", herbal: "Herbal", mineral: "Mineral", metallic: "Metálico", soapy: "Sabão",
  patchouli: "Patchouli", "soft spicy": "Especiarias Suaves", conifer: "Conífera", camphor: "Cânfora",
  cinnamon: "Canela", violet: "Violeta", tuberose: "Tuberosa", lactonic: "Lactônico",
  anis: "Anis", "sour": "Ácido", "bitter": "Amargo", "savory": "Salgado", vodka: "Vodka",
  whiskey: "Whisky", rum: "Rum", wine: "Vinho", beeswax: "Cera de Abelha",
};

/** A fonte às vezes só responde por um leitor de texto: convertemos para HTML equivalente. */
export function looksLikeMarkdown(raw: string): boolean {
  return !/<html|<body|<div/i.test(raw.slice(0, 4000)) && /\]\(https?:\/\//.test(raw);
}

export function markdownToPseudoHtml(md: string): string {
  let out = md;
  // imagens dentro de links viram apenas o texto (o link externo guarda o id da nota)
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  // links markdown -> âncoras reais
  out = out.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_m, text: string, href: string) => {
    const clean = String(text).replace(/\s+/g, " ").trim();
    return `<a href="${href}">${clean}</a>`;
  });
  // títulos markdown -> títulos HTML
  out = out.replace(/^\s{0,3}(#{1,6})\s*(.+)$/gm, (_m, hashes: string, text: string) => {
    const level = Math.min(6, String(hashes).length);
    return `<h${level}>${String(text).trim()}</h${level}>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  return out.replace(/^(.+)$/gm, (line) => (/^<(h\d|a )/.test(line.trim()) ? line : `<p>${line}</p>`));
}

/** Acordes a partir do link "Buscar por acordes", que carrega a intensidade real. */
export function parseAccordsFromSearchLink(raw: string): Accord[] {
  const m = raw.match(/accords-search\/\?([^"'()\s]+)/i);
  if (!m) return [];
  const params = new URLSearchParams(m[1]!.replace(/&amp;/g, "&"));
  const out: Accord[] = [];
  for (const [key, value] of params.entries()) {
    if (key.startsWith("f_from")) continue;
    const relative = Number(value);
    if (!Number.isFinite(relative) || relative <= 0) continue;
    const english = key.replace(/\+/g, " ").toLowerCase();
    const name = ACCORD_PT[english] ?? titleCase(english);
    if (out.some((a) => keyOf(a.name) === keyOf(name))) continue;
    out.push({ name, intensity: Math.max(0.05, Math.min(1, relative / 100)), color: null, position: out.length });
    if (out.length >= 14) break;
  }
  return out;
}

export function extractFromHtml(input: string, url: string): Omit<Extraction, "httpStatus" | "fromCache" | "durationMs"> {
  const markdown = looksLikeMarkdown(input);
  const rawHtml = markdown ? markdownToPseudoHtml(input) : input;
  const html = stripCode(rawHtml);
  const identity = parseIdentity(rawHtml);
  const accords = parseAccords(html).length ? parseAccords(html) : parseAccordsFromSearchLink(input);
  const strategies: StrategyReport[] = [];

  const structured = strategyStructured(rawHtml);
  strategies.push({
    id: "A",
    label: "Dados estruturados",
    ok: countLevels(structured.levels) > 0 || structured.flat.length > 0,
    notes: countLevels(structured.levels) || structured.flat.length,
    detail: "JSON-LD e objetos JavaScript da página",
  });

  const pyramidEl = strategyPyramidElement(html);
  strategies.push({
    id: "B",
    label: "Componente de pirâmide",
    ok: countLevels(pyramidEl) > 0,
    notes: countLevels(pyramidEl),
    detail: "elemento de pirâmide olfativa",
  });

  const headings = strategyHeadings(html);
  strategies.push({
    id: "C",
    label: "Títulos das camadas",
    ok: countLevels(headings) > 0,
    notes: countLevels(headings),
    detail: "Notas de Topo / Coração / Fundo no conteúdo",
  });

  const containers = strategyContainers(html);
  strategies.push({
    id: "D",
    label: "Containers da página",
    ok: countLevels(containers) > 0,
    notes: countLevels(containers),
    detail: "blocos marcados como top/middle/base",
  });

  const prose = strategyProse(html);
  strategies.push({
    id: "E",
    label: "Pirâmide no texto da página",
    ok: countLevels(prose) > 0,
    notes: countLevels(prose),
    detail: "\"as notas de topo são...\" no próprio texto da Fragrantica",
  });

  const flatSection = strategyFlatSection(html);
  strategies.push({
    id: "F",
    label: "Lista única de notas",
    ok: flatSection.length > 0,
    notes: flatSection.length,
    detail: "estrutura editorial sem pirâmide",
  });

  // merge: a estratégia com mais notas em cada camada vence; ordem preservada
  const candidates: Array<{ id: string; levels: LevelMap }> = [
    { id: "B", levels: pyramidEl },
    { id: "C", levels: headings },
    { id: "D", levels: containers },
    { id: "A", levels: structured.levels },
    { id: "E", levels: prose },
  ];
  const levels = emptyLevels();
  const usedIds = new Set<string>();
  for (const level of ["TOP", "HEART", "BASE"] as Level[]) {
    let best: { id: string; notes: ExtractedNote[] } | null = null;
    for (const c of candidates) {
      const notes = c.levels[level];
      if (notes.length && (!best || notes.length > best.notes.length)) best = { id: c.id, notes };
    }
    if (best) {
      levels[level] = best.notes;
      usedIds.add(best.id);
    }
  }

  // conflito: só quando duas estratégias apresentam conjuntos incompatíveis
  // (um ser parte do outro é apenas leitura parcial, não divergência)
  let conflictDetail: string | null = null;
  for (const level of ["TOP", "HEART", "BASE"] as Level[]) {
    const sets = candidates.map((c) => new Set(c.levels[level].map((n) => keyOf(n.label)))).filter((s) => s.size);
    for (let i = 0; i < sets.length && !conflictDetail; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const a = sets[i]!;
        const b = sets[j]!;
        const subset = [...a].every((x) => b.has(x)) || [...b].every((x) => a.has(x));
        if (!subset) {
          conflictDetail = `Camadas divergentes entre estratégias (${level}).`;
          break;
        }
      }
    }
  }

  const pyramidNotes = countLevels(levels);
  const structure: NoteStructure = pyramidNotes > 0 ? "PYRAMID" : flatSection.length ? "FLAT" : "NONE";
  const flat = pyramidNotes > 0 ? [] : flatSection;
  const totalNotes = pyramidNotes || flat.length;


  const noteImages = [...levels.TOP, ...levels.HEART, ...levels.BASE, ...flat]
    .filter((n) => n.externalId && n.imageUrl && n.sourceUrl)
    .map((n) => ({ label: n.label, externalId: n.externalId!, imageUrl: n.imageUrl!, sourceUrl: n.sourceUrl! }));

  const completeness = scoreCompleteness({
    accords: accords.length,
    notes: totalNotes,
    structure,
    identity: !!identity.perfumeName,
    family: !!identity.family,
    images: noteImages.length,
  });

  // a fonte anuncia camadas? (só então a ausência de pirâmide é falha nossa)
  const expectsPyramid =
    /<pyramid-level-new[^>]*notes="(top|middle|base)"/i.test(html) ||
    /notas?\s+de\s+(topo|sa[íi]da|cabe[çc]a|cora[çc][ãa]o|meio|fundo)/i.test(html);

  const issues: string[] = [];
  if (!accords.length) issues.push("Principais acordes não encontrados.");
  if (!totalNotes) issues.push("Nenhuma nota olfativa encontrada.");
  if (expectsPyramid && pyramidNotes === 0) issues.push("A página anuncia pirâmide, mas nenhuma camada foi extraída.");
  if (pyramidNotes > 0 && (!levels.TOP.length || !levels.BASE.length)) issues.push("Pirâmide incompleta na fonte.");
  if (!expectsPyramid && structure === "FLAT") issues.push("A fonte publica apenas uma lista única de notas.");
  if (conflictDetail) issues.push(conflictDetail);
  if (!identity.perfumeName) issues.push("Nome do perfume não identificado.");

  const faithful =
    accords.length > 0 &&
    totalNotes > 0 &&
    (structure === "PYRAMID" ? levels.TOP.length > 0 && levels.BASE.length > 0 : !expectsPyramid);

  const status: ExtractionStatus = !accords.length && !totalNotes
    ? "FAILED"
    : conflictDetail
      ? "REVIEW_REQUIRED"
      : faithful
        ? "COMPLETE"
        : "PARTIAL";


  return {
    ok: status !== "FAILED",
    error: status === "FAILED" ? "Esta página não trouxe acordes nem notas olfativas." : null,
    url,
    parserVersion: PARSER_VERSION,
    identity,
    accords,
    structure,
    levels,
    flat,
    noteImages,
    strategies,
    strategyUsed: usedIds.size ? [...usedIds].sort().join("+") : flat.length ? "F" : null,
    conflict: { detected: !!conflictDetail, detail: conflictDetail },
    status,
    completeness,
    issues,
  };
}

/** Lê a página (com fila, cache e retentativas) e extrai tudo. */
export async function extractFragrantica(rawUrl: string, opts: { force?: boolean } = {}): Promise<Extraction> {
  const startedAt = Date.now();
  const url = validateFragranticaUrl(rawUrl);
  const fail = (
    error: string,
    httpStatus: number | null,
    u: string,
    extra: Partial<Extraction> = {},
  ): Extraction => ({
    ok: false,
    error,
    url: u,
    httpStatus,
    fromCache: false,
    durationMs: Date.now() - startedAt,
    parserVersion: PARSER_VERSION,
    identity: { perfumeName: null, brand: null, gender: null, concentration: null, family: null },
    accords: [],
    structure: "NONE",
    levels: emptyLevels(),
    flat: [],
    noteImages: [],
    strategies: [],
    strategyUsed: null,
    conflict: { detected: false, detail: null },
    status: "FAILED",
    completeness: 0,
    issues: [error],
    parserRan: false,
    importMethod: "AUTO_URL",
    ...extra,
  });

  if (!url) return fail("Link do Fragrantica inválido.", null, String(rawUrl ?? ""));

  const first = await fetchPerfumePage(url, opts.force ?? false);
  if (!first.html) {
    const motivo: Record<string, string> = {
      BLOQUEIO: "O Fragrantica recusou a leitura automática desta página. Use a importação assistida abaixo.",
      NAO_ENCONTRADA: "Esta página de perfume não existe mais no Fragrantica.",
      TEMPO_EXCEDIDO: "O Fragrantica demorou demais para responder.",
      REDE: "Não houve resposta do Fragrantica (falha de conexão).",
      CONTEUDO_VAZIO: "A página respondeu, mas veio sem conteúdo de perfume.",
      ERRO_SERVIDOR_FONTE: "O Fragrantica está com instabilidade no momento.",
    };
    const reason = motivo[first.failure ?? "REDE"] ?? "Não foi possível ler esta página agora.";
    return fail(
      `${reason}${first.httpStatus ? ` (resposta ${first.httpStatus})` : ""}`,
      first.httpStatus,
      url,
      {
        blocked: !!first.blocked,
        failure: first.failure ?? null,
        diagnostics: {
          hostname: new URL(url).hostname,
          httpStatus: first.httpStatus,
          contentType: first.contentType ?? null,
          bytes: first.bytes ?? 0,
          redirected: !!first.redirected,
          finalUrl: first.finalUrl ?? null,
          challenge: !!first.challenge,
          attempts: first.attempts ?? 0,
          durationMs: first.durationMs ?? 0,
          via: first.via ?? null,
          at: new Date().toISOString(),
        },
      },
    );
  }



  let result = extractFromHtml(first.html, url);
  let fromCache = first.fromCache;
  let httpStatus = first.httpStatus;

  // Strategy G — representação alternativa da mesma página quando faltou nota.
  if (result.structure === "NONE") {
    const alt = url.replace("https://www.", "https://beta.");
    const second = await fetchPerfumePage(alt, opts.force ?? false);
    if (second.html) {
      const retry = extractFromHtml(second.html, url);
      retry.strategies.push({
        id: "G",
        label: "Representação alternativa",

        ok: retry.structure !== "NONE",
        notes: countLevels(retry.levels) || retry.flat.length,
        detail: "mesma página em outra representação pública",
      });
      if (retry.completeness > result.completeness) {
        result = retry;
        fromCache = second.fromCache;
        httpStatus = second.httpStatus;
      }
    }
  }

  return {
    ...result,
    httpStatus,
    fromCache,
    durationMs: Date.now() - startedAt,
    blocked: false,
    failure: null,
    parserRan: true,
    importMethod: "AUTO_URL",
    diagnostics: {
      hostname: new URL(url).hostname,
      httpStatus,
      contentType: first.contentType ?? null,
      bytes: first.bytes ?? first.html.length,
      redirected: !!first.redirected,
      finalUrl: first.finalUrl ?? url,
      challenge: false,
      attempts: first.attempts ?? 0,
      via: first.via ?? "direto",
      fromCache,
      at: new Date().toISOString(),
    },
  };
}

/* ------------------------------ quality guard ---------------------------- */

export type QualitySnapshot = { accords: number; notes: number; hasPyramid: boolean };

export function qualityScore(s: QualitySnapshot): number {
  return Math.min(100, Math.min(25, s.accords * 4) + Math.min(60, s.notes * 6) + (s.hasPyramid ? 15 : 0));
}

/**
 * QUALITY GUARD — nunca troca um dado melhor por um pior sem autorização.
 */
export function qualityGuard(
  current: QualitySnapshot,
  incoming: QualitySnapshot,
  force = false,
): { allow: boolean; reason: string | null; currentScore: number; incomingScore: number } {
  const currentScore = qualityScore(current);
  const incomingScore = qualityScore(incoming);
  if (force) return { allow: true, reason: null, currentScore, incomingScore };
  if (incomingScore >= currentScore) return { allow: true, reason: null, currentScore, incomingScore };
  return {
    allow: false,
    reason: `A importação é menos completa (${incomingScore}%) do que o que já está salvo (${currentScore}%).`,
    currentScore,
    incomingScore,
  };
}
