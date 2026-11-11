/**
 * ORIUM PRODUCT IDENTITY ENGINE V3 — núcleo puro (sem banco).
 *
 * RAW → normalização → atributos → candidatos → comparação → regras duras → decisão.
 * Canônico = marca + nome base + flanker + edição.
 * Apresentação = volume + concentração + estado (variante dentro do canônico).
 */

export const ENGINE_VERSION = "v3.0";

export type Concentration = "EXTRAIT" | "PARFUM" | "EDP" | "EDT" | "EDC" | "BODY" | null;
export type PresentationState = "LACRADO" | "TESTER" | "SEM_CAIXA" | "KIT" | "DECANT" | null;

export type Attributes = {
  raw: string;
  normalized: string;
  brand: string | null;
  brandKey: string | null;
  base: string[]; // tokens do nome base
  baseKey: string;
  flankers: string[]; // versão forte
  genderTokens: string[]; // man/woman quando fazem parte do nome (sinal fraco)
  edition: string[];
  concentration: Concentration;
  volumeMl: number | null;
  state: PresentationState;
  category: "PERFUME" | "BODY" | "OTHER";
  ean: string | null;
};

export type BrandDict = {
  /** chave normalizada (nome ou apelido) → nome oficial */
  byKey: Map<string, string>;
};

// ---------------------------------------------------------------- normalização

export const stripAccents = (s: string) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const key = (s: string | null | undefined) =>
  stripAccents(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Abreviações conhecidas — expandidas antes de tokenizar. */
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bcdnim\b/g, "club de nuit intense man"],
  [/\bcdniw\b/g, "club de nuit intense woman"],
  [/\bcdni\b/g, "club de nuit intense"],
  [/\bcdn\b/g, "club de nuit"],
  [/\bmaison al hambra\b/g, "maison alhambra"],
  [/\bal-?wataniah\b/g, "al wataniah"],
  [/\bcollector'?s\b/g, "collector"],
  [/\bcollectors\b/g, "collector"],
  [/\bltd\b/g, "limited"],
  [/\baoud\b/g, "oud"],
  [/\bespecial\b/g, "special"],
  [/\bplatin\b/g, "platinum"],
  [/\bpour homme\b/g, "man"],
  [/\bpour femme\b/g, "woman"],
  [/\bfor men\b/g, "man"],
  [/\bfor women\b/g, "woman"],
];

export function normalizeText(raw: string): string {
  let s = stripAccents(raw ?? "").toLowerCase();
  s = s.replace(/[’`´]/g, "'").replace(/&/g, " e ");
  // separa número de unidade: 100ml → 100 ml
  s = s.replace(/(\d)(ml|oz|g)\b/g, "$1 $2");
  s = s.replace(/[^a-z0-9.,' ]+/g, " ");
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to);
  s = s.replace(/'/g, "");
  const words = s.split(/\s+/).filter(Boolean);
  // remove repetições consecutivas ("lique de lique de")
  const out: string[] = [];
  for (const w of words) if (out[out.length - 1] !== w) out.push(w);
  return out.join(" ").trim();
}

// ---------------------------------------------------------------- dicionários

/** Tokens de versão/flanker — peso MUITO alto. Extensível. */
export const FLANKERS = new Set([
  "elixir", "intense", "intenso", "black", "noir", "white", "blanc", "blue", "bleu", "green", "vert",
  "gold", "golden", "rose", "pink", "red", "rouge", "silver", "platinum", "platine", "bronze", "bourbon",
  "tous", "moi", "candy", "qahwa", "dukhan", "waha", "electric", "ghost", "wraith", "precieux", "iconic",
  "sillage", "milestone", "maleka", "kobra", "zanzibar", "absolu", "absolute", "extreme", "ultra",
  "supreme", "prive", "prestige", "exclusif", "royal", "imperial", "sport", "aqua", "fresh", "night",
  "oud", "vanilla", "honey", "coffee", "cristal", "crystal", "amber", "ambre", "reserve", "legacy",
  "urban", "summer", "winter", "sapphire", "ruby", "emerald", "diamond", "velvet", "leather", "tobacco",
  "smoke", "fire", "ice", "sweet", "velvet", "infinity", "code", "shadow", "dark", "light", "pure",
]);

/** Tokens de gênero que às vezes fazem parte do nome oficial (Club de Nuit Woman). */
const GENDER_NAME = new Map([
  ["man", "man"], ["men", "man"], ["homme", "man"], ["him", "man"], ["male", "man"],
  ["woman", "woman"], ["women", "woman"], ["femme", "woman"], ["her", "woman"],
]);

const EDITION = new Set(["limited", "collector", "special", "anniversary", "edicao", "limitada"]);

/** Palavras sem valor de identidade. */
const STOP = new Set([
  "de", "du", "da", "do", "la", "le", "les", "el", "the", "of", "e", "and", "et", "a", "o", "for",
  "perfume", "perfumes", "fragrance", "fragrancia", "spray", "vaporisateur", "vapo", "natural",
  "masculino", "feminino", "unissex", "unisex", "masc", "fem", "importado", "original", "novo", "new",
  "edition", "edicao", "eau", "ml", "oz", "g", "un", "und", "unidade", "frasco", "caixa", "selado",
  "lacrado", "lacrada", "tester", "teste", "decant", "amostra", "kit", "set", "gift", "sem",
  "contratipo", "arabe", "arabian", "arab", "inspiracao", "inspired",
]);

// ---------------------------------------------------------------- extração

function extractVolume(s: string): number | null {
  const ml = s.match(/(\d{1,4}(?:[.,]\d+)?)\s*ml\b/);
  if (ml) return Math.round(parseFloat(ml[1]!.replace(",", ".")));
  const oz = s.match(/(\d{1,2}(?:[.,]\d+)?)\s*(?:fl\s*)?oz\b/);
  if (oz) return normalizeVolume(parseFloat(oz[1]!.replace(",", ".")) * 29.5735);
  return null;
}

/** Arredonda volumes em onças para a apresentação comercial mais próxima. */
export function normalizeVolume(ml: number | null | undefined): number | null {
  if (!ml || !Number.isFinite(ml)) return null;
  const common = [5, 10, 15, 20, 25, 30, 35, 50, 60, 75, 80, 85, 90, 100, 105, 110, 120, 125, 150, 200, 250];
  const near = common.find((c) => Math.abs(c - ml) / c <= 0.03);
  return near ?? Math.round(ml);
}

export function normalizeConcentration(s: string | null | undefined): Concentration {
  const t = normalizeText(s ?? "");
  if (!t) return null;
  if (/\bextrait\b/.test(t)) return "EXTRAIT";
  if (/\beau de parfum\b|\bedp\b|\bagua de perfume\b/.test(t)) return "EDP";
  if (/\beau de toilette\b|\bedt\b/.test(t)) return "EDT";
  if (/\beau de cologne\b|\bedc\b|\bcologne\b|\bcolonia\b/.test(t)) return "EDC";
  if (/\bbody (splash|mist|lotion)|\bhidratante\b|\blocao\b/.test(t)) return "BODY";
  if (/\bparfum\b/.test(t)) return "PARFUM";
  return null;
}

function extractState(t: string): PresentationState {
  if (/\btester\b|\bteste\b/.test(t)) return "TESTER";
  if (/\bsem caixa\b|\bunboxed\b/.test(t)) return "SEM_CAIXA";
  if (/\bkit\b|\bgift set\b|\bestojo\b/.test(t)) return "KIT";
  if (/\bdecant\b|\bamostra\b/.test(t)) return "DECANT";
  if (/\blacrad[oa]\b|\bselad[oa]\b/.test(t)) return "LACRADO";
  return null;
}

function extractCategory(t: string): Attributes["category"] {
  if (/\bbody\b|\bsplash\b|\bhidratante\b|\blocao\b|\bcreme\b|\bdesodorante\b|\bshampoo\b|\bsabonete\b|\bpasta\b/.test(t))
    return "BODY";
  return "PERFUME";
}

/** Valida EAN-8/12/13/14 pelo dígito verificador. */
export function validEan(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return null;
  const digits = d.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((n, i) => (sum += n * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check ? d : null;
}

function findBrand(words: string[], dict: BrandDict | null, hint: string | null): { brand: string | null; remove: string[] } {
  // 1) marca informada pelo fornecedor / cadastro
  // marca do fornecedor desconhecida no dicionário (às vezes é o nome da linha: "Maahir")
  // → procura a marca real no título e não apaga palavras do nome.
  if (hint && dict && !dict.byKey.has(key(hint))) {
    const scanned = findBrand(words, dict, null);
    return scanned.brand ? scanned : { brand: hint.trim(), remove: [] as string[] };
  }
  if (hint) {
    const k = key(hint);
    const official = dict?.byKey.get(k) ?? hint.trim();
    const hw = normalizeText(hint).split(" ");
    return { brand: official, remove: hw };
  }
  if (!dict) return { brand: null, remove: [] as string[] };
  // 2) procura sequências de até 3 palavras no título
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const slice = words.slice(i, i + n);
      const official = dict.byKey.get(key(slice.join("")));
      if (official && key(slice.join("")).length >= 3) return { brand: official, remove: slice };
    }
  }
  return { brand: null, remove: [] as string[] };
}

export function extractAttributes(
  input: {
    title: string;
    brand?: string | null;
    concentration?: string | null;
    volumeMl?: number | null;
    flanker?: string | null;
    ean?: string | null;
  },
  dict: BrandDict | null = null,
): Attributes {
  const raw = [input.title, input.flanker].filter(Boolean).join(" ");
  const normalized = normalizeText(raw);
  const concentration = normalizeConcentration(input.concentration) ?? normalizeConcentration(normalized);
  const volumeMl = normalizeVolume(input.volumeMl ?? null) ?? extractVolume(normalized);
  const state = extractState(normalized);
  const category = concentration === "BODY" ? "BODY" : extractCategory(normalized);

  // tira concentrações e volumes do texto antes de separar nome/flanker
  const text = normalized
    .replace(/\bextrait de parfum\b|\beau de (parfum|toilette|cologne)\b|\bed[ptc]\b|\bextrait\b/g, " ")
    .replace(/\b\d+([.,]\d+)?\s*(ml|oz|g)\b/g, " ")
    .replace(/\bsem caixa\b|\bgift set\b|\bbody splash\b|\bbody mist\b/g, " ");
  let words = text.split(/\s+/).filter(Boolean);

  const { brand, remove } = findBrand(words, dict, input.brand ?? null);
  if (remove.length) {
    const idx = findSeq(words, remove);
    if (idx >= 0) words = [...words.slice(0, idx), ...words.slice(idx + remove.length)];
  }

  const flankers = new Set<string>();
  const genderTokens = new Set<string>();
  const edition = new Set<string>();
  const base: string[] = [];
  // "parfum" solto conta como concentração, nunca como nome
  for (const w of words) {
    if (/^\d+$/.test(w) && w.length > 3) continue;
    if (w === "parfum") continue;
    if (EDITION.has(w)) { edition.add(w === "edicao" || w === "limitada" ? "limited" : w); continue; }
    if (GENDER_NAME.has(w)) { genderTokens.add(GENDER_NAME.get(w)!); continue; }
    if (STOP.has(w)) continue;
    const fl = flankerOf(w);
    if (fl && base.length > 0) { flankers.add(fl); continue; }
    base.push(w);
  }
  // se o nome for apenas um token de flanker (ex.: "Black"), ele é base
  return {
    raw: input.title,
    normalized,
    brand,
    brandKey: brand ? key(brand) : null,
    base,
    baseKey: base.join(" "),
    flankers: [...flankers].sort(),
    genderTokens: [...genderTokens].sort(),
    edition: [...edition].sort(),
    concentration,
    volumeMl,
    state,
    category,
    ean: validEan(input.ean),
  };
}

/** Reconhece flanker com erro de digitação comum (ELETRIC, PLATIN). */
function flankerOf(w: string): string | null {
  if (FLANKERS.has(w)) return w;
  if (w.length < 5) return null;
  for (const f of FLANKERS) {
    if (f.length < 6) continue;
    if (f.startsWith(w) && w.length >= 6) return f;
    if (Math.abs(f.length - w.length) <= 1 && f[0] === w[0] && editDistance(f, w) === 1) return f;
  }
  return null;
}

function editDistance(a: string, b: string) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

function findSeq(words: string[], seq: string[]) {
  outer: for (let i = 0; i + seq.length <= words.length; i++) {
    for (let j = 0; j < seq.length; j++) if (words[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

// ---------------------------------------------------------------- similaridade

export function dice(a: string, b: string): number {
  const A = a.replace(/\s+/g, ""), B = b.replace(/\s+/g, "");
  if (!A || !B) return 0;
  if (A === B) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(A), gb = grams(B);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (A.length - 1 + B.length - 1);
}

function baseSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const jac = inter / new Set([...sa, ...sb]).size;
  return Math.max(jac, dice(a.join(" "), b.join(" ")));
}

// ---------------------------------------------------------------- comparação

export type Verdict = "SAME" | "DIFFERENT" | "REVIEW";
export type Reason = { field: string; label: string; ok: boolean | null; hard?: boolean };
export type Comparison = { verdict: Verdict; score: number; reasons: Reason[]; samePresentation: boolean };

const CONC_LABEL: Record<string, string> = { EXTRAIT: "Extrait", PARFUM: "Parfum", EDP: "EDP", EDT: "EDT", EDC: "Colônia", BODY: "Body" };

export type CompareOptions = {
  /** "canonical": comparar produtos (volume/concentração = apresentação → revisão). */
  level?: "canonical" | "offer";
  brandAliases?: (a: string, b: string) => boolean;
};

/**
 * Compara duas identidades. Regras duras sempre vencem o score.
 */
export function compare(a: Attributes, b: Attributes, opts: CompareOptions = {}): Comparison {
  const reasons: Reason[] = [];
  let score = 0;
  let hardDifferent = false;
  let needsReview = false;

  // EAN
  const eanEqual = !!a.ean && a.ean === b.ean;
  if (a.ean && b.ean) {
    reasons.push({ field: "ean", label: eanEqual ? "Mesmo código de barras" : "Códigos de barras diferentes", ok: eanEqual });
    if (eanEqual) score += 100;
    else needsReview = true;
  }

  // categoria
  if (a.category !== b.category) {
    reasons.push({ field: "category", label: "Tipos de produto diferentes", ok: false, hard: true });
    hardDifferent = true;
  }

  // marca
  if (a.brandKey && b.brandKey) {
    const same = a.brandKey === b.brandKey || !!opts.brandAliases?.(a.brandKey, b.brandKey);
    reasons.push({ field: "brand", label: same ? "Marca igual" : `Marca diferente: ${a.brand} vs ${b.brand}`, ok: same });
    if (same) score += 25;
    else needsReview = true;
  } else {
    reasons.push({ field: "brand", label: "Marca não informada em um dos lados", ok: null });
    needsReview = true;
  }

  // flanker/versão — regra dura. Um token só conflita se não existir em NENHUM lugar do outro nome
  // (evita falso conflito quando o fornecedor põe a palavra no começo: "Pure Aruba").
  const allA = new Set([...a.base, ...a.flankers]);
  const allB = new Set([...b.base, ...b.flankers]);
  const onlyA = a.flankers.filter((t) => !allB.has(t));
  const onlyB = b.flankers.filter((t) => !allA.has(t));
  const flankerSet = new Set([...a.flankers, ...b.flankers]);
  if (onlyA.length || onlyB.length) {
    reasons.push({ field: "flanker", label: `Flanker: ${onlyA.join(" ") || "nenhum"} vs ${onlyB.join(" ") || "nenhum"}`, ok: false, hard: true });
    hardDifferent = true;
  } else {
    const shared = [...flankerSet].filter((t) => allA.has(t) && allB.has(t));
    reasons.push({ field: "flanker", label: shared.length ? `Flanker igual (${shared.join(" ")})` : "Sem flanker nos dois", ok: true });
    score += 25;
  }

  // nome base (sem os tokens de versão)
  const coreA = [...allA].filter((t) => !flankerSet.has(t));
  const coreB = [...allB].filter((t) => !flankerSet.has(t));
  const sim = coreA.length || coreB.length ? baseSimilarity(coreA, coreB) : 1;
  const baseEqual = coreA.slice().sort().join(" ") === coreB.slice().sort().join(" ");
  reasons.push({
    field: "base",
    label: baseEqual ? "Nome base igual" : sim >= 0.85 ? `Nome base muito parecido (${Math.round(sim * 100)}%)` : `Nome base diferente (${Math.round(sim * 100)}%)`,
    ok: baseEqual ? true : sim >= 0.85 ? null : false,
    ...(sim < 0.85 ? { hard: true } : {}),
  });
  score += 25 * sim;
  if (sim < 0.85) hardDifferent = true;
  else if (!baseEqual) needsReview = true;

  // gênero como parte do nome (Club de Nuit Man vs Woman)
  const ga = a.genderTokens.join(), gb = b.genderTokens.join();
  if (ga && gb && ga !== gb) {
    reasons.push({ field: "gender", label: `Versão ${ga} vs ${gb}`, ok: false, hard: true });
    hardDifferent = true;
  } else if (ga !== gb) {
    reasons.push({ field: "gender", label: `Versão ${ga || "sem gênero no nome"} vs ${gb || "sem gênero no nome"}`, ok: null });
    needsReview = true;
  }

  // edição — regra dura
  if (a.edition.join() !== b.edition.join()) {
    reasons.push({ field: "edition", label: `Edição: ${a.edition.join(" ") || "comum"} vs ${b.edition.join(" ") || "comum"}`, ok: false, hard: true });
    hardDifferent = true;
  }

  // apresentação
  let samePresentation = true;
  if (a.volumeMl && b.volumeMl) {
    const same = a.volumeMl === b.volumeMl;
    reasons.push({ field: "volume", label: same ? `Volume igual (${a.volumeMl}ml)` : `Volume: ${a.volumeMl}ml vs ${b.volumeMl}ml`, ok: same });
    if (same) score += 10;
    else { samePresentation = false; needsReview = true; }
  } else if (a.volumeMl !== b.volumeMl) {
    reasons.push({ field: "volume", label: "Volume não informado em um dos lados", ok: null });
  }
  if (a.concentration && b.concentration) {
    const same = a.concentration === b.concentration;
    reasons.push({ field: "concentration", label: same ? `Concentração igual (${CONC_LABEL[a.concentration]})` : `Concentração: ${CONC_LABEL[a.concentration]} vs ${CONC_LABEL[b.concentration]}`, ok: same });
    if (same) score += 10;
    else { samePresentation = false; needsReview = true; }
  }
  if ((a.state ?? "LACRADO") !== (b.state ?? "LACRADO")) {
    reasons.push({ field: "state", label: `Apresentação: ${a.state ?? "lacrado"} vs ${b.state ?? "lacrado"}`, ok: false });
    samePresentation = false;
    needsReview = true;
  }

  const normalized = Math.min(1, score / 95);
  let verdict: Verdict;
  if (hardDifferent) verdict = eanEqual && !a.flankers.length && !b.flankers.length ? "REVIEW" : "DIFFERENT";
  else if (needsReview) verdict = "REVIEW";
  else verdict = normalized >= 0.9 ? "SAME" : "REVIEW";

  return { verdict, score: Number(normalized.toFixed(3)), reasons, samePresentation };
}

// ---------------------------------------------------------------- candidatos

export type Indexed<T> = { item: T; attrs: Attributes };

/** Índice invertido por tokens do nome base e marca — evita comparar tudo com tudo. */
export class CandidateIndex<T> {
  private byToken = new Map<string, Set<number>>();
  readonly items: Indexed<T>[] = [];

  add(item: T, attrs: Attributes) {
    const i = this.items.push({ item, attrs }) - 1;
    for (const t of this.tokens(attrs)) {
      if (!this.byToken.has(t)) this.byToken.set(t, new Set());
      this.byToken.get(t)!.add(i);
    }
  }

  private tokens(a: Attributes) {
    const out = new Set<string>();
    for (const w of a.base) if (w.length >= 3) { out.add(`w:${w}`); out.add(`p:${w.slice(0, 4)}`); }
    if (a.ean) out.add(`e:${a.ean}`);
    return out;
  }

  candidates(attrs: Attributes, limit = 20): Indexed<T>[] {
    const hits = new Map<number, number>();
    for (const t of this.tokens(attrs)) for (const i of this.byToken.get(t) ?? []) hits.set(i, (hits.get(i) ?? 0) + (t.startsWith("e:") ? 10 : 1));
    return [...hits.entries()]
      .map(([i, h]) => ({ i, rank: h + baseSimilarity(attrs.base, this.items[i]!.attrs.base) * 3 + (attrs.brandKey && attrs.brandKey === this.items[i]!.attrs.brandKey ? 2 : 0) }))
      .sort((x, y) => y.rank - x.rank)
      .slice(0, limit)
      .map((x) => this.items[x.i]!);
  }
}

// ---------------------------------------------------------------- decisão de oferta

export type OfferDecision = {
  state: "AUTO_MATCHED" | "REVIEW_REQUIRED" | "NEW_CANONICAL";
  productId: string | null;
  score: number;
  reasons: Reason[];
  alternatives: Array<{ productId: string; score: number; verdict: Verdict }>;
};

/**
 * Decide o destino de uma oferta. Auto-vínculo só com SAME, sem empate próximo,
 * e sem par bloqueado.
 */
export function decideOffer<T extends { id: string }>(
  attrs: Attributes,
  index: CandidateIndex<T>,
  opts: CompareOptions & { blocked?: (productId: string) => boolean } = {},
): OfferDecision {
  const results = index
    .candidates(attrs)
    .filter((c) => !opts.blocked?.(c.item.id))
    .map((c) => ({ c, cmp: compare(attrs, c.attrs, { ...opts, level: "offer" }) }))
    .filter((r) => r.cmp.verdict !== "DIFFERENT")
    .sort((x, y) => y.cmp.score - x.cmp.score);

  const alternatives = results.slice(0, 5).map((r) => ({ productId: r.c.item.id, score: r.cmp.score, verdict: r.cmp.verdict }));
  const top = results[0];
  if (!top) return { state: "NEW_CANONICAL", productId: null, score: 0, reasons: [], alternatives };
  const second = results[1];
  const clearWinner = !second || second.cmp.verdict !== "SAME" || top.cmp.score - second.cmp.score >= 0.08;
  if (top.cmp.verdict === "SAME" && clearWinner && top.cmp.score >= 0.92)
    return { state: "AUTO_MATCHED", productId: top.c.item.id, score: top.cmp.score, reasons: top.cmp.reasons, alternatives };
  if (top.cmp.score < 0.5) return { state: "NEW_CANONICAL", productId: null, score: top.cmp.score, reasons: top.cmp.reasons, alternatives };
  return { state: "REVIEW_REQUIRED", productId: top.c.item.id, score: top.cmp.score, reasons: top.cmp.reasons, alternatives };
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
