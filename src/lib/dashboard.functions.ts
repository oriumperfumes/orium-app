/**
 * PAINEL DO ADMIN — leitura única e agregada no banco.
 *
 * Regras de cálculo (definidas em public.admin_dashboard):
 * - Pedido válido = não excluído, não cancelado.
 * - Receita de produtos = soma dos itens do pedido (já líquida de promoção/cupom);
 *   se o pedido não tiver itens, cai para os totais gravados no pedido.
 * - Custo = snapshot do custo no momento da venda (unit_cost_snapshot), nunca o custo atual.
 * - Frete fica separado e não entra na receita/margem de produtos.
 * - Lucro bruto = receita de produtos − custo dos produtos vendidos. Não é lucro líquido.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DashboardPoint = { at: string; orders: number; revenue: number; profit: number };

export type DashboardTopProduct = {
  product_id: string | null;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  units: number;
  revenue: number;
  profit: number;
  bottles: number;
  decants: number;
};

export type DashboardChannel = "all" | "app" | "store";

export type DashboardReport = {
  from: string;
  to: string;
  bucket: "hour" | "day";
  channel?: DashboardChannel;
  period: {
    orders: number;
    /** pedidos do aplicativo no período */
    app_orders?: number;
    /** vendas registradas na loja no período */
    store_sales?: number;
    app_revenue?: number;
    store_revenue?: number;
    revenue: number;
    cost: number;
    profit: number;
    margin: number | null;
    ticket: number | null;
    shipping: number;
    previous: { orders: number; revenue: number; profit: number; ticket: number | null };
  };

  series: DashboardPoint[];
  top_products: DashboardTopProduct[];
  pending: {
    count: number;
    total: number;
    recent: Array<{
      id: string;
      order_number: string | null;
      customer: string | null;
      total: number;
      at: string;
      status: string | null;
    }>;
  };
  status_counts: Array<{ status: string; count: number }>;
  attention: {
    pending_orders: number;
    restock_items: number;
    review_products: number;
    negotiation_interests: number;
  };
  restock: {
    items: number;
    units: number;
    cost: number;
    suppliers: Array<{ supplier: string; units: number; cost: number }>;
    low_stock: Array<{ product: string; stock: number | null }>;
  };
  customers: { new: number; leads: number; returning: number; total: number };
  live: { visitors: number; with_cart: number; in_checkout: number };
  stock: { available: number; cost: number };
  payments: Array<{ method: string; orders: number; revenue: number }>;
  variants: { bottles: number; decants: number; ml_2: number; ml_5: number; ml_10: number };
};

export const adminDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { from: string; to: string; channel?: DashboardChannel }) => data)
  .handler(async ({ data, context }) => {
    const { data: report, error } = await (context.supabase as any).rpc("admin_dashboard", {
      p_from: data.from,
      p_to: data.to,
      p_channel: data.channel ?? "all",
    });

    if (error) throw new Error(error.message);
    return report as DashboardReport;
  });

/**
 * Pedidos em atenção: todo pedido ativo ainda não entregue.
 * Pedido feito/confirmado = pago, aguardando entrega (prioridade máxima).
 * Pendente = só enviado ao WhatsApp, ainda não pago (secundário).
 * Ordem: pedido feito → confirmado → pendente; mais antigo primeiro.
 */
export type ActiveOrder = {
  id: string;
  order_number: string | null;
  customer: string | null;
  at: string;
  total: number;
  expected_delivery_date?: string | null;
  expected_delivery_time?: string | null;
  status: string;
  stage: "pendente" | "confirmado" | "andamento";
  /** valor já recebido (sinal ou total) */
  amount_paid: number;
  items: Array<{ name: string; qty: number; label: string | null; product_id: string | null; canonical_id: string | null; decant: boolean }>;
};

export const activeOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("catalog_orders")
      .select("id, order_number, customer_name, created_at, final_total, grand_total, sales_total, status, is_confirmed, amount_paid, expected_delivery_date, expected_delivery_time, catalog_order_items(product_name_snapshot, quantity, variant_label, variant, decant_ml, product_id, products(canonical_name))")
      .is("deleted_at", null)
      .is("canceled_at", null)
      .not("status", "in", "(entregue,cancelado)")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    // Pago primeiro: pedido feito → confirmado → pendente (ainda não é venda).
    const rank = { andamento: 0, confirmado: 1, pendente: 2 } as const;
    const list: ActiveOrder[] = (data ?? []).map((o: any) => {
      const stage: ActiveOrder["stage"] =
        o.status === "pendente" ? (o.is_confirmed ? "confirmado" : "pendente") : "andamento";
      return {
        id: o.id,
        order_number: o.order_number,
        customer: o.customer_name,
        at: o.created_at,
        total: Number(o.final_total ?? o.grand_total ?? o.sales_total ?? 0),
        status: stage === "confirmado" ? "confirmado" : o.status,
        stage,
        amount_paid: Number(o.amount_paid ?? 0),
        expected_delivery_date: o.expected_delivery_date ?? null,
        expected_delivery_time: o.expected_delivery_time ?? null,
        items: (o.catalog_order_items ?? []).map((i: any) => ({ name: i.product_name_snapshot ?? "Item", qty: Number(i.quantity ?? 1), label: i.variant_label, product_id: i.product_id ?? null, canonical_id: i.products?.canonical_name ?? null, decant: Number(i.decant_ml ?? 0) > 0 || String(i.variant ?? "").toLowerCase().includes("decant") })),
      };
    });
    list.sort((a, b) => rank[a.stage] - rank[b.stage] || a.at.localeCompare(b.at));
    return list;
  });

/** Dinheiro que entrou no período (eventos de pagamento) e saldo em aberto hoje. */
export type PaymentSummary = { received: number; receivable: number; receivable_orders: number };
export const adminPaymentSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { from: string; to: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: r, error } = await (context.supabase as any).rpc("admin_payment_summary", {
      p_from: data.from,
      p_to: data.to,
    });
    if (error) throw new Error(error.message);
    return r as PaymentSummary;
  });
