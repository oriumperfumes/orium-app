/**
 * COMO A ORIUM OUVE OS NOMES DOS PERFUMES.
 *
 * O reconhecimento de voz escreve o que ouviu, não o nome oficial: "açaí bourbon"
 * é Asad Bourbon, "lique de lique de bran" é Liquid Brun. Aqui a fala é limpa
 * (gagueira, números falados, palavras de embalagem) e traduzida para uma forma
 * sonora tolerante ao português falado, para depois ser comparada com o catálogo.
 *
 * Módulo puro: nenhuma consulta ao banco, nenhuma decisão de venda.
 */

const stripAccents = (s: string) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Palavras que não identificam o perfume. */
const NOISE = new Set([
  "de","do","da","dos","das","o","a","os","as","um","uma","e","the","of","le","la","du","des",
  "perfume","perfumes","frasco","frascos","lacrado","lacrada","fechado","fechada","completo","completa",
  "inteiro","inteira","decant","decants","decante","decantes","amostra","amostras","ml","mls",
  "vendi","vendido","vendeu","venda","cliente","reais","real","pix","cartao","dinheiro","credito","debito",
  "eu","foi","era","sendo","no","na","nos","nas","pelo","pela","por","com","para","mais","tambem",
]);

/** Números falados → dígito (só para entender quantidade, nunca tamanho). */
export const SPOKEN_NUMBERS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20,
};

/** minúsculas, sem acento, sem pontuação, espaços normais */
export const flat = (s: string) =>
  stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export const words = (s: string) => flat(s).split(" ").filter(Boolean);

/**
 * Remove repetições anormais do reconhecimento: "lique de lique de bran",
 * "asad asad bourbon", "club club de nuit".
 */
export function dedupeStutter(input: string): string {
  let list = words(input);
  for (let size = 3; size >= 1; size--) {
    const out: string[] = [];
    let i = 0;
    while (i < list.length) {
      const block = list.slice(i, i + size).join(" ");
      const next = list.slice(i + size, i + size * 2).join(" ");
      if (block && block === next && block.length > 1) {
        // pula a repetição e continua conferindo mais repetições do mesmo bloco
        while (list.slice(i + size, i + size * 2).join(" ") === block) i += size;
      }
      out.push(...list.slice(i, i + size));
      i += size;
    }
    list = out;
  }
  return list.join(" ");
}

/** Tokens que realmente identificam o perfume (sem ruído nem número). */
export function contentTokens(input: string): string[] {
  return words(dedupeStutter(input)).filter(
    (w) => !NOISE.has(w) && !(w in SPOKEN_NUMBERS) && !/^\d+$/.test(w) && w.length > 1,
  );
}

/**
 * Forma sonora de uma palavra, pensada para brasileiro falando nomes
 * estrangeiros: sibilantes juntas (s/c/ç/z/ss), k/qu/c-dura juntas, h muda,
 * vogais colapsadas. "asad"→"asad", "acai"→"asa", "liquid"→"lakad",
 * "brun"/"bran"/"brã"→"bran", "bourbon"/"burbon"→"barban".
 */
export function phoneticWord(word: string, cAs: "k" | "s" = "k"): string {
  let s = flat(word).replace(/\s+/g, "");
  if (!s) return "";
  s = s
    .replace(/ph/g, "f")
    .replace(/lh/g, "l")
    .replace(/nh/g, "n")
    .replace(/[cs]h/g, "x")
    .replace(/qu/g, "k")
    .replace(/q/g, "k")
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    .replace(/h/g, "")
    .replace(/c([ei])/g, "s$1")
    .replace(/c/g, cAs)
    .replace(/g([ei])/g, "j$1")
    .replace(/z/g, "s")
    .replace(/ss/g, "s")
    .replace(/x/g, "s")
    .replace(/([bcdfgjklmnprstv])\1+/g, "$1")
    .replace(/[mn]([bcdfgjklprstv]|$)/g, "n$1")
    .replace(/[aeiou]+/g, "a")
    .replace(/a$/g, "a");
  return s;
}

/** "açaí" pode ser "aka" ou "asa" na boca de quem fala: testamos as duas leituras. */
function phoneticVariants(word: string): string[] {
  const k = phoneticWord(word, "k");
  const flatWord = flat(word);
  if (!/c/.test(flatWord)) return [k];
  const s = phoneticWord(word, "s");
  return s === k ? [k] : [k, s];
}

export const phoneticKey = (text: string) => contentTokens(text).map((w) => phoneticWord(w)).join(" ");

/** Distância de edição limitada (rápida o bastante para o catálogo inteiro). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 4) return 99;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] as number;
      prev[j] = Math.min((prev[j] as number) + 1, (prev[j - 1] as number) + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length] as number;
}

/** Quão parecidas duas palavras soam (0–1). */
export function wordAffinity(spoken: string, target: string): number {
  if (!spoken || !target) return 0;
  if (spoken === target) return 1;
  const textDist = editDistance(spoken, target);
  const textOk = textDist <= (Math.max(spoken.length, target.length) >= 6 ? 2 : 1);
  let best = 0;
  for (const ps of phoneticVariants(spoken)) {
    for (const pt of phoneticVariants(target)) {
      if (ps && ps === pt) {
        best = Math.max(best, textOk ? 0.98 : 0.94);
        continue;
      }
      const phonDist = editDistance(ps, pt);
      // tolerância curta: nomes de flanker não podem virar um ao outro
      const tolerance = Math.max(pt.length, ps.length) >= 8 ? 2 : 1;
      if (phonDist <= tolerance) {
        best = Math.max(best, 0.9 - 0.06 * phonDist);
        continue;
      }
      const shared = Math.min(ps.length, pt.length);
      let same = 0;
      while (same < shared && ps[same] === pt[same]) same++;
      if (same >= 4 && same / Math.max(ps.length, pt.length) >= 0.75) best = Math.max(best, 0.7);

    }
  }
  if (best === 0 && textOk) best = 0.9 - 0.05 * textDist;
  return best;

}

export type NameAffinity = {
  /** 0–1: o quanto o nome do catálogo explica a fala e vice-versa */
  score: number;
  coverSpoken: number;
  coverTarget: number;
};

/**
 * Compara a fala com um nome do catálogo. Flanker pesa muito: palavras do
 * catálogo que a fala não disse derrubam o score (por isso "Asad" perde para
 * "Asad Bourbon" quando "bourbon" foi dito, e ganha quando não foi).
 */
export function nameAffinity(spokenTokens: string[], targetName: string): NameAffinity {
  const target = contentTokens(targetName);
  if (spokenTokens.length === 0 || target.length === 0) return { score: 0, coverSpoken: 0, coverTarget: 0 };

  const used = new Set<number>();
  let spokenHit = 0;
  let quality = 0;
  for (const s of spokenTokens) {
    let bestIndex = -1;
    let best = 0;
    target.forEach((t, i) => {
      if (used.has(i)) return;
      const a = wordAffinity(s, t);
      if (a > best) {
        best = a;
        bestIndex = i;
      }
    });
    if (best >= 0.7 && bestIndex >= 0) {
      used.add(bestIndex);
      spokenHit++;
      quality += best;
    }
  }
  if (spokenHit === 0) return { score: 0, coverSpoken: 0, coverTarget: 0 };

  const coverSpoken = spokenHit / spokenTokens.length;
  const coverTarget = used.size / target.length;
  const avgQuality = quality / spokenHit;
  const score = (0.55 * coverSpoken + 0.45 * coverTarget) * avgQuality;
  return { score, coverSpoken, coverTarget };
}

/** "frasco lacrado", "fechado", "completo" → frasco; "decant", "amostra" → decant. */
export function variantFromSpeech(text: string): "FULL" | "DECANT" | null {
  const t = flat(dedupeStutter(text));
  if (/\b(frasco|lacrad\w*|fechad\w*|complet\w*|inteir\w*|full)\b/.test(t)) return "FULL";
  if (/\b(decant\w*|amostra\w*|dose|dosinha)\b/.test(t) || /\b\d+\s*ml\b/.test(t)) return "DECANT";
  return null;
}
