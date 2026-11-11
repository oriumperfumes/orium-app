/**
 * ORIUM VOICE ENGINE — limpeza da transcrição (módulo puro, sem banco, sem IA).
 *
 * A transcrição é só uma hipótese. Antes de interpretar, deixamos o texto
 * previsível: números por extenso viram algarismos, "cinco ml" vira 5ml,
 * "picks" vira pix, "decante" vira decant, repetições do reconhecimento somem.
 * O nome do perfume NÃO é corrigido aqui — isso é trabalho do catálogo.
 */
import { dedupeStutter } from "@/lib/store-sales-phonetics";

const stripAccents = (s: string) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19,
};
const TENS: Record<string, number> = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
const HUNDREDS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};
const wordValue = (w: string): number | null => UNITS[w] ?? TENS[w] ?? HUNDREDS[w] ?? (w === "mil" ? 1000 : null);
const isNumWord = (w: string) => wordValue(w) != null || /^\d+$/.test(w);

/** "trezentos e dezenove" → 319, "mil e duzentos" → 1200, "dois e um" continua separado. */
function joinNumbers(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const w = tokens[i]!;
    const v = wordValue(w);
    if (v == null) {
      out.push(w);
      i++;
      continue;
    }
    let total = 0;
    let group = v === 1000 ? 0 : v;
    if (v === 1000) total = 1000;
    let j = i + 1;
    for (;;) {
      const conj = tokens[j] === "e";
      const next = tokens[conj ? j + 1 : j];
      const nv = next != null ? wordValue(next) : null;
      if (nv == null) break;
      if (nv === 1000) {
        total += (group || 1) * 1000;
        group = 0;
        j += conj ? 2 : 1;
        continue;
      }
      // só junta quando a próxima parte "cabe" (centena + dezena, dezena + unidade)
      const fits = (group >= 100 && group % 100 === 0 && nv < 100) || (group >= 20 && group < 100 && group % 10 === 0 && nv < 10) || (group === 0 && total > 0 && nv < 1000);
      if (!conj || !fits) break;
      group += nv;
      j += 2;
    }
    out.push(String(total + group));
    i = j;
  }
  return out;
}

export type Normalized = {
  /** texto limpo em minúsculas, sem acento, com números e unidades padronizados */
  text: string;
  payment: "PIX" | "CARTAO" | "DINHEIRO" | null;
};

/** Limpeza determinística da fala. Rápida (<1ms) e testada. */
export function normalizeTranscript(raw: string): Normalized {
  let s = stripAccents(String(raw ?? "")).toLowerCase();
  s = s.replace(/r\$\s*/g, " rs ").replace(/(\d)\.(\d{3})\b/g, "$1$2");
  s = s.replace(/(\d),(\d{1,2})\b/g, "$1_$2"); // protege decimais
  s = s.replace(/\b(por cento|porcento)\b/g, " pct ").replace(/%/g, " pct ").replace(/[,;]/g, " vrg ");
  s = s.replace(/[^a-z0-9_\s]/g, " ").replace(/\s+/g, " ").trim();
  s = dedupeStutter(s.replace(/_/g, "u")).replace(/(\d)u(\d)/g, "$1_$2");

  let tokens = joinNumbers(s.split(" ").filter(Boolean));
  s = ` ${tokens.join(" ")} `;

  // unidades de volume
  s = s.replace(/ (\d+) ?(ml|mls|mililitros?|eme ele|m l) /g, " $1ml ");
  // percentuais
  s = s.replace(/ (\d+(?:_\d+)?) pct /g, " $1% ").replace(/ pct /g, " % ").replace(/ vrg /g, " , ");
  // preço: "319 e 90" depois de gatilho de preço, "320 reais e 50 centavos"
  s = s.replace(/ (\d+) reais e (\d{1,2}) centavos? /g, (_m, a, b) => ` rs${a}_${String(b).padStart(2, "0")} `);
  s = s.replace(/ (por|a|pra|para|custa|custando|de|rs) (\d+) e (\d{2}) /g, (_m, g, a, b) => ` ${g} rs${a}_${b} `);
  s = s.replace(/ (\d+(?:_\d+)?) reais /g, " rs$1 ").replace(/ rs (\d)/g, " rs$1");
  // pagamento
  s = s.replace(/ (picks|pics|piques|pixe|pix) /g, " pix ");
  s = s.replace(/ (cartao de credito|cartao de debito|no credito|no debito|credito|debito|cartao) /g, " cartao ");
  s = s.replace(/ (dinheiro|especie|em especie|cash) /g, " dinheiro ");
  // variantes
  s = s.replace(/ (decantes|decants|decante|decan|decam|decanti|amostras|amostra) /g, " decant ");
  s = s.replace(/ (frasco lacrado|frasco fechado|lacrados?|lacradas?|fechados?|completos?|inteiros?) /g, " frasco ");
  s = s.replace(/ frasco frasco /g, " frasco ");
  s = s.replace(/\s+/g, " ").trim();

  tokens = s.split(" ");
  const payment = tokens.includes("pix") ? "PIX" : tokens.includes("cartao") ? "CARTAO" : tokens.includes("dinheiro") ? "DINHEIRO" : null;
  return { text: s.replace(/_/g, ","), payment };
}

/** "rs319,90" → 319.9 */
export const moneyOf = (token: string): number | null => {
  const m = token.match(/^rs?(\d+)(?:,(\d{1,2}))?$/) ?? token.match(/^(\d+)(?:,(\d{1,2}))?$/);
  if (!m) return null;
  return Number(`${m[1]}.${(m[2] ?? "0").padEnd(2, "0")}`);
};

export { isNumWord };
