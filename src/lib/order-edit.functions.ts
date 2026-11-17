import { decantUnitCost } from "@/lib/decants";
/**
 * EDIÇÃO DE PEDIDO (Admin → Pedidos).
 *
 * Um pedido já criado pode ser corrigido sem cancelar e recriar:
 * cliente, telefone, endereço, forma de entrega, itens (frasco e decant),
 * observação, cupom e frete. O preço NUNCA vem do navegador: tudo é
 * recalculado pela engine central (base → promoção → cupom) no servidor.
 *
 * Nada é salvo silenciosamente: `dryRun` devolve o resumo das alterações
 * para o Admin revisar antes de confirmar.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPaymentPricing, normalizePaymentSettings, paymentLabel, type PaymentMethod } from "@/lib/payment-rule";

export type EditVariant = "FULL" | "DECANT";

export type EditItemInput = {
  /** id do item já existente no pedido (quando houver) */
  id?: string | null;
  productId: string;
  variant: EditVariant;
  decantMl?: number | null;
  quantity: number;
  /** preço vendido por unidade, fixado pelo Admin (sem promoção/cupom); omitido = regra da loja */
  unitPrice?: number | null;
};

export type EditOrderInput = {
  orderId: string;
  /** preço de atacado no pedido (automático ou combinado na mão); omitido = não muda */
  wholesale?: boolean;
  /** trava otimista: updated_at que o Admin tinha na tela */
  expectedUpdatedAt?: string | null;
  reason?: string | null;
  dryRun?: boolean;
  /** OWNER pode alterar pedido entregue depois do aviso */
  force?: boolean;
  customerName?: string | null;
  customerPhone?: string | null;
  /** undefined = mantém o vínculo; string = vincula a outra ficha; null = cliente novo (ficha pelo telefone) */
  customerId?: string | null;
  notes?: string | null;
  fulfillment?: "PICKUP" | "LOCAL" | "SHIPPING";
  address?: {
    cep?: string | null;
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    district?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  shipping?: { service?: string | null; price?: number | null; days?: number | null } | null;
  couponCode?: string | null;
  /** forma de pagamento escolhida pelo cliente (PIX por padrão) */
  paymentMethod?: PaymentMethod;
  items: EditItemInput[];
};

export type EditChange = { label: string; from: string; to: string };

export type EditSummary = {
  ok: true;
  saved: boolean;
  /** itens adicionados/removidos/alterados, em texto pronto para a tela */
  added: string[];
  removed: string[];
  changed: string[];
  fields: EditChange[];
  before: { subtotal: number; shipping: number; total: number };
  after: { subtotal: number; shipping: number; total: number };
  promotionDiscount: number;
  couponDiscount: number;
  couponCode: string | null;
  couponMessage: string | null;
  unavailable: string[];
  warnings: string[];
  payment: { method: PaymentMethod; discountPercent: number; pixTotal: number; cardTotal: number; finalTotal: number };
  restock?: { created: number; updated: number; removed: number };
  updatedAt?: string;
};

const digits = (v?: string | null) => (v ?? "").replace(/\D/g, "");
const money = (n: number) => Number(Number(n || 0).toFixed(2));
const brl = (n: number) => `R$ ${money(n).toFixed(2).replace(".", ",")}`;
const lineKey = (productId: string, variant: string, ml: number | null) => `${productId}:${variant}:${ml ?? ""}`;

const variantLabelOf = (variant: EditVariant, ml: number | null, volumeMl?: number | null) =>
  variant === "DECANT" && ml ? `Decant ${ml}ml` : volumeMl ? `Frasco ${volumeMl}ml` : "Frasco";

async function requireStaff(context: { supabase: any; userId: string }) {
  const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!isStaff) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/**
 * Recalcula e (se não for `dryRun`) salva o pedido inteiro.
 * A reposição é reconciliada por delta: salvar duas vezes não duplica nada.
 */
export const saveOrderEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: EditOrderInput) => data)
  .handler(async ({ data, context }): Promise<EditSummary> => {
    const db = await requireStaff(context as never);
    return runOrderEdit(db, context as never, data);
  });

/** Núcleo da edição (também usado pelo Copilot, com a mesma prévia e as mesmas regras). */
export async function runOrderEdit(db: any, context: { supabase: any; userId: string }, data: EditOrderInput): Promise<EditSummary> {
  {
    const { priceCart } = await import("@/lib/promotions.server");
    const { calculateProductPricing } = await import("@/lib/pricing.server");

    const { data: order } = await db.from("catalog_orders").select("*").eq("id", data.orderId).maybeSingle();
    if (!order) throw new Error("Pedido não encontrado.");

    const warnings: string[] = [];

    // pedido entregue: só o dono altera, e sempre com aviso
    if (order.status === "entregue" && !data.dryRun) {
      const { data: isOwner } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "owner",
      });
      if (!isOwner) throw new Error("Este pedido já foi entregue. Somente o dono pode alterá-lo.");
      if (!data.force) {
        throw new Error("Este pedido já foi concluído. Confirme o aviso para alterar.");
      }
      warnings.push("Este pedido já foi concluído. Alterações podem afetar histórico e relatórios.");
    }
    if (["confirmado", "pedido feito"].includes(order.status) || order.is_confirmed) {
      warnings.push("Pedido já confirmado: a reposição será ajustada pela diferença.");
    }

    // trava otimista
    if (data.expectedUpdatedAt && order.updated_at && data.expectedUpdatedAt !== order.updated_at) {
      throw new Error("Este pedido foi alterado por outro usuário. Atualize antes de salvar.");
    }

    const { data: oldItems } = await db.from("catalog_order_items").select("*").eq("order_id", data.orderId);
    const existing = new Map<string, any>(
      (oldItems ?? []).map((i: any) => [lineKey(i.product_id, i.variant, i.decant_ml ?? null), i]),
    );

    const items = (data.items ?? [])
      .filter((i) => i.productId && Number(i.quantity) > 0)
      .map((i) => {
        const variant: EditVariant = i.variant === "DECANT" ? "DECANT" : "FULL";
        const ml = variant === "DECANT" ? Number(i.decantMl) : null;
        if (variant === "DECANT" && ml !== 2 && ml !== 5 && ml !== 10) throw new Error("Tamanho de decant inválido.");
        const fixed = i.unitPrice != null && Number.isFinite(Number(i.unitPrice)) && Number(i.unitPrice) >= 0 ? money(Number(i.unitPrice)) : null;
        return { productId: i.productId, variant, decantMl: ml, quantity: Math.min(999, Math.floor(Number(i.quantity))), fixed };
      });
    if (items.length === 0) throw new Error("O pedido precisa ter ao menos um item.");

    const fulfillment = data.fulfillment ?? order.fulfillment_type ?? "PICKUP";
    const name = (data.customerName ?? order.customer_name ?? "").trim();
    const phoneRaw = data.customerPhone ?? order.customer_phone ?? "";
    const phone = digits(phoneRaw);
    if (data.customerId) {
      const { data: c } = await db.from("crm_customers").select("id").eq("id", data.customerId).maybeSingle();
      if (!c) throw new Error("Cliente selecionado não encontrado.");
    }
    const address = data.address ?? {
      cep: order.shipping_cep,
      street: order.shipping_street,
      number: order.shipping_number,
      complement: order.shipping_complement,
      district: order.shipping_district,
      city: order.shipping_city,
      state: order.shipping_state,
    };

    if (!data.dryRun) {
      if (name.length < 2) throw new Error("Informe o nome do cliente.");
      if (fulfillment !== "PICKUP") {
        if (
          digits(address?.cep).length !== 8 ||
          !address?.street ||
          !address?.number ||
          !address?.district ||
          !address?.city ||
          !address?.state
        ) {
          throw new Error("Complete o endereço de entrega.");
        }
      }
    }

    // engine central de preço: base → promoção → cupom
    const couponCode = data.couponCode === undefined ? (order.coupon_code ?? null) : data.couponCode;
    const priced = await priceCart(db, items.map(({ fixed: _f, ...rest }) => rest), {
      couponCode: couponCode ?? null,
      userId: order.customer_user_id ?? null,
      deviceId: null,
    });
    // preço fixado pelo Admin vale por cima da regra (e tira promoção/cupom daquela linha)
    const fixedByKey = new Map(items.filter((i) => i.fixed != null).map((i) => [lineKey(i.productId, i.variant, i.decantMl), i.fixed as number]));
    const pricedLines = priced.lines.map((l) => {
      const fixed = fixedByKey.get(lineKey(l.productId, l.variant, l.decantMl));
      return fixed == null
        ? l
        : { ...l, unitFinalPrice: fixed, subtotal: money(fixed * l.quantity), promotionDiscount: 0, couponDiscount: 0, promotionId: null, promotionPercent: 0 };
    });
    const pricedByKey = new Map(pricedLines.map((l) => [lineKey(l.productId, l.variant, l.decantMl), l]));

    const shippingPrice =
      fulfillment === "SHIPPING" ? money(Number(data.shipping?.price ?? order.shipping_price ?? 0)) : 0;
    const total = money(pricedLines.reduce((s, l) => s + l.subtotal, 0));
    const subtotal = money(pricedLines.reduce((s, l) => s + l.unitBasePrice * l.quantity, 0));
    const promotionDiscount = money(pricedLines.reduce((s, l) => s + l.promotionDiscount, 0));
    const couponDiscount = money(pricedLines.reduce((s, l) => s + l.couponDiscount, 0));
    const grandTotal = money(total + shippingPrice);

    // pagamento: o total dos produtos é o valor no Pix; o cartão é derivado
    // pela regra central e o frete nunca recebe a diferença.
    const { data: pricingSettings } = await db.from("pricing_settings").select("*").maybeSingle();
    const paymentSettings = normalizePaymentSettings(pricingSettings as never);
    const paymentMethod: PaymentMethod =
      (data.paymentMethod ?? (order.payment_method === "CARD" ? "CARD" : "PIX")) === "CARD" ? "CARD" : "PIX";
    const paymentPricing = getPaymentPricing(total, paymentSettings);
    const pixTotal = money(paymentPricing.pixPrice + shippingPrice);
    const cardTotal = money(paymentPricing.cardPrice + shippingPrice);
    const finalTotal = paymentMethod === "CARD" ? cardTotal : pixTotal;

    const couponOk = priced.coupon.status === "OK";
    const couponMessage =
      priced.coupon.status === "NONE" || couponOk ? null : (priced.coupon as { message: string }).message;
    if (couponCode && !couponOk && couponMessage) warnings.push(`Cupom ${couponCode}: ${couponMessage}`);
    priced.unavailable.forEach((u) => warnings.push(`${u} está indisponível no momento.`));

    // resumo das alterações
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    const rows: any[] = [];
    let costTotal = 0;

    for (const l of pricedLines) {
      const key = lineKey(l.productId, l.variant, l.decantMl);
      const prev = existing.get(key);
      const pricing = await calculateProductPricing(db, l.productId);
      const best = pricing?.offers?.find((o: any) => o.supplierId === pricing.winningSupplierId) ?? null;
      const bottleCost = pricing?.baseCost ?? null;
      const unitCost =
        l.variant === "DECANT" && l.decantMl && bottleCost && pricing?.volumeMl
          ? decantUnitCost(bottleCost, pricing.volumeMl, l.decantMl)
          : l.variant === "DECANT"
            ? null
            : bottleCost;
      if (unitCost) costTotal += unitCost * l.quantity;

      const label = `${pricing?.productName ?? prev?.product_name_snapshot ?? "Produto"} — ${variantLabelOf(
        l.variant,
        l.decantMl,
        pricing?.volumeMl,
      )}`;
      if (!prev) added.push(`${l.quantity}x ${label} — ${brl(l.subtotal)}`);
      else if (Number(prev.quantity) !== l.quantity) changed.push(`${label}: ${prev.quantity} → ${l.quantity}`);
      else if (Math.abs(Number(prev.unit_sale_price) - l.unitFinalPrice) > 0.009)
        changed.push(`${label}: ${brl(Number(prev.unit_sale_price))} → ${brl(l.unitFinalPrice)}`);

      rows.push({
        id: prev?.id ?? null,
        order_id: data.orderId,
        product_id: l.productId,
        variant: l.variant,
        decant_ml: l.decantMl,
        variant_label: variantLabelOf(l.variant, l.decantMl, pricing?.volumeMl),
        supplier_id: pricing?.winningSupplierId ?? null,
        supplier_product_id: best?.supplierProductId ?? null,
        quantity: l.quantity,
        unit_base_price: l.unitBasePrice,
        unit_sale_price: l.unitFinalPrice,
        promotion_id: l.promotionId,
        promotion_percent: l.promotionPercent,
        promotion_discount: l.promotionDiscount,
        coupon_discount: l.couponDiscount,
        unit_cost_snapshot: unitCost,
        subtotal: l.subtotal,
        supplier_snapshot: pricing?.winningSupplierName ?? null,
        supplier_url_snapshot: best?.url ?? null,
        product_name_snapshot: pricing?.productName ?? prev?.product_name_snapshot ?? "Produto",
        image_snapshot: prev?.image_snapshot ?? null,
      });
      existing.delete(key);
    }

    const stale = [...existing.values()];
    for (const s of stale) {
      removed.push(
        `${s.quantity}x ${s.product_name_snapshot} — ${s.variant_label ?? ""} — ${brl(Number(s.subtotal))}`.replace(
          " —  —",
          " —",
        ),
      );
    }

    const fields: EditChange[] = [];
    const track = (label: string, from: unknown, to: unknown) => {
      const a = (from ?? "").toString().trim();
      const b = (to ?? "").toString().trim();
      if (a !== b) fields.push({ label, from: a || "—", to: b || "—" });
    };
    track("Nome", order.customer_name, name);
    track("Telefone", order.customer_phone, phoneRaw);
    if (data.customerId !== undefined && data.customerId !== (order as any).crm_customer_id) track("Cadastro do cliente", (order as any).crm_customer_id ?? "—", data.customerId ?? "novo cadastro");
    track("Entrega", order.fulfillment_type, fulfillment);
    track("CEP", order.shipping_cep, digits(address?.cep));
    track("Endereço", order.shipping_street, address?.street);
    track("Número", order.shipping_number, address?.number);
    track("Complemento", order.shipping_complement, address?.complement);
    track("Bairro", order.shipping_district, address?.district);
    track("Cidade", order.shipping_city, address?.city);
    track("Estado", order.shipping_state, address?.state);
    track("Observação", order.notes, data.notes ?? order.notes);
    track("Cupom", order.coupon_code, couponOk ? (priced.coupon as { code: string }).code : "");
    track(
      "Pagamento",
      paymentLabel(order.payment_method === "CARD" ? "CARD" : "PIX"),
      paymentLabel(paymentMethod),
    );
    if (money(Number(order.shipping_price ?? 0)) !== shippingPrice)
      fields.push({ label: "Frete", from: brl(Number(order.shipping_price ?? 0)), to: brl(shippingPrice) });

    const summary: EditSummary = {
      ok: true,
      saved: false,
      added,
      removed,
      changed,
      fields,
      before: {
        subtotal: money(Number(order.items_subtotal ?? order.sales_total ?? 0)),
        shipping: money(Number(order.shipping_price ?? 0)),
        total: money(Number(order.final_total ?? order.grand_total ?? order.sales_total ?? 0)),
      },
      after: { subtotal, shipping: shippingPrice, total: finalTotal },
      payment: {
        method: paymentMethod,
        discountPercent: paymentPricing.pixDiscountPercent,
        pixTotal,
        cardTotal,
        finalTotal,
      },
      promotionDiscount,
      couponDiscount,
      couponCode: couponOk ? (priced.coupon as { code: string }).code : null,
      couponMessage,
      unavailable: priced.unavailable,
      warnings: [...new Set(warnings)],
    };

    if (data.dryRun) return summary;

    // ---- persistência ----
    for (const s of stale) await db.from("catalog_order_items").delete().eq("id", s.id);
    for (const row of rows) {
      const { id, ...values } = row;
      if (id) await db.from("catalog_order_items").update(values).eq("id", id);
      else await db.from("catalog_order_items").insert(values);
    }

    const now = new Date().toISOString();
    const keepAddress = fulfillment === "PICKUP" ? null : address;
    const { data: updated } = await db
      .from("catalog_orders")
      .update({
        customer_name: name.slice(0, 120) || null,
        customer_phone: phoneRaw ? String(phoneRaw).slice(0, 20) : null,
        customer_phone_normalized: phone ? `55${phone}` : null,
        ...(data.customerId !== undefined ? { crm_customer_id: data.customerId } : {}),
        notes: data.notes ?? order.notes ?? null,
        ...(typeof data.wholesale === "boolean" ? { pricing_tier: data.wholesale ? "atacado" : "varejo" } : {}),
        fulfillment_type: fulfillment,
        shipping_cep: keepAddress ? digits(keepAddress.cep) : null,
        shipping_street: keepAddress?.street ?? null,
        shipping_number: keepAddress?.number ?? null,
        shipping_complement: keepAddress?.complement ?? null,
        shipping_district: keepAddress?.district ?? null,
        shipping_city: keepAddress?.city ?? null,
        shipping_state: keepAddress?.state ?? null,
        shipping_service: fulfillment === "SHIPPING" ? (data.shipping?.service ?? order.shipping_service ?? null) : null,
        shipping_days: fulfillment === "SHIPPING" ? (data.shipping?.days ?? order.shipping_days ?? null) : null,
        shipping_price: shippingPrice,
        total_quantity: items.reduce((s, i) => s + i.quantity, 0),
        items_subtotal: subtotal,
        sales_total: total,
        cost_total: money(costTotal),
        grand_total: grandTotal,
        promotion_discount: promotionDiscount,
        coupon_discount: couponDiscount,
        coupon_id: couponOk ? (priced.coupon as { couponId: string }).couponId : null,
        coupon_code: couponOk ? (priced.coupon as { code: string }).code : null,
        coupon_percent: couponOk ? (priced.coupon as { percent: number }).percent : null,
        payment_method: paymentMethod,
        payment_discount_percent: paymentPricing.pixDiscountPercent,
        pix_total: pixTotal,
        card_total: cardTotal,
        final_total: finalTotal,
        updated_at: now,
      })
      .eq("id", data.orderId)
      .select("updated_at")
      .maybeSingle();

    // histórico do pedido (nunca sobrescreve o passado)
    await db.from("order_events").insert({
      order_id: data.orderId,
      event: "pedido_editado",
      created_by: context.userId,
      details: {
        added,
        removed,
        changed,
        fields,
        reason: data.reason ?? null,
        totalBefore: summary.before.total,
        totalAfter: summary.after.total,
        snapshot: { order, items: oldItems ?? [] },
      } as never,
    });

    // audit log campo a campo
    const audit = [
      ...fields.map((f) => ({ field: f.label, from: f.from, to: f.to })),
      ...added.map((a) => ({ field: "Item adicionado", from: "—", to: a })),
      ...removed.map((r) => ({ field: "Item removido", from: r, to: "—" })),
      ...changed.map((c) => ({ field: "Item alterado", from: "—", to: c })),
    ];
    if (audit.length > 0) {
      await db.from("activity_logs").insert(
        audit.map((a) => ({
          user_id: context.userId,
          action: `pedido editado: ${a.field}`,
          entity: "catalog_orders",
          entity_id: data.orderId,
          details: { field: a.field, before: a.from, after: a.to, reason: data.reason ?? null } as never,
        })),
      );
    }

    // reposição por delta (idempotente: o mesmo pedido salvo 2x não duplica)
    const { resyncRestockForOrder } = await import("@/lib/orders-restock.server");
    const restock = await resyncRestockForOrder(db, data.orderId, context.userId);
    summary.warnings = [...new Set([...summary.warnings, ...restock.warnings])];

    return {
      ...summary,
      saved: true,
      restock: { created: restock.created, updated: restock.updated, removed: restock.removed },
      updatedAt: updated?.updated_at ?? now,
    };
  }
}

/** Busca de produtos para adicionar ao pedido (foto, marca, tipo, preço, disponibilidade). */
export const searchOrderProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const q = (data.q ?? "").trim();
    if (q.length < 2) return { rows: [] as any[] };
    const { data: rows } = await db
      .from("products")
      .select(
        "id, canonical_name, brand, image_url, product_type, volume_ml, in_stock, retail_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml",
      )
      .eq("active", true)
      .eq("catalog_eligible", true)
      .or(`canonical_name.ilike.%${q}%,brand.ilike.%${q}%`)
      .limit(20);
    const { data: settings } = await db.from("decant_settings").select("*").maybeSingle();
    return { rows: rows ?? [], decantSettings: settings ?? null };
  });
