/** Opções do catálogo, separadas da gaveta de filtros (que carrega sob demanda). */
export type Option = { key: string; label: string; count: number };
export type Availability = "todos" | "em-estoque" | "sem-estoque";
export type SortKey = "relevantes" | "mais-acessados" | "novidades" | "preco-asc" | "preco-desc";

/** Ordenações oferecidas ao cliente — poucas e com nome claro. */
export const SORT_OPTIONS: Array<[SortKey, string]> = [
  ["relevantes", "Mais populares"],
  ["mais-acessados", "Mais acessados"],
  ["novidades", "Novidades"],
  ["preco-asc", "Menor preço"],
  ["preco-desc", "Maior preço"],
];

