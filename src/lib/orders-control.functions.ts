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
  /** pedido ainda em andamento (não entregue, não cancelado, não excluído) */
  active: boolean;
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
  supplierPhone: string | null;
  supplierMinOrder: number | null;
  plannedDate: string | null;
  /** pedido ao fornecedor (registro) em que este item foi pedido, se houver */
  supplierOrderId: string | null;
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
      db.from("suppliers").select("id, name, phone, min_order"),
      db.from("restock_item_sources").select("restock_item_id, order_id, quantity").in("restock_item_id", rows.map((r) => r.id)),
      db
        .from("supplier_products")
        .select("product_id, supplier_id, normalized_cost, price, in_stock")
        .in("product_id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"])
        .eq("in_stock", true),
    ]);
    const { data: sois } = await db.from("supplier_order_items").select("restock_item_id, supplier_order_id").in("restock_item_id", rows.map((r) => r.id));
    const soOf = new Map((sois ?? []).map((x: any) => [x.restock_item_id, x.supplier_order_id as string]));
    const orderIds = [...new Set((sources ?? []).map((s: any) => s.order_id))];
    const { data: orders } = orderIds.length
      ? await db
          .from("catalog_orders")
          .select("id, order_number, customer_name, status, deleted_at, canceled_at, expected_delivery_date, amount_paid, final_total, grand_total, sales_total")
          .in("id", orderIds)
      : { data: [] as any[] };

    const pMap = new Map((products ?? []).map((p: any) => [p.id, p]));
    const sMap = new Map<string, string>((suppliers ?? []).map((s: any) => [s.id as string, s.name as string] as [string, string]));
    const supInfo = new Map((suppliers ?? []).map((s: any) => [s.id, s]));
    const oMap = new Map((orders ?? []).map((o: any) => [o.id, o]));
    void supplierIds;

    const out: PurchaseItem[] = rows.map((r) => {
      const p: any = pMap.get(r.product_id) ?? {};
      const unitCost = Number(r.unit_cost ?? 0);
      const best = (offers ?? [])
        .filter((o: any) => o.product_id === r.product_id && o.supplier_id !== r.supplier_id)
        .map((o: any) => ({ supplier: sMap.get(o.supplier_id) ?? "Outro fornecedor", cost: Number(o.normalized_cost ?? o.price ?? 0) }))
        .filter((o: any) => o.cost > 0)
        .sort((a: any, b: any) => a.cost - b.cost)[0];
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
        supplierPhone: (supInfo.get(r.supplier_id) as any)?.phone ?? null,
        supplierMinOrder: (supInfo.get(r.supplier_id) as any)?.min_order != null ? Number((supInfo.get(r.supplier_id) as any).min_order) : null,
        plannedDate: r.planned_purchase_date ?? null,
        supplierOrderId: (soOf.get(r.id) as string) ?? null,
        purchasedAt: r.purchased_at ?? null,
        receivedAt: r.received_at ?? null,
        cheaper: best && unitCost > 0 && best.cost < unitCost - 0.5 ? best : null,
        sources: (sources ?? [])
          .filter((s: any) => s.restock_item_id === r.id)
          .map((s: any) => {
            const o: any = oMap.get(s.order_id) ?? {};
            return {
              orderId: s.order_id,
              active: !!o.id && !o.deleted_at && !o.canceled_at && !["entregue", "cancelado"].includes(o.status),
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
 * Marca como pedido ao fornecedor e GUARDA o pedido (supplier_orders):
 * o que foi pedido, quanto, a que custo e a mensagem enviada.
 * Só muda quem ainda está "a comprar": clique duplo/duas abas não duplicam.
 */
export const markPurchased = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemIds: string[]; via?: "whatsapp" | "manual"; message?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const ids = (data.itemIds ?? []).filter(Boolean).slice(0, 500);
    const now = new Date().toISOString();
    const { data: rows } = await db
      .from("restock_items")
      .update({ status: "pedido feito", purchased_at: now, updated_at: now })
      .in("id", ids)
      .eq("status", "a comprar")
      .select("id, product_id, supplier_id, quantity, unit_cost, extra_fee");
    const done = (rows ?? []) as any[];
    const orders: number[] = [];
    if (done.length) {
      const productIds = [...new Set(done.map((r) => r.product_id).filter(Boolean))];
      const [{ data: products }, { data: suppliers }] = await Promise.all([
        db.from("products").select("id, canonical_name, brand, image_url, volume_ml").in("id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"]),
        db.from("suppliers").select("id, name"),
      ]);
      const pMap = new Map((products ?? []).map((p: any) => [p.id, p]));
      const sMap = new Map((suppliers ?? []).map((x: any) => [x.id, x.name]));
      const bySup = new Map<string, any[]>();
      done.forEach((r) => bySup.set(r.supplier_id ?? "", [...(bySup.get(r.supplier_id ?? "") ?? []), r]));
      for (const [supId, list] of bySup) {
        const total = list.reduce((acc, r) => acc + (Number(r.unit_cost ?? 0) + Number(r.extra_fee ?? 0)) * Number(r.quantity ?? 0), 0);
        const { data: order, error } = await db
          .from("supplier_orders")
          .insert({
            supplier_id: supId || null,
            supplier_name: (sMap.get(supId) as string) ?? "Sem fornecedor",
            status: "enviado",
            units: list.reduce((acc, r) => acc + Number(r.quantity ?? 0), 0),
            total: Math.round(total * 100) / 100,
            message: data.message?.slice(0, 4000) ?? null,
            sent_via: data.via === "manual" ? "manual" : "whatsapp",
            created_by: context.userId,
          })
          .select("id, seq")
          .single();
        if (error || !order) continue;
        orders.push(order.seq);
        await db.from("supplier_order_items").insert(
          list.map((r) => {
            const p: any = pMap.get(r.product_id) ?? {};
            return {
              supplier_order_id: order.id,
              restock_item_id: r.id,
              product_id: r.product_id,
              name: p.canonical_name ?? "Produto",
              brand: p.brand ?? null,
              image_url: p.image_url ?? null,
              volume_ml: p.volume_ml ?? null,
              quantity: Number(r.quantity ?? 1),
              unit_cost: Number(r.unit_cost ?? 0) + Number(r.extra_fee ?? 0),
            };
          }),
        );
      }
    }
    const doneIds = new Set(done.map((r) => r.id));
    return { ok: true as const, updated: done.length, skipped: ids.filter((i) => !doneIds.has(i)).length, orders };
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
    const got = (rows ?? []).map((r: any) => r.id);
    if (got.length) {
      const { data: sois } = await db.from("supplier_order_items").select("id, supplier_order_id, quantity").in("restock_item_id", got).is("result", null);
      for (const it of sois ?? []) await db.from("supplier_order_items").update({ result: "ok", received_qty: it.quantity }).eq("id", it.id);
      await refreshOrderStatus(db, [...new Set<string>((sois ?? []).map((x: any) => x.supplier_order_id as string))]);
    }
    return { ok: true as const, updated: got.length };
  });

/**
 * Exclui pedidos ao fornecedor (teste ou engano). Os perfumes voltam para
 * "a comprar" — continuam em Compras para os clientes que ainda precisam.
 */
export const deleteSupplierOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ids: string[] }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const ids = (data.ids ?? []).filter(Boolean).slice(0, 100);
    if (!ids.length) return { ok: true as const, deleted: 0, reopened: 0 };
    const { data: its } = await db.from("supplier_order_items").select("restock_item_id").in("supplier_order_id", ids);
    const rIds = [...new Set((its ?? []).map((i: any) => i.restock_item_id).filter(Boolean))] as string[];
    await db.from("supplier_orders").delete().in("id", ids);
    const { reopenRestockItems } = await import("@/lib/orders-restock.server");
    const reopened = rIds.length ? await reopenRestockItems(db, rIds) : 0;
    return { ok: true as const, deleted: ids.length, reopened };
  });

/** Desfaz "comprado" (errou o clique): volta para "a comprar". */
export const undoPurchased = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const ids = (data.itemIds ?? []).filter(Boolean).slice(0, 500);
    const { data: rows } = await db.from("restock_items").select("id").in("id", ids).eq("status", "pedido feito");
    const back = (rows ?? []).map((r: any) => r.id);
    if (back.length) {
      const { data: sois } = await db.from("supplier_order_items").select("id, supplier_order_id").in("restock_item_id", back).is("result", null);
      if (sois?.length) {
        await db.from("supplier_order_items").delete().in("id", sois.map((x: any) => x.id));
        for (const oid of new Set(sois.map((x: any) => x.supplier_order_id))) {
          const { count } = await db.from("supplier_order_items").select("id", { count: "exact", head: true }).eq("supplier_order_id", oid);
          if (!count) await db.from("supplier_orders").update({ status: "cancelado", updated_at: new Date().toISOString() }).eq("id", oid);
        }
      }
      const { reopenRestockItems } = await import("@/lib/orders-restock.server");
      await reopenRestockItems(db, back);
    }
    return { ok: true as const, updated: back.length };
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

/** WhatsApp do fornecedor (para mandar o pedido direto). */
export const saveSupplierPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { supplierId: string; phone: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    let d = (data.phone ?? "").replace(/\D/g, "");
    if (d.length > 11 && d.startsWith("55")) d = d.slice(-11);
    if (d.length < 10) throw new Error("WhatsApp inválido. Use DDD + número.");
    const { error } = await db.from("suppliers").update({ phone: d }).eq("id", data.supplierId);
    if (error) throw new Error("Não foi possível salvar o WhatsApp.");
    return { ok: true as const, phone: d };
  });

/**
 * Arquiva itens "a comprar" cujos pedidos já foram todos entregues ou
 * cancelados (sobras antigas). Confere no servidor, item por item: se algum
 * pedido ainda estiver em andamento, o item fica.
 */
export const archiveStalePurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const ids = (data.itemIds ?? []).filter(Boolean).slice(0, 500);
    if (!ids.length) return { ok: true as const, archived: 0 };
    const { data: sources } = await db.from("restock_item_sources").select("restock_item_id, order_id").in("restock_item_id", ids);
    const orderIds = [...new Set((sources ?? []).map((s: any) => s.order_id))];
    const { data: orders } = orderIds.length
      ? await db.from("catalog_orders").select("id, status, deleted_at, canceled_at").in("id", orderIds)
      : { data: [] as any[] };
    const done = new Map((orders ?? []).map((o: any) => [o.id, !!o.deleted_at || !!o.canceled_at || ["entregue", "cancelado"].includes(o.status)]));
    const safe = ids.filter((id) => {
      const src = (sources ?? []).filter((s: any) => s.restock_item_id === id);
      return src.length > 0 && src.every((s: any) => done.get(s.order_id) === true);
    });
    if (!safe.length) return { ok: true as const, archived: 0 };
    const now = new Date().toISOString();
    const { data: rows } = await db
      .from("restock_items")
      .update({ status: "recebido", received_at: now, updated_at: now })
      .in("id", safe)
      .eq("status", "a comprar")
      .select("id");
    return { ok: true as const, archived: (rows ?? []).length };
  });

/* ─────────────── pedidos ao fornecedor: histórico e conferência ─────────────── */

async function refreshOrderStatus(db: any, orderIds: string[]) {
  for (const id of orderIds) {
    const { data: items } = await db.from("supplier_order_items").select("result, resolution").eq("supplier_order_id", id);
    const list = (items ?? []) as any[];
    if (!list.length) continue;
    const allChecked = list.every((i) => i.result);
    const open = list.some((i) => i.result && i.result !== "ok" && !i.resolution);
    const status = !allChecked ? "enviado" : open ? "com_problema" : "conferido";
    await db
      .from("supplier_orders")
      .update({ status, ...(allChecked ? { checked_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() })
      .eq("id", id)
      .neq("status", "cancelado");
  }
}

export type SupplierOrderItem = {
  id: string;
  restockItemId: string | null;
  productId: string | null;
  name: string;
  brand: string | null;
  image: string | null;
  volumeMl: number | null;
  quantity: number;
  unitCost: number;
  result: "ok" | "faltou" | "quebrado" | "errado" | null;
  receivedQty: number | null;
  issueQty: number;
  issueNote: string | null;
  resolution: "chegou" | "repedido" | "reembolso" | "credito" | null;
  resolvedAt: string | null;
  customers: string[];
};
export type SupplierOrder = {
  id: string;
  seq: number;
  supplierId: string | null;
  supplier: string;
  supplierPhone: string | null;
  status: "enviado" | "conferido" | "com_problema" | "cancelado";
  units: number;
  total: number;
  message: string | null;
  via: "whatsapp" | "manual";
  createdAt: string;
  checkedAt: string | null;
  items: SupplierOrderItem[];
};

/** Histórico dos pedidos aos fornecedores (mais recentes primeiro). */
export const supplierOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await requireStaff(context as never);
    const { data: orders } = await db.from("supplier_orders").select("*").neq("status", "cancelado").order("created_at", { ascending: false }).limit(200);
    const list = (orders ?? []) as any[];
    if (!list.length) return { orders: [] as SupplierOrder[] };
    const { data: items } = await db.from("supplier_order_items").select("*").in("supplier_order_id", list.map((o) => o.id)).order("created_at");
    const restockIds = [...new Set((items ?? []).map((i: any) => i.restock_item_id).filter(Boolean))];
    const { data: sources } = restockIds.length
      ? await db.from("restock_item_sources").select("restock_item_id, order_id").in("restock_item_id", restockIds)
      : { data: [] as any[] };
    const orderIds = [...new Set((sources ?? []).map((x: any) => x.order_id))];
    const { data: cos } = orderIds.length ? await db.from("catalog_orders").select("id, customer_name").in("id", orderIds) : { data: [] as any[] };
    const nameOf = new Map((cos ?? []).map((o: any) => [o.id, o.customer_name ?? "Cliente"]));
    const { data: sups } = await db.from("suppliers").select("id, phone");
    const phoneOf = new Map((sups ?? []).map((x: any) => [x.id, x.phone]));
    return {
      orders: list.map((o) => ({
        id: o.id,
        seq: o.seq,
        supplierId: o.supplier_id,
        supplier: o.supplier_name,
        supplierPhone: (phoneOf.get(o.supplier_id) as string) ?? null,
        status: o.status,
        units: o.units,
        total: Number(o.total ?? 0),
        message: o.message,
        via: o.sent_via,
        createdAt: o.created_at,
        checkedAt: o.checked_at,
        items: (items ?? [])
          .filter((i: any) => i.supplier_order_id === o.id)
          .map((i: any) => ({
            id: i.id,
            restockItemId: i.restock_item_id,
            productId: i.product_id,
            name: i.name,
            brand: i.brand,
            image: i.image_url,
            volumeMl: i.volume_ml,
            quantity: i.quantity,
            unitCost: Number(i.unit_cost ?? 0),
            result: i.result,
            receivedQty: i.received_qty,
            issueQty: i.issue_qty ?? 0,
            issueNote: i.issue_note,
            resolution: i.resolution,
            resolvedAt: i.resolved_at,
            customers: [...new Set((sources ?? []).filter((x: any) => x.restock_item_id === i.restock_item_id).map((x: any) => nameOf.get(x.order_id) as string))].filter(Boolean),
          })),
      })) as SupplierOrder[],
    };
  });

/** Volta um item de reposição para "a comprar" (pedir de novo), inteiro ou só a parte que faltou. */
async function reorder(db: any, restockItemId: string, missing: number, total: number) {
  const now = new Date().toISOString();
  if (missing >= total) {
    const { reopenRestockItems } = await import("@/lib/orders-restock.server");
    await reopenRestockItems(db, [restockItemId]);
    return;
  }
  // parte chegou: o item vira "recebido" com o que veio e nasce outro "a comprar" com o que falta
  const { data: it } = await db.from("restock_items").select("*").eq("id", restockItemId).maybeSingle();
  if (!it) return;
  await db.from("restock_items").update({ status: "recebido", quantity: total - missing, received_at: now, updated_at: now }).eq("id", restockItemId);
  const { data: fresh } = await db
    .from("restock_items")
    .insert({
      restock_list_id: it.restock_list_id,
      product_id: it.product_id,
      supplier_id: it.supplier_id,
      quantity: missing,
      unit_cost: it.unit_cost,
      extra_fee: it.extra_fee ?? 0,
      status: "a comprar",
      manual_choice: it.manual_choice ?? false,
      cost_locked: it.cost_locked ?? false,
    })
    .select("id")
    .single();
  if (!fresh) {
    // já existe uma linha aberta desse perfume: soma o que faltou nela
    let q = db.from("restock_items").select("id, quantity").eq("restock_list_id", it.restock_list_id).eq("product_id", it.product_id).eq("status", "a comprar");
    q = it.supplier_id ? q.eq("supplier_id", it.supplier_id) : q.is("supplier_id", null);
    const { data: open } = await q.limit(1).maybeSingle();
    if (open) await db.from("restock_items").update({ quantity: Number(open.quantity ?? 0) + missing, updated_at: now }).eq("id", open.id);
    return;
  }
  const { data: src } = await db.from("restock_item_sources").select("*").eq("restock_item_id", restockItemId).limit(1);
  const first = (src ?? [])[0];
  if (first) {
    await db.from("restock_item_sources").insert({ restock_item_id: fresh.id, order_id: first.order_id, order_item_id: first.order_item_id, quantity: missing });
  }
}

export type CheckInput = {
  orderId: string;
  items: Array<{
    id: string;
    result: "ok" | "faltou" | "quebrado" | "errado";
    /** quantas unidades vieram com problema (faltou/quebrado/errado) */
    issueQty?: number;
    note?: string | null;
    /** o que fazer com o problema: esperar o fornecedor ou pedir de novo agora */
    action?: "esperar" | "repedir";
  }>;
};

/**
 * Conferência da chegada. Item ok → "recebido". Problema → fica registrado;
 * "pedir de novo" devolve o que faltou para o Passo 1; "esperar" deixa em
 * aberto até o fornecedor resolver.
 */
export const checkSupplierOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CheckInput) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const { data: items } = await db.from("supplier_order_items").select("*").eq("supplier_order_id", data.orderId);
    const byId = new Map((items ?? []).map((i: any) => [i.id, i]));
    const now = new Date().toISOString();
    let problems = 0;
    for (const c of data.items ?? []) {
      const it: any = byId.get(c.id);
      if (!it || it.result) continue; // já conferido: não confere de novo
      const qty = Number(it.quantity ?? 1);
      if (c.result === "ok") {
        await db.from("supplier_order_items").update({ result: "ok", received_qty: qty }).eq("id", it.id);
        if (it.restock_item_id)
          await db.from("restock_items").update({ status: "recebido", received_at: now, updated_at: now }).eq("id", it.restock_item_id).eq("status", "pedido feito");
        continue;
      }
      problems++;
      const issueQty = Math.max(1, Math.min(qty, Math.floor(Number(c.issueQty ?? qty))));
      const repedir = c.action === "repedir";
      await db
        .from("supplier_order_items")
        .update({
          result: c.result,
          received_qty: qty - issueQty,
          issue_qty: issueQty,
          issue_note: c.note?.trim().slice(0, 500) || null,
          ...(repedir ? { resolution: "repedido", resolved_at: now } : {}),
        })
        .eq("id", it.id);
      if (it.restock_item_id && repedir) await reorder(db, it.restock_item_id, issueQty, qty);
    }
    await refreshOrderStatus(db, [data.orderId]);
    return { ok: true as const, problems };
  });

/** Problema resolvido: chegou o que faltava, o fornecedor devolveu, deu crédito, ou vou pedir de novo. */
export const resolveSupplierIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemId: string; resolution: "chegou" | "repedido" | "reembolso" | "credito" }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const { data: it } = await db.from("supplier_order_items").select("*").eq("id", data.itemId).maybeSingle();
    if (!it) throw new Error("Item não encontrado.");
    if (it.resolution) return { ok: true as const };
    const now = new Date().toISOString();
    await db.from("supplier_order_items").update({ resolution: data.resolution, resolved_at: now }).eq("id", it.id);
    if (it.restock_item_id) {
      if (data.resolution === "chegou") {
        await db.from("supplier_order_items").update({ received_qty: it.quantity }).eq("id", it.id);
        await db.from("restock_items").update({ status: "recebido", received_at: now, updated_at: now }).eq("id", it.restock_item_id).eq("status", "pedido feito");
      } else {
        // devolveu/crédito/pedir de novo: o cliente ainda precisa do perfume → volta para "pedir"
        await reorder(db, it.restock_item_id, Number(it.issue_qty || it.quantity), Number(it.quantity));
      }
    }
    await refreshOrderStatus(db, [it.supplier_order_id]);
    return { ok: true as const };
  });
