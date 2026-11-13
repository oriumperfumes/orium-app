import { decantUnitCost } from "@/lib/decants";
/**
 * ORIUM COPILOT — CENTRAL DE AÇÕES (AdminActionRegistry).
 *
 * A IA entende → a ferramenta valida → o Admin confirma → o servidor executa →
 * a auditoria registra. Nenhuma ação altera o banco na fase "propose": ela só
 * resolve IDs reais, calcula a prévia e grava uma pendência em copilot_actions.
 * A execução acontece em `executeAction`, chamada pelo botão/voz de confirmação.
 */
import { commercialPrice } from "@/lib/commercial-price";

export type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Role = "owner" | "admin";

export type CopilotCtx = {
  /** cliente com o token do usuário: RLS e is_staff(auth.uid()) valem */
  userDb: any;
  /** cliente privilegiado, usado só depois de validar a permissão */
  adminDb: any;
  userId: string;
  roles: Role[];
  threadId: string | null;
};

export type ActionMeta = {
  name: string;
  label: string;
  description: string;
  risk: Risk;
  confirm: boolean;
  reversible: boolean;
  roles: Role[];
};

/** Tudo que o Copilot pode alterar. Consultas e navegação ficam fora (LOW, sem confirmação). */
export const ACTIONS: Record<string, ActionMeta> = {
  price_batch: { name: "price_batch", label: "Alterar vários preços", description: "Vários preços de produtos (frasco, atacado, decants) ou voltar decant ao global.", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  pricing_rules: { name: "pricing_rules", label: "Regras globais de preço", description: "Margens, desconto Pix, preço comercial e decants globais.", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  price_change: { name: "price_change", label: "Alterar preço", description: "Preço de frasco, Pix, atacado ou decant; ou voltar ao automático.", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  stock_change: { name: "stock_change", label: "Ajustar estoque Orium", description: "Definir, adicionar ou remover unidades físicas da loja.", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  supplier_catalog: { name: "supplier_catalog", label: "Catálogo público do fornecedor", description: "Define se as ofertas de um fornecedor podem disponibilizar perfumes no site (sincronização continua).", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  availability: { name: "availability", label: "Disponibilidade manual", description: "Liberar, esconder ou voltar ao automático.", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  coupon_create: { name: "coupon_create", label: "Criar cupom", description: "Cupom percentual.", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  coupon_toggle: { name: "coupon_toggle", label: "Ativar/desativar cupom", description: "", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  promotion_create: { name: "promotion_create", label: "Criar promoção", description: "Usa o sistema real de promoções (não altera o preço base).", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  promotion_end: { name: "promotion_end", label: "Encerrar promoção", description: "", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  order_status: { name: "order_status", label: "Mudar situação do pedido", description: "", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  restock_add: { name: "restock_add", label: "Adicionar à reposição", description: "", risk: "MEDIUM", confirm: true, reversible: false, roles: ["owner", "admin"] },
  command_save: { name: "command_save", label: "Comando personalizado", description: "Criar ou editar comando/macro do Copilot.", risk: "MEDIUM", confirm: true, reversible: true, roles: ["owner", "admin"] },
  command_delete: { name: "command_delete", label: "Excluir comando", description: "", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  store_sale_register: { name: "store_sale_register", label: "Registrar venda da loja", description: "Venda presencial: baixa estoque, lucro e auditoria.", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  order_create: { name: "order_create", label: "Criar pedido", description: "Pedido manual com preço do sistema e pagamento (não pago, sinal ou integral).", risk: "HIGH", confirm: true, reversible: true, roles: ["owner", "admin"] },
  order_to_restock: { name: "order_to_restock", label: "Enviar pedido à reposição", description: "", risk: "MEDIUM", confirm: true, reversible: false, roles: ["owner", "admin"] },
};

export const ORDER_STATUSES = ["pendente", "pedido feito", "entregue", "cancelado"] as const;
const PENDING_TTL_MS = 10 * 60 * 1000;

const money = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
export const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function allowed(ctx: CopilotCtx, meta: ActionMeta) {
  if (!meta.roles.some((r) => ctx.roles.includes(r))) throw new Error("Você não tem permissão para esta ação.");
}

// ---------------------------------------------------------------- produtos

export type ProductCard = {
  id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  volume_ml: number | null;
};

type Resolved =
  | { status: "ok"; product: ProductCard }
  | { status: "ambiguous" | "not_found"; query: string; candidates: ProductCard[] };

async function productById(db: any, id: string): Promise<ProductCard | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db.from("products").select("id, canonical_name, brand, image_url, volume_ml").eq("id", id).maybeSingle();
  return data ? { id: data.id, name: data.canonical_name, brand: data.brand, image_url: data.image_url, volume_ml: data.volume_ml } : null;
}

/** Nunca aceita ID inventado: id precisa existir; nome passa pelo resolvedor V3 + apelidos de voz. */
export async function resolveProduct(ctx: CopilotCtx, productId: string | null, query: string | null): Promise<Resolved> {
  if (productId) {
    const p = await productById(ctx.adminDb, productId);
    if (p) return { status: "ok", product: p };
  }
  const q = (query ?? "").trim();
  if (!q) return { status: "not_found", query: "", candidates: [] };
  const { resolveProductCandidates, confidenceOf } = await import("@/lib/store-sales-match.server");
  const found = await resolveProductCandidates(ctx.adminDb, q, null);
  const cards = found.slice(0, 5).map((c) => ({ id: c.product_id, name: c.name, brand: c.brand, image_url: c.image_url, volume_ml: c.volume_ml }));
  const conf = confidenceOf(found);
  if (conf === "high" && cards[0]) return { status: "ok", product: cards[0] };
  // nome exato e único ganha (ex.: "Yara" → Yara, nunca Yara Elixir; "Asad" sem exato continua perguntando)
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const exact = cards.filter((c) => norm(c.name) === norm(q) || norm(`${c.brand ?? ""} ${c.name}`) === norm(q));
  if (exact.length === 1) return { status: "ok", product: exact[0]! };
  // perfume ganha de acessório com o mesmo nome (ex.: "Asad Bourbon" × "Pasta Hidratante Asad Bourbon")
  const perfumes = found.slice(0, 5).filter((c) => c.product_type === "PERFUME" && c.score >= 0.68);
  if (perfumes.length === 1 && found.slice(0, 5).length > 1) {
    const pn = norm(perfumes[0]!.name);
    const others = found.slice(0, 5).filter((c) => c !== perfumes[0]);
    if (others.every((c) => norm(c.name).includes(pn)) && cards[0]) return { status: "ok", product: cards.find((c) => c.id === perfumes[0]!.product_id)! };
  }
  return { status: cards.length ? "ambiguous" : "not_found", query: q, candidates: cards };
}

async function pricingSettings(db: any) {
  const { data } = await db.from("pricing_settings").select("*").eq("id", true).maybeSingle();
  return data ?? {};
}

export async function productSnapshot(ctx: CopilotCtx, id: string) {
  const db = ctx.adminDb;
  const [{ data: p }, { data: cost }, { data: override }, settings] = await Promise.all([
    db
      .from("products")
      .select(
        "id, slug, canonical_name, brand, image_url, volume_ml, concentration, product_type, retail_price, wholesale_price, base_retail_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, manual_pricing, manual_cost, local_stock, availability_override, supplier_available, availability_source, in_stock, catalog_eligible, active, sale_mode",
      )
      .eq("id", id)
      .maybeSingle(),
    db.from("product_costs").select("best_cost").eq("product_id", id).maybeSingle(),
    db.from("pricing_overrides").select("*").eq("product_id", id).maybeSingle(),
    pricingSettings(db),
  ]);
  const { data: dg } = await db.from("decant_settings").select("*").eq("id", true).maybeSingle();
  if (!p) return null;
  const { offersFor } = await import("@/lib/purchase/compare.server");
  const offers = (await offersFor(db, [id])).get(id) ?? [];
  const pixPct = settings.pix_discount_active ? Number(settings.pix_discount_percent ?? 0) : 0;
  const retail = num(p.retail_price);
  const c = num(p.manual_cost) ?? num(cost?.best_cost);
  return {
    id: p.id,
    slug: p.slug,
    name: p.canonical_name,
    brand: p.brand,
    image_url: p.image_url,
    volume_ml: p.volume_ml,
    type: p.product_type,
    prices: {
      // o preço cadastrado É o preço no Pix; cartão = Pix / (1 - desconto)
      retail,
      pix: retail,
      card: retail != null && pixPct > 0 ? money(retail / (1 - pixPct / 100)) : retail,
      pix_discount_percent: pixPct,
      wholesale: num(p.wholesale_price),
      decant_2ml: p.decant_available ? (num(p.decant_price_2ml) ?? num(dg?.price_2ml) ?? 19.9) : null,
      decant_5ml: p.decant_available ? (num(p.decant_price_5ml) ?? num(dg?.price_5ml) ?? 39.9) : null,
      decant_10ml: p.decant_available ? (num(p.decant_price_10ml) ?? num(dg?.price_10ml) ?? 69.9) : null,
      decant_custom: { 2: num(p.decant_price_2ml) != null, 5: num(p.decant_price_5ml) != null, 10: num(p.decant_price_10ml) != null },
      mode: p.manual_pricing ? "manual" : override?.fixed_retail_price != null ? "fixado" : "automatico",
    },
    cost: c,
    margin: retail != null && c != null ? { profit: money(retail - c), percent: retail > 0 ? money(((retail - c) / retail) * 100) : null } : null,
    orium_stock: p.local_stock,
    availability: {
      public: p.in_stock && p.catalog_eligible && p.active ? "Disponível" : "Indisponível",
      source: p.availability_source,
      override: p.availability_override,
      supplier_available: p.supplier_available,
      catalog_eligible: p.catalog_eligible,
    },
    suppliers: offers.map((o) => ({ supplier: o.supplier_name, price: o.price, status: o.status })),
  };
}

// ---------------------------------------------------------------- tempo

const SP_OFFSET_H = 3;
function spMidnight(daysAgo = 0) {
  const now = new Date(Date.now() - SP_OFFSET_H * 3600_000);
  const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo);
  return new Date(d + SP_OFFSET_H * 3600_000);
}
export function periodRange(period: string): { from: string; to: string; label: string } {
  const now = new Date();
  switch (period) {
    case "yesterday":
      return { from: spMidnight(1).toISOString(), to: spMidnight(0).toISOString(), label: "ontem" };
    case "7d":
      return { from: spMidnight(6).toISOString(), to: now.toISOString(), label: "últimos 7 dias" };
    case "30d":
      return { from: spMidnight(29).toISOString(), to: now.toISOString(), label: "últimos 30 dias" };
    case "month": {
      const sp = new Date(Date.now() - SP_OFFSET_H * 3600_000);
      const first = new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), 1) + SP_OFFSET_H * 3600_000);
      return { from: first.toISOString(), to: now.toISOString(), label: "este mês" };
    }
    default:
      return { from: spMidnight(0).toISOString(), to: now.toISOString(), label: "hoje" };
  }
}

/** "domingo", "amanhã", "2026-10-01" → fim do dia em São Paulo (ISO). */
export function parseEndDate(hint: string | null): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const endOf = (daysAhead: number) => new Date(spMidnight(-daysAhead - 1).getTime() - 1000).toISOString();
  if (h.includes("hoje")) return endOf(0);
  if (h.includes("amanha")) return endOf(1);
  const days = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  const idx = days.findIndex((d) => h.includes(d));
  if (idx >= 0) {
    const today = new Date(Date.now() - SP_OFFSET_H * 3600_000).getUTCDay();
    let ahead = (idx - today + 7) % 7;
    if (ahead === 0) ahead = 7;
    return endOf(ahead);
  }
  const t = Date.parse(hint);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) + SP_OFFSET_H * 3600_000 - 1000).toISOString();
  }
  return null;
}

// ---------------------------------------------------------------- consultas

export async function querySalesSummary(ctx: CopilotCtx, period: string) {
  const r = periodRange(period);
  const { data, error } = await ctx.userDb.rpc("admin_dashboard", { p_from: r.from, p_to: r.to, p_channel: "all" });
  if (error) throw new Error(error.message);
  const rep = data as any;
  return {
    period: r.label,
    revenue: rep?.period?.revenue ?? 0,
    gross_profit: rep?.period?.profit ?? 0,
    margin_percent: rep?.period?.margin ?? null,
    orders: rep?.period?.orders ?? 0,
    app_orders: rep?.period?.app_orders ?? null,
    store_sales: rep?.period?.store_sales ?? null,
    ticket: rep?.period?.ticket ?? null,
    previous_period: rep?.period?.previous ?? null,
    top_products: (rep?.top_products ?? []).slice(0, 5).map((t: any) => ({ product_id: t.product_id, name: t.name, units: t.units, revenue: t.revenue, profit: t.profit })),
    pending_orders: rep?.pending?.count ?? 0,
    restock: rep?.restock ? { items: rep.restock.items, units: rep.restock.units, cost: rep.restock.cost } : null,
    note: "Lucro bruto = receita de produtos − custo registrado na venda. Não é lucro líquido.",
  };
}

export async function queryOrders(ctx: CopilotCtx, status: string) {
  let q = ctx.adminDb
    .from("catalog_orders")
    .select("id, order_number, customer_name, status, final_total, grand_total, sales_total, created_at, payment_method")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(15);
  if (status !== "todos") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((o: any) => ({
    order_number: o.order_number,
    customer: o.customer_name ? String(o.customer_name).split(" ")[0] : null,
    status: o.status,
    total: num(o.final_total) ?? num(o.grand_total) ?? num(o.sales_total),
    at: o.created_at,
    payment: o.payment_method,
  }));
}

export async function findOrder(db: any, raw: string) {
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  const code = `OR-${digits.padStart(4, "0")}`;
  const { data } = await db
    .from("catalog_orders")
    .select("id, order_number, customer_name, status, final_total, grand_total, created_at, payment_method, fulfillment_type")
    .in("order_number", [code, `OR-${digits}`])
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  return data;
}

export async function queryOrder(ctx: CopilotCtx, number: string) {
  const o = await findOrder(ctx.adminDb, number);
  if (!o) return { found: false, message: `Não encontrei o pedido ${number}.` };
  const { data: items } = await ctx.adminDb
    .from("catalog_order_items")
    .select("*")
    .eq("order_id", o.id)
    .limit(30);
  return {
    found: true,
    order: {
      id: o.id,
      order_number: o.order_number,
      customer: o.customer_name,
      status: o.status,
      total: num(o.final_total) ?? num(o.grand_total),
      at: o.created_at,
      payment: o.payment_method,
      delivery: o.fulfillment_type,
      items: (items ?? []).map((i: any) => ({
        name: i.product_name_snapshot ?? null,
        quantity: i.quantity,
        variant: i.variant_label ?? i.variant ?? null,
        decant_ml: i.decant_ml ?? null,
      })),
    },
  };
}

export async function queryCustomers(ctx: CopilotCtx, query: string) {
  const q = query.replace(/[%,()]/g, " ").trim();
  if (q.length < 2) return [];
  const { data } = await ctx.adminDb
    .from("crm_customers")
    .select("id, name, phone_normalized")
    .or(`name.ilike.%${q}%,phone_normalized.ilike.%${q.replace(/\D/g, "") || q}%`)
    .is("archived_at", null)
    .limit(5);
  const out = [];
  for (const c of data ?? []) {
    const { data: orders } = await ctx.adminDb
      .from("catalog_orders")
      .select("order_number, final_total, grand_total, status, created_at")
      .eq("customer_phone_normalized", c.phone_normalized ?? "__")
      .is("deleted_at", null)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(20);
    const list = orders ?? [];
    out.push({
      id: c.id,
      name: c.name,
      phone_end: c.phone_normalized ? `…${String(c.phone_normalized).slice(-4)}` : null,
      orders: list.length,
      total_spent: money(list.reduce((s: number, o: any) => s + (num(o.final_total) ?? num(o.grand_total) ?? 0), 0)),
      last_orders: list.slice(0, 3).map((o: any) => ({ order_number: o.order_number, total: num(o.final_total) ?? num(o.grand_total), status: o.status, at: o.created_at })),
    });
  }
  return out;
}

export async function queryCoupons(ctx: CopilotCtx) {
  const { data } = await ctx.adminDb
    .from("coupons")
    .select("code, discount_percent, visibility, applies_to, active, ends_at, redemptions, max_redemptions")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).filter((c: any) => !c.ends_at || Date.parse(c.ends_at) > Date.now());
}

export async function queryPromotions(ctx: CopilotCtx) {
  const { data } = await ctx.adminDb
    .from("promotions")
    .select("id, name, discount_percent, applies_to, product_ids, decant_sizes, starts_at, ends_at, active")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).filter((p: any) => !p.ends_at || Date.parse(p.ends_at) > Date.now());
}

export async function queryRestock(ctx: CopilotCtx) {
  const { data: list } = await ctx.adminDb.from("restock_lists").select("id").eq("status", "aberta").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!list) return { items: [], total: 0 };
  const { data } = await ctx.adminDb
    .from("restock_items")
    .select("quantity, unit_cost, status, products(canonical_name), suppliers(name)")
    .eq("restock_list_id", list.id)
    .limit(100);
  const items = (data ?? []).map((i: any) => ({
    name: i.products?.canonical_name ?? null,
    supplier: i.suppliers?.name ?? null,
    quantity: i.quantity,
    unit_cost: num(i.unit_cost),
    status: i.status,
  }));
  const pending = items.filter((i: any) => i.status !== "recebido");
  return { items, pending_units: pending.reduce((s: number, i: any) => s + (i.quantity ?? 0), 0), total: money(pending.reduce((s: number, i: any) => s + (i.unit_cost ?? 0) * (i.quantity ?? 0), 0)) };
}

/** Dados para conselhos: fatos, nunca causa. */
export async function queryAdviceData(ctx: CopilotCtx) {
  const summary = await querySalesSummary(ctx, "30d");
  const { data: stocked } = await ctx.adminDb
    .from("products")
    .select("id, canonical_name, brand, local_stock, retail_price, manual_cost, product_costs(best_cost)")
    .gt("local_stock", 0)
    .order("local_stock", { ascending: false })
    .limit(40);
  const soldIds = new Set((summary.top_products ?? []).map((t: any) => t.product_id));
  const { data: views } = await ctx.adminDb.rpc("admin_top_viewed", { p_days: 30, p_limit: 10 }).then(
    (r: any) => r,
    () => ({ data: null }),
  );
  const withMargin: Array<{ product_id: string; name: string; orium_stock: number; price: number | null; cost: number | null; margin_percent: number | null; sold_in_top_30d: boolean }> = (stocked ?? []).map((p: any) => {
    const cost = num(p.manual_cost) ?? num(p.product_costs?.best_cost);
    const retail = num(p.retail_price);
    return {
      product_id: p.id,
      name: p.canonical_name,
      orium_stock: p.local_stock,
      price: retail,
      cost,
      margin_percent: retail && cost != null ? money(((retail - cost) / retail) * 100) : null,
      sold_in_top_30d: soldIds.has(p.id),
    };
  });
  return {
    last_30_days: { revenue: summary.revenue, gross_profit: summary.gross_profit, orders: summary.orders, previous_period: summary.previous_period },
    best_sellers_30d: summary.top_products,
    orium_stock_without_top_sales: withMargin.filter((p) => !p.sold_in_top_30d).slice(0, 10),
    best_margins_in_stock: [...withMargin].filter((p) => p.margin_percent != null).sort((a, b) => (b.margin_percent ?? 0) - (a.margin_percent ?? 0)).slice(0, 8),
    most_viewed_30d: Array.isArray(views) ? views.slice(0, 10) : null,
  };
}

/** Custo de um decant: líquido proporcional aos ml + frasquinho. */
function decantCost(snap: any, ml: number) {
  return decantUnitCost(snap.cost, snap.volume_ml, ml);
}

function economics(price: number, cost: number | null) {
  return {
    cost,
    gross_profit: cost != null ? money(price - cost) : null,
    margin_percent: cost != null && price > 0 ? money(((price - cost) / price) * 100) : null,
    below_cost: cost != null && price < cost,
  };
}

/** Simulação: tudo calculado aqui (nunca pelo modelo). Nada é alterado. */
export async function querySimulatePrice(ctx: CopilotCtx, productId: string, price: number, kind: string = "pix") {
  const snap = await productSnapshot(ctx, productId);
  if (!snap) throw new Error("Produto não encontrado.");
  const pct = snap.prices.pix_discount_percent;
  const ml = kind.startsWith("decant") ? Number(kind.split("_")[1]) : null;
  // "cartão" simulado: converte para o Pix equivalente, que é o que entra no caixa com o desconto
  const pix = kind === "card" && pct > 0 ? money(price * (1 - pct / 100)) : price;
  const cost = ml ? decantCost(snap, ml) : snap.cost;
  const current = ml ? (snap.prices as any)[`decant_${ml}ml`] : kind === "wholesale" ? snap.prices.wholesale : snap.prices.pix;
  return {
    product: snap.name,
    kind,
    current_price: current,
    simulated_price: price,
    pix_equivalent: pix,
    card_equivalent: pct > 0 ? money(pix / (1 - pct / 100)) : pix,
    ...economics(pix, cost),
    cost_note: ml ? "Custo do decant estimado proporcional ao frasco." : null,
    note: "Simulação apenas. Nada foi alterado.",
  };
}

export async function queryPricingRules(ctx: CopilotCtx) {
  const { getRules } = await import("@/lib/pricing-rules.server");
  const r = await getRules(ctx.adminDb);
  return {
    varejo: `custo + ${brl(r.retail_markup)}`,
    atacado: `custo + ${brl(r.wholesale_markup)} (a partir de ${r.wholesale_min_quantity} unid.)`,
    desconto_pix: r.pix_discount_active ? `${r.pix_discount_percent}%` : "desligado",
    preco_comercial: r.psych_pricing_active ? `ligado (final ,90, ajuste máx. ${brl(r.psych_max_reduction)})` : "desligado",
    decants_globais: { "2ml": r.decant_2, "5ml": r.decant_5, "10ml": r.decant_10 },
    raw: r,
  };
}

// ---------------------------------------------------------------- navegação

const ROUTES: Record<string, string> = {
  dashboard: "/admin",
  pedidos: "/admin/pedidos",
  pedidos_pendentes: "/admin/pedidos?tab=pendente",
  produtos: "/admin/produtos",
  clientes: "/admin/clientes",
  reposicao: "/admin/reposicao",
  compras: "/admin/reposicao",
  fornecedores_rota: "/admin/fornecedores-rota",
  vendas_loja: "/admin/vendas-loja",
  registrar_venda: "/admin/vendas-loja?registrar=manual",
  precificacao: "/admin/precificacao",
  marcas: "/admin/manutencao?tab=marcas",
  manutencao: "/admin/manutencao",
  integridade: "/admin/manutencao?tab=integridade",
  fornecedores: "/admin/fornecedores",
  configuracoes: "/admin/configuracoes",
  copilot_config: "/admin/configuracoes?secao=copilot",
  aovivo: "/admin/aovivo",
  conversao: "/admin/conversao",
  negociacao: "/admin/negociacao",
};
export const DESTINATIONS = Object.keys(ROUTES);

export async function resolveNavigation(ctx: CopilotCtx, destination: string, productId: string | null, productQuery: string | null, orderNumber: string | null) {
  if (destination === "produto") {
    const r = await resolveProduct(ctx, productId, productQuery);
    if (r.status !== "ok") return { navigate: null, ...r };
    return { navigate: `/admin/produtos/${r.product.id}`, product: r.product };
  }
  if (destination === "pedido") {
    const o = orderNumber ? await findOrder(ctx.adminDb, orderNumber) : null;
    if (!o) return { navigate: null, message: "Pedido não encontrado." };
    return { navigate: `/admin/pedidos?pedido=${o.id}`, order_number: o.order_number };
  }
  const path = ROUTES[destination];
  return path ? { navigate: path } : { navigate: null, message: "Tela não encontrada." };
}

// ---------------------------------------------------------------- propostas

type Proposal =
  | { kind: "action"; action_id: string; tool: string; label: string; risk: Risk; reversible: boolean; expires_at: string; preview: any }
  | { kind: "needs"; message: string; ask?: string; options?: string[]; candidates?: ProductCard[] };

async function savePending(ctx: CopilotCtx, tool: string, params: any, preview: any, utterance: string | null): Promise<Proposal> {
  const meta = ACTIONS[tool]!;
  allowed(ctx, meta);
  const expires = new Date(Date.now() + PENDING_TTL_MS).toISOString();
  // uma pendência por conversa: a anterior expira (evita "sim" confirmar coisa antiga)
  if (ctx.threadId)
    await ctx.userDb.from("copilot_actions").update({ status: "expired" }).eq("thread_id", ctx.threadId).eq("status", "pending");
  const { data, error } = await ctx.userDb
    .from("copilot_actions")
    .insert({ user_id: ctx.userId, thread_id: ctx.threadId, tool, intent: "ACTION", risk: meta.risk, params, preview, utterance, expires_at: expires })
    .select("id")
    .single();
  if (error) throw new Error(`Não consegui preparar a ação: ${error.message}`);
  return { kind: "action", action_id: data.id, tool, label: meta.label, risk: meta.risk, reversible: meta.reversible, expires_at: expires, preview };
}

const needsProduct = (r: Exclude<Resolved, { status: "ok" }>): Proposal => ({
  kind: "needs",
  message: r.status === "ambiguous" ? `Encontrei mais de um perfume para "${r.query}". Qual deles?` : `Não encontrei "${r.query}" no catálogo.`,
  candidates: r.candidates,
});

export type PriceKind = "retail" | "pix" | "card" | "wholesale" | "decant_2" | "decant_5" | "decant_10" | "auto" | "auto_wholesale" | "unknown";

const KIND_LABEL: Record<string, string> = {
  retail: "Frasco (Pix)",
  pix: "Frasco (Pix)",
  card: "Frasco (cartão)",
  wholesale: "Atacado",
  decant_2: "Decant 2ml",
  decant_5: "Decant 5ml",
  decant_10: "Decant 10ml",
  auto: "Frasco: voltar ao automático",
  auto_wholesale: "Atacado: voltar ao automático",
};

type PriceLine = {
  product: ProductCard;
  price_kind: string;
  kind_label: string;
  /** valor gravado (sempre preço Pix); null = voltar ao padrão */
  value: number | null;
  from: number | null;
  to: number | null;
  card_equivalent: number | null;
  reset: boolean;
  cost: number | null;
  gross_profit: number | null;
  margin_percent: number | null;
  below_cost: boolean;
};

/** Monta UMA linha de preço com a mesma conta do catálogo. Devolve pergunta quando falta algo. */
async function buildPriceLine(
  ctx: CopilotCtx,
  args: { product_id: string | null; query: string | null; price_kind: PriceKind; new_price: number | null; delta?: number | null; reset_to_default?: boolean | null },
): Promise<PriceLine | Proposal> {
  const r = await resolveProduct(ctx, args.product_id, args.query);
  if (r.status !== "ok") return needsProduct(r);
  const snap = await productSnapshot(ctx, r.product.id);
  if (!snap) return { kind: "needs", message: "Produto não encontrado." };
  const kind = args.price_kind;
  if (kind === "unknown")
    return { kind: "needs", message: `Qual preço do ${r.product.name}?`, ask: "price_kind", options: ["Frasco (Pix)", "Frasco (cartão)", "Atacado", ...(snap.prices.decant_5ml != null ? ["Decant 2ml", "Decant 5ml", "Decant 10ml"] : [])] };
  const pct = snap.prices.pix_discount_percent;
  const isDecant = kind.startsWith("decant");
  const ml = isDecant ? Number(kind.split("_")[1]) : null;
  const current: number | null = isDecant
    ? (snap.prices as any)[`decant_${ml}ml`]
    : kind === "wholesale" || kind === "auto_wholesale"
      ? snap.prices.wholesale
      : kind === "card"
        ? snap.prices.card
        : snap.prices.pix;
  const cost = isDecant ? decantCost(snap, ml!) : snap.cost;
  const base = { product: r.product, price_kind: kind, kind_label: KIND_LABEL[kind] ?? kind, from: current };

  // voltar ao padrão: decant → preço global; frasco/atacado → automático
  if (args.reset_to_default || kind === "auto" || kind === "auto_wholesale") {
    if (isDecant) {
      if (!snap.prices.decant_custom?.[ml as 2 | 5 | 10]) return { kind: "needs", message: `O ${ml}ml do ${r.product.name} já usa o preço global.` };
      const { getRules } = await import("@/lib/pricing-rules.server");
      const g = Number((await getRules(ctx.adminDb))[`decant_${ml}` as "decant_2"]);
      return { ...base, kind_label: `${KIND_LABEL[kind]}: voltar ao global`, value: null, to: g, card_equivalent: pct > 0 ? money(g / (1 - pct / 100)) : null, reset: true, ...economics(g, cost) };
    }
    const k = kind === "wholesale" || kind === "auto_wholesale" ? "auto_wholesale" : "auto";
    if (snap.prices.mode === "manual") return { kind: "needs", message: "Este produto foi cadastrado à mão e não tem preço automático." };
    const { calculateProductPricing } = await import("@/lib/pricing.server");
    const { data: o } = await ctx.adminDb.from("pricing_overrides").select("*").eq("product_id", r.product.id).maybeSingle();
    const calc = await calculateProductPricing(ctx.adminDb, r.product.id);
    // automático = cálculo sem o preço fixado
    const { commercialPrice: cp } = await import("@/lib/commercial-price");
    const auto = calc?.baseCost != null
      ? cp(money(calc.baseCost + (k === "auto" ? calc.retailMarkup : calc.wholesaleMarkup)), calc.psych)
      : null;
    void o;
    return { ...base, price_kind: k, kind_label: KIND_LABEL[k]!, value: null, to: auto, card_equivalent: auto != null && pct > 0 ? money(auto / (1 - pct / 100)) : null, reset: true, ...economics(auto ?? 0, cost) };
  }

  let target = args.new_price;
  if (target == null && args.delta != null && current != null) target = money(current + args.delta);
  if (target == null || !(target > 0)) return { kind: "needs", message: `Qual o novo preço (${KIND_LABEL[kind]}) do ${r.product.name}?` };
  target = money(target);
  // o banco guarda sempre o preço Pix; "cartão" converte
  const pixValue = kind === "card" && pct > 0 ? money(target * (1 - pct / 100)) : target;
  return {
    ...base,
    value: pixValue,
    to: target,
    card_equivalent: kind !== "card" && !isDecant && pct > 0 ? money(pixValue / (1 - pct / 100)) : kind === "card" ? pixValue : null,
    reset: false,
    ...economics(pixValue, cost),
  };
}

const isLine = (x: PriceLine | Proposal): x is PriceLine => (x as any).kind_label != null && (x as any).kind == null;

export async function proposePrice(
  ctx: CopilotCtx,
  args: { product_id: string | null; query: string | null; price_kind: PriceKind; new_price: number | null; delta: number | null; reset_to_default?: boolean | null },
  utterance: string | null,
): Promise<Proposal> {
  const line = await buildPriceLine(ctx, args);
  if (!isLine(line)) return line;
  return savePending(ctx, "price_change", { product_id: line.product.id, price_kind: line.price_kind, value: line.value }, line, utterance);
}

/** Vários preços de uma vez (mesmo perfume em 2/5/10ml, ou vários perfumes). */
export async function proposePriceBatch(
  ctx: CopilotCtx,
  args: { items: Array<{ product_id: string | null; query: string | null; price_kind: PriceKind; new_price: number | null; reset_to_default?: boolean | null }> },
  utterance: string | null,
): Promise<Proposal> {
  if (!args.items?.length) return { kind: "needs", message: "Quais preços deseja alterar?" };
  if (args.items.length > 60) return { kind: "needs", message: "Máximo de 60 preços por vez. Para todos os produtos, use uma regra global." };
  const lines: PriceLine[] = [];
  for (const it of args.items) {
    const l = await buildPriceLine(ctx, it);
    if (!isLine(l)) return l;
    lines.push(l);
  }
  return savePending(
    ctx,
    "price_batch",
    { items: lines.map((l) => ({ product_id: l.product.id, price_kind: l.price_kind, value: l.value })) },
    { lines, below_cost: lines.filter((l) => l.below_cost).length },
    utterance,
  );
}

/** Regras globais: mostra quantos produtos mudam antes de gravar. */
export async function proposePricingRules(ctx: CopilotCtx, patch: import("@/lib/pricing-rules.server").RulesPatch, utterance: string | null): Promise<Proposal> {
  const { getRules, diffRules, rulesImpact } = await import("@/lib/pricing-rules.server");
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null));
  const before = await getRules(ctx.adminDb);
  const changes = diffRules(before, clean);
  if (!changes.length) return { kind: "needs", message: "Essas regras já estão assim. Nada muda." };
  const impact = await rulesImpact(ctx.adminDb, clean);
  return savePending(ctx, "pricing_rules", { patch: clean, before: Object.fromEntries(changes.map((c) => [c.key, c.from])) }, { changes, impact }, utterance);
}

export async function proposeStock(
  ctx: CopilotCtx,
  args: { items: Array<{ product_id: string | null; query: string | null; mode: "set" | "add" | "remove"; quantity: number }> },
  utterance: string | null,
): Promise<Proposal> {
  const lines = [];
  for (const it of args.items.slice(0, 30)) {
    const r = await resolveProduct(ctx, it.product_id, it.query);
    if (r.status !== "ok") return needsProduct(r);
    const q = Math.max(0, Math.round(Number(it.quantity) || 0));
    const { data: p } = await ctx.adminDb.from("products").select("local_stock, in_stock, availability_override, supplier_available").eq("id", r.product.id).single();
    const before = Number(p.local_stock ?? 0);
    const after = it.mode === "set" ? q : it.mode === "add" ? before + q : before - q;
    const src = (local: number) =>
      p.availability_override === "blocked" ? "blocked" : local > 0 ? "local" : p.availability_override === "available" ? "manual" : p.supplier_available ? "supplier" : "none";
    const avail = (s: string) => (s === "local" || s === "manual" || s === "supplier" ? "Disponível" : "Indisponível");
    lines.push({
      product: r.product,
      mode: it.mode,
      quantity: q,
      before,
      after,
      negative: after < 0,
      availability_before: avail(src(before)),
      availability_after: after < 0 ? null : avail(src(after)),
      source_after: after < 0 ? null : src(after),
    });
  }
  if (!lines.length) return { kind: "needs", message: "Quais perfumes e quantas unidades?" };
  const bad = lines.filter((l) => l.negative);
  if (bad.length)
    return {
      kind: "needs",
      message: bad.map((l) => `${l.product.name}: hoje há ${l.before} unidade(s); não dá para tirar ${l.quantity}.`).join(" "),
    };
  return savePending(ctx, "stock_change", { items: lines.map((l) => ({ product_id: l.product.id, mode: l.mode, quantity: l.quantity, before: l.before })) }, { lines }, utterance);
}

export async function proposeAvailability(ctx: CopilotCtx, args: { product_id: string | null; query: string | null; override: "none" | "available" | "blocked" }, utterance: string | null): Promise<Proposal> {
  const r = await resolveProduct(ctx, args.product_id, args.query);
  if (r.status !== "ok") return needsProduct(r);
  const { data: p } = await ctx.adminDb.from("products").select("availability_override, in_stock, local_stock").eq("id", r.product.id).single();
  const labels = { none: "Automático", available: "Liberado manualmente", blocked: "Escondido (bloqueado)" } as const;
  return savePending(ctx, "availability", { product_id: r.product.id, override: args.override, before: p.availability_override }, {
    product: r.product,
    from: labels[p.availability_override as keyof typeof labels],
    to: labels[args.override],
    orium_stock: p.local_stock,
    public_before: p.in_stock ? "Disponível" : "Indisponível",
  }, utterance);
}

const CATALOG_MODE_LABEL: Record<string, string> = { all: "Todos os produtos elegíveis", selected: "Somente produtos selecionados", none: "Não disponibilizar no catálogo" };

export async function proposeSupplierCatalog(ctx: CopilotCtx, args: { supplier: string; mode: "all" | "selected" | "none" }, utterance: string | null): Promise<Proposal> {
  const { data: sups } = await ctx.adminDb.from("suppliers").select("id, name, catalog_mode, auto_sync").ilike("name", `%${args.supplier.trim().slice(0, 60)}%`).limit(3);
  if (!sups?.length) return { kind: "needs", message: `Não encontrei o fornecedor ${args.supplier}.` };
  if (sups.length > 1) return { kind: "needs", message: `Qual fornecedor? ${sups.map((s: any) => s.name).join(", ")}.` };
  const s = sups[0];
  if (s.catalog_mode === args.mode) return { kind: "needs", message: `${s.name} já está como "${CATALOG_MODE_LABEL[args.mode]}".` };
  return savePending(ctx, "supplier_catalog", { supplier_id: s.id, mode: args.mode, before: s.catalog_mode }, {
    supplier: s.name,
    from: CATALOG_MODE_LABEL[s.catalog_mode] ?? s.catalog_mode,
    to: CATALOG_MODE_LABEL[args.mode],
    sync_continues: !!s.auto_sync,
  }, utterance);
}

export async function proposeCoupon(
  ctx: CopilotCtx,
  args: { code: string | null; percent: number | null; fixed_amount: number | null; min_order: number | null; ends_hint: string | null; max_redemptions: number | null; visibility: "PUBLIC" | "SECRET" | null; applies_to: "BOTH" | "FULL" | "DECANT" | null },
  utterance: string | null,
): Promise<Proposal> {
  if (args.fixed_amount != null || args.min_order != null)
    return { kind: "needs", message: "Hoje os cupons da Orium são só percentuais, sem valor mínimo. Quer um cupom percentual?" };
  const missing = [];
  const code = (args.code ?? "").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!code) missing.push("o código");
  if (args.percent == null) missing.push("a porcentagem");
  if (missing.length) return { kind: "needs", message: `Falta ${missing.join(" e ")} do cupom.` };
  const pct = Number(args.percent);
  if (!(pct > 0 && pct < 90)) return { kind: "needs", message: "A porcentagem precisa ficar entre 1% e 89%." };
  const { data: exists } = await ctx.adminDb.from("coupons").select("id").ilike("code", code).maybeSingle();
  if (exists) return { kind: "needs", message: `Já existe um cupom ${code}.` };
  const ends = parseEndDate(args.ends_hint);
  return savePending(ctx, "coupon_create", { code, percent: pct, ends_at: ends, max_redemptions: args.max_redemptions, visibility: args.visibility ?? "SECRET", applies_to: args.applies_to ?? "BOTH" }, {
    code,
    percent: pct,
    ends_at: ends,
    ends_hint: args.ends_hint,
    max_redemptions: args.max_redemptions,
    visibility: args.visibility === "PUBLIC" ? "Público (aparece na loja)" : "Secreto (só quem tem o código)",
    applies_to: args.applies_to ?? "BOTH",
  }, utterance);
}

export async function proposeCouponToggle(ctx: CopilotCtx, args: { code: string; active: boolean }, utterance: string | null): Promise<Proposal> {
  const { data: c } = await ctx.adminDb.from("coupons").select("id, code, active").ilike("code", args.code.trim()).maybeSingle();
  if (!c) return { kind: "needs", message: `Não encontrei o cupom ${args.code}.` };
  if (c.active === args.active) return { kind: "needs", message: `O cupom ${c.code} já está ${c.active ? "ativo" : "desativado"}.` };
  return savePending(ctx, "coupon_toggle", { id: c.id, active: args.active }, { code: c.code, from: c.active ? "Ativo" : "Desativado", to: args.active ? "Ativo" : "Desativado" }, utterance);
}

export async function proposePromotion(
  ctx: CopilotCtx,
  args: { product_id: string | null; query: string | null; percent: number | null; ends_hint: string | null; applies_to: "BOTH" | "FULL" | "DECANT"; decant_sizes: number[] | null; name: string | null },
  utterance: string | null,
): Promise<Proposal> {
  const r = await resolveProduct(ctx, args.product_id, args.query);
  if (r.status !== "ok") return needsProduct(r);
  if (args.percent == null || !(args.percent > 0 && args.percent < 90)) return { kind: "needs", message: "Qual o desconto da promoção (em %)?" };
  const snap = await productSnapshot(ctx, r.product.id);
  const ends = parseEndDate(args.ends_hint);
  const sizes = (args.decant_sizes ?? []).filter((s) => [2, 5, 10].includes(s));
  const price = snap?.prices.retail ?? null;
  const promo = price != null ? money(price * (1 - args.percent / 100)) : null;
  return savePending(ctx, "promotion_create", {
    product_id: r.product.id,
    percent: args.percent,
    ends_at: ends,
    applies_to: args.applies_to,
    decant_sizes: args.applies_to === "FULL" ? [] : sizes.length ? sizes : [2, 5, 10],
    name: args.name?.trim() || `${r.product.name} ${args.percent}%`,
  }, {
    product: r.product,
    percent: args.percent,
    applies_to: args.applies_to,
    decant_sizes: sizes,
    ends_at: ends,
    ends_hint: args.ends_hint,
    price_from: price,
    price_to: args.applies_to === "DECANT" ? null : promo,
    cost: snap?.cost ?? null,
    below_cost: promo != null && snap?.cost != null && promo < snap.cost,
  }, utterance);
}

export async function proposePromotionEnd(ctx: CopilotCtx, args: { product_id: string | null; query: string | null }, utterance: string | null): Promise<Proposal> {
  const r = await resolveProduct(ctx, args.product_id, args.query);
  if (r.status !== "ok") return needsProduct(r);
  const active = (await queryPromotions(ctx)).filter((p: any) => (p.product_ids ?? []).includes(r.product.id));
  if (!active.length) return { kind: "needs", message: `${r.product.name} não tem promoção ativa.` };
  return savePending(ctx, "promotion_end", { ids: active.map((p: any) => p.id) }, { product: r.product, promotions: active.map((p: any) => ({ name: p.name, percent: p.discount_percent })) }, utterance);
}

export async function proposeOrderStatus(ctx: CopilotCtx, args: { order_number: string; status: string }, utterance: string | null): Promise<Proposal> {
  if (!ORDER_STATUSES.includes(args.status as never)) return { kind: "needs", message: "Situação inválida. Use pendente, pedido feito, entregue ou cancelado." };
  const o = await findOrder(ctx.adminDb, args.order_number);
  if (!o) return { kind: "needs", message: `Não encontrei o pedido ${args.order_number}.` };
  if (o.status === args.status) return { kind: "needs", message: `O pedido ${o.order_number} já está como "${o.status}".` };
  return savePending(ctx, "order_status", { order_id: o.id, status: args.status, before: o.status }, {
    order_number: o.order_number,
    customer: o.customer_name,
    total: num(o.final_total) ?? num(o.grand_total),
    from: o.status,
    to: args.status,
  }, utterance);
}

export async function proposeOrderToRestock(ctx: CopilotCtx, args: { order_number: string }, utterance: string | null): Promise<Proposal> {
  const o = await findOrder(ctx.adminDb, args.order_number);
  if (!o) return { kind: "needs", message: `Não encontrei o pedido ${args.order_number}.` };
  const { restockPreviewForOrder } = await import("@/lib/orders-restock.server");
  const items = await restockPreviewForOrder(ctx.adminDb, o.id);
  const pick = items.filter((i) => i.suggested > 0);
  if (!pick.length) return { kind: "needs", message: `Os itens do pedido ${o.order_number} já estão na reposição.` };
  return savePending(ctx, "order_to_restock", {
    order_id: o.id,
    items: pick.map((i) => ({ orderItemId: i.orderItemId, quantity: i.suggested })),
  }, { order_number: o.order_number, items: pick.map((i) => ({ name: i.name, variant: i.variantLabel, quantity: i.suggested, supplier: i.supplierName, image_url: i.image })) }, utterance);
}

export async function proposeRestockAdd(
  ctx: CopilotCtx,
  args: { items: Array<{ product_id: string | null; query: string | null; quantity: number; supplier: string | null }> },
  utterance: string | null,
): Promise<Proposal> {
  const { offersFor } = await import("@/lib/purchase/compare.server");
  const lines = [];
  for (const it of args.items.slice(0, 30)) {
    const r = await resolveProduct(ctx, it.product_id, it.query);
    if (r.status !== "ok") return needsProduct(r);
    const offers = (await offersFor(ctx.adminDb, [r.product.id])).get(r.product.id) ?? [];
    const usable = offers.filter((o) => o.price != null);
    let chosen = it.supplier
      ? usable.find((o) => o.supplier_name.toLowerCase().includes(it.supplier!.toLowerCase()))
      : [...usable].filter((o) => o.status === "disponivel").sort((a, b) => a.price! - b.price!)[0] ?? [...usable].sort((a, b) => a.price! - b.price!)[0];
    if (!chosen) return { kind: "needs", message: it.supplier ? `${it.supplier} não tem ${r.product.name}.` : `Nenhum fornecedor tem preço para ${r.product.name}.` };
    const q = Math.max(1, Math.round(it.quantity || 1));
    lines.push({ product: r.product, quantity: q, supplier_id: chosen.supplier_id, supplier: chosen.supplier_name, unit_cost: chosen.price, status: chosen.status, subtotal: money(chosen.price! * q), manual: !!it.supplier });
  }
  if (!lines.length) return { kind: "needs", message: "Quais perfumes e quantas unidades?" };
  return savePending(ctx, "restock_add", { lines: lines.map((l) => ({ product_id: l.product.id, supplier_id: l.supplier_id, quantity: l.quantity, unit_cost: l.unit_cost, manual: l.manual })) }, { lines, total: money(lines.reduce((s, l) => s + l.subtotal, 0)) }, utterance);
}

// ---------------------------------------------------------------- execução

async function setPrice(ctx: CopilotCtx, productId: string, kind: string, value: number | null, actionId?: string) {
  const { updateProductPrice } = await import("@/lib/product-admin.server");
  await updateProductPrice(ctx, { productId, kind: (kind === "retail" || kind === "card" ? "pix" : kind) as any, value, source: "copilot", actionId: actionId ?? null });
}

async function currentPriceState(ctx: CopilotCtx, productId: string) {
  const [{ data: p }, { data: o }] = await Promise.all([
    ctx.adminDb.from("products").select("manual_pricing, retail_price, wholesale_price, decant_price_2ml, decant_price_5ml, decant_price_10ml").eq("id", productId).single(),
    ctx.adminDb.from("pricing_overrides").select("fixed_retail_price, fixed_wholesale_price").eq("product_id", productId).maybeSingle(),
  ]);
  return { p, o };
}

/** Executa uma ação já confirmada. Retorna antes/depois para a resposta e para o desfazer. */
async function run(ctx: CopilotCtx, tool: string, params: any, actionId: string): Promise<any> {
  const db = ctx.adminDb;
  switch (tool) {
    case "price_change":
    case "price_batch": {
      const items = tool === "price_change" ? [params] : (params.items as any[]);
      const done: any[] = [];
      const failed: any[] = [];
      const undo: any[] = [];
      for (const it of items) {
        try {
          const { p, o } = await currentPriceState(ctx, it.product_id);
          const kind = it.price_kind as string;
          if (kind.startsWith("decant")) undo.push({ product_id: it.product_id, price_kind: kind, value: num(p[`decant_price_${kind.split("_")[1]}ml`]) });
          else if (kind === "wholesale" || kind === "auto_wholesale") {
            const prev = p.manual_pricing ? num(p.wholesale_price) : num(o?.fixed_wholesale_price);
            undo.push({ product_id: it.product_id, price_kind: prev == null ? "auto_wholesale" : "wholesale", value: prev });
          } else {
            const prev = p.manual_pricing ? num(p.retail_price) : num(o?.fixed_retail_price);
            undo.push({ product_id: it.product_id, price_kind: prev == null ? "auto" : "pix", value: prev });
          }
          const k = kind === "card" || kind === "retail" ? "pix" : kind;
          await setPrice(ctx, it.product_id, k, it.value == null ? null : Number(it.value), actionId);
          const after = await currentPriceState(ctx, it.product_id);
          done.push({ product_id: it.product_id, price_kind: kind, after: { retail: num(after.p.retail_price), wholesale: num(after.p.wholesale_price), decant_2ml: num(after.p.decant_price_2ml), decant_5ml: num(after.p.decant_price_5ml), decant_10ml: num(after.p.decant_price_10ml) } });
        } catch (e) {
          failed.push({ product_id: it.product_id, error: e instanceof Error ? e.message : "falhou" });
        }
      }
      if (tool === "price_change" && failed.length) throw new Error(failed[0].error);
      return {
        done,
        failed,
        after: done[0]?.after,
        undo: undo.length ? { tool: "price_batch", params: { items: undo } } : null,
      };
    }
    case "pricing_rules": {
      const { applyRules } = await import("@/lib/pricing-rules.server");
      const r = await applyRules(ctx.userDb, ctx.userId, params.patch, "copilot");
      return { changes: r.changes, recalculated: r.recalculated, undo: { tool: "pricing_rules", params: { patch: params.before, before: params.patch } } };
    }
    case "stock_change": {
      const done: any[] = [];
      const failed: any[] = [];
      for (const it of params.items as any[]) {
        const { setLocalStock } = await import("@/lib/product-admin.server");
        const { data, error } = await setLocalStock(ctx, { productId: it.product_id, mode: it.mode, quantity: it.quantity, source: "copilot", actionId }).then(
          (d) => ({ data: d, error: null as any }),
          (e: Error) => ({ data: null as any, error: e }),
        );
        if (error) failed.push({ product_id: it.product_id, error: error.message });
        else done.push(data);
      }
      return {
        done,
        failed,
        undo: done.length ? { tool: "stock_change", params: { items: done.map((d) => ({ product_id: d.product_id, mode: "set", quantity: d.before })) } } : null,
      };
    }
    case "supplier_catalog": {
      const { error } = await ctx.userDb.from("suppliers").update({ catalog_mode: params.mode }).eq("id", params.supplier_id);
      if (error) throw new Error(error.message);
      return { mode: params.mode, undo: { tool: "supplier_catalog", params: { supplier_id: params.supplier_id, mode: params.before, before: params.mode } } };
    }
    case "availability": {
      const { setAvailabilityMode, OVERRIDE_TO_MODE } = await import("@/lib/product-admin.server");
      const data = await setAvailabilityMode(ctx, { productId: params.product_id, mode: OVERRIDE_TO_MODE[params.override] ?? "AUTO", source: "copilot", actionId });
      return { ...data, undo: { tool: "availability", params: { product_id: params.product_id, override: data.before } } };
    }
    case "coupon_create": {
      const { data, error } = await ctx.userDb
        .from("coupons")
        .insert({ code: params.code, discount_percent: params.percent, visibility: params.visibility, applies_to: params.applies_to, product_ids: [], decant_sizes: [], ends_at: params.ends_at, max_redemptions: params.max_redemptions, active: true })
        .select("id, code")
        .single();
      if (error) throw new Error(error.message);
      return { coupon: data, undo: { tool: "coupon_toggle", params: { id: data.id, active: false } } };
    }
    case "coupon_toggle": {
      const { error } = await ctx.userDb.from("coupons").update({ active: params.active }).eq("id", params.id);
      if (error) throw new Error(error.message);
      return { active: params.active, undo: { tool: "coupon_toggle", params: { id: params.id, active: !params.active } } };
    }
    case "promotion_create": {
      const { data, error } = await ctx.userDb
        .from("promotions")
        .insert({ name: params.name, discount_percent: params.percent, applies_to: params.applies_to, product_ids: [params.product_id], decant_sizes: params.decant_sizes, starts_at: new Date().toISOString(), ends_at: params.ends_at, active: true, announce: false })
        .select("id, name")
        .single();
      if (error) throw new Error(error.message);
      return { promotion: data, undo: { tool: "promotion_end", params: { ids: [data.id] } } };
    }
    case "promotion_end": {
      const { error } = await ctx.userDb.from("promotions").update({ active: false }).in("id", params.ids);
      if (error) throw new Error(error.message);
      return { ended: params.ids.length, undo: { tool: "promotion_reactivate", params: { ids: params.ids } } };
    }
    case "promotion_reactivate": {
      const { error } = await ctx.userDb.from("promotions").update({ active: true }).in("id", params.ids);
      if (error) throw new Error(error.message);
      return { reactivated: params.ids.length };
    }
    case "order_status": {
      const { data: o } = await db.from("catalog_orders").select("status").eq("id", params.order_id).single();
      const now = new Date().toISOString();
      const { error } = await db
        .from("catalog_orders")
        .update({ status: params.status, updated_at: now, ...(params.status === "cancelado" ? { canceled_at: now } : { canceled_at: null }) })
        .eq("id", params.order_id);
      if (error) throw new Error(error.message);
      await db.from("order_events").insert({ order_id: params.order_id, event: `status_${String(params.status).replace(/\s+/g, "_")}`, created_by: ctx.userId, details: { via: "copilot" } }).then(() => null, () => null);
      if (params.status === "cancelado") {
        const { resyncRestockForOrder } = await import("@/lib/orders-restock.server");
        await (resyncRestockForOrder as any)(db, params.order_id, ctx.userId, true).catch(() => null);
      }
      return { from: o.status, to: params.status, undo: { tool: "order_status", params: { order_id: params.order_id, status: o.status } } };
    }
    case "order_to_restock": {
      const { addOrderItemsToRestock } = await import("@/lib/orders-restock.server");
      return { result: await addOrderItemsToRestock(db, params.order_id, params.items, ctx.userId) };
    }
    case "command_save": {
      const row = { name: params.name, phrases: params.phrases, instructions: params.instructions, active: true, updated_at: new Date().toISOString() };
      if (params.id) {
        const { data: before } = await ctx.userDb.from("copilot_commands").select("name, phrases, instructions, active").eq("id", params.id).single();
        const { error } = await ctx.userDb.from("copilot_commands").update(row).eq("id", params.id);
        if (error) throw new Error(error.message);
        return { name: params.name, updated: true, undo: { tool: "command_restore", params: { id: params.id, ...before } } };
      }
      const { data, error } = await ctx.userDb.from("copilot_commands").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      return { name: params.name, created: true, undo: { tool: "command_delete", params: { id: data.id } } };
    }
    case "command_restore": {
      const { id, ...rest } = params;
      const { error } = await ctx.userDb.from("copilot_commands").upsert({ id, ...rest, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return { name: rest.name };
    }
    case "command_delete": {
      const { data: before } = await ctx.userDb.from("copilot_commands").select("id, name, phrases, instructions, active").eq("id", params.id).single();
      const { error } = await ctx.userDb.from("copilot_commands").delete().eq("id", params.id);
      if (error) throw new Error(error.message);
      return { name: before?.name, undo: before ? { tool: "command_restore", params: before } : null };
    }
    case "restock_add": {
      const { openRestockList } = await import("@/lib/orders-restock.server");
      const listId = await openRestockList(db, ctx.userId);
      const { data: current } = await db.from("restock_items").select("id, product_id, supplier_id, quantity").eq("restock_list_id", listId).eq("status", "a comprar");
      let added = 0;
      let updated = 0;
      const failed: any[] = [];
      for (const l of params.lines as any[]) {
        const ex = (current ?? []).find((c: any) => c.product_id === l.product_id && c.supplier_id === l.supplier_id);
        const res = ex
          ? await db.from("restock_items").update({ quantity: Number(ex.quantity ?? 0) + l.quantity, unit_cost: l.unit_cost, manual_choice: l.manual }).eq("id", ex.id)
          : await db.from("restock_items").insert({ restock_list_id: listId, product_id: l.product_id, supplier_id: l.supplier_id, quantity: l.quantity, unit_cost: l.unit_cost, cost_locked: true, manual_choice: l.manual });
        if (res.error) failed.push({ product_id: l.product_id, error: res.error.message });
        else if (ex) updated++;
        else added++;
      }
      return { added, updated, failed };
    }
    case "store_sale_register": {
      const { data: result, error } = await ctx.userDb.rpc("store_sale_commit", {
        p_payload: {
          idempotency_key: params.idempotency_key,
          entry_method: "voice",
          payment_method: params.payment_method,
          customer_id: null,
          customer_name: params.customer_name ?? null,
          sold_at: null,
          transcript: params.transcript ?? null,
          discount: null,
          total: null,
          items: params.items.map((i: any) => ({ product_id: i.product_id, variant: i.variant, decant_ml: i.decant_ml, quantity: i.quantity, unit_price: i.unit_price })),
        },
      });
      if (error) throw new Error(error.message);
      const sale = result as { id: string; duplicate: boolean };
      // aprendizado de voz: só agora, depois da confirmação real
      if (!sale.duplicate) await learnVoiceAliases(ctx, params.items);
      return { sale_id: sale.id, duplicate: sale.duplicate, undo: { tool: "store_sale_cancel", params: { id: sale.id } } };
    }
    case "order_create": {
      const { data: order, error } = await db
        .from("catalog_orders")
        .insert({
          customer_name: params.customer_name,
          customer_phone: params.customer_phone ?? null,
          customer_phone_normalized: params.customer_phone ? `55${String(params.customer_phone).replace(/\D/g, "")}` : null,
          total_quantity: params.total_quantity,
          pricing_tier: params.tier,
          sales_total: params.total,
          cost_total: params.cost_total ?? 0,
          grand_total: params.total,
          status: "pendente",
          origin: "MANUAL",
          order_origin: "MANUAL",
          fulfillment_type: "PICKUP",
          shipping_price: 0,
          notes: params.notes ?? null,
          is_confirmed: true,
          confirmed_at: new Date().toISOString(),
          created_by: ctx.userId,
          idempotency_key: params.idempotency_key,
        })
        .select("id, order_number")
        .single();
      if (error || !order) throw new Error(error?.message ?? "Não foi possível criar o pedido.");
      const { error: ie } = await db.from("catalog_order_items").insert(params.items.map((r: any) => ({ ...r, order_id: order.id })));
      if (ie) throw new Error(ie.message);
      await db.from("order_events").insert({ order_id: order.id, event: "pedido_criado", created_by: ctx.userId, details: { origin: "copilot" } }).then(() => null, () => null);
      if (params.amount_paid > 0) {
        await db.from("catalog_orders").update({ amount_paid: params.amount_paid }).eq("id", order.id);
        await db.from("order_events").insert({
          order_id: order.id,
          event: params.amount_paid >= params.total ? "pagamento_integral" : "pagamento_sinal",
          created_by: ctx.userId,
          details: { amount: params.amount_paid, before: 0, after: params.amount_paid, total: params.total, origin: "copilot" },
        }).then(() => null, () => null);
      }
      const { resyncRestockForOrder } = await import("@/lib/orders-restock.server");
      await (resyncRestockForOrder as any)(db, order.id, ctx.userId).catch(() => null);
      return { order_number: order.order_number, undo: { tool: "order_status", params: { order_id: order.id, status: "cancelado" } } };
    }
    case "store_sale_cancel": {
      const { error } = await ctx.userDb.rpc("store_sale_cancel", { p_id: params.id, p_reason: "Desfeito pelo Copilot" });
      if (error) throw new Error(error.message);
      return { canceled: params.id };
    }
    default:
      throw new Error("Ação desconhecida.");
  }
}

export async function executeAction(ctx: CopilotCtx, actionId: string, opts: { voice?: boolean } = {}) {
  const { data: a } = await ctx.userDb.from("copilot_actions").select("*").eq("id", actionId).maybeSingle();
  if (!a || a.user_id !== ctx.userId) throw new Error("Ação não encontrada.");
  if (a.status !== "pending") throw new Error(a.status === "done" ? "Esta ação já foi executada." : "Esta ação não está mais pendente.");
  if (Date.parse(a.expires_at) < Date.now()) {
    await ctx.userDb.from("copilot_actions").update({ status: "expired" }).eq("id", a.id);
    throw new Error("A confirmação expirou. Peça de novo.");
  }
  const meta = ACTIONS[a.tool];
  if (!meta) throw new Error("Ação desconhecida.");
  allowed(ctx, meta);
  if (opts.voice && meta.risk === "CRITICAL") throw new Error("Esta ação precisa ser confirmada na tela.");
  // trava: só um executor ganha (dois toques em Confirmar executam uma vez)
  const { data: claimed } = await ctx.userDb.from("copilot_actions").update({ status: "running" }).eq("id", a.id).eq("status", "pending").select("id");
  if (!claimed?.length) throw new Error("Esta ação já está sendo executada.");
  try {
    const result = await run(ctx, a.tool, a.params, a.id);
    const partial = Array.isArray(result?.failed) && result.failed.length > 0;
    await ctx.userDb
      .from("copilot_actions")
      .update({ status: partial ? "partial" : "done", result, executed_at: new Date().toISOString() })
      .eq("id", a.id);
    return { ok: true, partial, tool: a.tool, preview: a.preview, result: { ...result, undo: undefined }, undoable: !!result?.undo && meta.reversible };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha desconhecida.";
    await ctx.userDb.from("copilot_actions").update({ status: "failed", error: message, executed_at: new Date().toISOString() }).eq("id", a.id);
    return { ok: false, partial: false, tool: a.tool, preview: a.preview, error: message, undoable: false };
  }
}

/** Desfazer = nova operação auditada no servidor, nunca rollback de tela. */
export async function undoAction(ctx: CopilotCtx, actionId: string) {
  const { data: a } = await ctx.userDb.from("copilot_actions").select("*").eq("id", actionId).maybeSingle();
  if (!a || a.user_id !== ctx.userId) throw new Error("Ação não encontrada.");
  if (!["done", "partial"].includes(a.status) || !a.result?.undo) throw new Error("Esta ação não pode ser desfeita.");
  if (a.undone_by) throw new Error("Esta ação já foi desfeita.");
  if (Date.now() - Date.parse(a.executed_at) > 5 * 60 * 1000) throw new Error("O prazo para desfazer passou (5 minutos).");
  const undo = a.result.undo;
  const { data: row, error } = await ctx.userDb
    .from("copilot_actions")
    .insert({ user_id: ctx.userId, thread_id: a.thread_id, tool: undo.tool, intent: "UNDO", risk: a.risk, params: undo.params, preview: { undo_of: a.preview }, utterance: "Desfazer", undo_of: a.id, status: "running" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  try {
    const result = await run(ctx, undo.tool, undo.params, row.id);
    await ctx.userDb.from("copilot_actions").update({ status: "done", result: { ...result, undo: undefined }, executed_at: new Date().toISOString() }).eq("id", row.id);
    await ctx.userDb.from("copilot_actions").update({ undone_by: row.id, status: "undone" }).eq("id", a.id);
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha";
    await ctx.userDb.from("copilot_actions").update({ status: "failed", error: message }).eq("id", row.id);
    throw new Error(`Não consegui desfazer: ${message}`);
  }
}

export { commercialPrice };


// ---------------------------------------------------------------- comandos personalizados

export async function queryCommands(ctx: CopilotCtx) {
  const { data } = await ctx.userDb.from("copilot_commands").select("id, name, phrases, instructions, active").order("created_at");
  return { commands: data ?? [] };
}

async function findCommand(ctx: CopilotCtx, name: string) {
  const { data } = await ctx.userDb.from("copilot_commands").select("id, name, phrases, instructions, active");
  const key = name.trim().toLowerCase();
  return (data ?? []).find((c: any) => c.name.toLowerCase() === key || (c.phrases ?? []).some((p: string) => p.toLowerCase() === key)) ?? null;
}

export async function proposeCommandSave(
  ctx: CopilotCtx,
  args: { existing_name: string | null; name: string; phrases: string[]; steps: string[]; instructions: string },
  utterance: string | null,
): Promise<Proposal> {
  const name = args.name.trim().slice(0, 60);
  const phrases = Array.from(new Set([name, ...args.phrases].map((p) => p.trim()).filter(Boolean))).slice(0, 12);
  const instructions = args.instructions.trim().slice(0, 600);
  if (!name || instructions.length < 3) return { kind: "needs", message: "Preciso do nome do comando e do que ele deve fazer." };
  const existing = await findCommand(ctx, args.existing_name ?? name);
  if (existing && !args.existing_name && existing.name.toLowerCase() === name.toLowerCase())
    return { kind: "needs", message: `Já existe um comando “${existing.name}”. Quer alterar ele?`, options: [`Alterar o comando ${existing.name}`] };
  if (args.existing_name && !existing) return { kind: "needs", message: `Não encontrei o comando “${args.existing_name}”.` };
  return savePending(ctx, "command_save", { id: existing?.id ?? null, name, phrases, instructions }, {
    name,
    phrases,
    steps: args.steps.slice(0, 8),
    editing: !!existing,
    before: existing ? { instructions: existing.instructions } : null,
  }, utterance);
}

export async function proposeCommandDelete(ctx: CopilotCtx, args: { name: string }, utterance: string | null): Promise<Proposal> {
  const c = await findCommand(ctx, args.name);
  if (!c) return { kind: "needs", message: `Não encontrei o comando “${args.name}”.` };
  return savePending(ctx, "command_delete", { id: c.id }, { name: c.name, phrases: c.phrases, instructions: c.instructions }, utterance);
}


// ---------------------------------------------------------------- venda da loja (voz e texto)

/** Guarda "como foi ouvido → perfume confirmado". Só é chamado depois da confirmação. */
export async function learnVoiceAliases(ctx: CopilotCtx, items: Array<{ spoken?: string | null; product_id: string; name?: string | null }>) {
  const { flat, phoneticKey } = await import("@/lib/store-sales-phonetics");
  const { forgetCatalogIndex } = await import("@/lib/store-sales-match.server");
  let learned = 0;
  await Promise.all(
    items.map(async (i) => {
      const spoken = flat(i.spoken ?? "");
      if (spoken.length < 3 || !i.product_id || spoken === flat(i.name ?? "")) return;
      learned++;
      await ctx.userDb.rpc("voice_alias_learn", { p_transcript: spoken, p_phonetic: phoneticKey(spoken), p_product_id: i.product_id }).then(
        () => undefined,
        () => undefined,
      );
    }),
  );
  if (learned) forgetCatalogIndex();
}

export type SaleItemArg = {
  product_id: string | null;
  query: string | null;
  spoken: string | null;
  variant: "FULL" | "DECANT" | "UNKNOWN";
  decant_ml: number | null;
  quantity: number;
  unit_price: number | null;
};

const PAYMENT_LABEL: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão", DINHEIRO: "Dinheiro" };

/**
 * Monta a venda: todos os perfumes resolvidos de uma vez (sem N+1), preço do
 * sistema, e só pergunta o que falta. Itens resolvidos nunca são descartados.
 */
export async function proposeStoreSale(
  ctx: CopilotCtx,
  args: { items: SaleItemArg[]; payment_method: "PIX" | "CARTAO" | "DINHEIRO" | null; customer_name: string | null },
  utterance: string | null,
): Promise<any> {
  const { resolveProductCandidates, confidenceOf, candidateById } = await import("@/lib/store-sales-match.server");
  const { inferVariant, suggestPrice } = await import("@/lib/store-sales.functions");
  const items = (args.items ?? []).slice(0, 20);
  if (!items.length) return { kind: "needs", message: "O que foi vendido?" };

  const [{ data: decant }, resolved] = await Promise.all([
    ctx.adminDb.from("decant_settings").select("*").maybeSingle(),
    Promise.all(
      items.map(async (it) => {
        if (it.product_id) {
          const c = await candidateById(ctx.adminDb, it.product_id);
          if (c) return { it, chosen: c, candidates: [c], ok: true };
        }
        const q = (it.query ?? it.spoken ?? "").trim();
        const cands = q ? await resolveProductCandidates(ctx.adminDb, q, null) : [];
        const ok = confidenceOf(cands) === "high";
        return { it, chosen: ok ? cands[0]! : null, candidates: cands, ok };
      }),
    ),
  ]);

  // a IA fala FRASCO/DECANT/null; o motor de vendas usa FULL/DECANT/UNKNOWN.
  // Sem esse mapa, "FRASCO" e null caíam em "sem preço cadastrado" mesmo com preço no banco.
  const spokenVariant = (v: unknown, ml: unknown): "FULL" | "DECANT" | "UNKNOWN" => {
    const s = String(v ?? "").toUpperCase();
    if (s === "FRASCO" || s === "FULL") return "FULL";
    if (s === "DECANT" || [2, 5, 10].includes(Number(ml))) return "DECANT";
    return "UNKNOWN";
  };
  const lines = resolved.map(({ it, chosen, candidates, ok }) => {
    const inf = inferVariant(chosen, spokenVariant(it.variant, it.decant_ml));
    const ml = inf.variant === "DECANT" && [2, 5, 10].includes(Number(it.decant_ml)) ? (Number(it.decant_ml) as 2 | 5 | 10) : null;
    const price = it.unit_price && it.unit_price > 0 ? it.unit_price : suggestPrice(chosen, (decant ?? null) as any, inf.variant, ml);
    return {
      ok,
      spoken: it.spoken ?? it.query,
      query: it.query,
      candidates,
      product: chosen ? { id: chosen.product_id, name: chosen.name, brand: chosen.brand, image_url: chosen.image_url, volume_ml: chosen.volume_ml } : null,
      variant: inf.variant,
      decant_ml: ml,
      quantity: Math.max(1, Math.min(99, Math.round(it.quantity || 1))),
      unit_price: price,
    };
  });

  // preço oficial (mesmo motor do carrinho: promoções ativas e atacado) quando o Admin não falou um preço
  const quotable = lines.filter((l, i) => l.ok && !(items[i]!.unit_price! > 0) && (l.variant === "FULL" || (l.variant === "DECANT" && l.decant_ml)));
  if (quotable.length) {
    try {
      const { quoteSale } = await import("@/lib/copilot/pricing-tools.server");
      const q = await quoteSale(ctx, quotable.map((l) => ({ product_id: l.product!.id, variant: l.variant as "FULL" | "DECANT", decant_ml: l.decant_ml, quantity: l.quantity })), { payment_method: args.payment_method });
      quotable.forEach((l, i) => { if (q.lines[i]?.unit_price) l.unit_price = q.lines[i]!.unit_price; });
    } catch (e) {
      console.error("copilot: cotação oficial falhou, usando preço-base", e instanceof Error ? e.message : e);
    }
  }

  const done = lines.filter((l) => l.ok).map((l) => ({ product_id: l.product!.id, name: l.product!.name, spoken: l.spoken, variant: l.variant, decant_ml: l.decant_ml, quantity: l.quantity }));
  const summary = lines.filter((l) => l.ok).map((l) => `✓ ${l.quantity} × ${l.product!.name}`).join(" · ");
  const lead = summary ? `${summary}. ` : "";

  const doubtful = lines.find((l) => !l.ok);
  if (doubtful)
    return {
      kind: "needs",
      message: doubtful.candidates.length ? `${lead}Qual é o “${doubtful.spoken}”?` : `${lead}Não encontrei “${doubtful.spoken}” no catálogo. Qual perfume é?`,
      candidates: doubtful.candidates.slice(0, 5).map((c) => ({ id: c.product_id, name: c.name, brand: c.brand, image_url: c.image_url, volume_ml: c.volume_ml })),
      resolved: done,
    };
  const noVariant = lines.find((l) => l.variant === "UNKNOWN");
  if (noVariant) return { kind: "needs", message: `${lead}${noVariant.product!.name}: frasco ou decant?`, options: ["Frasco", "Decant 2ml", "Decant 5ml", "Decant 10ml"], resolved: done };
  const noSize = lines.find((l) => l.variant === "DECANT" && !l.decant_ml);
  if (noSize) return { kind: "needs", message: `${noSize.product!.name} · ${noSize.quantity} × Decant. Qual tamanho?`, options: ["2ml", "5ml", "10ml"], resolved: done };
  const noPrice = lines.find((l) => !(Number(l.unit_price) > 0));
  if (noPrice) return { kind: "needs", message: `${noPrice.product!.name} está sem preço cadastrado. Por quanto foi vendido?`, resolved: done };
  if (!args.payment_method) return { kind: "needs", message: `${lead}Qual foi o pagamento?`, options: ["Pix", "Cartão", "Dinheiro"], resolved: done };

  const total = money(lines.reduce((s, l) => s + Number(l.unit_price) * l.quantity, 0));
  return savePending(
    ctx,
    "store_sale_register",
    {
      idempotency_key: crypto.randomUUID(),
      payment_method: args.payment_method,
      customer_name: args.customer_name ?? null,
      transcript: utterance,
      items: lines.map((l) => ({ product_id: l.product!.id, name: l.product!.name, spoken: l.spoken, variant: l.variant, decant_ml: l.decant_ml, quantity: l.quantity, unit_price: Number(l.unit_price) })),
    },
    {
      lines: lines.map((l) => ({ product: l.product, variant: l.variant, decant_ml: l.decant_ml, quantity: l.quantity, unit_price: Number(l.unit_price), subtotal: money(Number(l.unit_price) * l.quantity) })),
      payment: PAYMENT_LABEL[args.payment_method] ?? args.payment_method,
      customer_name: args.customer_name,
      total,
    },
    utterance,
  );
}

/** Pedido manual pelo Copilot: preços sempre do motor oficial; sinal calculado no backend. */
export async function proposeOrderCreate(
  ctx: CopilotCtx,
  args: { customer_name: string | null; customer_phone: string | null; items: Array<{ product_id: string | null; query: string | null; variant: "FRASCO" | "DECANT" | null; decant_ml: number | null; quantity: number }>; payment: "unpaid" | "deposit" | "paid" | null; deposit_percent: number | null; notes: string | null },
  utterance: string | null,
): Promise<any> {
  const name = (args.customer_name ?? "").trim();
  if (name.length < 2) return { kind: "needs", message: "Qual o nome do cliente?" };
  if (!args.items?.length) return { kind: "needs", message: "Quais perfumes entram no pedido?" };
  const resolvedItems = [];
  for (const it of args.items.slice(0, 20)) {
    const r = await resolveProduct(ctx, it.product_id, it.query);
    if (r.status !== "ok") return needsProduct(r);
    const variant = it.variant === "DECANT" || [2, 5, 10].includes(Number(it.decant_ml)) ? "DECANT" : "FULL";
    if (variant === "DECANT" && ![2, 5, 10].includes(Number(it.decant_ml))) return { kind: "needs", message: `${r.product.name}: decant de quantos ml?`, options: ["2ml", "5ml", "10ml"] };
    resolvedItems.push({ product_id: r.product.id, variant: variant as "FULL" | "DECANT", decant_ml: variant === "DECANT" ? Number(it.decant_ml) : null, quantity: Math.max(1, Math.round(it.quantity || 1)) });
  }
  if (!args.payment) return { kind: "needs", message: "Pagamento: não pago, 50% de sinal ou pago integralmente?", options: ["Não pago", "50% pago", "Pago integralmente"] };
  const { quoteSale } = await import("@/lib/copilot/pricing-tools.server");
  const pct = args.payment === "paid" ? 100 : args.payment === "deposit" ? (args.deposit_percent ?? 50) : 0;
  const q = await quoteSale(ctx, resolvedItems, { deposit_percent: pct, payment_method: "PIX" });
  const { data: costs } = await ctx.adminDb.from("product_costs").select("product_id, best_cost").in("product_id", resolvedItems.map((i) => i.product_id));
  const costOf = new Map<string, number>((costs ?? []).map((c: any) => [c.product_id as string, Number(c.best_cost ?? 0)]));
  const items = q.lines.map((l) => ({
    product_id: l.product.id,
    quantity: l.quantity,
    unit_sale_price: l.unit_price,
    unit_cost_snapshot: l.variant === "FULL" ? (costOf.get(l.product.id) ?? null) : decantUnitCost(costOf.get(l.product.id) ?? null, l.product.volume_ml, l.decant_ml ?? 0),
    subtotal: l.subtotal,
    product_name_snapshot: l.product.name,
    variant: l.variant,
    decant_ml: l.decant_ml,
    variant_label: l.variant === "DECANT" ? `Decant ${l.decant_ml}ml` : l.product.volume_ml ? `Frasco ${l.product.volume_ml}ml` : "Frasco",
  }));
  const amountPaid = q.deposit?.amount_paid ?? 0;
  return savePending(
    ctx,
    "order_create",
    {
      idempotency_key: crypto.randomUUID(),
      customer_name: name.slice(0, 120),
      customer_phone: args.customer_phone?.slice(0, 20) ?? null,
      notes: args.notes ?? null,
      tier: q.tier,
      total: q.total,
      total_quantity: q.lines.reduce((a, l) => a + l.quantity, 0),
      cost_total: money(items.reduce((a, i) => a + Number(i.unit_cost_snapshot ?? 0) * i.quantity, 0)),
      amount_paid: amountPaid,
      items,
    },
    {
      customer_name: name,
      lines: q.lines,
      total: q.total,
      payment: args.payment === "paid" ? "Pago integralmente" : args.payment === "deposit" ? `Sinal ${pct}%` : "Não pago",
      amount_paid: amountPaid,
      amount_due: money(q.total - amountPaid),
    },
    utterance,
  );
}
