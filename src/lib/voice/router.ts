/**
 * ORIUM VOICE ENGINE — roteador rápido de intenções (puro, sem IA).
 *
 * Pedidos óbvios ("abre pedidos", "tenho 3 liquid brun", "vendi dois asad
 * bourbon de 5 no pix") são entendidos aqui em microssegundos. O que não
 * encaixa com segurança devolve null e segue para o Copilot com IA.
 * Nomes de perfume saem daqui como TEXTO — o catálogo decide o produto.
 */
import { moneyOf } from "./normalize";

export type SaleItemIntent = {
  query: string;
  quantity: number;
  variant: "FULL" | "DECANT" | "UNKNOWN";
  decant_ml: 2 | 5 | 10 | null;
};

export type FastIntent =
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "mic_mode"; mode: "tap" | "hold" }
  | { type: "navigate"; destination: string; order_number: string | null }
  | { type: "summary"; period: "today" | "yesterday" | "7d" | "30d" | "month" }
  | { type: "pending_orders" }
  | { type: "sale"; items: SaleItemIntent[]; payment: "PIX" | "CARTAO" | "DINHEIRO" | null }
  | { type: "stock"; query: string | null; mode: "set" | "add" | "remove"; quantity: number }
  | { type: "price"; query: string | null; price: number }
  | { type: "restock"; query: string; quantity: number }
  | { type: "compare"; query: string }
  | { type: "order_status"; order_number: string; status: "pendente" | "pedido feito" | "entregue" | "cancelado" };

/** "ele", "esse", "este" e similares: produto do contexto. */
const PRONOUN = /^(ele|ela|esse|essa|este|esta|isso|dele|dela|desse|deste|o mesmo|a mesma)$/;
const clean = (s: string) =>
  s
    .replace(/^(o|a|os|as|do|da|dos|das|de|um|uma)\s+/g, "")
    .replace(/\s+(aqui|na loja|em estoque|no estoque|pra mim|por favor|agora)$/g, "")
    .trim();

const NAV: Array<[RegExp, string]> = [
  [/^pedidos? (pendentes?|em aberto)$/, "pedidos_pendentes"],
  [/^pedidos?( feitos?)?$/, "pedidos"],
  [/^(o )?(dashboard|painel|inicio)$/, "dashboard"],
  [/^produtos?$/, "produtos"],
  [/^clientes?$/, "clientes"],
  [/^(reposicao|compras)$/, "reposicao"],
  [/^vendas?( da loja)?$/, "vendas_loja"],
  [/^(precificacao|precos)$/, "precificacao"],
  [/^marcas?$/, "marcas"],
  [/^integridade$/, "integridade"],
  [/^fornecedores?$/, "fornecedores"],
  [/^(rota|rota dos fornecedores)$/, "fornecedores_rota"],
  [/^(configuracoes|ajustes)$/, "configuracoes"],
  [/^ao vivo$/, "aovivo"],
  [/^conversao$/, "conversao"],
  [/^negociac(ao|oes)$/, "negociacao"],
];

function parseSaleItem(part: string): SaleItemIntent | null {
  let t = ` ${part.trim()} `;
  let quantity = 1;
  const q = t.match(/^ (\d{1,2}) /);
  if (q) {
    quantity = Math.max(1, Math.min(99, Number(q[1])));
    t = t.slice(q[0].length - 1);
  }
  let variant: SaleItemIntent["variant"] = "UNKNOWN";
  let ml: SaleItemIntent["decant_ml"] = null;
  const mlm = t.match(/ (2|5|10)ml /) ?? t.match(/ de (2|5|10) ?$/) ?? t.match(/ de (2|5|10) /);
  if (mlm) {
    ml = Number(mlm[1]) as 2 | 5 | 10;
    variant = "DECANT";
    t = t.replace(mlm[0], " ");
  }
  if (/ decant /.test(t)) variant = "DECANT";
  if (/ frasco /.test(t) && variant === "UNKNOWN") variant = "FULL";
  t = t.replace(/ (decant|frasco|unidades?|pecas?) /g, " ").replace(/\s+/g, " ");
  const query = clean(t.trim().replace(/^(de|do|da)\s+/, ""));
  if (query.replace(/\s/g, "").length < 3) return null;
  return { query, quantity, variant, decant_ml: ml };
}

/**
 * Venda: "vendi 2 decant de 5ml do acai bourbon e 1 frasco do lique de bran no pix".
 * Itens são separados por vírgula ou por " e " seguido de quantidade.
 */
function parseSale(rest: string, payment: "PIX" | "CARTAO" | "DINHEIRO" | null): FastIntent | null {
  const body = rest
    .replace(/\s*(no|em|pelo|via|pagou|pagamento|pago|foi)?\s*(no |em |pelo |via )?(pix|cartao|dinheiro)\b/g, " ")
    .replace(/\s+(pra|para) (um|uma|o|a) cliente.*$/, "")
    .trim();
  const parts = body.split(/\s*,\s*|\s+e\s+(?=\d)|\s+mais\s+(?=\d)/).filter(Boolean);
  const items = parts.map(parseSaleItem).filter((x): x is SaleItemIntent => !!x);
  if (!items.length || items.length !== parts.length) return null;
  return { type: "sale", items: items.slice(0, 12), payment };
}

export function routeIntent(text: string, payment: "PIX" | "CARTAO" | "DINHEIRO" | null): FastIntent | null {
  const t = text.trim().replace(/[.!?]+$/, "");
  if (!t) return null;

  if (/^(sim|confirm\w*|pode( confirmar)?|ok|isso( mesmo)?|manda( ver)?|pode mandar|fechado|beleza|confirma)$/.test(t)) return { type: "confirm" };
  if (/^(nao|cancela\w*|deixa( pra la)?|esquece|para|nao quero)$/.test(t)) return { type: "cancel" };
  if (/(modo )?segurar (para|pra) falar/.test(t)) return { type: "mic_mode", mode: "hold" };
  if (/(modo )?tocar (para|pra) falar/.test(t)) return { type: "mic_mode", mode: "tap" };

  // navegação
  const nav = t.match(/^(abre|abrir|abra|vai (para|pra)|ir (para|pra)|me leva (para|pra)|mostra a tela( de)?|tela( de)?)\s+(a |o |os |as |tela de |tela )?(.+)$/);
  if (nav) {
    const target = nav[nav.length - 1]!.trim();
    const order = target.match(/^(o )?pedido (numero )?(\d+)$/);
    if (order) return { type: "navigate", destination: "pedido", order_number: order[3]! };
    for (const [re, dest] of NAV) if (re.test(target)) return { type: "navigate", destination: dest, order_number: null };
  }

  // resumo
  if (/^(resumo|como foi|como ta|como esta|balanco)( de| do)?( hoje| o dia| dia)?$/.test(t) || /^resumo (de|do) (hoje|dia)$/.test(t)) return { type: "summary", period: "today" };
  if (/^(resumo|como foi)( de| do)? ontem$/.test(t)) return { type: "summary", period: "yesterday" };
  if (/^(resumo|como foi)( da| dessa| desta)? semana$/.test(t)) return { type: "summary", period: "7d" };
  if (/^(resumo|como foi)( do| desse| deste)? mes$/.test(t)) return { type: "summary", period: "month" };
  if (/^(quais |ver |mostra )?(os )?pedidos pendentes$/.test(t)) return { type: "pending_orders" };

  // pedido
  const os = t.match(/^(marca|coloca|muda|poe) (o )?pedido (numero )?(\d+) (como|para|pra) (entregue|cancelado|pendente|pedido feito|feito)$/);
  if (os) {
    const st = os[6] === "feito" ? "pedido feito" : (os[6] as "entregue" | "cancelado" | "pendente" | "pedido feito");
    return { type: "order_status", order_number: os[4]!, status: st };
  }

  // venda (antes de estoque: "vendi" nunca é ajuste de estoque)
  const sale = t.match(/^(vendi|vendemos|vendeu|vendido|saiu|sairam|venda de|registra (uma )?venda( de)?)\s+(.+)$/);
  if (sale) return parseSale(sale[sale.length - 1]!, payment);

  // reposição
  const rep = t.match(/^(adiciona|coloca|poe|bota|inclui|acrescenta) (\d{1,3}) (.+?) (na|a|pra|para a) (reposicao|lista de compras|compra)$/);
  if (rep) return { type: "restock", quantity: Number(rep[2]), query: clean(rep[3]!) };

  // comparação
  const cmp = t.match(/^(compara|comparar|compare|quanto (ta|esta|custa)) (o |a )?(.+?)( nos fornecedores| no fornecedor| nos fornecedor)?$/);
  if (cmp && (cmp[1]!.startsWith("compar") || cmp[5])) return { type: "compare", query: clean(cmp[4]!) };

  // estoque
  const add = t.match(/^(chegaram|chegou|entrou|entraram|recebi|adiciona|soma|acrescenta|da entrada( em| de)?)( mais)? (\d{1,3}) (.+)$/);
  if (add) {
    const q = clean(add[5]!);
    return { type: "stock", mode: "add", quantity: Number(add[4]), query: PRONOUN.test(q) || /^(no |em )?estoque$/.test(q) ? null : q };
  }
  const rem = t.match(/^(tira|remove|retira|baixa)( mais)? (\d{1,3}) (.+?)( do estoque)?$/);
  if (rem) {
    const q = clean(rem[4]!);
    return { type: "stock", mode: "remove", quantity: Number(rem[3]), query: PRONOUN.test(q) || /^(do )?estoque$/.test(q) ? null : q };
  }
  const zero = t.match(/^zera (o )?estoque( do| da| de)?\s*(.*)$/);
  if (zero) {
    const q = clean(zero[3] ?? "");
    return { type: "stock", mode: "set", quantity: 0, query: q && !PRONOUN.test(q) ? q : null };
  }
  const set = t.match(/^(tenho|temos|tem|coloca|poe|bota|deixa|ficou com|fica com)( agora)? (\d{1,3}) (.+)$/);
  if (set) {
    const raw = set[4]!;
    if (!/ (reposicao|compra)$/.test(raw)) {
      const q = clean(raw.replace(/ (em|no|de) estoque$/, ""));
      const onlyUnit = /^(unidades?|em estoque|no estoque|estoque)?$/.test(q);
      return { type: "stock", mode: "set", quantity: Number(set[3]), query: onlyUnit || PRONOUN.test(q) ? null : q };
    }
  }

  // preço: "coloca liquid brun a rs319,90", "coloca ele por 319,90"
  const price = t.match(/^(coloca|muda|altera|poe|deixa|bota)( o preco( do| da| de)?)? (.+?) (a|por|pra|para|em|de) (rs)?(\d+(?:,\d{1,2})?)( reais)?$/);
  if (price) {
    const v = moneyOf(price[7]!);
    const q = clean(price[4]!);
    if (v && v > 0) return { type: "price", price: v, query: PRONOUN.test(q) ? null : q };
  }
  const price2 = t.match(/^(coloca|muda|altera|poe|deixa|bota)( o preco( do| da| de)?)? (.+?) (a|por|pra|para|em|de) (rs\d+(?:,\d{1,2})?)$/);
  if (price2) {
    const v = moneyOf(price2[6]!);
    const q = clean(price2[4]!);
    if (v && v > 0) return { type: "price", price: v, query: PRONOUN.test(q) ? null : q };
  }
  return null;
}
