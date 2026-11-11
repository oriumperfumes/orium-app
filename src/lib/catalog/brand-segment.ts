/**
 * Segmento da marca — decide o posicionamento da Orium (perfumaria árabe).
 *
 * Regra pública: PERFUME + marca DESIGNER (com "mostrar no catálogo" desligado)
 * sai do catálogo. Body splash, cremes, pastas e hidratantes NUNCA são afetados.
 *
 * Quando não há segurança sobre a marca, o segmento é UNKNOWN: nada é removido
 * automaticamente, o caso vai para revisão no Admin.
 */

export type BrandSegment = "ARABIC" | "DESIGNER" | "NICHE" | "UNKNOWN";

export const SEGMENT_LABEL: Record<BrandSegment, string> = {
  ARABIC: "Árabe",
  DESIGNER: "Designer",
  NICHE: "Nicho",
  UNKNOWN: "Outro",
};

/** Chave de comparação da marca: sem acento, sem pontuação, sem espaço. */
export const segmentKey = (raw: string | null | undefined) =>
  (raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

/** Marcas designer/tradicionais que não fazem parte do posicionamento da Orium. */
const DESIGNER = [
  "paco rabanne",
  "rabanne",
  "jean paul gaultier",
  "jeanpaul gaultier",
  "gaultier",
  "calvin klein",
  "dior",
  "christian dior",
  "chanel",
  "carolina herrera",
  "giorgio armani",
  "armani",
  "emporio armani",
  "yves saint laurent",
  "saint laurent",
  "ysl",
  "hugo boss",
  "hugo",
  "versace",
  "dolce gabbana",
  "dolce&gabbana",
  "d&g",
  "gucci",
  "burberry",
  "givenchy",
  "prada",
  "valentino",
  "lacoste",
  "azzaro",
  "ralph lauren",
  "polo ralph lauren",
  "antonio banderas",
  "banderas",
  "marc jacobs",
  "ariana grande",
  "lancome",
  "ferrari",
  "ferrari scuderia",
  "scuderia ferrari",
  "jacques bogart",
  "bogart",
  "montblanc",
  "mont blanc",
  "bvlgari",
  "bulgari",
  "tommy hilfiger",
  "nautica",
  "kenzo",
  "cacharel",
  "moschino",
  "jimmy choo",
  "salvatore ferragamo",
  "ferragamo",
  "hermes",
  "guerlain",
  "shakira",
  "britney spears",
  "paris hilton",
  "hollister",
  "abercrombie",
  "diesel",
  "issey miyake",
  "thierry mugler",
  "mugler",
  "narciso rodriguez",
  "jean patou",
  "davidoff",
  "gilles cantuel",
  "fragluxe",
  "natura",
  "o boticario",
  "boticario",
  "avon",
  "eudora",
  "jequiti",
];

/** Casas árabes legítimas (referência, não lista fechada). */
const ARABIC = [
  "lattafa",
  "lattafa perfumes",
  "maison alhambra",
  "alhambra",
  "armaf",
  "afnan",
  "al wataniah",
  "al whataniah",
  "rasasi",
  "rayhaan",
  "rayhaa",
  "french avenue",
  "fragrance world",
  "paris corner",
  "khadlaj",
  "ahmed al maghribi",
  "orientica",
  "swiss arabian",
  "al haramain",
  "ard al zaafaran",
  "asdaaf",
  "adyan",
  "riiffs",
  "emper",
  "zimaya",
  "nusuk",
  "bharara",
  "ajmal",
  "mawwal",
  "chris adams",
  "grandeur",
  "naseem",
  "anfar",
  "anfar london",
  "my perfumes",
  "bidaya",
  "al noble",
  "hamidi",
  "sabah",
  "aurora scents",
  "milestone",
  "odysse",
  "elite risala",
  "amaran",
  "angham",
  "durrat",
  "reyna",
  "shams",
  "khamra",
];

const DESIGNER_KEYS = new Set(DESIGNER.map(segmentKey));
const ARABIC_KEYS = new Set(ARABIC.map(segmentKey));

export type SegmentGuess = { segment: BrandSegment; confidence: number; source: string };

/**
 * Classificação automática pela MARCA (nunca pelo nome do produto).
 * Sem certeza → UNKNOWN, que vai para revisão e não remove nada.
 */
export function classifyBrandSegment(brandName: string | null | undefined): SegmentGuess {
  const key = segmentKey(brandName);
  if (!key) return { segment: "UNKNOWN", confidence: 0, source: "sem-marca" };
  if (DESIGNER_KEYS.has(key))
    return { segment: "DESIGNER", confidence: 0.98, source: "lista-designer" };
  if (ARABIC_KEYS.has(key)) return { segment: "ARABIC", confidence: 0.98, source: "lista-arabe" };

  // grafias compostas ("Paco Rabanne Perfumes", "Dior Sauvage Oficial")
  for (const k of DESIGNER_KEYS) {
    if (k.length >= 6 && (key.startsWith(k) || key.endsWith(k))) {
      return { segment: "DESIGNER", confidence: 0.9, source: "lista-designer-parcial" };
    }
  }
  for (const k of ARABIC_KEYS) {
    if (k.length >= 6 && (key.startsWith(k) || key.endsWith(k))) {
      return { segment: "ARABIC", confidence: 0.9, source: "lista-arabe-parcial" };
    }
  }

  // pistas árabes comuns nas casas do Golfo
  if (/^(al|el)[a-z]/.test(key) || /(arabian|arabia|oud|attar|perfumesuae)/.test(key)) {
    return { segment: "ARABIC", confidence: 0.7, source: "pista-arabe" };
  }

  return { segment: "UNKNOWN", confidence: 0, source: "sem-certeza" };
}

/** Motivo gravado quando o perfume sai do catálogo por causa da marca. */
export const DESIGNER_REASON = "marca-designer-fora-do-posicionamento";
