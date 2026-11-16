/**
 * Uma cor por "família" de acorde — a mesma no admin (barras do estúdio) e na
 * loja. Cores sólidas e quentes, que conversam com o dourado da Orium.
 */
const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const RULES: Array<[RegExp, string]> = [
  [/cafe|cacau|chocolate|gourmand|avela|amendoa|praline/, "#B07A52"],
  [/baunilha|doce|caramelo|mel|coco|tonka|acucar|toffee|marshmallow/, "#F0B37E"],
  [/ambar|incenso|resina|balsam|benjoim|mirra|labdano|ladano/, "#E39B4E"],
  [/especi|pimenta|canela|cardamomo|acafrao|cravo|gengibre/, "#D9653E"],
  [/tabaco|couro|leather|fumad|defumad/, "#8E5B3E"],
  [/oud|amadeir|madeira|cedro|sandalo|vetiver|patchouli|musgo/, "#A3825E"],
  [/rosa|floral|jasmim|iris|violeta|lirio|gardenia|tuberosa|flor|ylang|neroli|peonia/, "#E78FB3"],
  [/lavanda/, "#A99BE0"],
  [/citr|limao|bergamot|laranja|toranja|lima|mandarin/, "#F2D35B"],
  [/tropical|frut|abacaxi|maca|framboesa|damasco|pessego|groselha|cassis|amora|morango|tamara|ameixa|lichia|manga/, "#EE6F7F"],
  [/aromat|herbal|hortela|menta|salvia|alecrim|verde/, "#8DC27A"],
  [/aquat|marinh|fresc|ozon|salin|aquoso/, "#7CC6DB"],
  [/almiscar|musk|atalcado|talco|powder|suave|limpo/, "#CFC3EA"],
  [/metal|mineral/, "#A8B1BA"],
];

export function accordColor(name: string): string {
  const k = strip(name);
  for (const [re, color] of RULES) if (re.test(k)) return color;
  return "#FFD599";
}
