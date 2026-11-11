/**
 * Camada de PESQUISA EXTERNA de identidade de perfumes (server-only).
 *
 * Nunca é usada pelo catálogo público: só roda em auditoria, sincronização de
 * produto desconhecido ou comando manual do painel. Preço, estoque e
 * disponibilidade continuam vindo exclusivamente dos fornecedores.
 *
 * Como funciona:
 * 1. gera várias consultas a partir do título bruto do fornecedor;
 * 2. lê resultados de busca (leitor de páginas + DuckDuckGo Lite) e páginas
 *    estruturadas de fontes de perfumaria (Fragrantica, Parfumo, site oficial);
 * 3. entrega as evidências brutas a um extrator (Lovable AI) que só pode
 *    responder com o que aparece nas evidências;
 * 4. pontua a confiança conforme número de fontes independentes, confiabilidade
 *    do domínio e coincidência com o título/volume/concentração do fornecedor.
 */
import { cleanText, canonicalBrandName } from "@/lib/suppliers/normalize.server";
import { extractConcentration, extractVolume } from "@/lib/format";
import type { Gender } from "@/lib/catalog/classify";

export type WebResult = { title: string; url: string; domain: string; snippet: string; query: string };

export type ResearchCandidate = {
  brand: string | null;
  name: string | null;
  concentration: string | null;
  volumeMl: number | null;
  gender: Gender | null;
  referenceUrl: string | null;
  sources: Array<{ domain: string; url: string; title: string }>;
  queries: string[];
  confidence: number;
  reason: string;
};

const key = (s: string) =>
  cleanText(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

/** Domínios de identidade de perfumaria (nunca usados para preço). */
const TRUSTED = [
  { match: /fragrantica\./i, weight: 1 },
  { match: /parfumo\./i, weight: 1 },
  { match: /thearabscent\./i, weight: 0.8 },
  { match: /fraganty\./i, weight: 0.7 },
  { match: /basenotes\./i, weight: 0.8 },
  { match: /perfumo|scentgrail|wikiparfum/i, weight: 0.6 },
];

const domainWeight = (domain: string) => {
  const hit = TRUSTED.find((t) => t.match.test(domain));
  if (hit) return hit.weight;
  // sites oficiais de marca costumam ter "parfum(s)"/"perfume(s)" no domínio
  if (/parfum|perfume|fragrance/i.test(domain)) return 0.5;
  return 0.25;
};

const NOISE = /\b(perfume|perfumes|arabe|arabes|importado|original|masculino|feminino|unissex|unisex|edp|edt|eau|de|parfum|toilette|spray|ml|kit|lacrado|novo|100|50|80)\b/gi;

/** Título bruto → miolo pesquisável. */
export function searchableCore(title: string) {
  return cleanText(title.replace(/\d+\s*ml/gi, " ").replace(NOISE, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Gera consultas inteligentes (não pesquisa só o título inteiro). */
export function buildQueries(title: string, currentBrand?: string | null): string[] {
  const core = searchableCore(title);
  const words = core.split(/\s+/).filter(Boolean);
  const short = words.slice(0, 4).join(" ");
  const tail = words.slice(1, 4).join(" ");
  const list = [
    `"${short}" perfume marca fragrantica`,
    `"${tail || short}" perfume fragrance brand`,
    `${short} perfume parfumo`,
    currentBrand ? `"${short}" ${currentBrand} perfume` : `${short} perfume oficial`,
  ];
  return Array.from(new Set(list.map((q) => q.replace(/\s+/g, " ").trim()).filter((q) => q.length > 8))).slice(0, 4);
}

const READER = "https://r.jina.ai/";

async function fetchText(url: string, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; OriumIdentityAudit/1.0)",
        accept: "text/plain,text/html,*/*",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const decodeDdg = (href: string) => {
  const m = href.match(/uddg=([^&]+)/);
  if (!m) return href;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return href;
  }
};

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Uma consulta de busca → resultados estruturados (título, domínio, resumo). */
export async function searchWeb(query: string): Promise<WebResult[]> {
  const target = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const md = await fetchText(`${READER}${target}`);
  if (!md) return [];
  const out: WebResult[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(/\[([^\]]{4,200})\]\((https?:\/\/[^\s)]+)\)/);
    if (!m) continue;
    const url = decodeDdg(m[2]!);
    const domain = domainOf(url);
    if (!domain || /duckduckgo\.com$/.test(domain)) continue;
    const snippet = cleanText((lines[i + 1] ?? "").replace(/\*\*/g, "")).slice(0, 400);
    out.push({ title: cleanText(m[1]!.replace(/\*\*/g, "")), url, domain, snippet, query });
    if (out.length >= 8) break;
  }
  return out;
}

/** Lê uma página de fonte confiável (dados estruturados quando existirem). */
export async function readSourcePage(url: string): Promise<string | null> {
  const md = await fetchText(`${READER}${url}`, 25000);
  return md ? md.slice(0, 4000) : null;
}

type ExtractInput = {
  title: string;
  currentBrand?: string | null;
  currentName?: string | null;
  siblingTitles?: string[];
  results: WebResult[];
  queries: string[];
};

/** Extrai marca/nome oficiais SOMENTE a partir das evidências coletadas. */
async function extractFromEvidence(input: ExtractInput) {
  if (!input.results.length) return null;

  const evidence = input.results
    .map((r, i) => `[${i + 1}] ${r.domain} | ${r.title} | ${r.snippet}`)
    .join("\n")
    .slice(0, 7000);

  const prompt = `Você é um catalogador de perfumaria. Descubra a MARCA (casa produtora) e o NOME OFICIAL da fragrância do produto abaixo, usando SOMENTE as evidências de busca listadas. Nunca invente marca. Se as evidências não deixarem claro, responda brand null com confidence baixa.

Regras:
- A marca não pode ficar dentro do nome. Ex.: "Bidaya Elliur" -> brand "Bidaya", name "Elliur".
- Preserve versões/flankers: "Asad Bourbon" é diferente de "Asad"; "Attar Gold" é diferente de "Attar Al Wesal".
- Ignore palavras de marketing, volume e concentração no nome.
- Use "Parfums"/"Perfumes" no fim da marca só se as fontes usarem sempre assim.
- sources: números das evidências ([1], [2]...) que sustentam a resposta. Exija pelo menos duas fontes para confidence acima de 0.85.

Título do fornecedor (dado bruto, pode estar errado): ${input.title}
Marca atualmente no banco: ${input.currentBrand ?? "nenhuma"}
Nome atualmente no banco: ${input.currentName ?? "nenhum"}
${input.siblingTitles?.length ? `Título do mesmo produto em outro fornecedor: ${input.siblingTitles.join(" | ")}` : ""}

Evidências:
${evidence}

Responda apenas JSON:
{"brand":"...|null","name":"...","concentration":"EDP|EDT|EDC|Extrait|null","volume_ml":100,"gender":"MALE|FEMALE|UNISEX|UNKNOWN","sources":[1,2],"confidence":0.0,"reason":"curto, em português"}`;

  try {
    const { aiJson } = await import("@/lib/ai/engine.server");
    return (await aiJson({ feature: "catalog_research", profile: "copilot", prompt })) as {
      brand?: string | null;
      name?: string | null;
      concentration?: string | null;
      volume_ml?: number | null;
      gender?: string | null;
      sources?: number[];
      confidence?: number;
      reason?: string;
    };
  } catch {
    return null;
  }
}

/**
 * identity_confidence_score: combina o que o extrator entendeu com evidências
 * objetivas (nº de domínios independentes, peso do domínio, coincidência com o
 * título do fornecedor, volume e concentração, produto equivalente).
 */
function scoreCandidate(args: {
  title: string;
  brand: string | null;
  name: string | null;
  used: WebResult[];
  modelConfidence: number;
  siblingBrand?: string | null;
  volumeMl: number | null;
  concentration: string | null;
}) {
  const { title, brand, name, used, modelConfidence } = args;
  if (!brand || !name) return { score: 0, notes: ["sem marca nas evidências"] };

  const notes: string[] = [];
  const titleKey = key(title);
  const domains = Array.from(new Set(used.map((r) => r.domain)));
  const trustedHits = domains.filter((d) => domainWeight(d) >= 0.7);

  let score = 0.35 + Math.min(modelConfidence, 1) * 0.25;

  // fontes independentes concordando
  if (domains.length >= 3) {
    score += 0.2;
    notes.push(`${domains.length} fontes`);
  } else if (domains.length === 2) {
    score += 0.14;
    notes.push("2 fontes");
  } else if (domains.length === 1) {
    score += 0.04;
    notes.push("1 fonte");
  }

  if (trustedHits.length) {
    score += Math.min(0.14, trustedHits.length * 0.07);
    notes.push(`fonte de referência: ${trustedHits.join(", ")}`);
  }

  // marca e nome aparecem no título do fornecedor
  if (titleKey.includes(key(brand))) {
    score += 0.1;
    notes.push("marca também no título do fornecedor");
  }
  if (key(name).length > 3 && titleKey.includes(key(name))) {
    score += 0.08;
    notes.push("nome coincide com o título");
  }

  // produto equivalente do outro fornecedor
  if (args.siblingBrand && key(args.siblingBrand) === key(brand)) {
    score += 0.08;
    notes.push("outro fornecedor concorda");
  }

  // volume/concentração conferem com o título
  if (args.volumeMl && extractVolume(title) === args.volumeMl) score += 0.02;
  if (args.concentration && extractConcentration(title) === args.concentration) score += 0.02;

  // nunca deixar passar automaticamente com uma única fonte fraca
  if (domains.length < 2) score = Math.min(score, 0.78);
  if (!trustedHits.length && domains.length < 3) score = Math.min(score, 0.88);

  return { score: Math.min(0.99, Number(score.toFixed(2))), notes };
}

/** Pesquisa a identidade de um produto em várias consultas e devolve o candidato pontuado. */
export async function researchIdentity(input: {
  title: string;
  currentBrand?: string | null;
  currentName?: string | null;
  siblingTitles?: string[];
  siblingBrand?: string | null;
  maxQueries?: number;
}): Promise<{ candidate: ResearchCandidate | null; results: WebResult[]; queries: string[] }> {
  const queries = buildQueries(input.title, input.currentBrand).slice(0, input.maxQueries ?? 3);
  const results: WebResult[] = [];
  for (const q of queries) {
    const found = await searchWeb(q);
    results.push(...found);
    // já temos duas fontes de referência: não precisa gastar mais consultas
    const trusted = new Set(results.filter((r) => domainWeight(r.domain) >= 0.7).map((r) => r.domain));
    if (trusted.size >= 2 && results.length >= 5) break;
  }

  const unique = results.filter((r, i) => results.findIndex((o) => o.url === r.url) === i).slice(0, 12);
  if (!unique.length) return { candidate: null, results: [], queries };

  const extracted = await extractFromEvidence({
    title: input.title,
    currentBrand: input.currentBrand ?? null,
    currentName: input.currentName ?? null,
    siblingTitles: input.siblingTitles ?? [],
    results: unique,
    queries,
  });

  if (!extracted?.brand || !extracted?.name) {
    return { candidate: null, results: unique, queries };
  }

  const brand = canonicalBrandName(cleanText(extracted.brand));
  const name = cleanText(extracted.name);
  const plausibleBrand = !!brand && brand.length >= 3 && brand.split(/\s+/).length <= 4;
  if (!plausibleBrand || !name) return { candidate: null, results: unique, queries };

  const used = (extracted.sources ?? [])
    .map((n) => unique[Number(n) - 1])
    .filter((r): r is WebResult => !!r);
  const evidence = used.length ? used : unique.slice(0, 3);

  const volumeMl = Number(extracted.volume_ml) > 0 ? Number(extracted.volume_ml) : extractVolume(input.title);
  const concentration = extracted.concentration && extracted.concentration !== "null" ? extracted.concentration : null;

  const { score, notes } = scoreCandidate({
    title: input.title,
    brand,
    name,
    used: evidence,
    modelConfidence: Number(extracted.confidence ?? 0),
    siblingBrand: input.siblingBrand ?? null,
    volumeMl,
    concentration,
  });

  const gender = (["MALE", "FEMALE", "UNISEX", "UNKNOWN"].includes(extracted.gender ?? "")
    ? extracted.gender
    : null) as Gender | null;

  return {
    results: unique,
    queries,
    candidate: {
      brand,
      name,
      concentration,
      volumeMl,
      gender,
      referenceUrl: evidence[0]?.url ?? null,
      sources: evidence.map((r) => ({ domain: r.domain, url: r.url, title: r.title })),
      queries,
      confidence: score,
      reason: [extracted.reason, ...notes].filter(Boolean).join(" · ").slice(0, 400),
    },
  };
}
