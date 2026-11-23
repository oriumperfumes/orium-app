/**
 * Inteligência do CRM (pura, sem banco): transforma o retrato de cada cliente vindo de
 * `crm_leads()` em calor (0–100), listas de ação, perfil de compra em frases simples e a
 * próxima melhor ação com mensagem pronta. Nada aqui envia mensagem: só sugere.
 */

export type LeadRaw = {
  id: string;
  name: string | null;
  phone: string | null;
  user_id: string | null;
  created_at: string;
  first_source: string | null;
  lead_trigger: string | null;
  optin: boolean | null;
  orders_count: number;
  spent: number;
  first_order_at: string | null;
  last_order_at: string | null;
  avg_interval_days: number | null;
  decant_units: number;
  bottle_units: number;
  avg_bottle_price: number | null;
  avg_decant_price: number | null;
  max_item_price: number | null;
  promo_items: number;
  total_items: number;
  last_decant_at: string | null;
  top_brands: string[];
  recent_items: Array<{ product_id: string | null; name: string; decant: boolean; at: string }>;
  views: {
    d7: number;
    d30: number;
    last_at: string | null;
    top: Array<{
      product_id: string;
      name: string;
      brand: string | null;
      views: number;
      last_at: string;
      price: number | null;
      in_stock: boolean;
      bought: boolean;
    }>;
  } | null;
  cart: {
    id: string;
    status: string;
    items: number;
    total: number | null;
    last_at: string;
    abandoned_at: string | null;
    names: string[];
  } | null;
  favorites: Array<{
    product_id: string;
    name: string;
    in_stock: boolean;
    price: number | null;
  }> | null;
  waiting: Array<{ product_id: string; name: string; in_stock: boolean; since: string }> | null;
  live: {
    active: boolean;
    product: string | null;
    intent: string | null;
    checkout: boolean;
    cart_total: number | null;
    at: string;
  } | null;
  wa: {
    jid: string;
    stage: string;
    unread: number;
    last_inbound_at: string | null;
    last_outbound_at: string | null;
    last_from_me: boolean | null;
    preview: string | null;
  } | null;
};

export type Temp = "quente" | "morno" | "frio";
export type SegmentKey =
  | "responder"
  | "quentes"
  | "carrinho"
  | "esperando"
  | "upgrade"
  | "promo"
  | "recompra"
  | "novos"
  | "sumidos";

export const SEGMENTS: Record<SegmentKey, { title: string; hint: string }> = {
  responder: {
    title: "Esperando resposta",
    hint: "Escreveram no WhatsApp e ainda não responderam",
  },
  quentes: { title: "Quentes agora", hint: "Maior chance de comprar hoje" },
  carrinho: { title: "Carrinho parado", hint: "Separaram perfumes e não fecharam" },
  esperando: {
    title: "Chegou o que queriam",
    hint: "Pediram aviso e o perfume já está disponível",
  },
  upgrade: { title: "Decant → frasco", hint: "Provaram no decant; hora de oferecer o frasco" },
  promo: { title: "Prontos pra promoção", hint: "Um cupom pequeno deve destravar" },
  recompra: { title: "Hora da recompra", hint: "Chegou o tempo em que costumam voltar" },
  novos: { title: "Novos contatos", hint: "Chegaram há pouco e ainda não compraram" },
  sumidos: { title: "Sumidos", hint: "Compraram antes e pararam de aparecer" },
};

export const SEGMENT_ORDER: SegmentKey[] = [
  "responder",
  "quentes",
  "carrinho",
  "esperando",
  "upgrade",
  "promo",
  "recompra",
  "novos",
  "sumidos",
];

const DAY = 86_400_000;
const daysSince = (iso: string | null | undefined, now: number) =>
  iso ? (now - new Date(iso).getTime()) / DAY : Infinity;
const hoursSince = (iso: string | null | undefined, now: number) => daysSince(iso, now) * 24;
const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const firstName = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || "";

/** Aguardando resposta: a última mensagem da conversa veio do cliente. */
export function awaitingReply(r: LeadRaw) {
  return !!r.wa?.last_inbound_at && r.wa.last_from_me === false;
}

function inStockWaiting(r: LeadRaw) {
  return (r.waiting ?? []).filter((w) => w.in_stock);
}

/** Produto mais olhado que a pessoa ainda não comprou (3+ visitas). */
function stuckOn(r: LeadRaw) {
  return (r.views?.top ?? []).find((t) => !t.bought && t.views >= 3) ?? null;
}

function upgradeCandidate(r: LeadRaw, now: number) {
  const d = daysSince(r.last_decant_at, now);
  if (!(d >= 7 && d <= 75)) return null;
  const decant = r.recent_items.find((i) => i.decant);
  if (!decant) return null;
  const alsoBottle = r.recent_items.some(
    (i) => !i.decant && i.product_id && i.product_id === decant.product_id,
  );
  return alsoBottle ? null : decant;
}

function repurchaseDue(r: LeadRaw, now: number) {
  if (r.orders_count < 1) return false;
  const d = daysSince(r.last_order_at, now);
  const cycle = r.avg_interval_days && r.avg_interval_days > 3 ? r.avg_interval_days : 45;
  return d >= cycle * 0.85 && d <= 180;
}

export function scoreLead(
  r: LeadRaw,
  now = Date.now(),
): { score: number; temp: Temp; reasons: string[] } {
  let s = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => {
    s += n;
    reasons.push(why);
  };

  if (r.live?.active)
    add(
      r.live.checkout ? 45 : 30,
      r.live.checkout
        ? "Está no checkout agora"
        : `Está no app agora${r.live.product ? ` vendo ${r.live.product}` : ""}`,
    );
  if (awaitingReply(r)) {
    const h = hoursSince(r.wa!.last_inbound_at, now);
    if (h <= 24) add(28, "Mandou mensagem e espera resposta");
    else if (h <= 24 * 7) add(14, "Mensagem sem resposta há dias");
  } else if (hoursSince(r.wa?.last_inbound_at, now) <= 72)
    add(8, "Conversou no WhatsApp nos últimos dias");

  if (r.cart && r.cart.items > 0) {
    const h = hoursSince(r.cart.last_at, now);
    add(
      h <= 24 ? 35 : h <= 48 ? 25 : h <= 24 * 7 ? 15 : 8,
      `Carrinho com ${r.cart.items} ${r.cart.items === 1 ? "item" : "itens"}${r.cart.total ? ` (${brl(r.cart.total)})` : ""}`,
    );
  }
  const ready = inStockWaiting(r);
  if (ready.length) add(30, `Pediu aviso e o ${ready[0].name} chegou`);

  const v7 = r.views?.d7 ?? 0;
  if (v7 >= 5) add(15, `${v7} perfumes vistos nesta semana`);
  else if (v7 >= 1) add(8, `Visitou o app nesta semana`);
  if (hoursSince(r.views?.last_at, now) <= 24) add(10, "Visitou nas últimas 24h");
  const stuck = stuckOn(r);
  if (stuck) add(10, `Voltou ${stuck.views}x no ${stuck.name}`);

  const favIn = (r.favorites ?? []).filter((f) => f.in_stock).length;
  if (favIn)
    add(
      Math.min(10, favIn * 4),
      `${favIn} favorito${favIn > 1 ? "s" : ""} disponível${favIn > 1 ? "is" : ""}`,
    );

  if (repurchaseDue(r, now)) add(20, "Chegou a época de recompra");
  if (upgradeCandidate(r, now)) add(10, "Provou um decant recentemente");
  if (r.orders_count >= 3) add(10, "Cliente fiel");
  else if (r.orders_count >= 1) add(5, "Já comprou antes");

  const score = Math.max(0, Math.min(100, Math.round(s)));
  return { score, temp: score >= 55 ? "quente" : score >= 30 ? "morno" : "frio", reasons };
}

export function segmentsOf(r: LeadRaw, now = Date.now()): SegmentKey[] {
  const out: SegmentKey[] = [];
  const { score } = scoreLead(r, now);
  if (awaitingReply(r)) out.push("responder");
  if (score >= 55) out.push("quentes");
  if (r.cart && r.cart.items > 0) out.push("carrinho");
  if (inStockWaiting(r).length) out.push("esperando");
  if (upgradeCandidate(r, now)) out.push("upgrade");
  const promoShare = r.total_items ? r.promo_items / r.total_items : 0;
  if (
    (r.total_items >= 2 && promoShare >= 0.4) ||
    stuckOn(r) ||
    (r.orders_count === 0 && (r.favorites?.length ?? 0) >= 2)
  )
    out.push("promo");
  if (repurchaseDue(r, now)) out.push("recompra");
  if (r.orders_count === 0 && daysSince(r.created_at, now) <= 14) out.push("novos");
  if (
    r.orders_count >= 1 &&
    daysSince(r.last_order_at, now) > 90 &&
    (r.views?.d30 ?? 0) === 0 &&
    !r.live?.active
  )
    out.push("sumidos");
  return out;
}

/** Perfil de compra em frases curtas, do mais útil pro menos. */
export function profileOf(r: LeadRaw, now = Date.now()): string[] {
  const out: string[] = [];
  const units = r.decant_units + r.bottle_units;
  if (r.spent >= 1500 || r.orders_count >= 3)
    out.push(
      `Cliente VIP: ${brl(r.spent)} em ${r.orders_count} compra${r.orders_count > 1 ? "s" : ""}`,
    );
  if (units >= 2) {
    const share = r.decant_units / units;
    if (share >= 0.7)
      out.push(
        `Compra mais decant (${Math.round(share * 100)}%): gosta de provar antes de investir`,
      );
    else if (share <= 0.3)
      out.push(`Prefere frasco lacrado (${Math.round((1 - share) * 100)}% das peças)`);
    else out.push("Mistura decant e frasco: oferecer os dois");
  } else if (units === 1)
    out.push(r.decant_units ? "Primeira compra foi decant" : "Primeira compra foi um frasco");
  if (r.orders_count > 0) out.push(`Ticket médio ${brl(r.spent / r.orders_count)}`);
  if (r.avg_bottle_price) {
    const lo = Math.round((r.avg_bottle_price * 0.8) / 10) * 10;
    const hi = Math.round(((r.max_item_price ?? r.avg_bottle_price) * 1.1) / 10) * 10;
    out.push(`Faixa confortável no frasco: ${brl(lo)} a ${brl(Math.max(hi, lo + 20))}`);
  }
  if (r.total_items >= 2) {
    const ps = r.promo_items / r.total_items;
    if (ps >= 0.5) out.push("Sensível a promoção: cupom pequeno converte");
    else if (ps === 0 && r.total_items >= 3)
      out.push("Compra a preço cheio: não precisa de desconto");
  }
  if (r.top_brands?.length) out.push(`Marcas preferidas: ${r.top_brands.join(", ")}`);
  if (r.avg_interval_days && r.avg_interval_days > 3) {
    const next = new Date(new Date(r.last_order_at!).getTime() + r.avg_interval_days * DAY);
    out.push(
      `Volta a comprar a cada ~${r.avg_interval_days} dias (próxima por volta de ${next.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })})`,
    );
  }
  const stuck = stuckOn(r);
  if (stuck) out.push(`De olho no ${stuck.name}: ${stuck.views} visitas sem comprar`);
  if ((r.favorites?.length ?? 0) > 0)
    out.push(`${r.favorites!.length} favorito${r.favorites!.length > 1 ? "s" : ""} no app`);
  if (r.orders_count === 0 && units === 0) {
    const d = Math.floor(daysSince(r.created_at, now));
    out.push(d <= 1 ? "Contato novo de hoje" : `Contato há ${d} dias, ainda sem compra`);
  }
  return out;
}

export type NextAction = { key: string; title: string; why: string; message: string | null };

/** A ação de maior chance de venda agora, com mensagem pronta (o dono edita antes de enviar). */
export function nextAction(r: LeadRaw, now = Date.now()): NextAction {
  const fn = firstName(r.name);
  const hi = fn ? `Oi, ${fn}!` : "Oi!";
  if (awaitingReply(r))
    return {
      key: "reply",
      title: "Responder agora",
      why: "Quem espera resposta esfria rápido",
      message: null,
    };
  if (r.live?.active && r.live.checkout)
    return {
      key: "checkout",
      title: "Ajudar a fechar",
      why: "Está finalizando o pedido agora",
      message: `${hi} Vi que você está finalizando aqui na Orium 😊 Posso te ajudar com alguma dúvida pra fechar?`,
    };
  const ready = inStockWaiting(r)[0];
  if (ready)
    return {
      key: "arrived",
      title: `Avisar: ${ready.name} chegou`,
      why: "Pediu aviso e o perfume está disponível",
      message: `${hi} O ${ready.name} que você queria acabou de chegar aqui na Orium ✨ Quer que eu separe um pra você?`,
    };
  if (r.cart && r.cart.items > 0) {
    const item = r.cart.names?.[0];
    return {
      key: "cart",
      title: "Recuperar carrinho",
      why: `${r.cart.items} ${r.cart.items === 1 ? "item separado" : "itens separados"}${r.cart.total ? ` · ${brl(r.cart.total)}` : ""}`,
      message: `${hi} Vi que você separou ${item ? `o ${item}` : "uns perfumes"} aqui na Orium 😊 Quer que eu reserve pra você? Te passo tudo por aqui.`,
    };
  }
  const up = upgradeCandidate(r, now);
  if (up)
    return {
      key: "upgrade",
      title: "Oferecer o frasco",
      why: `Provou ${up.name} no decant`,
      message: `${hi} E aí, o que achou do ${up.name}? Se curtiu, o frasco lacrado sai bem mais em conta por ml. Quer que eu te passe o valor?`,
    };
  const stuck = stuckOn(r);
  if (stuck)
    return {
      key: "stuck",
      title: `Destravar ${stuck.name}`,
      why: `Viu ${stuck.views}x e não comprou`,
      message: `${hi} Vi que você curtiu o ${stuck.name} 👀 Consigo uma condição especial pra você hoje. Quer saber?`,
    };
  if (repurchaseDue(r, now)) {
    const brand = r.top_brands?.[0];
    return {
      key: "repurchase",
      title: "Puxar a recompra",
      why: "Chegou a época em que costuma voltar",
      message: `${hi} Chegaram novidades${brand ? ` da ${brand}` : ""} aqui na Orium que têm a sua cara ✨ Quer que eu te mande as opções?`,
    };
  }
  if (r.orders_count >= 1 && daysSince(r.last_order_at, now) > 90)
    return {
      key: "winback",
      title: "Reconquistar",
      why: "Faz tempo que não compra",
      message: `${hi} Saudade de você por aqui! Separei uma condição especial pra você voltar a se perfumar com a gente ✨`,
    };
  if (r.orders_count === 0)
    return {
      key: "first",
      title: "Primeira venda",
      why: "Ainda não comprou",
      message: `${hi} Aqui é da Orium Perfumes 😊 Posso te ajudar a escolher o perfume ideal? Me conta que tipo de cheiro você curte.`,
    };
  return { key: "nurture", title: "Manter contato", why: "Sem sinal forte agora", message: null };
}

export type Lead = LeadRaw & {
  score: number;
  temp: Temp;
  reasons: string[];
  segments: SegmentKey[];
  profile: string[];
  action: NextAction;
};

export function enrich(rows: LeadRaw[], now = Date.now()): Lead[] {
  return rows
    .map((r) => ({
      ...r,
      ...scoreLead(r, now),
      segments: segmentsOf(r, now),
      profile: profileOf(r, now),
      action: nextAction(r, now),
    }))
    .sort((a, b) => b.score - a.score);
}
