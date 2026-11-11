/**
 * Nome canônico da Orium (puro, sem banco).
 *
 * O título do fornecedor é dado bruto. Aqui nasce o nome que o cliente vê:
 * grafia correta da linha (Club de Nuit), siglas preservadas (BAD, 9PM, 212 VIP),
 * sem letras separadas artificialmente e sem palavras de marketing.
 *
 * Também gera os APELIDOS de busca: as grafias antigas continuam pesquisáveis.
 */

const collapse = (s: string) => (s ?? "").replace(/\s+/g, " ").trim();

const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Chave de comparação: sem acento, sem espaço, sem pontuação. */
export const searchKey = (s: string) => stripAccents(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const LOWER = new Set(["de", "da", "do", "des", "of", "the", "le", "la", "du", "e", "y"]);
const UPPER = new Set(["EDP", "EDT", "EDC", "VIP", "CK", "BAD", "NYC", "UAE", "XS", "XX", "XXL", "GT", "CDN", "JPG"]);
const ROMAN = /^(i{1,3}|iv|vi{0,3}|ix|xi{0,2})$/i;

/** Grafias equivalentes que sempre viram a forma oficial. */
const TOKEN_FIX: Record<string, string> = {
  platin: "Platinum",
  platinium: "Platinum",
  platinum: "Platinum",
  nuitt: "Nuit",
  clube: "Club",
  homem: "Homme",
  wooman: "Woman",
  womam: "Woman",
};

/** Junta letras separadas artificialmente: "B A D Femme" → "BAD Femme". */
const joinSpacedLetters = (s: string) =>
  s.replace(/\b([A-Za-z])(?:\s+[A-Za-z]\b){1,4}/g, (m) => m.replace(/\s+/g, "").toUpperCase());

const titleToken = (word: string, first: boolean) => {
  const bare = stripAccents(word).replace(/[^A-Za-z0-9]/g, "");
  const fixed = TOKEN_FIX[bare.toLowerCase()];
  if (fixed) return fixed;
  if (UPPER.has(bare.toUpperCase())) return bare.toUpperCase();
  if (/\d/.test(word)) return word.toUpperCase(); // 9PM, 212, 105ML
  if (ROMAN.test(bare) && bare.length <= 3) return bare.toUpperCase();
  if (!first && LOWER.has(bare.toLowerCase())) return bare.toLowerCase();
  if (word.length <= 3 && word === word.toUpperCase() && /^[A-Za-z]+$/.test(word)) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
};

const NOISE = new Set([
  "perfume",
  "perfumes",
  "perfumaria",
  "original",
  "importado",
  "lacrado",
  "atacado",
  "prontaentrega",
  "pronta",
  "entrega",
  "novo",
  "promocao",
  "oferta",
  "arabe",
  "arabes",
]);

export type CanonicalName = {
  /** Nome público final. */
  name: string;
  /** Linha/família quando reconhecida (Club de Nuit, Fakhar…). */
  line: string | null;
  /** Marca dona da linha, quando é conhecida com segurança. */
  lineBrand: string | null;
  /** Falta a versão (flanker) para diferenciar o produto. */
  needsVersion: boolean;
  /** Motivos que justificam revisão humana. */
  suspicious: string[];
};

/** Título bruto → nome público correto da Orium. */
export function canonicalizeProductName(raw: string, opts?: { brand?: string | null }): CanonicalName {
  const suspicious: string[] = [];
  const original = collapse(raw ?? "");
  let base = collapse(joinSpacedLetters(original));
  if (searchKey(base) !== searchKey(original) || base !== original) suspicious.push("letras separadas artificialmente");
  if (original && original === original.toUpperCase() && original.replace(/[^A-Za-z]/g, "").length > 6)
    suspicious.push("título todo em caixa alta");

  base = base.replace(/\b\d{2,4}\s?(ml|g)\b/gi, " ");
  let tokens = collapse(base).split(" ").filter(Boolean);

  // marca repetida no começo do nome
  if (opts?.brand) {
    const brandWords = opts.brand.split(/\s+/).map(searchKey);
    while (tokens.length > 1 && brandWords.includes(searchKey(tokens[0] ?? ""))) {
      tokens.shift();
      suspicious.push("marca repetida no nome");
    }
  }

  tokens = tokens.filter((t) => t && !NOISE.has(searchKey(t)));

  // palavras repetidas ("Asad Asad Zanzibar")
  const seen = new Set<string>();
  tokens = tokens.filter((t) => {
    const k = searchKey(t);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let line: string | null = null;
  let lineBrand: string | null = null;
  let needsVersion = false;
  const keys = tokens.map(searchKey);

  if (keys.includes("club") || keys.includes("clube")) {
    if (keys.includes("nuit") || keys.includes("nuitt")) {
      const drop = new Set(["club", "clube", "nuit", "nuitt", "de", "d", "du"]);
      const rest = tokens.filter((_, i) => !drop.has(keys[i] ?? ""));
      line = "Club de Nuit";
      lineBrand = "Armaf";
      tokens = ["Club", "de", "Nuit", ...rest];
      needsVersion = rest.length === 0;
      if (!/club\s+de\s+nuit/i.test(original)) suspicious.push("linha Club de Nuit escrita de forma incompleta");
    }
  } else if (keys.includes("fakhar")) {
    const drop = new Set(["fakhar", "pride", "of", "lattafa"]);
    const rest = tokens.filter((_, i) => !drop.has(keys[i] ?? ""));
    line = "Fakhar";
    lineBrand = "Lattafa";
    tokens = ["Fakhar", ...rest];
    needsVersion = rest.length === 0;
    if (/pride/i.test(original)) suspicious.push("nome genérico “Pride of”");
  } else if (keys.includes("bad")) {
    line = "BAD";
  }

  const name = collapse(tokens.map((t, i) => titleToken(t, i === 0)).join(" "));
  if (needsVersion) suspicious.push("falta a versão para diferenciar o produto");

  return { name: name || original, line, lineBrand, needsVersion, suspicious: Array.from(new Set(suspicious)) };
}

/** Apelidos de busca: grafias antigas, versão colada, sem “de”, iniciais e letras separadas. */
export function buildAliases(canonical: string, extras: Array<string | null | undefined> = []): string[] {
  const out = new Set<string>();
  const push = (s?: string | null) => {
    const v = collapse(s ?? "");
    if (v.length > 2) out.add(v);
  };

  push(canonical);
  for (const e of extras) push(e);

  const words = canonical.split(" ").filter(Boolean);
  const strong = words.filter((w) => !LOWER.has(w.toLowerCase()));
  push(strong.join(" "));
  push(canonical.replace(/\s+/g, ""));
  push(strong.join(""));

  const initials = strong.map((w) => w[0] ?? "").join("");
  if (initials.length >= 3) push(initials.toUpperCase());
  if (strong.length >= 3) push(strong.slice(0, 3).map((w) => w[0] ?? "").join("").toUpperCase());

  for (const w of words) {
    if (w.length >= 2 && /^[A-Z0-9]+$/.test(w)) push(canonical.replace(w, w.split("").join(" ")));
  }

  return Array.from(out).slice(0, 16);
}
