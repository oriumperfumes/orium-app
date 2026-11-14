/**
 * Reposição espelhada a partir dos pedidos confirmados.
 *
 * Regra central: a reposição é sempre reconciliada por DELTA entre o que o
 * pedido tinha e o que passou a ter. Salvar o mesmo pedido várias vezes nunca
 * duplica entradas — cada item do pedido tem no máximo uma origem vinculada.
 */

export type RestockSyncResult = {
  ok: true;
  created: number;
  updated: number;
  removed: number;
  warnings: string[];
};

/** Lista de reposição aberta (cria se não existir). */
export async function openRestockList(db: any, userId?: string) {
  const { data: existing } = await db
    .from("restock_lists")
    .select("id")
    .eq("status", "aberta")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data: created, error } = await db
    .from("restock_lists")
    .insert({ name: "Lista de reposição", created_by: userId ?? null })
    .select("id")
    .single();
  if (error || !created) throw new Error("Não foi possível abrir a lista de reposição.");
  return created.id as string;
}

/** Recalcula a quantidade de um item consolidado a partir das origens (pedidos). */
async function recomputeItem(db: any, restockItemId: string) {
  const { data: sources } = await db
    .from("restock_item_sources")
    .select("quantity")
    .eq("restock_item_id", restockItemId);
  const total = (sources ?? []).reduce((s: number, r: any) => s + Number(r.quantity ?? 0), 0);
  const { data: item } = await db
    .from("restock_items")
    .select("id, status")
    .eq("id", restockItemId)
    .maybeSingle();
  if (!item) return { removed: false, blocked: false };
  if (total === 0) {
    if (item.status === "a comprar") {
      await db.from("restock_items").delete().eq("id", restockItemId);
      return { removed: true, blocked: false };
    }
    return { removed: false, blocked: true };
  }
  await db.from("restock_items").update({ quantity: total }).eq("id", restockItemId);
  return { removed: false, blocked: false };
}

/** Espelha os itens do pedido confirmado na reposição, de forma idempotente. */
export async function resyncRestockForOrder(
  db: any,
  orderId: string,
  userId?: string,
  drop = false,
): Promise<RestockSyncResult> {
  const warnings: string[] = [];
  let created = 0;
  let updated = 0;
  let removed = 0;

  const { data: order } = await db
    .from("catalog_orders")
    .select("id, order_number, customer_name, is_confirmed, status, canceled_at, deleted_at")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new Error("Pedido não encontrado.");

  const shouldDrop =
    drop || !order.is_confirmed || !!order.canceled_at || !!order.deleted_at || order.status === "cancelado";

  const { data: sources } = await db
    .from("restock_item_sources")
    .select("id, order_item_id, restock_item_id, quantity")
    .eq("order_id", orderId);
  const existing = new Map<string, any>((sources ?? []).map((s: any) => [s.order_item_id, s]));

  if (shouldDrop) {
    const touched = new Set<string>();
    for (const s of sources ?? []) {
      const { data: item } = await db
        .from("restock_items")
        .select("id, status")
        .eq("id", s.restock_item_id)
        .maybeSingle();
      if (item && item.status !== "a comprar") {
        warnings.push("Alguns itens já foram comprados no fornecedor e continuam na reposição.");
        continue;
      }
      await db.from("restock_item_sources").delete().eq("id", s.id);
      touched.add(s.restock_item_id);
      removed += 1;
    }
    for (const id of touched) {
      const r = await recomputeItem(db, id);
      if (r.blocked) warnings.push("Um item já comprado permaneceu na lista de reposição.");
    }
    return { ok: true, created, updated, removed, warnings: [...new Set(warnings)] };
  }

  const listId = await openRestockList(db, userId);
  const { data: items } = await db
    .from("catalog_order_items")
    .select("id, product_id, quantity, supplier_id, supplier_chosen, unit_cost_snapshot, variant, decant_ml")
    .eq("order_id", orderId);

  const touched = new Set<string>();

  for (const line of items ?? []) {
    if (!line.product_id) continue;
    // decants saem do frasco já aberto: não geram compra de frasco novo na reposição
    if (line.variant === "DECANT") {
      warnings.push("Decants não entram na reposição automática — confira o frasco de fracionamento.");
      continue;
    }
    const { data: cost } = await db
      .from("product_costs")
      .select("best_cost, best_supplier_id")
      .eq("product_id", line.product_id)
      .maybeSingle();
    // fornecedor escolhido no pedido manda; senão, o melhor custo do momento
    const supplierId = line.supplier_chosen ? line.supplier_id : (cost?.best_supplier_id ?? line.supplier_id ?? null);
    const unitCost = Number((line.supplier_chosen ? line.unit_cost_snapshot : null) ?? cost?.best_cost ?? line.unit_cost_snapshot ?? 0);

    const prevSource = existing.get(line.id);
    if (prevSource) {
      // já foi pedido/recebido do fornecedor para ESTE pedido: não mexe (o perfume é dele)
      const { data: prevItem } = await db.from("restock_items").select("id, status").eq("id", prevSource.restock_item_id).maybeSingle();
      if (prevItem && prevItem.status !== "a comprar") {
        existing.delete(line.id);
        continue;
      }
    }

    // só junta com o que AINDA vai ser pedido: venda nova nunca "pega carona"
    // num perfume que já foi comprado/recebido para outro cliente
    let query = db
      .from("restock_items")
      .select("id, status, unit_cost")
      .eq("restock_list_id", listId)
      .eq("product_id", line.product_id)
      .eq("status", "a comprar");
    query = supplierId ? query.eq("supplier_id", supplierId) : query.is("supplier_id", null);
    const { data: target } = await query.order("created_at", { ascending: true }).limit(1).maybeSingle();

    let restockItemId = target?.id as string | undefined;
    if (!restockItemId) {
      const { data: inserted, error } = await db
        .from("restock_items")
        .insert({
          restock_list_id: listId,
          product_id: line.product_id,
          supplier_id: supplierId,
          unit_cost: unitCost,
          quantity: line.quantity,
        })
        .select("id")
        .single();
      if (error || !inserted) continue;
      restockItemId = inserted.id;
    } else if (unitCost > 0) {
      await db.from("restock_items").update({ unit_cost: unitCost }).eq("id", restockItemId);
    }

    const prev = existing.get(line.id);
    if (prev) {
      if (prev.restock_item_id !== restockItemId) {
        await db.from("restock_item_sources").delete().eq("id", prev.id);
        touched.add(prev.restock_item_id);
        await db.from("restock_item_sources").insert({
          restock_item_id: restockItemId,
          order_id: orderId,
          order_item_id: line.id,
          quantity: line.quantity,
        });
        updated += 1;
      } else if (Number(prev.quantity) !== Number(line.quantity)) {
        await db.from("restock_item_sources").update({ quantity: line.quantity }).eq("id", prev.id);
        updated += 1;
      }
      existing.delete(line.id);
    } else {
      await db.from("restock_item_sources").insert({
        restock_item_id: restockItemId,
        order_id: orderId,
        order_item_id: line.id,
        quantity: line.quantity,
      });
      created += 1;
    }
    touched.add(restockItemId!);
  }

  // itens que saíram do pedido depois da confirmação
  for (const staleSource of existing.values()) {
    await db.from("restock_item_sources").delete().eq("id", staleSource.id);
    touched.add(staleSource.restock_item_id);
    removed += 1;
  }

  for (const id of touched) {
    const r = await recomputeItem(db, id);
    if (r.blocked) warnings.push("Um item já comprado no fornecedor permaneceu na reposição.");
  }

  if (created > 0 || updated > 0 || removed > 0) {
    await db.from("order_events").insert({
      order_id: orderId,
      event: "reposicao_sincronizada",
      created_by: userId ?? null,
      details: { created, updated, removed } as never,
    });
  }

  return { ok: true, created, updated, removed, warnings: [...new Set(warnings)] };
}

/* ------------------------------------------------------------------ *
 * Envio manual e seletivo de itens do pedido para a reposição.
 * Regras: um item de pedido tem no máximo uma origem (order_item_id é
 * único), então reenviar nunca duplica. Decants não viram frasco
 * automaticamente — o operador decide se precisa repor o frasco.
 * ------------------------------------------------------------------ */

export type RestockPreviewItem = {
  orderItemId: string;
  productId: string | null;
  name: string;
  image: string | null;
  variant: string;
  variantLabel: string | null;
  decantMl: number | null;
  quantity: number;
  /** ml consumidos do frasco (só decants) */
  mlUsed: number | null;
  supplierId: string | null;
  supplierName: string;
  unitCost: number;
  /** quantidade já enviada para a reposição a partir deste item */
  sentQuantity: number;
  /** sugestão padrão de unidades a repor */
  suggested: number;
};

/** Itens do pedido prontos para a tela de envio à reposição. */
export async function restockPreviewForOrder(db: any, orderId: string): Promise<RestockPreviewItem[]> {
  const { data: lines } = await db
    .from("catalog_order_items")
    .select(
      "id, product_id, product_name_snapshot, image_snapshot, variant, variant_label, decant_ml, quantity, supplier_id, supplier_chosen, supplier_snapshot, unit_cost_snapshot",
    )
    .eq("order_id", orderId);

  const { data: sources } = await db
    .from("restock_item_sources")
    .select("order_item_id, quantity")
    .eq("order_id", orderId);
  const sent = new Map<string, number>((sources ?? []).map((s: any) => [s.order_item_id, Number(s.quantity ?? 0)]));

  const productIds = [...new Set((lines ?? []).map((l: any) => l.product_id).filter(Boolean))];
  const costs = new Map<string, any>();
  if (productIds.length) {
    const { data: rows } = await db
      .from("product_costs")
      .select("product_id, best_cost, best_supplier_id")
      .in("product_id", productIds);
    (rows ?? []).forEach((r: any) => costs.set(r.product_id, r));
  }

  const images = new Map<string, string | null>();
  if (productIds.length) {
    const { data: rows } = await db.from("products").select("id, image_url").in("id", productIds);
    (rows ?? []).forEach((r: any) => images.set(r.id, r.image_url));
  }

  const supplierIds = [
    ...new Set(
      (lines ?? [])
        .map((l: any) => (l.supplier_chosen ? l.supplier_id : (costs.get(l.product_id)?.best_supplier_id ?? l.supplier_id)))
        .filter(Boolean),
    ),
  ];
  const suppliers = new Map<string, string>();
  if (supplierIds.length) {
    const { data: rows } = await db.from("suppliers").select("id, name").in("id", supplierIds);
    (rows ?? []).forEach((r: any) => suppliers.set(r.id, r.name));
  }

  return (lines ?? []).map((l: any) => {
    const cost = costs.get(l.product_id);
    const supplierId = l.supplier_chosen ? l.supplier_id : (cost?.best_supplier_id ?? l.supplier_id ?? null);
    const decant = l.variant === "DECANT";
    return {
      orderItemId: l.id,
      productId: l.product_id ?? null,
      name: l.product_name_snapshot,
      image: l.image_snapshot ?? images.get(l.product_id) ?? null,
      variant: l.variant,
      variantLabel: l.variant_label ?? null,
      decantMl: l.decant_ml ?? null,
      quantity: Number(l.quantity ?? 0),
      mlUsed: decant ? Number(l.decant_ml ?? 0) * Number(l.quantity ?? 0) : null,
      supplierId,
      supplierName:
        (supplierId ? suppliers.get(supplierId) : null) ?? l.supplier_snapshot ?? "Sem fornecedor definido",
      unitCost: Number((l.supplier_chosen ? l.unit_cost_snapshot : null) ?? cost?.best_cost ?? l.unit_cost_snapshot ?? 0),
      sentQuantity: Number(sent.get(l.id) ?? 0),
      // decant sai do frasco já aberto: nada é sugerido automaticamente
      suggested: decant ? 0 : Number(l.quantity ?? 0),
    } satisfies RestockPreviewItem;
  });
}

/** Envia apenas os itens escolhidos. Itens já enviados são ignorados. */
export async function addOrderItemsToRestock(
  db: any,
  orderId: string,
  picks: Array<{ orderItemId: string; quantity: number }>,
  userId?: string,
) {
  const warnings: string[] = [];
  let created = 0;
  let alreadySent = 0;

  const { data: order } = await db
    .from("catalog_orders")
    .select("id, deleted_at, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new Error("Pedido não encontrado.");
  if (order.deleted_at || order.status === "cancelado")
    throw new Error("Pedido cancelado ou excluído não vai para a reposição.");

  const listId = await openRestockList(db, userId);
  const touched = new Set<string>();

  for (const pick of picks) {
    const qty = Math.max(0, Math.floor(Number(pick.quantity)));
    if (!qty) continue;

    const { data: line } = await db
      .from("catalog_order_items")
      .select("id, order_id, product_id, supplier_id, supplier_chosen, unit_cost_snapshot")
      .eq("id", pick.orderItemId)
      .maybeSingle();
    if (!line || line.order_id !== orderId || !line.product_id) continue;

    // idempotência: order_item_id é único em restock_item_sources
    const { data: existing } = await db
      .from("restock_item_sources")
      .select("id")
      .eq("order_item_id", line.id)
      .maybeSingle();
    if (existing) {
      alreadySent += 1;
      continue;
    }

    const { data: cost } = await db
      .from("product_costs")
      .select("best_cost, best_supplier_id")
      .eq("product_id", line.product_id)
      .maybeSingle();
    // fornecedor escolhido no pedido manda; senão, o melhor custo do momento
    const supplierId = line.supplier_chosen ? line.supplier_id : (cost?.best_supplier_id ?? line.supplier_id ?? null);
    const unitCost = Number((line.supplier_chosen ? line.unit_cost_snapshot : null) ?? cost?.best_cost ?? line.unit_cost_snapshot ?? 0);

    let query = db
      .from("restock_items")
      .select("id, status")
      .eq("restock_list_id", listId)
      .eq("product_id", line.product_id)
      .eq("status", "a comprar");
    query = supplierId ? query.eq("supplier_id", supplierId) : query.is("supplier_id", null);
    const { data: target } = await query.order("created_at", { ascending: true }).limit(1).maybeSingle();

    let restockItemId = target?.id as string | undefined;
    if (!restockItemId) {
      const { data: inserted, error } = await db
        .from("restock_items")
        .insert({
          restock_list_id: listId,
          product_id: line.product_id,
          supplier_id: supplierId,
          unit_cost: unitCost,
          quantity: qty,
        })
        .select("id")
        .single();
      if (error || !inserted) continue;
      restockItemId = inserted.id;
    } else if (unitCost > 0) {
      await db.from("restock_items").update({ unit_cost: unitCost }).eq("id", restockItemId);
    }

    await db.from("restock_item_sources").insert({
      restock_item_id: restockItemId,
      order_id: orderId,
      order_item_id: line.id,
      quantity: qty,
    });
    created += 1;
    touched.add(restockItemId!);
  }

  for (const id of touched) {
    const r = await recomputeItem(db, id);
    if (r.blocked) warnings.push("Um item já comprado no fornecedor permaneceu na reposição.");
  }

  if (created > 0) {
    await db.from("order_events").insert({
      order_id: orderId,
      event: "reposicao_enviada",
      created_by: userId ?? null,
      details: { created } as never,
    });
  }

  return { ok: true as const, created, alreadySent, warnings: [...new Set(warnings)] };
}

/* ------------------------------------------------------------------ *
 * Voltar itens para "a comprar" sem duplicar linha.
 * Só existe UMA linha "a comprar" por perfume+fornecedor (índice parcial
 * restock_items_unique_open_line). Se já houver outra aberta, as origens
 * (pedidos) passam para ela e a linha antiga some.
 * ------------------------------------------------------------------ */

async function openTwin(db: any, item: any) {
  let q = db
    .from("restock_items")
    .select("id")
    .eq("restock_list_id", item.restock_list_id)
    .eq("product_id", item.product_id)
    .eq("status", "a comprar")
    .neq("id", item.id);
  q = item.supplier_id ? q.eq("supplier_id", item.supplier_id) : q.is("supplier_id", null);
  const { data } = await q.limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Volta a linha inteira para "a comprar" (ou junta com a que já está aberta). */
export async function reopenRestockItems(db: any, itemIds: string[]) {
  const now = new Date().toISOString();
  let reopened = 0;
  for (const id of [...new Set(itemIds.filter(Boolean))]) {
    const { data: item } = await db.from("restock_items").select("*").eq("id", id).maybeSingle();
    if (!item || item.status === "a comprar") continue;
    const twin = await openTwin(db, item);
    if (twin) {
      await db.from("restock_item_sources").update({ restock_item_id: twin }).eq("restock_item_id", id);
      await db.from("restock_items").delete().eq("id", id);
      await recomputeItem(db, twin);
    } else {
      await db
        .from("restock_items")
        .update({ status: "a comprar", purchased_at: null, received_at: null, planned_purchase_date: null, updated_at: now })
        .eq("id", id);
    }
    reopened += 1;
  }
  return reopened;
}

/**
 * Tira UM pedido de cliente de uma linha já pedida/recebida e devolve a parte
 * dele para "a comprar" (os outros clientes da linha continuam como estão).
 */
export async function detachOrderFromItem(db: any, sourceId: string) {
  const { data: src } = await db.from("restock_item_sources").select("*").eq("id", sourceId).maybeSingle();
  if (!src) return;
  const { data: item } = await db.from("restock_items").select("*").eq("id", src.restock_item_id).maybeSingle();
  if (!item || item.status === "a comprar") return;
  const { data: all } = await db.from("restock_item_sources").select("id, quantity").eq("restock_item_id", item.id);
  const others = (all ?? []).filter((x: any) => x.id !== sourceId);
  if (!others.length) {
    // a linha era só deste pedido: some do pedido ao fornecedor e volta inteira
    const { data: sois } = await db.from("supplier_order_items").select("id, supplier_order_id").eq("restock_item_id", item.id);
    if (sois?.length) {
      await db.from("supplier_order_items").delete().in("id", sois.map((x: any) => x.id));
      for (const oid of new Set<string>(sois.map((x: any) => x.supplier_order_id))) {
        const { count } = await db.from("supplier_order_items").select("id", { count: "exact", head: true }).eq("supplier_order_id", oid);
        if (!count) await db.from("supplier_orders").delete().eq("id", oid);
      }
    }
    await reopenRestockItems(db, [item.id]);
    return;
  }
  // linha dividida: a parte deste pedido vai para a linha aberta (nova ou existente)
  const twin = await openTwin(db, item);
  let target = twin;
  if (!target) {
    const { data: fresh } = await db
      .from("restock_items")
      .insert({
        restock_list_id: item.restock_list_id,
        product_id: item.product_id,
        supplier_id: item.supplier_id,
        quantity: src.quantity,
        unit_cost: item.unit_cost,
        extra_fee: item.extra_fee ?? 0,
        status: "a comprar",
        manual_choice: item.manual_choice ?? false,
        cost_locked: item.cost_locked ?? false,
      })
      .select("id")
      .single();
    target = fresh?.id ?? null;
  }
  if (!target) return;
  await db.from("restock_item_sources").update({ restock_item_id: target }).eq("id", sourceId);
  await recomputeItem(db, target);
  const rest = others.reduce((s: number, x: any) => s + Number(x.quantity ?? 0), 0);
  await db.from("restock_items").update({ quantity: rest, updated_at: new Date().toISOString() }).eq("id", item.id);
}
