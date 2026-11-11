/**
 * Descrição própria da Orium ("Sobre esta fragrância").
 *
 * Regras: nada é copiado da fonte e nada de performance inventada (fixação,
 * projeção, elogios). O texto é construído apenas a partir de fatos que já
 * temos no banco: acordes, pirâmide, família olfativa, gênero e concentração.
 */

type Db = { from: (t: string) => any };

export type DescriptionInput = {
  name: string;
  brand: string | null;
  gender: string | null;
  concentration: string | null;
  family: string | null;
  accords: string[];
  top: string[];
  heart: string[];
  base: string[];
};

export type DescriptionResult =
  | { ok: true; text: string; reason: string }
  | { ok: false; text: null; reason: string };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const list = (items: string[], max = 3) => {
  const l = items.slice(0, max).map((i) => i.toLowerCase());
  if (l.length <= 1) return l[0] ?? "";
  return `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`;
};

/** Perfil derivado dos acordes — sem exagero, só o que os dados dizem. */
const PROFILES: Array<[RegExp, string]> = [
  [/doce|baunilha|caramelo|gourmand|chocolate|acucar|mel/, "doce"],
  [/amadeirado|madeira|sandalo|cedro|vetiver|oud/, "amadeirado"],
  [/citric|citrico|fresco|aquatico|marinho|aromatico|verde/, "fresco"],
  [/especiar|especiado|canela|cardamomo|pimenta/, "especiado"],
  [/floral|rosa|jasmim|flor/, "floral"],
  [/ambar|balsamic|balsamico|resina|incenso/, "envolvente"],
  [/couro|tabaco|fumaca|defumado/, "marcante"],
  [/almiscar|musk|pudor|talco/, "aveludado"],
  [/frutado|fruta|tropical|coco/, "frutado"],
];

function profileWords(accords: string[]): string[] {
  const hay = norm(accords.join(" "));
  const out: string[] = [];
  for (const [re, word] of PROFILES) if (re.test(hay) && !out.includes(word)) out.push(word);
  return out;
}

function genderPhrase(gender: string | null): string {
  const g = (gender ?? "").toLowerCase();
  if (g.startsWith("masc")) return "de assinatura masculina";
  if (g.startsWith("fem")) return "de assinatura feminina";
  if (g.startsWith("uni")) return "de uso unissex";
  return "";
}

function occasionPhrase(profile: string[]): string {
  if (profile.includes("fresco")) return "Combina bem com o dia a dia, calor e uso durante o dia.";
  if (profile.includes("doce") || profile.includes("envolvente")) return "Funciona melhor à noite e em climas mais frios.";
  if (profile.includes("amadeirado") || profile.includes("marcante")) return "Boa escolha para o fim do dia e ocasiões mais formais.";
  if (profile.includes("floral")) return "Fica agradável no dia a dia e em ocasiões sociais.";
  return "";
}

const CONCENTRATION_LABEL: Record<string, string> = {
  EDP: "eau de parfum",
  EDT: "eau de toilette",
  EDC: "eau de cologne",
  PARFUM: "parfum",
  EXTRAIT: "extrait de parfum",
};

/** Monta o texto. Devolve null quando não há base suficiente. */
export function buildDescription(input: DescriptionInput): DescriptionResult {
  const accords = input.accords.filter(Boolean);
  const hasPyramid = input.top.length + input.heart.length + input.base.length > 0;
  if (accords.length < 2 && !hasPyramid) {
    return { ok: false, text: null, reason: "dados olfativos insuficientes" };
  }

  const profile = profileWords(accords);
  const paragraphs: string[] = [];

  /* 1 — abertura: identidade + caráter geral */
  const family = input.family ? input.family.toLowerCase() : "";
  const gp = genderPhrase(input.gender);
  const character = profile.length ? list(profile, 3) : family || list(accords, 2);
  const conc = input.concentration ? CONCENTRATION_LABEL[input.concentration.toUpperCase()] ?? null : null;
  paragraphs.push(
    [
      `${input.name}${input.brand ? `, da ${input.brand}` : ""}, é uma fragrância ${character}`,
      gp ? ` ${gp}` : "",
      family && !profile.includes(family) ? `, dentro do universo ${family}` : "",
      conc ? `, em versão ${conc}` : "",
      ".",
    ].join(""),
  );

  /* 2 — desenvolvimento real, camada por camada */
  if (hasPyramid) {
    const parts: string[] = [];
    if (input.top.length) parts.push(`abre com ${list(input.top, 3)}`);
    if (input.heart.length) parts.push(`no coração traz ${list(input.heart, 3)}`);
    if (input.base.length) parts.push(`e se apoia em ${list(input.base, 3)}`);
    paragraphs.push(`${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.`);
  } else if (accords.length) {
    paragraphs.push(`Os acordes mais presentes são ${list(accords, 4)}.`);
  }

  /* 3 — leitura do conjunto (sem prometer desempenho) */
  if (hasPyramid && accords.length) {
    paragraphs.push(`No conjunto, a impressão é ${list(profile.length ? profile : accords, 2)}, com destaque para ${list(accords, 2)}.`);
  }

  /* 4 — uso sugerido, apenas quando o perfil sustenta */
  const occasion = occasionPhrase(profile);
  if (occasion) paragraphs.push(occasion);

  const text = paragraphs.filter(Boolean).join("\n\n").replace(/\s+([.,])/g, "$1").trim();
  if (text.length < 120) return { ok: false, text: null, reason: "texto curto demais" };
  return { ok: true, text, reason: "descrição gerada a partir dos dados olfativos" };
}

/* --------------------------- verificação final --------------------------- */

let seenCache: { at: number; keys: Set<string> } | null = null;

async function seenDescriptions(db: Db): Promise<Set<string>> {
  if (seenCache && Date.now() - seenCache.at < 120_000) return seenCache.keys;
  const keys = new Set<string>();
  const { data } = await db.from("fragrance_details").select("description").not("description", "is", null).limit(2000);
  for (const row of (data ?? []) as Array<{ description: string | null }>) {
    if (row.description) keys.add(norm(row.description).slice(0, 160));
  }
  seenCache = { at: Date.now(), keys };
  return keys;
}

/** Valida (vazia, duplicada, genérica, outro perfume) antes de salvar. */
export async function qualityCheck(
  db: Db,
  input: DescriptionInput,
  text: string,
): Promise<{ ok: boolean; reason: string }> {
  if (text.trim().length < 120) return { ok: false, reason: "texto curto demais" };
  const key = norm(text).slice(0, 160);
  const seen = await seenDescriptions(db);
  if (seen.has(key)) return { ok: false, reason: "descrição igual a de outro perfume" };
  if (!norm(text).includes(norm(input.name).split(" ")[0] ?? "")) {
    return { ok: false, reason: "texto não menciona o próprio perfume" };
  }
  seen.add(key);
  return { ok: true, reason: "aprovada" };
}
