/**
 * Versões (flankers) de uma mesma linha de perfume.
 *
 * "Yara" e "Yara Elixir" são perfumes DIFERENTES. Estas palavras identificam a
 * versão e por isso têm peso alto: se um lado tem e o outro não, os produtos
 * nunca são unificados automaticamente.
 */

const stripAccents = (s: string) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Palavra normalizada para comparação (sem acento, minúscula). */
export const flankerWord = (s: string) =>
  stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Termos que identificam versão/edição dentro da mesma linha. */
export const FLANKER_TERMS = new Set(
  [
    // concentrações usadas como versão
    "elixir",
    "extrait",
    "absolu",
    "absolute",
    "parfum",
    "intense",
    "intenso",
    "ultra",
    "supreme",
    "prive",
    "prestige",
    "exclusif",
    "essence",
    "essential",
    // cores e materiais
    "black",
    "noir",
    "white",
    "blanc",
    "blue",
    "bleu",
    "red",
    "rouge",
    "rose",
    "pink",
    "green",
    "vert",
    "gold",
    "golden",
    "silver",
    "platinum",
    "platine",
    "bronze",
    "cristal",
    "crystal",
    "ambre",
    "amber",
    "oud",
    "musk",
    "vanilla",
    "bourbon",
    "candy",
    "honey",
    "coffee",
    "chocolate",
    // versões de linha
    "tous",
    "moi",
    "iconic",
    "sillage",
    "milestone",
    "urban",
    "legacy",
    "sport",
    "aqua",
    "aquatic",
    "fresh",
    "summer",
    "winter",
    "night",
    "nuit",
    "day",
    "royal",
    "imperial",
    "limited",
    "edition",
    "collector",
    "reserve",
    "classic",
    "vintage",
    "qahwa",
    "dukhan",
    "waha",
    "electric",
    "kobra",
    "zanzibar",
    "precieux",
    "sillage",
    "milestone",
    "collectors",
    "silver",
    "blue",
    // gênero quando faz parte do nome oficial
    "homme",
    "femme",
    "man",
    "men",
    "woman",
    "women",
    "her",
    "him",
  ].map(flankerWord),
);

/**
 * Concentração escrita como "Eau de Parfum"/"EDP" é só concentração — não versão.
 * Remove essas expressões para que "Parfum" sozinho continue valendo como versão.
 */
export function stripConcentrationPhrases(name: string): string {
  return (name ?? "")
    .replace(/\beaux?\s+(de\s+)?(parfum|toilette|cologne|fraiche|fresh)\b/gi, " ")
    .replace(/\bagua\s+de\s+(perfume|colonia)\b/gi, " ")
    .replace(/\bed[ptc]\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Termos de versão presentes no nome, em ordem alfabética. */
export function flankerTerms(name: string): string[] {
  const found = new Set<string>();
  const clean = stripConcentrationPhrases(name ?? "");
  for (const w of stripAccents(clean).toLowerCase().split(/[^a-z0-9]+/)) {
    const k = flankerWord(w);
    if (k && FLANKER_TERMS.has(k)) found.add(k);
  }
  return Array.from(found).sort();
}


/** Versões diferentes entre os dois nomes (o que existe em um e não no outro). */
export function flankerDifference(a: string, b: string): string[] {
  const fa = new Set(flankerTerms(a));
  const fb = new Set(flankerTerms(b));
  const diff = [
    ...[...fa].filter((t) => !fb.has(t)),
    ...[...fb].filter((t) => !fa.has(t)),
  ];
  return Array.from(new Set(diff)).sort();
}
