export const brl = (value?: number | string | null) =>
  value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));

export const num = (value?: number | string | null) => (value == null ? 0 : Number(value));

export const dateBR = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
};

export const relativeTime = (value?: string | null) => {
  if (!value) return "nunca sincronizado";
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora mesmo";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
};

/** CEP com máscara brasileira: 23810-000 */
export const maskCep = (raw: string) =>
  raw
    .replace(/\D/g, "")
    .slice(0, 8)
    .replace(/(\d{5})(\d)/, "$1-$2");

const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
  49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Telefone brasileiro válido: DDD real + 8 ou 9 dígitos (celular começa com 9). */
export const isValidPhoneBR = (raw: string) => {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length < 10 || d.length > 11) return false;
  if (!DDDS.has(Number(d.slice(0, 2)))) return false;
  if (d.length === 11 && d[2] !== "9") return false;
  return true;
};

/** Versão normalizada para o WhatsApp: 5521977174508 */
export const normalizePhoneBR = (raw: string) => {
  const d = (raw ?? "").replace(/\D/g, "");
  return d ? `55${d}` : "";
};

export const maskPhone = (raw: string) => {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};

export const whatsappLink = (phone?: string | null) => {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/55${d}`;
};

/** Normalização usada pelo motor de identificação de perfumes. */
const NOISE = [
  "perfume",
  "perfumes",
  "masculino",
  "feminino",
  "unissex",
  "original",
  "importado",
  "lacrado",
  "arabe",
  "eau",
  "de",
  "the",
];

/**
 * Cache limitado para funções puras de texto. A sincronização compara cada oferta com
 * todos os produtos (o mesmo nome centenas de vezes): sem cache, é o que consome a CPU
 * da requisição no Worker Free. O resultado é idêntico; só deixa de ser recalculado.
 */
function memoString<R>(fn: (s: string) => R, max = 20000): (s: string) => R {
  const cache = new Map<string, R>();
  return (s) => {
    const hit = cache.get(s);
    if (hit !== undefined) return hit;
    const value = fn(s);
    if (cache.size >= max) cache.clear();
    cache.set(s, value);
    return value;
  };
}

export const normalizeName = memoString((raw: string) =>
  raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NOISE.includes(w))
    .join(" ")
    .trim(),
);

export const extractVolume = memoString((raw: string): number | null => {
  const m = raw.toLowerCase().match(/(\d{2,3})\s*ml/);
  return m?.[1] ? Number(m[1]) : null;
});

export const extractConcentration = memoString((raw: string): string | null => {
  const s = raw.toLowerCase();
  if (/\bextrait\b/.test(s)) return "Extrait";
  if (/\bparfum\b/.test(s) && !/eau de parfum/.test(s)) return "Parfum";
  if (/\bedp\b|eau de parfum/.test(s)) return "EDP";
  if (/\bedt\b|eau de toilette/.test(s)) return "EDT";
  return null;
});

// Conjuntos de bigramas só de leitura (compartilhados pelo cache).
const bigramsOf = memoString((s: string) => {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
});

/** Similaridade textual simples (Dice bigram) — 0 a 1. */
export const similarity = (a: string, b: string) => {
  const A = bigramsOf(a);
  const B = bigramsOf(b);
  if (!A.size || !B.size) return a === b ? 1 : 0;
  let hits = 0;
  A.forEach((g) => B.has(g) && hits++);
  return (2 * hits) / (A.size + B.size);
};

export const matchScore = (a: string, b: string) => {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  const va = extractVolume(a);
  const vb = extractVolume(b);
  const ca = extractConcentration(a);
  const cb = extractConcentration(b);
  if (va && vb && va !== vb) return 0.2;
  if (ca && cb && ca !== cb) return 0.25;
  const base = similarity(na.replace(/\s/g, ""), nb.replace(/\s/g, ""));
  const bonus = (va && vb && va === vb ? 0.05 : 0) + (ca && cb && ca === cb ? 0.05 : 0);
  return Math.min(1, Number((base + bonus).toFixed(3)));
};

/** Exibição elegante do nome: evita gritar em CAIXA ALTA, preserva siglas curtas (EDP, EDT, ML). */
const KEEP_UPPER = new Set(["EDP", "EDT", "EDC", "ML", "XL", "II", "III", "VIP", "NYC", "UAE"]);
export const productTitle = (raw: string | null | undefined) => {
  if (!raw) return "";
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => {
      const bare = word.replace(/[^A-Za-zÀ-ÿ0-9]/g, "");
      if (KEEP_UPPER.has(bare.toUpperCase())) return word.toUpperCase();
      if (/\d/.test(word)) return word.toUpperCase();
      if (word.length <= 2 && word === word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
};

/** Data curta para listas: "Hoje · 14:32", "Ontem · 18:20", "12/09 · 10:14". */
export const listDateTime = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const hour = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return `Hoje · ${hour}`;
  if (d.toDateString() === yesterday.toDateString()) return `Ontem · ${hour}`;
  const day = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${day} · ${hour}`;
};

/** Data completa para telas de detalhe: "12/09/2026 às 10:14". */
export const fullDateTime = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};
