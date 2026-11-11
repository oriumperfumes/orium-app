/**
 * Entende a MENSAGEM do Admin (nunca calcula nada).
 * Listas coladas são lidas por regras; frases soltas usam a IA só para
 * extrair nomes de perfumes e quantidades.
 */
import { parseListLine } from "./compare.server";

export type Intent =
  | { kind: "compare"; items: Array<{ name: string; quantity: number }>; replace: boolean }
  | { kind: "add_to_restock"; option: "cheapest" | "fewest" }
  | { kind: "route" }
  | { kind: "fewest" }
  | { kind: "totals" }
  | { kind: "exclude"; supplier: string }
  | { kind: "swap"; product: string; supplier: string }
  | { kind: "history"; product: string | null }
  | { kind: "only_stock" }
  | { kind: "help" };

const n = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function commandIntent(msg: string, supplierNames: string[]): Intent | null {
  const t = n(msg).trim();
  const supplierIn = (s: string) =>
    supplierNames.find((name) => {
      const k = n(name);
      return s.includes(k) || s.includes(k.split(" ")[0]!);
    }) ?? null;

  if (/(adicion|coloc|mand|jog).*(reposic)/.test(t))
    return { kind: "add_to_restock", option: /(dois|menos|2)\s*fornecedor/.test(t) ? "fewest" : "cheapest" };
  if (/(monte|montar|fazer|faz|otimiz|calcul).*(rota)|^rota\b/.test(t)) return { kind: "route" };
  let m = t.match(/(?:troca|trocar|muda|mudar|passa|passar)\s+(?:o|a)?\s*(.+?)\s+(?:para|pra|pro)\s+(?:a|o)?\s*(.+)$/);
  if (m) {
    const s = supplierIn(m[2]!);
    if (s) return { kind: "swap", product: m[1]!.trim(), supplier: s };
  }
  if (/(sem|nao for|nao ir|tirar|tira|excluir|sem passar).*(na|no|a|o)?\s/.test(t) && /se eu nao|sem a |sem o |tira a|tirar a|excluir/.test(t)) {
    const s = supplierIn(t);
    if (s) return { kind: "exclude", supplier: s };
  }
  if (/(dois|2|menos)\s+fornecedor|so em (dois|2)/.test(t)) return { kind: "fewest" };
  if (/quanto (vou gastar|economiz|fica)|menor preco de cada|total/.test(t) && t.length < 60) return { kind: "totals" };
  if (/so (mostra|os que)|apenas (os )?disponiveis|tem estoque/.test(t) && t.length < 60) return { kind: "only_stock" };
  m = t.match(/(?:o|a)?\s*(.+?)\s+(?:baixou|subiu|mudou de preco)|historico(?: de preco)?(?: do| da)?\s*(.*)$/);
  if (m) return { kind: "history", product: (m[1] || m[2] || "").trim() || null };
  return null;
}

/** Lista colada (várias linhas ou separada por vírgulas). */
export function listIntent(msg: string): Intent | null {
  const lines = msg
    .split(/\n|;|,(?!\d)/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const items = lines.map(parseListLine).filter(Boolean) as Array<{ name: string; quantity: number }>;
  return items.length ? { kind: "compare", items, replace: true } : null;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "add_to_existing"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity"],
        properties: {
          name: { type: "string", description: "nome do perfume como escrito, sem inventar versão" },
          quantity: { type: "integer" },
        },
      },
    },
    add_to_existing: { type: "boolean", description: "true quando a pessoa pede para acrescentar à lista atual" },
  },
} as const;

const SYSTEM = `Você lê mensagens de um comprador de perfumes e extrai SOMENTE os perfumes citados e as quantidades.
- Nunca complete versões: "Yara" continua "Yara", nunca "Yara Elixir". "Club de Nuit" continua "Club de Nuit".
- Remova palavras de pergunta ("quanto está", "onde está mais barato", "compare", "tem ... na KL?").
- Não inclua nomes de fornecedores (KL, MRX, Smart Mania) como perfume.
- Quantidade não dita = 1.
- Se não houver perfume, devolva items vazio.`;

export async function aiExtract(message: string): Promise<{ items: Array<{ name: string; quantity: number }>; add: boolean }> {
  const { aiJson } = await import("@/lib/ai/engine.server");
  const text = JSON.stringify(
    await aiJson({ feature: "purchase_intent", profile: "economy", system: SYSTEM, prompt: message, schema: { name: "compra", schema: SCHEMA as never } }),
  );
  try {
    const j = JSON.parse(text.trim());
    return {
      items: (j.items ?? [])
        .filter((i: any) => typeof i?.name === "string" && i.name.trim().length > 1)
        .map((i: any) => ({ name: i.name.trim(), quantity: Math.max(1, Math.min(999, Number(i.quantity) || 1)) })),
      add: j.add_to_existing === true,
    };
  } catch {
    return { items: [], add: false };
  }
}
