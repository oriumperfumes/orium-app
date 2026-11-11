/**
 * Auditoria Fragrantica Brasil — leitura determinística (sem IA).
 *
 * Fluxo por perfume:
 *   identidade (marca + nome + flanker + concentração)
 *     -> página da marca no Fragrantica Brasil (cacheada)
 *     -> escolha do candidato com maior score de identidade
 *     -> leitura da página exata (acordes + pirâmide reais)
 *     -> comparação com o que está no banco
 *     -> gravação + log de auditoria
 *
 * Nada é inventado: sem candidato confiável o perfume vai para revisão manual.
 */

type Db = { from: (t: string) => any };

export type AuditStatus = "VERIFIED_FRAGRANTICA" | "MANUALLY_VERIFIED" | "REVIEW_REQUIRED" | "NOT_FOUND";

export type AuditSnapshot = {
  accords: Array<{ name: string; intensity: number }>;
  top: string[];
  heart: string[];
  base: string[];
};

export type AuditResult = {
  productId: string;
  productName: string;
  status: AuditStatus;
  confidence: number;
  url: string | null;
  matchedTitle: string | null;
  changed: boolean;
  changes: string[];
  before: AuditSnapshot;
  after: AuditSnapshot | null;
  reason: string;
  applied: boolean;
};

/* ------------------------------- utilidades ------------------------------ */

/** A Fragrantica bloqueia rajadas: alternamos o agente e espaçamos as tentativas. */
const AGENTS: Array<Record<string, string>> = [
  {},
  { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15" },
  { "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36" },
];

const BASE = "https://www.fragrantica.com.br";

const htmlCache = new Map<string, string>();
let lastFetchAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Busca com espaçamento entre requisições, retentativas e cache. */
async function fetchHtml(url: string, minLength = 20_000, attempts = 10): Promise<string | null> {
  const cached = htmlCache.get(url);
  if (cached !== undefined) return cached || null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const wait = Math.max(0, 4000 - (Date.now() - lastFetchAt));
    if (wait) await sleep(wait);
    lastFetchAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: AGENTS[attempt % AGENTS.length]!,
        redirect: "follow",
        signal: AbortSignal.timeout(25_000),
      });
      const text = await res.text();
      if (res.status === 404) {
        htmlCache.set(url, "");
        return null;
      }
      if (res.status === 200 && text.length >= minLength) {
        htmlCache.set(url, text);
        return text;
      }
    } catch {
      /* rede instável: tenta de novo */
    }
    await sleep(5000 + attempt * 3000 + Math.random() * 2000);
  }
  return null;
}

const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const norm = (s: string) =>
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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Palavras que descrevem concentração e não fazem parte do nome.
 * "Elixir", "Intense" e afins NÃO entram aqui: em várias marcas árabes
 * elas identificam o flanker (Yara Elixir ≠ Yara).
 */
const CONCENTRATION_WORDS: Array<[RegExp, string]> = [
  [/\beau de parfum\b|\bedp\b/, "edp"],
  [/\beau de toilette\b|\bedt\b/, "edt"],
  [/\beau de cologne\b|\bedc\b/, "edc"],
  [/\bextrait de parfum\b/, "extrait"],
  [/\bparfum\b/, "parfum"],
  [/\beau fraiche\b/, "fraiche"],
];

function concentrationKey(...parts: Array<string | null | undefined>): string | null {
  const hay = norm(parts.filter(Boolean).join(" "));
  for (const [re, key] of CONCENTRATION_WORDS) if (re.test(hay)) return key;
  return null;
}

const GENDER_WORDS = /\b(masculino|feminino|unissex|for men|for women|pour homme|pour femme|men|women|homme|femme)\b/g;
const NOISE_WORDS = /\b(perfumes?|parfums?|fragrancias?|fragrances?|paris|colonia|cologne|unisex|pride|de|do|da)\b/g;

/** Remove marca, gênero, concentração, volume e ano de um título. */
function coreTokens(text: string, brand: string): string[] {
  let t = ` ${norm(text)} `;
  for (const word of norm(brand).split(/\s+/).filter(Boolean)) {
    t = t.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  }
  t = t.replace(GENDER_WORDS, " ");
  for (const [re] of CONCENTRATION_WORDS) t = t.replace(re, " ");
  t = t.replace(/\b(19|20)\d{2}\b/g, " ");
  t = t.replace(/\b\d{1,4}\s?(ml|g)\b/g, " ");
  t = t.replace(NOISE_WORDS, " ");
  return t.split(/\s+/).filter((w) => w.length > 0);
}

/* --------------------------- índice por marca ---------------------------- */

export type Candidate = { url: string; title: string; gender: string | null; year: number | null };

const brandCache = new Map<string, Candidate[]>();

function brandSlugs(brand: string): string[] {
  const clean = stripAccents(brand).replace(/&/g, "and").replace(/[^A-Za-z0-9 ]+/g, " ").trim();
  const dashed = clean.replace(/\s+/g, "-");
  const out = new Set<string>([dashed]);
  const withoutSuffix = dashed.replace(/-(Perfumes|Perfume|Parfums|Paris|Fragrances|Cosmetics)$/i, "");
  out.add(withoutSuffix);
  out.add(`${withoutSuffix}-Perfumes`);
  out.add(`${withoutSuffix}-Parfums`);
  return [...out].filter(Boolean);
}

/** Lista todos os perfumes de uma marca no Fragrantica Brasil (uma requisição por marca). */
export async function loadBrandIndex(brand: string): Promise<Candidate[]> {
  const key = norm(brand);
  const cached = brandCache.get(key);
  if (cached !== undefined) return cached;

  let found: Candidate[] = [];
  const paths: string[] = [];
  for (const slug of brandSlugs(brand).slice(0, 3)) {
    paths.push(`${BASE}/desenhista/${slug}.html`, `${BASE}/designers/${slug}.html`);
  }
  for (const path of paths) {
    const html = await fetchHtml(path, 40_000, 3);
    if (!html) continue;
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
    if (items.size) {
      found = [...items.values()];
      break;
    }
  }
  brandCache.set(key, found);
  return found;
}

/* ------------------------- score de identidade --------------------------- */

export function identityScore(
  product: { brand: string | null; canonical_name: string; flanker: string | null; concentration: string | null; gender_norm: string | null },
  candidate: Candidate,
): number {
  const brand = product.brand ?? "";
  const wanted = coreTokens(`${product.canonical_name} ${product.flanker ?? ""}`, brand);
  const got = coreTokens(candidate.title, brand);
  if (!wanted.length || !got.length) return 0;

  const wantedSet = new Set(wanted);
  const gotSet = new Set(got);
  const hits = [...wantedSet].filter((w) => gotSet.has(w)).length;
  const missing = wantedSet.size - hits;
  const extra = [...gotSet].filter((w) => !wantedSet.has(w)).length;

  // base: cobertura das palavras do nosso nome
  let score = (hits / wantedSet.size) * 88;
  // sequência idêntica vale mais (evita "Asad" x "Asad Bourbon")
  if (wanted.join(" ") === got.join(" ")) score = 96;
  else if (hits === wantedSet.size && extra === 0) score = 94;
  // cada palavra sobrando na Fragrantica é forte indício de outro flanker
  const extraNumeric = [...gotSet].filter((w) => !wantedSet.has(w) && /^\d+$/.test(w)).length;
  score -= (extra - extraNumeric) * 18 + extraNumeric * 6;
  score -= missing * 22;

  const wantedConc = concentrationKey(product.concentration, product.canonical_name, product.flanker);
  const gotConc = concentrationKey(candidate.title);
  if (wantedConc && gotConc) score += wantedConc === gotConc ? 8 : -25;
  else if (!wantedConc && !gotConc) score += 4;

  const g = (product.gender_norm ?? "").toLowerCase();
  const cg = (candidate.gender ?? "").toLowerCase();
  if (g && cg) {
    const same =
      (g.startsWith("masc") && cg === "masculino") ||
      (g.startsWith("fem") && cg === "feminino") ||
      (g.startsWith("uni") && cg === "unissex");
    score += same ? 5 : -4;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/* --------------------------- leitura da página --------------------------- */

export type PageData = {
  accords: Array<{ name: string; intensity: number }>;
  levels: { TOP: string[]; HEART: string[]; BASE: string[] };
  noteImages: Array<{ label: string; externalId: string; imageUrl: string; sourceUrl: string }>;
};

const LEVEL_MAP: Record<string, "TOP" | "HEART" | "BASE"> = { top: "TOP", middle: "HEART", base: "BASE" };

export function parsePerfumePage(html: string): PageData {
  const flat = html.replace(/\s+/g, " ");

  /* acordes com a largura real da barra (predominância verdadeira) */
  const accords: Array<{ name: string; intensity: number }> = [];
  const start = flat.indexOf("Principais Acordes");
  if (start >= 0) {
    const block = flat.slice(start, start + 12_000);
    const re = /width:\s*([\d.]+)%;?"[^>]*>\s*<span class="truncate">([^<]+)<\/span>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) {
      const intensity = Math.max(0.05, Math.min(1, Number(m[1]) / 100));
      const name = decodeEntities(m[2]!).toLowerCase();
      if (name && !accords.some((a) => a.name === name)) accords.push({ name, intensity });
      if (accords.length >= 12) break;
    }
  }

  /* pirâmide: só os níveis que a Fragrantica realmente publica */
  const levels: PageData["levels"] = { TOP: [], HEART: [], BASE: [] };
  const noteImages: PageData["noteImages"] = [];
  const levelRe = /<pyramid-level-new notes="(top|middle|base)"[^>]*>([\s\S]*?)<\/pyramid-level-new>/g;
  let lm: RegExpExecArray | null;
  while ((lm = levelRe.exec(html))) {
    const level = LEVEL_MAP[lm[1]!]!;
    const chunk = lm[2]!;
    const noteRe = /href="(https:\/\/www\.fragrantica\.com\.br\/notas\/[^"]+-(\d+)\.html)"[\s\S]*?alt="([^"]*)"/g;
    let nm: RegExpExecArray | null;
    while ((nm = noteRe.exec(chunk))) {
      const label = decodeEntities(nm[3]!);
      if (!label) continue;
      if (!levels[level].includes(label)) levels[level].push(label);
      noteImages.push({
        label,
        externalId: nm[2]!,
        imageUrl: `https://fimgs.net/mdimg/sastojci/o.${nm[2]}.jpg`,
        sourceUrl: nm[1]!,
      });
    }
  }

  return { accords, levels, noteImages };
}

/* ---------------------------- banco de dados ----------------------------- */

type NoteRow = { id: string; canonical_name: string; aliases: string[] | null; category: string };

let notesCache: { at: number; rows: NoteRow[] } | null = null;

async function loadNotes(db: Db): Promise<NoteRow[]> {
  if (notesCache && Date.now() - notesCache.at < 120_000) return notesCache.rows;
  const { data } = await db.from("olfactory_notes").select("id, canonical_name, aliases, category");
  const rows = (data ?? []) as NoteRow[];
  notesCache = { at: Date.now(), rows };
  return rows;
}

async function resolveNote(db: Db, label: string, rows: NoteRow[]): Promise<NoteRow | null> {
  const k = norm(label).replace(/\s+/g, "");
  if (!k) return null;
  const hit = rows.find(
    (r) => norm(r.canonical_name).replace(/\s+/g, "") === k || (r.aliases ?? []).some((a) => norm(a).replace(/\s+/g, "") === k),
  );
  if (hit) return hit;
  const canonical = decodeEntities(label).slice(0, 60);
  const { data } = await db
    .from("olfactory_notes")
    .insert({ canonical_name: canonical, aliases: [canonical.toLowerCase()], category: "outros" })
    .select("id, canonical_name, aliases, category")
    .maybeSingle();
  if (data) {
    rows.push(data as NoteRow);
    return data as NoteRow;
  }
  return null;
}

export async function readSnapshot(db: Db, productId: string): Promise<AuditSnapshot> {
  const [{ data: acc }, { data: notes }] = await Promise.all([
    db.from("fragrance_accords").select("accord_name, intensity, position").eq("product_id", productId).order("position"),
    db.from("fragrance_notes").select("note_label, pyramid_level, position").eq("product_id", productId).order("position"),
  ]);
  const list = (notes ?? []) as Array<{ note_label: string; pyramid_level: string }>;
  return {
    accords: ((acc ?? []) as Array<{ accord_name: string; intensity: number }>).map((a) => ({
      name: a.accord_name,
      intensity: Number(a.intensity),
    })),
    top: list.filter((n) => n.pyramid_level === "TOP").map((n) => n.note_label),
    heart: list.filter((n) => n.pyramid_level === "HEART").map((n) => n.note_label),
    base: list.filter((n) => n.pyramid_level === "BASE").map((n) => n.note_label),
  };
}

function diff(before: AuditSnapshot, after: AuditSnapshot): string[] {
  const changes: string[] = [];
  const cmp = (a: string[], b: string[]) => a.map(norm).join("|") !== b.map(norm).join("|");
  if (cmp(before.accords.map((a) => a.name), after.accords.map((a) => a.name))) {
    changes.push(`Acordes: ${before.accords.map((a) => a.name).join(", ") || "vazio"} → ${after.accords.map((a) => a.name).join(", ")}`);
  } else if (
    before.accords.some((a, i) => Math.abs(a.intensity - (after.accords[i]?.intensity ?? 0)) > 0.05)
  ) {
    changes.push("Acordes: predominância ajustada");
  }
  const levels: Array<[keyof AuditSnapshot, string]> = [
    ["top", "Saída"],
    ["heart", "Coração"],
    ["base", "Fundo"],
  ];
  for (const [key, label] of levels) {
    const b = before[key] as string[];
    const a = after[key] as string[];
    if (cmp(b, a)) changes.push(`${label}: ${b.join(", ") || "vazio"} → ${a.join(", ") || "vazio"}`);
  }
  return changes;
}

/* -------------------------------- auditoria ------------------------------ */

export async function auditProductFragrantica(
  db: Db,
  productId: string,
  opts: { apply?: boolean; force?: boolean } = {},
): Promise<AuditResult> {
  const apply = opts.apply ?? true;

  const { data: product } = await db
    .from("products")
    .select("id, canonical_name, brand, flanker, concentration, gender_norm, product_type")
    .eq("id", productId)
    .maybeSingle();

  const before = await readSnapshot(db, productId);
  const productName = product ? `${product.brand ?? ""} ${product.canonical_name}`.trim() : productId;
  const shell: AuditResult = {
    productId,
    productName,
    status: "REVIEW_REQUIRED",
    confidence: 0,
    url: null,
    matchedTitle: null,
    changed: false,
    changes: [],
    before,
    after: null,
    reason: "",
    applied: false,
  };

  if (!product || product.product_type !== "PERFUME") {
    return { ...shell, status: "NOT_FOUND", reason: "produto não é perfume" };
  }
  if (!product.brand) {
    if (apply) await markStatus(db, productId, "REVIEW_REQUIRED", 0, null);
    return { ...shell, reason: "marca ausente no cadastro" };
  }

  const { data: details } = await db
    .from("fragrance_details")
    .select("locked, verified")
    .eq("product_id", productId)
    .maybeSingle();

  if (details?.locked && !opts.force) {
    return { ...shell, status: "MANUALLY_VERIFIED", reason: "confirmado manualmente (travado)" };
  }

  const candidates = await loadBrandIndex(product.brand);
  if (!candidates.length) {
    return { ...shell, status: "NOT_FOUND", reason: "marca não localizada no Fragrantica Brasil" };
  }

  const ranked = candidates
    .map((c) => ({ c, score: identityScore(product, c) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]!;
  const bestKey = coreTokens(best.c.title, product.brand).join(" ");
  // páginas duplicadas do mesmo perfume não contam como concorrentes
  const runnerUp =
    ranked.slice(1).find((r) => coreTokens(r.c.title, product.brand!).join(" ") !== bestKey)?.score ?? 0;

  const margin = best.score - runnerUp;
  const confident = best.score >= 94 ? margin >= 1 : margin >= 4;
  if (best.score < 85 || !confident) {
    if (apply) await markStatus(db, productId, "REVIEW_REQUIRED", best.score, best.c.url);
    await logAudit(db, { ...shell, status: "REVIEW_REQUIRED", confidence: best.score, url: best.c.url, matchedTitle: best.c.title, reason: "identidade ambígua" });
    return {
      ...shell,
      status: "REVIEW_REQUIRED",
      confidence: best.score,
      url: best.c.url,
      matchedTitle: best.c.title,
      reason: best.score < 85 ? "confiança abaixo de 85" : "dois candidatos muito parecidos",
    };
  }

  // leitura da página delegada ao FRAGRANTICA IMPORT ENGINE V2 (várias estratégias)
  const { extractFragrantica } = await import("./fragrantica-v2.server");
  const extraction = await extractFragrantica(best.c.url, {});
  if (!extraction.ok) {
    // falha temporária de leitura: não rebaixa o que já estava salvo
    return { ...shell, status: "REVIEW_REQUIRED", confidence: best.score, url: best.c.url, matchedTitle: best.c.title, reason: extraction.error ?? "página não pôde ser lida" };
  }

  const page: PageData = {
    accords: extraction.accords.map((a) => ({ name: a.name, intensity: a.intensity })),
    levels: {
      TOP: extraction.levels.TOP.map((n) => n.label),
      HEART: extraction.levels.HEART.map((n) => n.label),
      BASE: extraction.levels.BASE.map((n) => n.label),
    },
    noteImages: extraction.noteImages,
  };
  const after: AuditSnapshot = {
    accords: page.accords,
    top: page.levels.TOP,
    heart: page.levels.HEART,
    base: page.levels.BASE,
  };


  if (!after.accords.length && !after.top.length && !after.heart.length && !after.base.length) {
    if (apply) await markStatus(db, productId, "REVIEW_REQUIRED", best.score, best.c.url);
    return { ...shell, status: "REVIEW_REQUIRED", confidence: best.score, url: best.c.url, matchedTitle: best.c.title, reason: "página sem acordes/pirâmide" };
  }

  const changes = diff(before, after);
  const result: AuditResult = {
    ...shell,
    status: "VERIFIED_FRAGRANTICA",
    confidence: best.score,
    url: best.c.url,
    matchedTitle: best.c.title,
    changed: changes.length > 0,
    changes,
    after,
    reason: changes.length ? "dados corrigidos pela Fragrantica" : "dados já conferiam com a Fragrantica",
    applied: false,
  };

  if (!apply) return result;

  await writeSnapshot(db, productId, after, best.c.url, page.noteImages);
  await markStatus(db, productId, "VERIFIED_FRAGRANTICA", best.score, best.c.url, after);
  await logAudit(db, result);
  return { ...result, applied: true };
}

export async function writeSnapshot(
  db: Db,
  productId: string,
  after: AuditSnapshot,
  url: string,
  noteImages: PageData["noteImages"],
) {
  const rows = await loadNotes(db);

  const accordRows = after.accords.map((a, i) => ({
    product_id: productId,
    accord_name: a.name,
    intensity: Number(a.intensity.toFixed(3)),
    position: i,
    source: "Fragrantica Brasil",
  }));

  const noteRows: Array<Record<string, unknown>> = [];
  const levels: Array<["TOP" | "HEART" | "BASE", string[]]> = [
    ["TOP", after.top],
    ["HEART", after.heart],
    ["BASE", after.base],
  ];
  for (const [level, list] of levels) {
    let pos = 0;
    for (const label of list) {
      const note = await resolveNote(db, label, rows);
      noteRows.push({
        product_id: productId,
        note_id: note?.id ?? null,
        note_label: note?.canonical_name ?? label,
        pyramid_level: level,
        position: pos++,
        source: "Fragrantica Brasil",
      });
    }
  }

  await db.from("fragrance_accords").delete().eq("product_id", productId);
  await db.from("fragrance_notes").delete().eq("product_id", productId);
  if (accordRows.length) await db.from("fragrance_accords").insert(accordRows);
  if (noteRows.length) await db.from("fragrance_notes").insert(noteRows);

  // imagens das notas vindas da própria Fragrantica (biblioteca canônica)
  for (const img of noteImages) {
    const note = rows.find((r) => norm(r.canonical_name) === norm(img.label));
    if (note) {
      await db.from("olfactory_notes").update({ image_url: img.imageUrl }).eq("id", note.id).is("image_url", null);
    }
    await db.from("olfactory_note_assets").upsert(
      {
        canonical_note_name: img.label,
        display_name: img.label,
        image_url: img.imageUrl,
        source_url: img.sourceUrl,
        source: "fragrantica.com.br",
        external_id: img.externalId,
        status: "ok",
      },
      { onConflict: "canonical_note_name" },
    );
  }

  void url;
}

export async function markStatus(
  db: Db,
  productId: string,
  auditStatus: AuditStatus,
  confidence: number,
  url: string | null,
  after?: AuditSnapshot,
) {
  const complete =
    !!after && after.accords.length >= 3 && (after.top.length > 0 || after.heart.length > 0 || after.base.length > 0);
  await db.from("fragrance_details").upsert(
    {
      product_id: productId,
      audit_status: auditStatus,
      fragrantica_match_confidence: confidence,
      fragrantica_url: url,
      audited_at: new Date().toISOString(),
      ...(auditStatus === "VERIFIED_FRAGRANTICA"
        ? {
            status: complete ? "completo" : "revisar",
            source_primary: "Fragrantica Brasil",
            source_primary_url: url,
            confidence: Math.min(1, confidence / 100),
            external_match_score: Math.min(1, confidence / 100),
            source_conflict: false,
            enriched_at: new Date().toISOString(),
          }
        : { status: "revisar" }),
    },
    { onConflict: "product_id" },
  );
}

async function logAudit(db: Db, r: AuditResult) {
  await db.from("fragrance_audit_log").insert({
    product_id: r.productId,
    product_name: r.productName,
    fragrantica_url: r.url,
    match_confidence: r.confidence,
    status: r.status,
    changed: r.changed,
    before: r.before as unknown as Record<string, unknown>,
    after: (r.after ?? {}) as unknown as Record<string, unknown>,
    changes: r.changes,
  });
}

/* ---------------------------- execução em lote --------------------------- */

export async function runFragranticaAuditBatch(
  db: Db,
  opts: { limit?: number; force?: boolean; onlyPending?: boolean; retryFailed?: boolean } = {},
): Promise<{ processed: number; verified: number; review: number; notFound: number; corrected: number; remaining: number }> {
  const limit = Math.max(1, Math.min(40, opts.limit ?? 10));

  const onlyPending = opts.onlyPending ?? true;

  // Paginação real: percorre TODO o catálogo, sem depender de uma única página.
  const rows: Array<{
    id: string;
    fragrance_details: { audit_status: string | null; locked: boolean | null } | Array<{ audit_status: string | null; locked: boolean | null }> | null;
  }> = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data } = await db
      .from("products")
      .select("id, brand, fragrance_details(audit_status, locked)")
      .eq("product_type", "PERFUME")
      .eq("active", true)
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    const chunk = (data ?? []) as typeof rows;
    rows.push(...chunk);
    if (chunk.length < page) break;
  }

  const queue = rows.filter((r) => {
    const d = Array.isArray(r.fragrance_details) ? r.fragrance_details[0] : r.fragrance_details;
    if (d?.locked && !opts.force) return false;
    if (!onlyPending) return true;
    const s = d?.audit_status;
    if (!s || s === "PENDING") return true;
    return (opts.retryFailed ?? false) && (s === "FAILED" || s === "NOT_FOUND");
  });

  const batch = queue.slice(0, limit);
  const out = { processed: 0, verified: 0, review: 0, notFound: 0, corrected: 0, remaining: 0 };
  for (const row of batch) {
    try {
      const r = await auditProductFragrantica(db, row.id, { apply: true, force: opts.force ?? false });
      if (r.status === "VERIFIED_FRAGRANTICA") out.verified++;
      else if (r.status === "NOT_FOUND") out.notFound++;
      else out.review++;
      if (r.changed) out.corrected++;
    } catch {
      // Um perfume difícil não pode parar a fila: fica para a próxima passada.
      out.review++;
    }
    out.processed++;
  }
  out.remaining = Math.max(0, queue.length - batch.length);
  return out;
}

