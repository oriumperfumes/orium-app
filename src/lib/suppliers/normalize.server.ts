/**
 * Limpeza de texto e normalização de marcas vindas dos fornecedores.
 * Nada aqui toca no banco: são funções puras usadas pelos adaptadores e pelo motor.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  nbsp: " ",
  lt: "<",
  gt: ">",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  aacute: "á",
  agrave: "à",
  acirc: "â",
  atilde: "ã",
  ccedil: "ç",
  iacute: "í",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  uacute: "ú",
  uuml: "ü",
  ntilde: "ñ",
  deg: "°",
  reg: "®",
  copy: "©",
  trade: "™",
};

/** Converte entidades HTML (&amp;, &#039;, &quot;…) em texto normal, inclusive quando codificadas duas vezes. */
export function decodeEntities(input: string): string {
  let out = input;
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
      if (body.startsWith("#")) {
        const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      const hit = NAMED[body.toLowerCase()];
      return hit ?? whole;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Texto pronto para exibir: sem entidades, sem espaços duplicados e sem lixo nas pontas. */
export function cleanText(input: string | null | undefined): string {
  if (!input) return "";
  return decodeEntities(String(input))
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—|,.]+|[\s\-–—|,]+$/g, "")
    .trim();
}

/** Chave de comparação de marcas: ignora acentos, maiúsculas, hífens e pontuação. */
export function brandKey(input: string): string {
  return cleanText(input)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

const KNOWN_BRANDS = [
  "Lattafa",
  "Armaf",
  "Maison Alhambra",
  "Al Haramain",
  "Rasasi",
  "Afnan",
  "Ard Al Zaafaran",
  "Asdaaf",
  "Riiffs",
  "Fragrance World",
  "Paris Corner",
  "Swiss Arabian",
  "Emper",
  "Zimaya",
  "Nusuk",
  "Bharara",
  "Dolce&Gabbana",
  "Victoria's Secret",
  "Aurora Scents",
  "Isabelle La Belle",
  "Neeche House",
  "Orientica",
  "Khadlaj",
  "Ajmal",
  "Dior",
  "Chanel",
  "Versace",
  "Carolina Herrera",
];

const KNOWN_BY_KEY = new Map(KNOWN_BRANDS.map((b) => [brandKey(b), b]));

const LOWER_WORDS = new Set(["de", "da", "do", "des", "of", "the", "al", "el", "y", "e"]);

/** Grafia oficial da marca: usa a lista conhecida ou aplica capitalização cuidadosa. */
export function canonicalBrandName(input: string | null | undefined): string | null {
  const clean = cleanText(input);
  if (!clean) return null;
  const known = KNOWN_BY_KEY.get(brandKey(clean));
  if (known) return known;
  const words = clean.toLowerCase().split(/\s+/);
  return words
    .map((w, i) => {
      if (i > 0 && LOWER_WORDS.has(w)) return w;
      return w.replace(/^[a-z\u00e0-\u00ff]/, (c) => c.toUpperCase());
    })
    .join(" ");
}
