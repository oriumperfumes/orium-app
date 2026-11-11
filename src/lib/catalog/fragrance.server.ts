/**
 * FragranceDetailsEnrichment (server-only).
 *
 * Enriquece um perfume com acordes, pirâmide olfativa e uma descrição própria
 * da Orium, usando EXCLUSIVAMENTE o Fragrantica Brasil como fonte de referência.
 *
 * Regras de ouro:
 * - a identidade (marca + nome + concentração) precisa estar confirmada antes;
 * - nada é inventado: sem evidência confiável o produto vai para revisão;
 * - o cliente nunca dispara pesquisa externa — a página só lê o banco;
 * - informação confirmada manualmente (locked) nunca é sobrescrita.
 */
import { cleanText } from "@/lib/suppliers/normalize.server";
import { searchWeb } from "@/lib/catalog/research.server";

const READER = "https://r.jina.ai/";
const BLOCKED = /just a moment|security verification|requiring CAPTCHA|access denied|are you a robot/i;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** HTML → texto corrido legível, mantendo a janela da pirâmide olfativa. */
function htmlToText(html: string): string {
  const txt = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const anchor = txt.search(/main accords|fragrance pyramid|pir[âa]mide olfativa|top notes/i);
  const body = anchor > 800 ? txt.slice(anchor - 600) : txt;
  return body.slice(0, 12000);
}

/**
 * Fila global de leitura: respeita as fontes com um intervalo mínimo entre
 * requisições, evitando bloqueio por excesso de acessos.
 */
const MIN_GAP_MS = Number(process.env["FRAG_MIN_GAP_MS"] ?? 1600);
let lastAt = 0;
let chain: Promise<void> = Promise.resolve();

function politeSlot(): Promise<void> {
  const mine = chain.then(async () => {
    const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  });
  chain = mine;
  return mine;
}

/** Leitura direta (sem proxy), enfileirada e com uma retentativa em bloqueio. */
async function fetchDirect(url: string, timeoutMs = 20000, attempt = 1): Promise<string | null> {
  await politeSlot();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      if (attempt >= 2) return null;
      await new Promise((r) => setTimeout(r, 15000));
      return fetchDirect(url, timeoutMs, attempt + 1);
    }
    if (!res.ok) return null;
    const html = await res.text();
    if (!html || html.length < 1000 || BLOCKED.test(html.slice(0, 1500))) return null;
    return html;
  } catch {
    if (attempt >= 2) return null;
    await new Promise((r) => setTimeout(r, 4000));
    return fetchDirect(url, timeoutMs, attempt + 1);
  }
}


/** Leitura pelo proxy, com retentativa quando o limite por IP é atingido. */
async function readerText(url: string, attempt = 1): Promise<string | null> {
  try {
    const res = await fetch(`${READER}${url}`, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) return null;
      await new Promise((r) => setTimeout(r, 4000 * attempt));
      return readerText(url, attempt + 1);
    }
    if (!res.ok) return null;
    const md = await res.text();
    if (!md || BLOCKED.test(md.slice(0, 800))) return null;
    return md;
  } catch {
    return null;
  }
}

/** Candidatos diretos no Fragrantica Brasil via busca pública (sem proxy). */
async function ddgCandidates(brand: string, name: string) {
  const base = cleanText(`${brand} ${name}`);
  const queries = [`site:fragrantica.com.br ${base}`, `site:fragrantica.com.br perfume ${base}`];
  const out: Array<{ url: string; domain: string; title: string; snippet: string }> = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const html = await fetchDirect(`https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`, 20000);
    if (!html) continue;
    const found = Array.from(
      html.matchAll(
        /(?:www\.)?(fragrantica\.com\.br\/perfume\/[\w%\-.]+\/[\w%\-.]+\.html)/g,
      ),
    ).map((m) => `https://www.${m[1]!}`);
    for (const u of found) {
      if (seen.has(u)) continue;
      seen.add(u);
      const domain = "fragrantica.com.br";
      const slug = decodeURIComponent(u.split("/").slice(4).join(" ")).replace(/[-_]+/g, " ").replace(/\.html$/, "");
      out.push({ url: u, domain, title: slug, snippet: "" });
      if (out.length >= 8) break;
    }
  }
  return out;
}


/**
 * Leitor de página de referência: tenta leitura direta (rápida) e só usa o
 * proxy de leitura como reserva, descartando páginas de verificação anti-bot.
 */
async function readFragrancePage(url: string): Promise<string | null> {
  const direct = await fetchDirect(url);
  if (direct) {
    const text = htmlToText(direct);
    if (text.length > 600) return text;
  }
  const md = await readerText(url);
  if (!md || md.length < 600) return null;
  // corta o menu do topo quando existir uma âncora clara de conteúdo
  const anchor = md.search(/pir[âa]mide olfativa|fragrance notes|notas de topo|top notes|Duft(noten|pyramide)/i);
  const body = anchor > 1500 ? md.slice(anchor - 1200) : md;
  return body.slice(0, 12000);
}



type Db = {
  from: (t: string) => any;
};

export type EnrichResult = {
  productId: string;
  status: "completo" | "parcial" | "revisar" | "nao_encontrado" | "bloqueado";
  matchScore: number;
  confidence: number;
  accords: number;
  notes: number;
  sourcePrimary: string | null;
  conflict: boolean;
  reason: string;
};

const norm = (s: string) =>
  cleanText(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const keyOf = (s: string) => norm(s).replace(/\s+/g, "");

/* ------------------------------- notas ---------------------------------- */

type NoteRow = { id: string; canonical_name: string; aliases: string[] | null; category: string };

let noteCache: { at: number; rows: NoteRow[] } | null = null;

async function loadNotes(db: Db): Promise<NoteRow[]> {
  if (noteCache && Date.now() - noteCache.at < 60_000) return noteCache.rows;
  const { data } = await db.from("olfactory_notes").select("id, canonical_name, aliases, category");
  const rows = (data ?? []) as NoteRow[];
  noteCache = { at: Date.now(), rows };
  return rows;
}

/** "Musk" / "Almíscar" / "musc" → nota canônica Almíscar. */
export function matchNote(label: string, rows: NoteRow[]): NoteRow | null {
  const k = keyOf(label);
  if (!k) return null;
  for (const r of rows) {
    if (keyOf(r.canonical_name) === k) return r;
    if ((r.aliases ?? []).some((a) => keyOf(a) === k)) return r;
  }
  // contém a nota canônica ("baunilha bourbon" → Baunilha)
  const partial = rows
    .filter((r) => k.includes(keyOf(r.canonical_name)) || (r.aliases ?? []).some((a) => keyOf(a).length > 4 && k.includes(keyOf(a))))
    .sort((a, b) => keyOf(b.canonical_name).length - keyOf(a.canonical_name).length)[0];
  return partial ?? null;
}

/** Cria a nota na biblioteca quando ela ainda não existe (guardando o apelido). */
async function ensureNote(db: Db, label: string, rows: NoteRow[]): Promise<NoteRow | null> {
  const found = matchNote(label, rows);
  if (found) return found;
  const canonical = cleanText(label).replace(/^\w/, (c) => c.toUpperCase()).slice(0, 60);
  if (canonical.length < 2) return null;
  const { data } = await db
    .from("olfactory_notes")
    .insert({ canonical_name: canonical, aliases: [label.toLowerCase()], category: "outros" })
    .select("id, canonical_name, aliases, category")
    .maybeSingle();
  if (data) {
    rows.push(data as NoteRow);
    noteCache = null;
    return data as NoteRow;
  }
  return null;
}

/* ------------------------------ extração -------------------------------- */

type Extracted = {
  matched_brand?: string | null;
  matched_name?: string | null;
  matched_concentration?: string | null;
  accords?: Array<{ name?: string; intensity?: number }>;
  top?: string[];
  heart?: string[];
  base?: string[];
  description?: string;
  primary_source?: string | null;
  secondary_source?: string | null;
  confidence?: number;
  conflict?: boolean;
  reason?: string;
};

function buildQueries(brand: string, name: string, concentration: string | null) {
  const full = cleanText(`${brand} ${name}`);
  const conc = concentration ? ` ${concentration}` : "";
  return [
    `fragrantica.com.br ${full}${conc} notas`,
    `fragrantica brasil ${full} pirâmide olfativa`,
    `site:fragrantica.com.br ${full}`,
  ];
}

/** Fontes aceitas como evidência olfativa (nunca para preço/estoque). */
const EVIDENCE_DOMAIN = /fragrantica\.com\.br/i;

async function collectEvidence(brand: string, name: string, concentration: string | null) {
  const queries = buildQueries(brand, name, concentration);
  const results: Array<{ url: string; domain: string; title: string; snippet: string }> = [];

  // 1) candidatos diretos do Fragrantica Brasil
  results.push(...(await ddgCandidates(brand, name)));

  // 2) mecanismo de busca só quando não houver candidato plausível
  const tokens0 = norm(`${brand} ${name}`).split(/\s+/).filter((t) => t.length > 2);
  const plausible = results.some((r) => {
    const hay = norm(`${r.title} ${r.url}`);
    return tokens0.filter((t) => hay.includes(t)).length >= Math.max(1, Math.ceil(tokens0.length * 0.6));
  });
  if (!plausible) {
    for (const q of queries) {
      const found = await searchWeb(q);
      for (const r of found) {
        if (EVIDENCE_DOMAIN.test(r.domain) && !results.some((x) => x.url === r.url)) {
          results.push({ url: r.url, domain: r.domain, title: r.title, snippet: r.snippet });
        }
      }
      const strong = results.filter((r) => /fragrantica\.com\.br/i.test(r.domain)).length;
      if (strong >= 2 || results.length >= 6) break;
    }
  }



  const pages: Array<{ url: string; domain: string; title: string; text: string }> = [];

  // páginas de perfume valem mais que listagens de marca/notas
  const tokens = norm(`${brand} ${name}`).split(/\s+/).filter((t) => t.length > 2);
  const rank = (r: { url: string; title: string }) => {
    const hay = norm(`${r.title} ${r.url}`);
    let score = tokens.filter((t) => hay.includes(t)).length;
    if (/\/perfume\/|\/Perfumes\//i.test(r.url)) score += 3;
    if (/\/notes?\/|\/designers?\/|\/brand|search|list/i.test(r.url)) score -= 3;
    return score;
  };
  const ordered = [...results].sort((a, b) => rank(b) - rank(a));
  const perDomain = new Map<string, number>();
  for (const r of ordered) {
    if (pages.length >= 3) break;
    const used = perDomain.get(r.domain) ?? 0;
    if (used >= 2) continue;
    const text = await readFragrancePage(r.url);
    perDomain.set(r.domain, used + 1);
    if (text) pages.push({ ...r, text });
  }

  if (process.env["FRAG_DEBUG"]) {
    console.error("[frag] results", results.map((r) => r.url), "pages", pages.map((p) => `${p.url}:${p.text.length}`));
  }
  return { queries, results, pages };

}

async function extract(input: {
  brand: string;
  name: string;
  concentration: string | null;
  volumeMl: number | null;
  gender: string | null;
  pages: Array<{ url: string; domain: string; title: string; text: string }>;
}): Promise<Extracted | null> {
  if (!input.pages.length) return null;

  const evidence = input.pages
    .map((p, i) => `[${i + 1}] ${p.domain} | ${p.url}\n${p.title}\n${p.text.slice(0, 6000)}`)
    .join("\n\n---\n\n")
    .slice(0, 18000);

  const prompt = `Você é catalogador de perfumaria da Orium. Extraia as informações olfativas do perfume abaixo usando SOMENTE as páginas de referência (exclusivamente Fragrantica Brasil) listadas.

Perfume no catálogo:
- marca: ${input.brand}
- nome: ${input.name}
- concentração: ${input.concentration ?? "não informada"}
- volume: ${input.volumeMl ?? "não informado"}
- gênero: ${input.gender ?? "não informado"}

REGRAS CRÍTICAS
1. A página precisa ser EXATAMENTE deste perfume, incluindo o flanker e a concentração. "Club de Nuit Intense Man EDT" NÃO é "Club de Nuit Intense Man Parfum". Se as páginas forem de outra versão, responda confidence baixa e listas vazias.
2. Nunca invente acordes ou notas. Só o que aparece nas evidências.
3. Use apenas o Fragrantica Brasil. Se as evidências forem ambíguas, marque conflict true e reduza a confiança.
4. accords: até 6 acordes principais em PORTUGUÊS, na ORDEM REAL do Fragrantica (o primeiro é o dominante) e com intensidades proporcionais e distintas — nunca use a mesma distribuição para perfumes diferentes (ex.: Amadeirado, Especiado quente, Âmbar, Baunilha, Aromático, Doce), do mais forte ao mais fraco, com intensity de 0.2 a 1.0.
5. notas (top/heart/base): nomes das notas em PORTUGUÊS, sem duplicar, no máximo 6 por nível. Se a fonte só tiver uma lista única de notas, coloque tudo em "heart" e deixe top/base vazios.
6. description: texto ORIGINAL da Orium em português, comercial e fácil de entender, 2 a 4 parágrafos curtos separados por "\\n\\n". Fale de sensação geral, estilo, impressão olfativa, ocasiões e caráter. Não copie frases das fontes, não use linguagem técnica, não invente prêmios nem histórias.
7. primary_source deve ser sempre "Fragrantica" com a URL da página usada; secondary_source pode ser null.

Evidências:
${evidence}

Responda apenas JSON:
{"matched_brand":"...","matched_name":"...","matched_concentration":"EDP|EDT|Parfum|null","accords":[{"name":"Amadeirado","intensity":0.9}],"top":["Pimenta preta"],"heart":["Café"],"base":["Baunilha"],"description":"...","primary_source":"Fragrantica|null","primary_url":"...","secondary_source":"Fragrantica|null","secondary_url":"...","confidence":0.0,"conflict":false,"reason":"curto, em português"}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { aiJson, AiError } = await import("@/lib/ai/engine.server");
      try {
        return (await aiJson({ feature: "fragrance", profile: "copilot", prompt })) as Extracted;
      } catch (e) {
        if (e instanceof AiError && e.code === "rate_limited") {
          await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
          continue;
        }
        if (e instanceof AiError && e.code !== "unavailable") return null;
        throw e;
      }
    } catch (e) {
      if (process.env["FRAG_DEBUG"]) console.error("[frag] ai err", String(e).slice(0, 200));
      await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
    }
  }
  return null;
}

/** fragrance_external_match_score: a página encontrada é mesmo este perfume? */
export function matchScore(args: {
  brand: string;
  name: string;
  concentration: string | null;
  extracted: Extracted;
  pages: Array<{ title: string; text: string }>;
}) {
  const { brand, name, concentration, extracted } = args;
  let score = 0.3;
  const notes: string[] = [];

  if (extracted.matched_brand && keyOf(extracted.matched_brand) === keyOf(brand)) {
    score += 0.28;
    notes.push("marca confere");
  } else if (extracted.matched_brand && keyOf(extracted.matched_brand).includes(keyOf(brand))) {
    score += 0.14;
  }

  const nk = keyOf(name);
  const mk = keyOf(extracted.matched_name ?? "");
  if (mk && mk === nk) {
    score += 0.3;
    notes.push("nome idêntico");
  } else if (mk && (mk.includes(nk) || nk.includes(mk))) {
    score += 0.16;
    notes.push("nome compatível");
  }

  if (concentration) {
    if (extracted.matched_concentration && keyOf(extracted.matched_concentration) === keyOf(concentration)) {
      score += 0.12;
      notes.push("concentração confere");
    } else if (extracted.matched_concentration) {
      score -= 0.2;
      notes.push("concentração diferente");
    }
  }

  const domains = new Set(args.pages.map((p) => p.title));
  if (domains.size >= 2) score += 0.05;

  return { score: Math.max(0, Math.min(0.99, Number(score.toFixed(2)))), notes };
}

/* ----------------------------- enriquecimento ---------------------------- */

async function writeStatus(
  db: Db,
  productId: string,
  patch: Record<string, unknown>,
) {
  await db
    .from("fragrance_details")
    .upsert({ product_id: productId, ...patch, enriched_at: new Date().toISOString() }, { onConflict: "product_id" });
}

/** Enriquece um único perfume. */
export async function enrichFragrance(db: Db, productId: string, opts?: { force?: boolean }): Promise<EnrichResult> {
  const { data: product } = await db
    .from("products")
    .select("id, canonical_name, brand, concentration, volume_ml, gender_norm, product_type")
    .eq("id", productId)
    .maybeSingle();

  const base = {
    productId,
    matchScore: 0,
    confidence: 0,
    accords: 0,
    notes: 0,
    sourcePrimary: null as string | null,
    conflict: false,
  };

  if (!product) return { ...base, status: "nao_encontrado", reason: "produto inexistente" };

  const { data: existing } = await db
    .from("fragrance_details")
    .select("locked, verified")
    .eq("product_id", productId)
    .maybeSingle();
  if (existing?.locked && !opts?.force) {
    return { ...base, status: "bloqueado", reason: "informação confirmada manualmente" };
  }

  const brand = cleanText(product.brand ?? "");
  const name = cleanText(product.canonical_name ?? "");
  if (!brand || name.length < 3) {
    await writeStatus(db, productId, { status: "revisar", confidence: 0, external_match_score: 0 });
    return { ...base, status: "revisar", reason: "identidade incompleta (marca ou nome)" };
  }

  const { queries, pages } = await collectEvidence(brand, name, product.concentration ?? null);
  if (!pages.length) {
    await writeStatus(db, productId, {
      status: "nao_encontrado",
      confidence: 0,
      external_match_score: 0,
      evidence: queries,
    });
    return { ...base, status: "nao_encontrado", reason: "nenhuma página de referência encontrada" };
  }

  const extracted = await extract({
    brand,
    name,
    concentration: product.concentration ?? null,
    volumeMl: product.volume_ml ?? null,
    gender: product.gender_norm ?? null,
    pages,
  });
  if (process.env["FRAG_DEBUG"]) console.error("[frag] extracted", JSON.stringify(extracted).slice(0, 600));
  if (!extracted) {
    // falha temporária de leitura não pode rebaixar uma ficha que já está boa
    const { data: current } = await db
      .from("fragrance_details")
      .select("status")
      .eq("product_id", productId)
      .maybeSingle();
    if (current?.status !== "completo") await writeStatus(db, productId, { status: "revisar", evidence: queries });
    return { ...base, status: "revisar", reason: "não foi possível extrair as informações" };
  }

  const { score, notes: scoreNotes } = matchScore({
    brand,
    name,
    concentration: product.concentration ?? null,
    extracted,
    pages,
  });
  const modelConfidence = Math.max(0, Math.min(1, Number(extracted.confidence ?? 0)));
  const confidence = Number(Math.min(0.99, score * 0.6 + modelConfidence * 0.4).toFixed(2));

  const evidence = pages.map((p) => ({ domain: p.domain, url: p.url, title: p.title }));
  const primary = extracted.primary_source ?? (pages[0] ? "Fragrantica" : null);
  const secondary = extracted.secondary_source ?? null;
  const reason = [extracted.reason, ...scoreNotes].filter(Boolean).join(" · ").slice(0, 400);

  // confiança baixa: nunca inventar pirâmide
  if (confidence < 0.65) {
    await writeStatus(db, productId, {
      status: "revisar",
      confidence,
      external_match_score: score,
      source_conflict: !!extracted.conflict,
      evidence,
      source_primary: primary,
      source_primary_url: (extracted as { primary_url?: string }).primary_url ?? evidence[0]?.url ?? null,
    });
    return { ...base, status: "revisar", matchScore: score, confidence, sourcePrimary: primary, reason: reason || "confiança insuficiente" };
  }

  const accords = (extracted.accords ?? [])
    .map((a, i) => ({
      name: cleanText(a.name ?? "").replace(/^\p{Ll}/u, (c) => c.toUpperCase()),
      intensity: Math.max(0.2, Math.min(1, Number(a.intensity ?? 0.7))),
      position: i,
    }))
    .filter((a) => a.name.length > 1)
    .slice(0, 6);

  const noteRows = await loadNotes(db);
  const levels: Array<["TOP" | "HEART" | "BASE", string[]]> = [
    ["TOP", extracted.top ?? []],
    ["HEART", extracted.heart ?? []],
    ["BASE", extracted.base ?? []],
  ];

  const noteInserts: Array<{ product_id: string; note_id: string | null; note_label: string; pyramid_level: string; position: number; source: string | null }> = [];
  for (const [level, list] of levels) {
    let pos = 0;
    for (const raw of list.slice(0, 6)) {
      const label = cleanText(raw);
      if (label.length < 2) continue;
      const note = await ensureNote(db, label, noteRows);
      noteInserts.push({
        product_id: productId,
        note_id: note?.id ?? null,
        note_label: note?.canonical_name ?? label,
        pyramid_level: level,
        position: pos++,
        source: primary,
      });
    }
  }

  // pirâmide só é "completa" com acordes + saída + coração + fundo
  const levelCount = (lvl: string) => noteInserts.filter((n) => n.pyramid_level === lvl).length;
  const fullPyramid = levelCount("TOP") > 0 && levelCount("HEART") > 0 && levelCount("BASE") > 0;
  const status: EnrichResult["status"] =
    accords.length >= 3 && fullPyramid && confidence >= 0.75 ? "completo" : "revisar";


  await db.from("fragrance_accords").delete().eq("product_id", productId);
  await db.from("fragrance_notes").delete().eq("product_id", productId);
  if (accords.length) {
    await db
      .from("fragrance_accords")
      .insert(accords.map((a) => ({ product_id: productId, accord_name: a.name, intensity: a.intensity, position: a.position, source: primary })));
  }
  if (noteInserts.length) await db.from("fragrance_notes").insert(noteInserts);

  const description = cleanText(extracted.description ?? "").length > 60 ? (extracted.description as string).trim() : null;

  await writeStatus(db, productId, {
    description,
    status,
    confidence,
    external_match_score: score,
    source_primary: primary,
    source_secondary: secondary,
    source_primary_url: (extracted as { primary_url?: string }).primary_url ?? evidence[0]?.url ?? null,
    source_secondary_url: (extracted as { secondary_url?: string }).secondary_url ?? evidence[1]?.url ?? null,
    source_conflict: !!extracted.conflict,
    evidence,
  });

  return {
    productId,
    status,
    matchScore: score,
    confidence,
    accords: accords.length,
    notes: noteInserts.length,
    sourcePrimary: primary,
    conflict: !!extracted.conflict,
    reason,
  };
}

/** Backfill em blocos de todos os perfumes do catálogo. */
export async function backfillFragrances(
  db: Db,
  cursor = 0,
  limit = 5,
  opts?: { onlyMissing?: boolean },
) {
  const query = db
    .from("products")
    .select("id")
    .eq("product_type", "PERFUME")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .range(cursor, cursor + limit - 1);

  const { data: products } = await query;
  const list = (products ?? []) as Array<{ id: string }>;
  const results: EnrichResult[] = [];

  for (const p of list) {
    if (opts?.onlyMissing !== false) {
      const { data: d } = await db
        .from("fragrance_details")
        .select("status, locked")
        .eq("product_id", p.id)
        .maybeSingle();
      if (d && (d.locked || d.status === "completo")) continue;
    }
    try {
      results.push(await enrichFragrance(db, p.id));
    } catch (e) {
      results.push({
        productId: p.id,
        status: "revisar",
        matchScore: 0,
        confidence: 0,
        accords: 0,
        notes: 0,
        sourcePrimary: null,
        conflict: false,
        reason: e instanceof Error ? e.message : "erro",
      });
    }
  }

  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("product_type", "PERFUME")
    .eq("active", true);

  const next = cursor + list.length;
  return {
    processed: results.length,
    scanned: list.length,
    cursor: next,
    total: count ?? null,
    done: list.length < limit,
    results,
  };
}

/* ------------------------ pesquisa sem sobrescrever ---------------------- */

export type FragrancePreview = {
  found: boolean;
  reason: string;
  confidence: number;
  matchScore: number;
  description: string | null;
  accords: Array<{ name: string; intensity: number }>;
  top: string[];
  heart: string[];
  base: string[];
  sourcePrimary: string | null;
  sourcePrimaryUrl: string | null;
  sourceSecondary: string | null;
  sourceSecondaryUrl: string | null;
  conflict: boolean;
};

/**
 * Pesquisa de novo as informações olfativas de um perfume e DEVOLVE o resultado
 * sem gravar nada — quem decide aplicar é a equipe, na tela de comparação.
 */
export async function previewFragrance(db: Db, productId: string): Promise<FragrancePreview> {
  const empty: FragrancePreview = {
    found: false,
    reason: "",
    confidence: 0,
    matchScore: 0,
    description: null,
    accords: [],
    top: [],
    heart: [],
    base: [],
    sourcePrimary: null,
    sourcePrimaryUrl: null,
    sourceSecondary: null,
    sourceSecondaryUrl: null,
    conflict: false,
  };

  const { data: product } = await db
    .from("products")
    .select("id, canonical_name, brand, concentration, volume_ml, gender_norm")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return { ...empty, reason: "produto inexistente" };

  const brand = cleanText(product.brand ?? "");
  const name = cleanText(product.canonical_name ?? "");
  if (!brand || name.length < 3) return { ...empty, reason: "identidade incompleta (marca ou nome)" };

  const { pages } = await collectEvidence(brand, name, product.concentration ?? null);
  if (!pages.length) return { ...empty, reason: "nenhuma página de referência encontrada" };

  const extracted = await extract({
    brand,
    name,
    concentration: product.concentration ?? null,
    volumeMl: product.volume_ml ?? null,
    gender: product.gender_norm ?? null,
    pages,
  });
  if (!extracted) return { ...empty, reason: "não foi possível ler as informações das fontes" };

  const { score, notes: scoreNotes } = matchScore({
    brand,
    name,
    concentration: product.concentration ?? null,
    extracted,
    pages,
  });
  const modelConfidence = Math.max(0, Math.min(1, Number(extracted.confidence ?? 0)));
  const confidence = Number(Math.min(0.99, score * 0.6 + modelConfidence * 0.4).toFixed(2));
  const primary =
    extracted.primary_source ?? (pages[0] ? "Fragrantica" : null);
  const clean = (list: unknown) =>
    (Array.isArray(list) ? list : [])
      .map((x) => cleanText(String(x)))
      .filter((x) => x.length > 1)
      .slice(0, 8);

  return {
    found: true,
    reason: [extracted.reason, ...scoreNotes].filter(Boolean).join(" · ").slice(0, 400),
    confidence,
    matchScore: score,
    description: cleanText(extracted.description ?? "").length > 60 ? String(extracted.description).trim() : null,
    accords: (extracted.accords ?? [])
      .map((a) => ({ name: cleanText(a.name ?? ""), intensity: Math.max(0.2, Math.min(1, Number(a.intensity ?? 0.7))) }))
      .filter((a) => a.name.length > 1)
      .slice(0, 6),
    top: clean(extracted.top),
    heart: clean(extracted.heart),
    base: clean(extracted.base),
    sourcePrimary: primary,
    sourcePrimaryUrl: (extracted as { primary_url?: string }).primary_url ?? pages[0]?.url ?? null,
    sourceSecondary: extracted.secondary_source ?? null,
    sourceSecondaryUrl: (extracted as { secondary_url?: string }).secondary_url ?? pages[1]?.url ?? null,
    conflict: !!extracted.conflict,
  };
}
