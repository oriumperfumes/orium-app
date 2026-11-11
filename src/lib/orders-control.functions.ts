/**
 * CONTROLE DE PEDIDOS — compras no fornecedor e datas combinadas.
 *
 * - Compras: lê a lista de reposição aberta já pronta para a tela (foto,
 *   fornecedor, custo, para quais clientes) e muda o estado dos itens.
 * - "Comprado" só vale para item ainda "a comprar": clicar duas vezes, ou em
 *   duas abas, nunca registra a mesma compra em dobro.
 * - Data de pagamento combinada no pedido (alerta de atraso).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireStaff(context: { supabase: any; userId: string }) {
  const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!isStaff) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const ymd = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export type PurchaseSource = {
  orderId: string;
  orderNumber: string | null;
  customer: string | null;
  quantity: number;
  status: string | null;
  deliveryDate: string | null;
  paid: number;
  total: number;
};

export type PurchaseItem = {
  id: string;
  productId: string | null;
  name: string;
  brand: string | null;
  image: string | null;
  volumeMl: number | null;
  quantity: number;
  unitCost: number;
  extraFee: number;
  status: "a comprar" | "pedido feito" | "recebido" | string;
  supplierId: string | null;
  supplier: string | null;
  plannedDate: string | null;
  purchasedAt: string | null;
  receivedAt: string | null;
  /** oferta mais barata em estoque em outro fornecedor (se for mais barata) */
  cheaper: { supplier: string; cost: number } | null;
  sources: PurchaseSource[];
};

/** Lista de compras aberta, pronta para a aba "Compras". */
export const purchaseBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await requireStaff(context as never);
    const { data: list } = await db.from("restock_lists").select("id").eq("status", "aberta").limit(1).maybeSingle();
    if (!list) return { items: [] as PurchaseItem[] };
    const { data: items } = await db.from("restock_items").select("*").eq("restock_list_id", list.id);
    const rows = (items ?? []) as any[];
    if (!rows.length) return { items: [] as PurchaseItem[] };

    const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))];
    const supplierIds = [...new Set(rows.map((r) => r.supplier_id).filter(Boolean))];
    const [{ data: products }, { data: suppliers }, { data: sources }, { data: offers }] = await Promise.all([
      db.from("products").select("id, canonical_name, brand, image_url, volume_ml").in("id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"]),
      db.from("suppliers").select("id, name"),
      db.from("restock_item_sources").select("restock_item_id, order_id, quantity").in("restock_item_id", rows.map((r) => r.id)),
      db
        .from("supplier_products")
        .select("product_id, supplier_id, normalized_cost, price, in_stock")
        .in("product_id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"])
        .eq("in_stock", true),
    ]);
    const orderIds = [...new Set((sources ?? []).map((s: any) => s.order_id))];
    const { data: orders } = orderIds.length
      ? await db
          .from("catalog_orders")
          .select("id, order_number, customer_name, status, expected_delivery_date, amount_paid, final_total, grand_total, sales_total")
          .in("id", orderIds)
      : { data: [] as any[] };

    const pMap = new Map((products ?? []).map((p: any) => [p.id, p]));
    const sMap = new Map((suppliers ?? []).map((s: any) => [s.id, s.name as string]));
    const oMap = new Map((orders ?? []).map((o: any) => [o.id, o]));
    void supplierIds;

    const out: PurchaseItem[] = rows.map((r) => {
      const p: any = pMap.get(r.product_id) ?? {};
      const unitCost = Number(r.unit_cost ?? 0);
      const best = (offers ?? [])
        .filter((o: any) => o.product_id === r.product_id && o.supplier_id !== r.supplier_id)
        .map((o: any) => ({ supplier: sMap.get(o.supplier_id) ?? "Outro fornecedor", cost: Number(o.normalized_cost ?? o.price ?? 0) }))
        .filter((o) => o.cost > 0)
        .sort((a, b) => a.cost - b.cost)[0];
      return {
        id: r.id,
        productId: r.product_id,
        name: p.canonical_name ?? "Produto",
        brand: p.brand ?? null,
        image: p.image_url ?? null,
        volumeMl: p.volume_ml ?? null,
        quantity: Number(r.quantity ?? 0),
        unitCost,
        extraFee: Number(r.extra_fee ?? 0),
        status: r.status ?? "a comprar",
        supplierId: r.supplier_id ?? null,
        supplier: r.supplier_id ? (sMap.get(r.supplier_id) ?? "Fornecedor") : null,
        plannedDate: r.planned_purchase_date ?? null,
        purchasedAt: r.purchased_at ?? null,
        receivedAt: r.received_at ?? null,
        cheaper: best && unitCost > 0 && best.cost < unitCost - 0.5 ? best : null,
        sources: (sources ?? [])
          .filter((s: any) => s.restock_item_id === r.id)
          .map((s: any) => {
            const o: any = oMap.get(s.order_id) ?? {};
            return {
              orderId: s.order_id,
              orderNumber: o.order_number ?? null,
              customer: o.customer_name ?? null,
              quantity: Number(s.quantity ?? 0),
              status: o.status ?? null,
              deliveryDate: o.expected_delivery_date ?? null,
              paid: Number(o.amount_paid ?? 0),
              total: Number(o.final_total ?? o.grand_total ?? o.sales_total ?? 0),
            };
          }),
      };
    });
    return { items: out };
  });

/** Agenda (ou desagenda, com date = null) o dia da compra de vários itens. */
export const schedulePurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemIds: string[]; date: string | null }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const ids = (data.itemIds ?? []).filter(Boolean).slice(0, 500);
    if (!ids.length) return { ok: true as const, updated: 0 };
    const { data: rows } = await db
      .from("restock_items")
      .update({ planned_purchase_date: ymd(data.date), updated_at: new Date().toISOString() })
      .in("id", ids)
      .eq("status", "a comprar")
      .select("id");
    return { ok: true as const, updated: (rows ?? []).length };
  });

/**
 * Marca como comprado. Só muda quem ainda está "a comprar": se algum item já
 * tinha sido comprado (outra aba, clique duplo), ele volta em `skipped`.
 */
export const markPurchased = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const ids = (data.itemIds ?? []).filter(Boolean).slice(0, 500);
    const now = new Date().toISOString();
    const { data: rows } = await db
      .from("restock_items")
      .update({ status: "pedido feito", purchased_at: now, updated_at: now })
      .in("id", ids)
      .eq("status", "a comprar")
      .select("id");
    const done = new Set((rows ?? []).map((r: any) => r.id));
    return { ok: true as const, updated: done.size, skipped: ids.filter((i) => !done.has(i)).length };
  });

/** Chegou do fornecedor. Só itens já comprados viram "recebido". */
export const markReceived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const ids = (data.itemIds ?? []).filter(Boolean).slice(0, 500);
    const now = new Date().toISOString();
    const { data: rows } = await db
      .from("restock_items")
      .update({ status: "recebido", received_at: now, updated_at: now })
      .in("id", ids)
      .eq("status", "pedido feito")
      .select("id");
    return { ok: true as const, updated: (rows ?? []).length };
  });

/** Desfaz "comprado" (errou o clique): volta para "a comprar". */
export const undoPurchased = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const ids = (data.itemIds ?? []).filter(Boolean).slice(0, 500);
    const { data: rows } = await db
      .from("restock_items")
      .update({ status: "a comprar", purchased_at: null, updated_at: new Date().toISOString() })
      .in("id", ids)
      .eq("status", "pedido feito")
      .select("id");
    return { ok: true as const, updated: (rows ?? []).length };
  });

/** Dia combinado para o cliente pagar (null tira a data). */
export const setPaymentDueDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string; date: string | null }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const date = ymd(data.date);
    const { error } = await db
      .from("catalog_orders")
      .update({ payment_due_date: date, updated_at: new Date().toISOString() })
      .eq("id", data.orderId);
    if (error) throw new Error("Não foi possível salvar a data.");
    await db.from("order_events").insert({
      order_id: data.orderId,
      event: date ? "pagamento_combinado" : "pagamento_combinado_removido",
      created_by: context.userId,
      details: { date } as never,
    });
    return { ok: true as const };
  });

/** Custo atual por perfume (frasco), para avisar venda abaixo do custo. */
export const productCosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await requireStaff(context as never);
    const { data } = await db.from("product_costs").select("product_id, best_cost").limit(5000);
    const out: Record<string, number> = {};
    (data ?? []).forEach((r: any) => {
      if (r.best_cost != null && Number(r.best_cost) > 0) out[r.product_id] = Number(r.best_cost);
    });
    return out;
  });
