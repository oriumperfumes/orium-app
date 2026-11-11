import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decantLabel, decantPrice, decantUnitCost } from "@/lib/decants";

export type SyncResult = {
  ok: true;
  /** itens de reposição criados a partir deste pedido */
  created: number;
  /** itens já vinculados, apenas atualizados */
  updated: number;
  removed: number;
  /** avisos: itens já comprados no fornecedor que não foram mexidos */
  warnings: string[];
};

const ZERO = "00000000-0000-0000-0000-000000000000";

async function requireStaff(context: { supabase: any; userId: string }) {
  const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!isStaff) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function logEvent(db: any, orderId: string, event: string, userId?: string, details?: unknown) {
  await db.from("order_events").insert({
    order_id: orderId,
    event,
    created_by: userId ?? null,
    details: (details ?? null) as never,
  });
}

const cleanDate = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const cleanTime = (t?: string | null) => (t && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : null);

/** Previsão de entrega: independente de status e pagamento; reagendamento vai ao histórico. */
export const setOrderDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      orderId: string;
      date: string | null;
      time?: string | null;
      notes?: string | null;
      fulfillmentType?: "PICKUP" | "LOCAL" | "SHIPPING";
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const { data: o } = await db
      .from("catalog_orders")
      .select("id, expected_delivery_date, expected_delivery_time, delivery_notes, fulfillment_type")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!o) throw new Error("Pedido não encontrado.");
    const next = {
      expected_delivery_date: cleanDate(data.date),
      expected_delivery_time: cleanDate(data.date) ? cleanTime(data.time) : null,
      delivery_notes: data.notes?.trim().slice(0, 500) || null,
      ...(data.fulfillmentType ? { fulfillment_type: data.fulfillmentType } : {}),
    };
    await db.from("catalog_orders").update({ ...next, updated_at: new Date().toISOString() }).eq("id", data.orderId);
    const prevTime = o.expected_delivery_time ? String(o.expected_delivery_time).slice(0, 5) : null;
    if (o.expected_delivery_date !== next.expected_delivery_date || prevTime !== next.expected_delivery_time) {
      await logEvent(
        db,
        data.orderId,
        !o.expected_delivery_date ? "entrega_agendada" : !next.expected_delivery_date ? "entrega_sem_data" : "entrega_reagendada",
        context.userId,
        { before: o.expected_delivery_date, before_time: prevTime, after: next.expected_delivery_date, after_time: next.expected_delivery_time },
      );
    }
    return { ok: true as const };
  });

/** Reposição por delta — implementação única em orders-restock.server.ts. */
async function syncOrderToRestock(db: any, orderId: string, userId?: string, drop = false): Promise<SyncResult> {
  const { resyncRestockForOrder } = await import("@/lib/orders-restock.server");
  return resyncRestockForOrder(db, orderId, userId, drop);
}


/** Confirma que o cliente fechou a compra e joga os itens na reposição. */
export const confirmOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const { data: order } = await db
      .from("catalog_orders")
      .select("id, is_confirmed, status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("Pedido não encontrado.");

    const alreadyConfirmed = order.is_confirmed;
    if (!alreadyConfirmed) {
      await db
        .from("catalog_orders")
        .update({
          is_confirmed: true,
          confirmed_at: new Date().toISOString(),
          canceled_at: null,
          status: order.status === "cancelado" ? "pendente" : order.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.orderId);
      await logEvent(db, data.orderId, "pedido_confirmado", context.userId);
    }

    const sync = await syncOrderToRestock(db, data.orderId, context.userId);
    return { ...sync, alreadyConfirmed };
  });

/** Reprocessa a reposição depois de editar um pedido já confirmado. */
export const resyncOrderRestock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    return syncOrderToRestock(db, data.orderId, context.userId);
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const sync = await syncOrderToRestock(db, data.orderId, context.userId, true);
    await db
      .from("catalog_orders")
      .update({
        status: "cancelado",
        canceled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.orderId);
    await logEvent(db, data.orderId, "pedido_cancelado", context.userId);
    return sync;
  });

/** Exclusão em lixeira: nada é destruído. */
export const trashOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const sync = await syncOrderToRestock(db, data.orderId, context.userId, true);
    await db
      .from("catalog_orders")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", data.orderId);
    await logEvent(db, data.orderId, "pedido_excluido", context.userId);
    return sync;
  });

export const restoreOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    await db
      .from("catalog_orders")
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq("id", data.orderId);
    await logEvent(db, data.orderId, "pedido_restaurado", context.userId);
    return syncOrderToRestock(db, data.orderId, context.userId);
  });

/** Exclusão definitiva — só o dono. */
export const purgeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isOwner } = await supabase.rpc("has_role", { _user_id: userId, _role: "owner" });
    if (!isOwner) throw new Error("Somente o dono pode excluir definitivamente.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await syncOrderToRestock(db, data.orderId, userId, true);
    await db.from("catalog_orders").delete().eq("id", data.orderId);
    return { ok: true as const };
  });

/** Pedido lançado à mão (WhatsApp ou balcão), com custo e fornecedor do momento. */
export const createManualOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      customerName: string;
      customerPhone?: string;
      /** ficha escolhida no seletor; sem id, o cadastro é criado/encontrado pelo telefone */
      customerId?: string | null;
      origin?: "MANUAL" | "WHATSAPP";
      notes?: string;
      payment?: "unpaid" | "deposit" | "paid";
      /**
       * variant/decantMl/unitPrice são opcionais: sem eles o item é um frasco
       * com o preço vigente (comportamento antigo). unitPrice = preço que a loja
       * realmente vendeu (o Admin pode negociar).
       */
      items: Array<{
        productId: string;
        quantity: number;
        variant?: "FULL" | "DECANT";
        decantMl?: 2 | 5 | 10 | null;
        unitPrice?: number | null;
      }>;
      paymentMethod?: "PIX" | "CARD" | null;
      /** dia combinado para o cliente pagar (AAAA-MM-DD) */
      paymentDueDate?: string | null;
      fulfillmentType?: "PICKUP" | "LOCAL";
      expectedDeliveryDate?: string | null;
      expectedDeliveryTime?: string | null;
      deliveryNotes?: string | null;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const { calculateProductPricing } = await import("@/lib/pricing.server");

    const name = (data.customerName ?? "").trim();
    if (name.length < 2) throw new Error("Informe o nome do cliente.");
    const items = (data.items ?? []).filter((i) => i.productId && Number(i.quantity) > 0);
    if (items.length === 0) throw new Error("Adicione ao menos um produto.");

    const { data: settings } = await db.from("pricing_settings").select("*").maybeSingle();
    const minQty = settings?.wholesale_min_quantity ?? 6;
    // atacado conta só frascos (decant tem preço fixo por tamanho)
    const totalQuantity = items.reduce((s, i) => s + Number(i.quantity), 0);
    const bottleQuantity = items.filter((i) => i.variant !== "DECANT").reduce((s, i) => s + Number(i.quantity), 0);
    const tier = bottleQuantity >= minQty ? "atacado" : "varejo";
    const hasDecant = items.some((i) => i.variant === "DECANT");
    const { data: decantSettings } = hasDecant
      ? await db.from("decant_settings").select("*").maybeSingle()
      : { data: null };

    const rows: any[] = [];
    let salesTotal = 0;
    let costTotal = 0;

    for (const item of items) {
      const pricing = await calculateProductPricing(db, item.productId);
      if (!pricing) continue;
      const qty = Math.floor(Number(item.quantity));
      const decant = item.variant === "DECANT";
      const ml = decant ? ([2, 5, 10].includes(Number(item.decantMl)) ? (Number(item.decantMl) as 2 | 5 | 10) : null) : null;
      if (decant && !ml) throw new Error("Escolha o tamanho do decant (2, 5 ou 10 ml).");

      let listPrice: number;
      if (decant) {
        const { data: prod } = await db
          .from("products")
          .select("decant_price_2ml, decant_price_5ml, decant_price_10ml")
          .eq("id", item.productId)
          .maybeSingle();
        listPrice = decantPrice(prod as never, decantSettings as never, ml!);
      } else {
        listPrice = Number(tier === "atacado" ? pricing.wholesalePrice : pricing.retailPrice) || 0;
      }
      const custom = item.unitPrice != null && Number.isFinite(Number(item.unitPrice)) && Number(item.unitPrice) >= 0;
      const unitPrice = custom ? Math.round(Number(item.unitPrice) * 100) / 100 : listPrice;
      const subtotal = Number((unitPrice * qty).toFixed(2));
      const unitCost = decant ? decantUnitCost(pricing.baseCost, pricing.volumeMl, ml!) : pricing.baseCost;
      const best = pricing.offers.find((o: any) => o.supplierId === pricing.winningSupplierId) ?? null;
      salesTotal += subtotal;
      costTotal += Number(unitCost ?? 0) * qty;
      rows.push({
        product_id: pricing.productId,
        supplier_id: pricing.winningSupplierId,
        supplier_product_id: best?.supplierProductId ?? null,
        quantity: qty,
        unit_base_price: listPrice,
        unit_sale_price: unitPrice,
        unit_cost_snapshot: unitCost,
        subtotal,
        supplier_snapshot: pricing.winningSupplierName,
        supplier_url_snapshot: best?.url ?? null,
        product_name_snapshot: pricing.productName,
        variant: decant ? "DECANT" : "FULL",
        decant_ml: ml,
        variant_label: decant ? decantLabel(ml!) : pricing.volumeMl ? `Frasco ${pricing.volumeMl}ml` : "Frasco",
      });
    }
    if (rows.length === 0) throw new Error("Nenhum produto válido no pedido.");

    let phone = (data.customerPhone ?? "").replace(/\D/g, "");
    if (phone.length > 11 && phone.startsWith("55")) phone = phone.slice(-11);
    let crmId: string | null = null;
    if (data.customerId) {
      const { data: c } = await db.from("crm_customers").select("id").eq("id", data.customerId).maybeSingle();
      if (!c) throw new Error("Cliente selecionado não encontrado.");
      crmId = c.id;
    }
    const { data: order, error } = await db
      .from("catalog_orders")
      .insert({
        customer_name: name.slice(0, 120),
        customer_phone: data.customerPhone?.slice(0, 20) ?? null,
        customer_phone_normalized: phone ? `55${phone}` : null,
        crm_customer_id: crmId,
        total_quantity: totalQuantity,
        pricing_tier: tier,
        sales_total: Number(salesTotal.toFixed(2)),
        cost_total: Number(costTotal.toFixed(2)),
        grand_total: Number(salesTotal.toFixed(2)),
        final_total: Number(salesTotal.toFixed(2)),
        ...(data.paymentMethod ? { payment_method: data.paymentMethod } : {}),
        ...(data.payment !== "paid" && cleanDate(data.paymentDueDate) ? { payment_due_date: cleanDate(data.paymentDueDate) } : {}),
        status: "pendente",
        origin: data.origin ?? "MANUAL",
        order_origin: data.origin ?? "MANUAL",
        fulfillment_type: data.fulfillmentType === "LOCAL" ? "LOCAL" : "PICKUP",
        expected_delivery_date: cleanDate(data.expectedDeliveryDate),
        expected_delivery_time: cleanTime(data.expectedDeliveryTime),
        delivery_notes: data.deliveryNotes?.trim().slice(0, 500) || null,
        shipping_price: 0,
        notes: data.notes ?? null,
        is_confirmed: true,
        confirmed_at: new Date().toISOString(),
        created_by: context.userId,
      })
      .select("id, order_number")
      .single();
    if (error || !order) throw new Error("Não foi possível registrar o pedido.");

    await db.from("catalog_order_items").insert(rows.map((r) => ({ ...r, order_id: order.id })));
    await logEvent(db, order.id, "pedido_criado", context.userId, { origin: data.origin ?? "MANUAL" });
    if (data.payment === "deposit" || data.payment === "paid") {
      const total = Number(salesTotal.toFixed(2));
      const paid = data.payment === "paid" ? total : Math.round(total * 50) / 100;
      await db.from("catalog_orders").update({ amount_paid: paid }).eq("id", order.id);
      await logEvent(db, order.id, data.payment === "paid" ? "pagamento_integral" : "pagamento_sinal", context.userId, {
        amount: paid, before: 0, after: paid, total, origin: "novo_pedido",
      });
    }
    const sync = await syncOrderToRestock(db, order.id, context.userId);
    return { orderId: order.id, orderNumber: order.order_number, ...sync };
  });

/** Duplica um pedido para relançar rapidamente. */
export const duplicateOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const { data: order } = await db.from("catalog_orders").select("*").eq("id", data.orderId).maybeSingle();
    if (!order) throw new Error("Pedido não encontrado.");
    const { data: items } = await db.from("catalog_order_items").select("*").eq("order_id", data.orderId);

    const {
      id: _id,
      created_at: _c,
      updated_at: _u,
      order_number: _n,
      idempotency_key: _k,
      ...rest
    } = order as Record<string, unknown>;

    const { data: copy, error } = await db
      .from("catalog_orders")
      .insert({
        ...rest,
        is_confirmed: false,
        confirmed_at: null,
        canceled_at: null,
        deleted_at: null,
        status: "pendente",
        created_by: context.userId,
      } as never)
      .select("id, order_number")
      .single();
    if (error || !copy) throw new Error("Não foi possível duplicar o pedido.");

    await db.from("catalog_order_items").insert(
      (items ?? []).map((i: any) => {
        const { id, created_at, order_id, ...line } = i;
        return { ...line, order_id: copy.id };
      }),
    );
    await logEvent(db, copy.id, "pedido_criado", context.userId, { duplicatedFrom: data.orderId });
    return { orderId: copy.id, orderNumber: copy.order_number };
  });

/** Atualiza quantidades de um pedido e reflete na reposição. */
export const updateOrderItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string; items: Array<{ id: string; quantity: number }> }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    for (const it of data.items ?? []) {
      const qty = Math.max(0, Math.floor(Number(it.quantity)));
      const { data: row } = await db
        .from("catalog_order_items")
        .select("id, unit_sale_price")
        .eq("id", it.id)
        .maybeSingle();
      if (!row) continue;
      if (qty === 0) {
        await db.from("catalog_order_items").delete().eq("id", it.id);
        continue;
      }
      await db
        .from("catalog_order_items")
        .update({ quantity: qty, subtotal: Number((Number(row.unit_sale_price) * qty).toFixed(2)) })
        .eq("id", it.id);
    }

    const { data: lines } = await db
      .from("catalog_order_items")
      .select("quantity, subtotal, unit_cost_snapshot")
      .eq("order_id", data.orderId);
    const totalQuantity = (lines ?? []).reduce((s: number, l: any) => s + Number(l.quantity), 0);
    const salesTotal = (lines ?? []).reduce((s: number, l: any) => s + Number(l.subtotal), 0);
    const costTotal = (lines ?? []).reduce(
      (s: number, l: any) => s + Number(l.unit_cost_snapshot ?? 0) * Number(l.quantity),
      0,
    );
    const { data: order } = await db
      .from("catalog_orders")
      .select("shipping_price")
      .eq("id", data.orderId)
      .maybeSingle();
    await db
      .from("catalog_orders")
      .update({
        total_quantity: totalQuantity,
        sales_total: Number(salesTotal.toFixed(2)),
        cost_total: Number(costTotal.toFixed(2)),
        grand_total: Number((salesTotal + Number(order?.shipping_price ?? 0)).toFixed(2)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.orderId);
    await logEvent(db, data.orderId, "pedido_editado", context.userId);
    return syncOrderToRestock(db, data.orderId, context.userId);
  });

/**
 * PAGAMENTO — independente do status operacional.
 * mode: unpaid (zera), deposit (sinal = total × deposit_percent), paid (quita), amount (valor livre).
 * O total vem do banco; status/saldo são recalculados pelo trigger catalog_orders_payment_sync.
 * Cada mudança grava um evento "pagamento_*" com o valor (delta) recebido — base do "Recebido".
 */
export type PaymentMode = "unpaid" | "deposit" | "paid" | "amount";
export const setOrderPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string; mode: PaymentMode; amount?: number; origin?: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const { data: o, error } = await db
      .from("catalog_orders")
      .select("id, final_total, grand_total, sales_total, amount_paid, deposit_percent")
      .eq("id", data.orderId)
      .single();
    if (error || !o) throw new Error("Pedido não encontrado.");
    const total = Math.round(Number(o.final_total ?? o.grand_total ?? o.sales_total ?? 0) * 100) / 100;
    const before = Number(o.amount_paid ?? 0);
    const pct = Number(o.deposit_percent ?? 50);
    let after =
      data.mode === "unpaid" ? 0
      : data.mode === "deposit" ? Math.round(total * pct) / 100
      : data.mode === "paid" ? total
      : Math.max(0, Math.round(Number(data.amount ?? 0) * 100) / 100);
    after = Math.min(after, Math.max(total, before));
    const delta = Math.round((after - before) * 100) / 100;
    if (delta === 0) return { ok: true as const, amount_paid: before };
    await db.from("catalog_orders").update({ amount_paid: after, updated_at: new Date().toISOString() }).eq("id", data.orderId);
    const event =
      delta < 0 ? "pagamento_estornado"
      : after >= total ? (before > 0 ? "pagamento_saldo" : "pagamento_integral")
      : "pagamento_sinal";
    await logEvent(db, data.orderId, event, context.userId, {
      amount: delta, before, after, total, origin: data.origin ?? "admin",
    });
    return { ok: true as const, amount_paid: after };
  });

/** Status operacional: pendente → pedido feito → entregue. */
export const setOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string; status: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    await db
      .from("catalog_orders")
      .update({
        status: data.status,
        updated_at: new Date().toISOString(),
        ...(data.status === "cancelado" ? { canceled_at: new Date().toISOString() } : { canceled_at: null }),
      })
      .eq("id", data.orderId);
    await logEvent(db, data.orderId, `status_${data.status.replace(/\s+/g, "_")}`, context.userId);
    if (data.status === "cancelado") return syncOrderToRestock(db, data.orderId, context.userId, true);
    return { ok: true as const, created: 0, updated: 0, removed: 0, warnings: [] as string[] };
  });

/** Situação do item de reposição: a comprar / pedido feito / recebido. */
export const setRestockItemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemId: string; status: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    await db.from("restock_items").update({ status: data.status }).eq("id", data.itemId);
    return { ok: true as const };
  });

/** Itens do pedido prontos para a tela "Enviar para reposição". */
export const orderRestockPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const { restockPreviewForOrder } = await import("@/lib/orders-restock.server");
    return { items: await restockPreviewForOrder(db, data.orderId) };
  });

/** Envia só os itens escolhidos para a reposição, sem duplicar. */
export const sendOrderItemsToRestock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { orderId: string; items: Array<{ orderItemId: string; quantity: number }> }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const { addOrderItemsToRestock } = await import("@/lib/orders-restock.server");
    return addOrderItemsToRestock(db, data.orderId, data.items ?? [], context.userId);
  });
