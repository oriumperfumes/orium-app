/**
 * Acha perfumes citados numa mensagem de WhatsApp ("tem o asad bourbon?", "quanto ta o 9pm").
 * Puro: recebe o índice do catálogo e devolve os produtos encontrados, do trecho mais longo
 * pro mais curto. Nome de uma palavra só conta se for incomum ou vier junto com a marca,
 * para "pisa" (verbo) não virar o perfume Pisa.
 */

export type MentionIndexRow = {
  id: string;
  name: string;
  brand: string | null;
  terms: string[];
  in_stock?: boolean;
};
export type Mention = {
  productId: string;
  name: string;
  brand: string | null;
  term: string;
  confidence: "alta" | "media";
};

export const flat = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Palavras comuns em conversa ou genéricas demais em nome de perfume. */
const COMMON = new Set(
  (
    "a o e de da do das dos um uma pra para por com sem que qual quais quanto quanta ta esta tem ter vc voce oi ola bom boa dia tarde noite sim nao " +
    "obrigado obrigada valor preco frasco decant ml perfume perfumes manda foto quero queria gostei gosto amei esse essa este esta isso aqui ai la " +
    "pisa casa vida amor love night day gold black white silver rose blue red noir intense eau parfum pour homme femme man woman men women club royal " +
    "amber ambar vanilla baunilha oud musk sport extreme edition elixir private prive original classic classico new novo nova pink green verde azul " +
    "preto branco dourado ouro prata king queen lady sir mister miss pure absolute intensa forte suave doce fresco amadeirado oriental"
  ).split(" "),
);

type Entry = { tokens: string[]; brandOnly: boolean; rows: MentionIndexRow[]; term: string };

export function buildMentionIndex(rows: MentionIndexRow[]) {
  const map = new Map<string, Entry>();
  const put = (term: string, row: MentionIndexRow, brandOnly = false) => {
    const key = flat(term);
    if (!key || key.length < 3) return;
    const e = map.get(key) ?? { tokens: key.split(" "), brandOnly, rows: [], term: key };
    if (!e.rows.some((r) => r.id === row.id)) e.rows.push(row);
    map.set(key, e);
  };
  const brands = new Set<string>();
  for (const r of rows) {
    for (const t of [r.name, ...r.terms]) {
      put(t, r);
      if (r.brand) put(`${r.brand} ${t}`, r);
    }
    if (r.brand) brands.add(flat(r.brand));
  }
  return { map, brands, maxLen: Math.max(1, ...[...map.values()].map((e) => e.tokens.length)) };
}

export type MentionIndex = ReturnType<typeof buildMentionIndex>;

export function findMentions(text: string, index: MentionIndex, limit = 4): Mention[] {
  const toks = flat(text).split(" ").filter(Boolean);
  if (!toks.length) return [];
  const textFlat = ` ${toks.join(" ")} `;
  const used = new Array(toks.length).fill(false);
  const found: Mention[] = [];
  const seen = new Set<string>();
  const maxN = Math.min(index.maxLen, 6);

  for (let n = maxN; n >= 1; n--) {
    for (let i = 0; i + n <= toks.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const key = toks.slice(i, i + n).join(" ");
      const e = index.map.get(key);
      if (!e) continue;
      // marca sozinha (ex.: "lattafa") não é um perfume
      if (index.brands.has(key)) continue;
      let confidence: Mention["confidence"] = n >= 2 ? "alta" : "media";
      if (n === 1) {
        const brandNear = e.rows.some((r) => r.brand && textFlat.includes(` ${flat(r.brand)} `));
        const rare = key.length >= 5 && !COMMON.has(key) && !/^\d+$/.test(key);
        if (!brandNear && !rare) continue;
        if (brandNear) confidence = "alta";
      }
      // mesmo nome em vários produtos (tamanhos/versões): prefere o que está em estoque
      const rows = [...e.rows].sort((a, b) => Number(!!b.in_stock) - Number(!!a.in_stock));
      for (const r of rows.slice(0, 2)) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        found.push({ productId: r.id, name: r.name, brand: r.brand, term: key, confidence });
      }
      for (let k = i; k < i + n; k++) used[k] = true;
      if (found.length >= limit) return found.slice(0, limit);
    }
  }
  return found;
}
