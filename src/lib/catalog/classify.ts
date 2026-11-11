/**
 * Classificação do catálogo Orium — funções puras, sem banco.
 *
 * Responsabilidades:
 * - decidir se o item pertence ao segmento da Orium (whitelist);
 * - identificar tipo de produto, gênero e marca;
 * - montar o nome comercial limpo preservando nomes oficiais;
 * - gerar a chave de duplicidade usada na unificação.
 */

export type ProductType =
  | "PERFUME"
  | "BODY_SPLASH"
  | "BODY_MOISTURIZER"
  | "BODY_CREAM"
  | "BODY_LOTION"
  | "COSMETIC"
  | "UNKNOWN";
export type Gender = "MALE" | "FEMALE" | "UNISEX" | "UNKNOWN";

/** Tipos que podem aparecer no catálogo público. */
export const ALLOWED_TYPES: ProductType[] = [
  "PERFUME",
  "BODY_SPLASH",
  "BODY_MOISTURIZER",
  "BODY_CREAM",
  "BODY_LOTION",
  "COSMETIC",
];

export const TYPE_LABEL: Record<ProductType, string> = {
  PERFUME: "Perfume",
  BODY_SPLASH: "Body splash",
  BODY_MOISTURIZER: "Hidratante corporal",
  BODY_CREAM: "Creme corporal",
  BODY_LOTION: "Loção corporal",
  COSMETIC: "Cosmético perfumado",
  UNKNOWN: "Sem tipo definido",
};

export const GENDER_LABEL: Record<Gender, string> = {
  MALE: "Masculino",
  FEMALE: "Feminino",
  UNISEX: "Unissex",
  UNKNOWN: "Indefinido",
};


/** Texto sem acento, minúsculo, com espaços simples — base de todas as regras. */
export const flat = (raw: string) =>
  raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9%+.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const has = (hay: string, words: string[]) => words.some((w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(hay));

/** Palavras que tiram o item do catálogo mesmo quando a categoria parece boa. */
const BLOCK: Array<[string, string[]]> = [
  [
    "eletrônico ou acessório",
    [
      "caixa de som",
      "caixinha de som",
      "speaker",
      "bluetooth",
      "fone",
      "fones",
      "headphone",
      "headset",
      "earbud",
      "carregador",
      "cabo",
      "cabos",
      "usb",
      "power ?bank",
      "powerbank",
      "celular",
      "smartphone",
      "iphone",
      "capinha",
      "capa de celular",
      "pelicula",
      "smartwatch",
      "relogio",
      "relogios",
      "watch",
      "televisao",
      "tv",
      "notebook",
      "mouse",
      "teclado",
      "drone",
      "camera",
      "eletronico",
      "eletronicos",
      "eletroportatil",
    ],
  ],
  [
    "casa e utilidades",
    [
      "ventilador",
      "liquidificador",
      "panela",
      "luminaria",
      "lampada",
      "brinquedo",
      "camiseta",
      "tenis",
      "chinelo",
      "bolsa",
      "mochila",
      "oculos",
      "caixa de ferramenta",
      "furadeira",
      "utilidades domesticas",
    ],
  ],
  [
    "medicamento ou suplemento",
    [
      "medicamento",
      "remedio",
      "farmacia",
      "generico",
      "comprimido",
      "comprimidos",
      "capsulas",
      "capsula",
      "suplemento",
      "vitamina",
      "vitaminas",
      "whey",
      "creatina",
      "colageno",
      "melatonina",
      "omega 3",
      "gummy",
      "gomas",
      "anticoncepcional",
      "pomada",
      "antibiotico",
      "dipirona",
      "ibuprofeno",
      "paracetamol",
      "soro fisiologico",
    ],
  ],
  [
    "tratamento capilar",
    [
      "minoxidil",
      "minoxidil kirkland",
      "finasterida",
      "shampoo",
      "condicionador",
      "anticaspa",
      "crescimento capilar",
      "queda de cabelo",
      "tonico capilar",
      "progressiva",
      "botox capilar",
      "alisante",
      "tintura",
      "coloracao",
      "descolorante",
      "queratina",
      "cronograma capilar",
      "mascara capilar",
      "barba",
      "oleo para barba",
      "balm de barba",
      "pomada modeladora",
      "gel de cabelo",
    ],
  ],
  [
    "outro segmento",
    [
      "suco",
      "cafe em po",
      "chocolate",
      "bala",
      "energetico",
      "cigarro",
      "vape",
      "narguile",
      "essencia para narguile",
      "preservativo",
      "gel lubrificante",
      "sex shop",
      "fralda",
      "absorvente",
      "papel higienico",
      "detergente",
      "amaciante",
      "desinfetante",
      "sabao em po",
    ],
  ],
];

const PERFUME_WORDS = [
  "perfume",
  "perfumes",
  "parfum",
  "parfums",
  "edp",
  "edt",
  "edc",
  "e\\.?d\\.?p",
  "eau de parfum",
  "eau de toilette",
  "eau de cologne",
  "eau fraiche",
  "extrait",
  "elixir",
  "cologne",
  "colonia",
  "deo parfum",
  "deo colonia",
  "perfumaria",
  "perfumes arabes",
  "fragrancia",
  "fragrancias",
  "fragrance",
  "attar",
  "oud",
  "perfume oil",
  "oleo perfumado",
];

const SPLASH_WORDS = ["body splash", "body mist", "fragrance mist", "splash corporal", "splash", "mist"];

const MOISTURIZER_WORDS = [
  "hidratante",
  "hidratante corporal",
  "pasta hidratante",
  "pasta hidrante",
  "body butter",
  "manteiga corporal",
  "body milk",
];

const CREAM_WORDS = ["creme corporal", "creme hidratante", "body cream", "creme perfumado", "creme de corpo"];

const LOTION_WORDS = ["locao corporal", "locao hidratante", "body lotion", "locao perfumada", "locao"];

const COSMETIC_WORDS = [
  "desodorante",
  "deo spray",
  "body spray",
  "sabonete",
  "shower gel",
  "gel de banho",
  "oleo corporal",
  "kit perfume",
  "escalda pes",
  "talco perfumado",
  "agua perfumada",
];

export type TypeResult = { type: ProductType; eligible: boolean; reason: string };

/**
 * Lista de permissão: só perfumaria e cuidados corporais perfumados entram no catálogo.
 * O padrão é ficar fora (`UNKNOWN`) — nada entra sem indício claro.
 */
export function classifyType(name: string, categories: string[] = [], extra = ""): TypeResult {
  const hay = flat([name, categories.join(" "), extra].join(" "));

  for (const [reason, words] of BLOCK) {
    if (has(hay, words)) return { type: "UNKNOWN", eligible: false, reason };
  }

  if (has(hay, MOISTURIZER_WORDS)) return { type: "BODY_MOISTURIZER", eligible: true, reason: "hidratante corporal" };
  if (has(hay, CREAM_WORDS)) return { type: "BODY_CREAM", eligible: true, reason: "creme corporal" };
  if (has(hay, LOTION_WORDS)) return { type: "BODY_LOTION", eligible: true, reason: "loção corporal" };
  if (has(hay, SPLASH_WORDS)) return { type: "BODY_SPLASH", eligible: true, reason: "body splash" };
  if (has(hay, PERFUME_WORDS)) return { type: "PERFUME", eligible: true, reason: "perfume" };
  if (has(hay, COSMETIC_WORDS)) return { type: "COSMETIC", eligible: true, reason: "cosmético perfumado" };
  if (/\b\d{2,3}\s?ml\b/.test(hay)) return { type: "PERFUME", eligible: true, reason: "perfume (volume em ml)" };

  return { type: "UNKNOWN", eligible: false, reason: "sem indício de perfumaria" };
}

export type GenderResult = { gender: Gender; confidence: number };

/** Sinais fortes: dizem explicitamente para quem é o perfume. */
const STRONG_MALE = ["masculino", "masculina", "masc", "para homem", "para homens", "pour homme", "for men", "for him"];
const STRONG_FEMALE = [
  "feminino",
  "feminina",
  "fem",
  "para mulher",
  "para mulheres",
  "pour femme",
  "for women",
  "for her",
];
/** Sinais fracos: podem ser parte do nome oficial (Club de Nuit Intense Man). */
const WEAK_MALE = ["homem", "homme", "men", "man", "male", "him"];
const WEAK_FEMALE = ["mulher", "femme", "women", "woman", "female", "her", "lady", "ladies"];

/** Gênero a partir de título, categoria, atributos e URL do fornecedor. */
export function classifyGender(name: string, categories: string[] = [], extra = ""): GenderResult {
  const hay = flat([name, categories.join(" "), extra].join(" "));

  if (has(hay, ["unissex", "unisex", "for all", "shared", "masculino e feminino", "for men and women"])) {
    return { gender: "UNISEX", confidence: 0.95 };
  }

  const strongMale = has(hay, STRONG_MALE);
  const strongFemale = has(hay, STRONG_FEMALE);
  if (strongMale && strongFemale) return { gender: "UNISEX", confidence: 0.8 };
  if (strongMale) return { gender: "MALE", confidence: 0.92 };
  if (strongFemale) return { gender: "FEMALE", confidence: 0.92 };

  const weakMale = has(hay, WEAK_MALE);
  const weakFemale = has(hay, WEAK_FEMALE);
  if (weakMale && weakFemale) return { gender: "UNISEX", confidence: 0.55 };
  if (weakMale) return { gender: "MALE", confidence: 0.6 };
  if (weakFemale) return { gender: "FEMALE", confidence: 0.6 };

  return { gender: "UNKNOWN", confidence: 0 };
}


/** Ruído comercial removido do nome público — sempre como palavra inteira. */
const MARKETING = [
  "perfume",
  "perfumes",
  "importado",
  "importada",
  "original",
  "originais",
  "atacado",
  "varejo",
  "promocao",
  "promocional",
  "pronta entrega",
  "envio imediato",
  "frete gratis",
  "lacrado",
  "lacrada",
  "novo",
  "nova",
  "oferta",
  "super oferta",
  "kit com",
  "melhor preco",
  "arabe",
  "arabes",
  "masculino",
  "masculina",
  "feminino",
  "feminina",
  "unissex",
  "unisex",
  "de luxo",
  "luxo",
  "top",
  "similar",
  "inspirado",
  "importados",
  "100% original",
];

const CONC_TOKENS: Array<[RegExp, string]> = [
  [/\bextrait( de parfum)?\b/i, "Extrait"],
  [/\beau de parfum\b|\bedp\b/i, "EDP"],
  [/\beau de toilette\b|\bedt\b/i, "EDT"],
  [/\beau de cologne\b|\bedc\b|\bcologne\b|\bcolonia\b/i, "Cologne"],
  [/\belixir\b/i, "Elixir"],
  [/\bparfum\b/i, "Parfum"],
];

export function detectConcentration(raw: string): string | null {
  const s = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [re, label] of CONC_TOKENS) if (re.test(s)) return label;
  return null;
}

export function detectVolume(raw: string): number | null {
  const m = raw.toLowerCase().replace(/,/g, ".").match(/(\d{2,4}(?:\.\d)?)\s*ml\b/);
  if (!m?.[1]) return null;
  const v = Math.round(Number(m[1]));
  return v >= 5 && v <= 1000 ? v : null;
}

const titleWord = (w: string) => {
  if (/^[0-9]/.test(w)) return w.toUpperCase(); // 9PM, 212, 100ml
  if (w.length <= 3 && w === w.toUpperCase()) return w; // CK, EDP
  return w.charAt(0).toUpperCase() + w.slice(1);
};

const LOWER = new Set(["de", "du", "da", "do", "des", "la", "le", "les", "of", "the", "al", "el", "y", "en"]);

/** Capitalização comercial preservando siglas e números oficiais (CK One, 212 VIP, 9PM). */
export function prettyName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const low = w.toLowerCase();
      if (i > 0 && LOWER.has(low)) return low;
      if (/^[A-Z0-9][A-Z0-9.'-]*$/.test(w) && w.length <= 4) return w; // CK, VIP, 9PM
      return titleWord(low);
    })
    .join(" ");
}

export type NameResult = {
  /** Nome curto da fragrância, sem marca, concentração nem volume. */
  core: string;
  /** Nome comercial completo: Marca Fragrância EDP 100ml */
  canonical: string;
  concentration: string | null;
  volumeMl: number | null;
};

/**
 * Monta o nome público a partir do título bruto do fornecedor.
 * Remove apenas ruído de anúncio; nunca corta palavras do nome oficial.
 */
export function buildCanonicalName(rawName: string, brand: string | null): NameResult {
  const concentration = detectConcentration(rawName);
  const volumeMl = detectVolume(rawName);

  let s = rawName.replace(/\s+/g, " ").trim();
  // tira volume, concentração e ruído comercial do miolo
  s = s.replace(/\b\d{2,4}(?:[.,]\d)?\s*(ml|ML|Ml)\b/g, " ");
  s = s.replace(
    /\b(extrait de parfum|eau de parfum|eau de toilette|eau de cologne|edp|edt|edc|extrait|elixir|cologne|colonia|col[oô]nia|parfum|perfum)\b/gi,
    " ",
  );
  for (const term of MARKETING) {
    s = s.replace(new RegExp(`(^|[^\\p{L}0-9])${term.replace(/ /g, "\\s+")}($|[^\\p{L}0-9])`, "giu"), "$1 $2");
  }
  // tira a marca do início/fim do miolo
  if (brand) {
    const b = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`(^|[^\\p{L}0-9])${b}($|[^\\p{L}0-9])`, "iu"), "$1 $2");
  }
  s = s
    .replace(/\s*[|/–—•]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—,.]+|[\s\-–—,.]+$/g, "")
    .trim();

  const core = prettyName(s) || prettyName(rawName.slice(0, 60));
  const canonical = [brand ?? null, core, concentration, volumeMl ? `${volumeMl}ml` : null]
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { core, canonical, concentration, volumeMl };
}

const KEY_NOISE = new Set([
  "perfume",
  "perfumes",
  "de",
  "the",
  "el",
  "la",
  "for",
  "and",
  "e",
  "eau",
  "spray",
  "vaporisateur",
  "hidratante",
  "body",
  "splash",
  "mist",
  "creme",
  "cream",
  "lotion",
  "locao",
]);

/** Miolo comparável: só as palavras que identificam a fragrância. */
export function coreKey(core: string): string {
  return flat(core)
    .split(/\s+/)
    .filter((w) => w && !KEY_NOISE.has(w))
    .sort()
    .join(" ");
}

/**
 * Chave de duplicidade. Dois itens só são o mesmo produto quando marca, miolo,
 * concentração, volume e tipo coincidem — flankers e versões continuam separados.
 */
export function dedupeKey(input: {
  brand: string | null;
  core: string;
  concentration: string | null;
  volumeMl: number | null;
  type: ProductType;
}): string {
  return [
    flat(input.brand ?? "sem-marca").replace(/\s+/g, ""),
    coreKey(input.core).replace(/\s+/g, "-"),
    input.concentration ?? "-",
    input.volumeMl ?? "-",
    input.type,
  ].join("|");
}

/** Marca reconhecida dentro do título quando o fornecedor não informa o campo. */
export function detectBrandInName(rawName: string, brands: string[]): string | null {
  const hay = flat(rawName);
  let best: { name: string; len: number } | null = null;
  for (const b of brands) {
    const fb = flat(b);
    if (!fb) continue;
    const re = new RegExp(`(^|[^a-z0-9])${fb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    if (re.test(hay) && (!best || fb.length > best.len)) best = { name: b, len: fb.length };
  }
  return best?.name ?? null;
}
