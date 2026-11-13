/**
 * Chave de um perfume para comparar nomes de fornecedores, do nosso catálogo e
 * do índice Fragrantica: palavras do nome sem marca, volume, "EDP" etc.,
 * em ordem alfabética. "Bade'e Al Oud Black Exposed Lattafa 100ml" e
 * "Black Exposed" dão a mesma chave (a linha "Bade'e Al Oud" sai).
 */
export const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const BRAND_PHRASES =
  /\b(paris corner|maison alhamb?ara|al wataniah|french avenue|aurora scents|neeche house|ard al zaaf?ra?n|anfar london|maison asrar|elite risala|arabi?y?a?t prestige|abdul samad al qurashi|isabell?e la belle|al haramain|le bon?u?he?u?r|al ambara?|rue broca|fragrance world)\b/g;
const DROP = new Set(
  "edp edt parfum extrait extrato eau de da di do la le el al the of and e ml perfume perfumes compartilhavel masculino feminino unissex pour lattafa pride armaf maison alhambra wataniah alwataniah afnan rasasi rayhaan orientica haramain alharamain mawwal riiffs riffs zimaya asdaaf hamidi bidaya adyan anfar bharara amaran nusuk khadlaj volare nayaat luxury edition limited spray tradicional new original lacrado tester l vc compartilhavel borouj nabeel emper aramois aramios laffair".split(
    " ",
  ),
);
const FIX: Record<string, string> = { supermacy: "supremacy", dubia: "dubai", pharoah: "pharaoh", laventure: "aventure", bade: "badee", musammam: "musamam", nui: "nuit", silage: "sillage", sparay: "spray", bodysparay: "bodyspray", hidratande: "hidratante" };

/** Chave do perfume: palavras do nome sem marca, volume e "EDP" (mesma regra da ligação no banco). */
export function perfumeKey(name: string) {
  const words = ` ${plain(name).replace(/['’`´]/g, "").replace(/[^a-z0-9]+/g, " ")} `
    .replace(BRAND_PHRASES, " ")
    // linha "Bade'e Al Oud": o nome do perfume é o que vem depois
    .replace(/\bbade+e? ?al oud\b/g, " ")
    .split(" ")
    .map((w) => FIX[w] ?? w)
    .filter((w) => w && !DROP.has(w) && !/^\d+(ml|g)?$/.test(w));
  return [...new Set(words)].sort().join(" ");
}

/** Mesma palavra com 1 letra de diferença (ex.: tiramesu × tiramisu), só em palavras longas. */
function near(a: string, b: string) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1 || a[0] !== b[0]) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Quão certo é que duas chaves são o mesmo perfume (0–1).
 * 1 = mesmas palavras (aceita 1 letra trocada em palavra longa: tiramesu ×
 * tiramisu). Palavra sobrando baixa a nota — "Asad" × "Asad Elixir" = 0,5.
 */
const GENDER: Record<string, string> = { man: "m", men: "m", him: "m", homme: "m", woman: "f", women: "f", her: "f", femme: "f" };

export function keyMatch(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = a.split(" ");
  const B = b.split(" ");
  // masculino × feminino do mesmo nome nunca é o mesmo perfume
  const ga = new Set(A.map((w) => GENDER[w]).filter(Boolean));
  const gb = new Set(B.map((w) => GENDER[w]).filter(Boolean));
  if (ga.size && gb.size && ![...ga].some((g) => gb.has(g))) return 0;
  const used = new Set<number>();
  let hit = 0;
  for (const x of A) {
    const j = B.findIndex((y, k) => !used.has(k) && near(x, y));
    if (j >= 0) {
      used.add(j);
      hit++;
    }
  }
  // palavra a mais costuma ser outra versão (Elixir, Intense, Blue…): não conta como igual
  return hit / Math.max(A.length, B.length);
}

/** Melhor candidato por chave usando um índice de palavras (rápido para milhares de nomes). */
export function makeKeyIndex<T>(items: Array<{ key: string; item: T }>) {
  const exact = new Map<string, T[]>();
  const byWord = new Map<string, number[]>();
  items.forEach(({ key }, i) => {
    if (!key) return;
    (exact.get(key) ?? exact.set(key, []).get(key)!).push(items[i]!.item);
    for (const w of new Set(key.split(" "))) (byWord.get(w) ?? byWord.set(w, []).get(w)!).push(i);
  });
  return {
    exact: (key: string) => exact.get(key) ?? [],
    best: (key: string, min = 0.8, accept: (item: T) => boolean = () => true) => {
      if (!key) return null;
      const hit = (exact.get(key) ?? []).find(accept);
      if (hit) return { item: hit, score: 1 };
      const seen = new Set<number>();
      let best: { item: T; score: number } | null = null;
      for (const w of key.split(" ")) {
        if (w.length < 3) continue;
        for (const i of byWord.get(w) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const cand = items[i]!;
          if (!accept(cand.item)) continue;
          const sc = keyMatch(key, cand.key);
          if (sc >= min && (!best || sc > best.score)) best = { item: cand.item, score: sc };
        }
      }
      return best;
    },
  };
}

/* ─────────────── versão: concentração e edição ─────────────── */

export type Variant = { conc: "EDT" | "EDP" | "PARFUM" | "EXTRAIT" | "COLOGNE" | null; limited: boolean };

/** concentração escrita no nome ou no campo (EDT ≠ EDP ≠ Parfum ≠ Extrait) */
export function concOf(...texts: Array<string | null | undefined>): Variant["conc"] {
  for (const t of texts) {
    const s = ` ${plain(String(t ?? "")).replace(/[^a-z0-9]+/g, " ")} `;
    if (/ (extrait|extrato|elixir de parfum) /.test(s)) return "EXTRAIT";
    if (/ (edt|eau de toilette|toilette) /.test(s)) return "EDT";
    if (/ (edc|eau de cologne|cologne) /.test(s)) return "COLOGNE";
    if (/ (edp|eau de parfum|eau de perfume) /.test(s)) return "EDP";
    if (/ (parfum|pure parfum|pure perfume|le parfum) /.test(s)) return "PARFUM";
  }
  return null;
}

export function variantOf(name: string | null | undefined, conc?: string | null): Variant {
  const s = plain(String(name ?? ""));
  return { conc: concOf(conc, name), limited: /\b(limited|edicao limitada|limitada)\b/.test(s) };
}

/**
 * Mesma versão do perfume? Concentração diferente (quando os dois dizem) =
 * produtos diferentes. Ex.: Club de Nuit Intense Man EDT 105ml × EDP × Parfum.
 * "Limited Edition" sozinho NÃO separa: Asad Zanzibar e Odyssey Mega já são
 * edições limitadas e cada fornecedor escreve (ou não) no nome.
 */
export function sameVariant(a: Variant, b: Variant) {
  return !(a.conc && b.conc && a.conc !== b.conc);
}
