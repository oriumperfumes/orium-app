/**
 * FRAGRANTICA ASSISTED PROVIDER
 *
 * Quando a origem recusa a leitura server-side (HTTP 403), o Admin abre a
 * página no próprio navegador, copia o conteúdo e cola na Orium. Aqui esse
 * conteúdo é interpretado — sem nenhuma nova requisição ao Fragrantica.
 *
 * Aceita dois formatos:
 *  - HTML / markdown da página → reaproveita o leitor V2 completo;
 *  - texto copiado da tela → FragranticaPasteParser (abaixo).
 *
 * Regras: não inventar pirâmide, não inventar intensidade de acorde, preservar
 * a ordem em que o conteúdo foi publicado e guardar o rótulo original.
 */
import {
  extractFromHtml,
  PARSER_VERSION,
  type Extraction,
  type ExtractedNote,
  type ExtractionStatus,
  type Level,
  type NoteStructure,
} from "./fragrantica-v2.server";

export type ParsedPaste = Omit<Extraction, "httpStatus" | "fromCache" | "durationMs">;

const emptyLevels = (): Record<Level, ExtractedNote[]> => ({ TOP: [], HEART: [], BASE: [] });

const keyOf = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");

function looksLikeHtml(raw: string): boolean {
  const head = raw.slice(0, 6000);
  return /<(html|body|div|section|script|meta)\b/i.test(head) || /\]\(https?:\/\//.test(head);
}

/* --------------------------- rótulos de seção ---------------------------- */

type SectionId = "ACCORDS" | "TOP" | "HEART" | "BASE" | "NOTES" | "DESCRIPTION" | "OTHER";

const HEADINGS: Array<[SectionId, RegExp]> = [
  ["ACCORDS", /^(principais\s+acordes|acordes\s+principais|acordes|main\s+accords)\b/i],
  ["TOP", /^notas?\s+de\s+(topo|sa[íi]da|cabe[çc]a)\b|^top\s+notes\b/i],
  ["HEART", /^notas?\s+d[eo]\s+(cora[çc][ãa]o|meio)\b|^(middle|heart)\s+notes\b/i],
  ["BASE", /^notas?\s+de\s+(fundo|base)\b|^base\s+notes\b/i],
  ["NOTES", /^notas?\s*(olfativas)?\s*$|^notes\s*$/i],
  ["DESCRIPTION", /^(sobre|descri[çc][ãa]o|about)\b/i],
];

/** Lixo comum quando se copia a tela inteira. */
const JUNK =
  /^(fragrantica|perfume|perfumes|resenhas?|coment[áa]rios?|votos?|classifica[çc][ãa]o|imagem|fotos?|mostrar mais|ver mais|read more|compartilhar|an[úu]ncio|publicidade|loja|comprar|onde comprar|pir[âa]mide olfativa|not[ei]s?)$/i;

function cleanItem(raw: string): string | null {
  let s = raw
    .replace(/\[[^\]]*\]\([^)]*\)/g, (m) => m.replace(/^\[/, "").replace(/\]\([^)]*\)$/, ""))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*•·|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, "")
    .trim();
  if (!s) return null;
  if (/^\d+([.,]\d+)?%?$/.test(s)) return null;
  if (s.length < 2 || s.length > 48) return null;
  if (JUNK.test(s)) return null;
  if (/\d{3,}/.test(s)) return null;
  return titleCase(s.toLowerCase());
}

function toNotes(items: string[]): ExtractedNote[] {
  const out: ExtractedNote[] = [];
  for (const raw of items) {
    const label = cleanItem(raw);
    if (!label) continue;
    if (out.some((n) => keyOf(n.label) === keyOf(label))) continue;
    out.push({ label, sourceLabel: raw.trim(), externalId: null, imageUrl: null, sourceUrl: null });
    if (out.length >= 30) break;
  }
  return out;
}


/** Uma frase (com verbo/pontuação e muitas palavras) nunca é um nome de nota. */
function isProse(line: string): boolean {
  const words = line.split(/\s+/).length;
  if (line.length >= 90) return true;
  return line.length >= 60 && words >= 10 && /[.!?;]/.test(line);
}

/** Divide uma linha/bloco em itens (vírgula, ponto e vírgula, bullets, quebras). */
function splitItems(block: string): string[] {
  return block
    .split(/\n|,|;|\u2022|\s+e\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * FragranticaPasteParser — interpreta o texto copiado da página.
 * Tolerante a espaços, linhas repetidas e conteúdo extra ao redor.
 */
export function parsePastedText(raw: string) {
  const lines = String(raw ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim());

  const blocks = new Map<SectionId, string[]>();
  const prose: string[] = [];
  let current: SectionId = "OTHER";

  for (const line of lines) {
    if (!line) continue;
    const hit = HEADINGS.find(([, re]) => re.test(line));
    if (hit) {
      current = hit[0];
      // conteúdo na mesma linha do título ("Notas de Topo: bergamota, limão")
      const rest = line.replace(hit[1], "").replace(/^[:\-–—\s]+/, "").trim();
      if (rest) blocks.set(current, [...(blocks.get(current) ?? []), rest]);
      continue;
    }
    if (current === "OTHER" || current === "DESCRIPTION") {
      if (line.length >= 60) prose.push(line);
      if (current === "DESCRIPTION") blocks.set("DESCRIPTION", [...(blocks.get("DESCRIPTION") ?? []), line]);
      continue;
    }
    // Frase corrida dentro de uma seção de notas é texto descritivo, não nota.
    if (isProse(line)) {
      prose.push(line);
      continue;
    }
    blocks.set(current, [...(blocks.get(current) ?? []), line]);
  }

  const items = (id: SectionId) => splitItems((blocks.get(id) ?? []).join("\n"));

  const accordNotes = toNotes(items("ACCORDS"));
  const levels = emptyLevels();
  levels.TOP = toNotes(items("TOP"));
  levels.HEART = toNotes(items("HEART"));
  levels.BASE = toNotes(items("BASE"));
  const flat = levels.TOP.length || levels.HEART.length || levels.BASE.length ? [] : toNotes(items("NOTES"));

  const descriptionBlock = (blocks.get("DESCRIPTION") ?? []).join(" ").trim();
  const description = (descriptionBlock.length >= 60 ? descriptionBlock : prose.join(" ")).trim();

  return { accords: accordNotes.map((n) => n.label), levels, flat, description: description || null };
}

/** Interpreta o conteúdo fornecido pelo Admin (texto ou HTML) — sem acessar a fonte. */
export function parsePastedContent(content: string, url: string): ParsedPaste {
  const raw = String(content ?? "");
  if (looksLikeHtml(raw)) {
    const result = extractFromHtml(raw, url);
    return {
      ...result,
      importMethod: "MANUAL_ASSISTED",
      parserRan: true,
      blocked: false,
      failure: null,
      sourceDescription: extractProse(raw),
    };
  }

  const parsed = parsePastedText(raw);
  const pyramidCount = parsed.levels.TOP.length + parsed.levels.HEART.length + parsed.levels.BASE.length;
  const structure: NoteStructure = pyramidCount ? "PYRAMID" : parsed.flat.length ? "FLAT" : "NONE";
  const totalNotes = pyramidCount || parsed.flat.length;

  const issues: string[] = [];
  if (!parsed.accords.length) issues.push("Nenhum acorde reconhecido no conteúdo colado.");
  if (!totalNotes) issues.push("Nenhuma nota olfativa reconhecida no conteúdo colado.");
  if (pyramidCount && (!parsed.levels.TOP.length || !parsed.levels.BASE.length))
    issues.push("Pirâmide incompleta no conteúdo colado.");
  if (!parsed.description) issues.push("Nenhum texto descritivo no conteúdo colado.");

  const complete = parsed.accords.length > 0 && pyramidCount > 0 && !!parsed.levels.TOP.length && !!parsed.levels.BASE.length;
  const status: ExtractionStatus = !parsed.accords.length && !totalNotes ? "FAILED" : complete ? "COMPLETE" : "PARTIAL";

  const completeness = Math.min(
    100,
    (parsed.accords.length ? 25 : 0) +
      Math.min(45, totalNotes * 5) +
      (structure === "PYRAMID" ? 20 : structure === "FLAT" ? 8 : 0) +
      (parsed.description ? 10 : 0),
  );

  return {
    ok: status !== "FAILED",
    error:
      status === "FAILED"
        ? "O conteúdo colado não trouxe acordes nem notas. Copie a parte da página com Principais Acordes e a pirâmide olfativa."
        : null,
    url,
    parserVersion: `${PARSER_VERSION}-assistido`,
    identity: { perfumeName: null, brand: null, gender: null, concentration: null, family: null },
    // ordem preservada; sem intensidade inventada
    accords: parsed.accords.map((name, position) => ({ name, intensity: 0.6, color: null, position })),
    structure,
    levels: parsed.levels,
    flat: parsed.flat,
    noteImages: [],
    strategies: [
      {
        id: "P",
        label: "Conteúdo colado pelo Admin",
        ok: totalNotes > 0 || parsed.accords.length > 0,
        notes: totalNotes,
        detail: "interpretação do texto fornecido, sem acessar a fonte",
      },
    ],
    strategyUsed: "P",
    conflict: { detected: false, detail: null },
    status,
    completeness,
    issues,
    blocked: false,
    failure: null,
    parserRan: true,
    importMethod: "MANUAL_ASSISTED",
    sourceDescription: parsed.description,
  };
}

/** Texto corrido de um HTML colado (usado como base fiel da descrição). */
function extractProse(html: string): string | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length >= 60);
  const picked = sentences.slice(0, 6).join(" ").trim();
  return picked.length >= 60 ? picked.slice(0, 1200) : null;
}
