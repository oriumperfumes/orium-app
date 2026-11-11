import { decantUnitCost } from "@/lib/decants";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Limpeza e reclassificação do catálogo — exclusiva de owner/admin, roda em blocos. */
export const cleanupCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { stage?: "ofertas" | "produtos" | "duplicados"; cursor?: number }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
    if (!isStaff) throw new Error("Sem permissão.");
    const { runCatalogCleanup } = await import("@/lib/catalog/cleanup.server");
    return runCatalogCleanup(data.stage ?? "ofertas", data.cursor ?? 0);
  });

/** Unifica dois perfumes decididos na tela de revisão. */
export const mergeCatalogProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { keepId: string; dropId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
    if (!isStaff) throw new Error("Sem permissão.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mergeProducts } = await import("@/lib/catalog/cleanup.server");
    await mergeProducts(supabaseAdmin, data.keepId, data.dropId);
    return { ok: true };
  });

export type CartVariantInput = "FULL" | "DECANT";
export type CartLineInput = { productId: string; quantity: number; variant?: CartVariantInput; decantMl?: number | null };

export type OrderLine = {
  productId: string;
  name: string;
  brand: string | null;
  variant: CartVariantInput;
  decantMl: number | null;
  /** "Frasco 100ml" · "Decant 5ml" — texto pronto para WhatsApp/Admin */
  variantLabel: string;
  quantity: number;
  /** preço cheio, sem promoção nem cupom */
  unitBasePrice: number;
  /** preço final por unidade (promoção + cupom já aplicados) */
  unitPrice: number;
  subtotal: number;
  promotionName: string | null;
  promotionPercent: number;
  promotionDiscount: number;
  couponDiscount: number;
  inStock: boolean;
  /** Preço mudou desde que o cliente colocou no carrinho. */
  priceChanged: boolean;
};


export type FulfillmentType = "PICKUP" | "LOCAL" | "SHIPPING";

export type OrderAddress = {
  cep: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  state: string;
};

export type OrderResult = {
  orderId: string | null;
  orderNumber: string | null;
  lines: OrderLine[];
  totalQuantity: number;
  tier: "varejo" | "atacado";
  /** soma dos preços cheios dos produtos */
  subtotal: number;
  promotionDiscount: number;
  couponDiscount: number;
  couponCode: string | null;
  couponPercent: number;
  /** aviso simples quando o cupom não pôde ser usado */
  couponMessage: string | null;
  /** Total dos produtos, sem frete. */
  total: number;
  shippingPrice: number;
  /** Total no Pix (preços cadastrados) + frete. */
  grandTotal: number;
  paymentMethod: PaymentMethod;
  paymentDiscountPercent: number;
  /** Total no Pix, com frete. */
  pixTotal: number;
  /** Total no cartão, com frete (o frete não recebe a diferença). */
  cardTotal: number;
  /** Total realmente escolhido pelo cliente. */
  finalTotal: number;
  unavailable: string[];
  changed: string[];
};


import { getPaymentPricing, normalizePaymentSettings, type PaymentMethod } from "@/lib/payment-rule";

const digits = (v?: string | null) => (v ?? "").replace(/\D/g, "");

/**
 * Confere o carrinho com o preço OFICIAL recalculado na hora (menor custo + margem)
 * e registra o pedido antes de abrir o WhatsApp.
 * O cliente nunca recebe custo nem fornecedor: isso fica só no snapshot do banco.
 */
export const placeCatalogOrder = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      items: Array<{ productId: string; quantity: number; unitPrice?: number; variant?: CartVariantInput; decantMl?: number | null }>;
      customerName?: string;
      customerPhone?: string;
      couponCode?: string | null;
      deviceId?: string | null;
      fulfillment?: FulfillmentType;
      address?: OrderAddress | null;
      shipping?: { service: string; carrier?: string; price: number; days?: number | null; quote?: unknown } | null;
      paymentMethod?: PaymentMethod;
      idempotencyKey?: string;
      dryRun?: boolean;
    }) => data,

  )
  .handler(async ({ data }): Promise<OrderResult> => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { calculateProductPricing } = await import("@/lib/pricing.server");
    const { verifiedViewerId } = await import("@/lib/viewer.server");
    // Identidade sempre do token da sessão: o corpo da requisição não decide de quem é o pedido.
    const viewerId = await verifiedViewerId();

    const items = (data.items ?? [])
      .filter((i) => i.productId && Number(i.quantity) > 0)
      .map((i) => {
        const variant: CartVariantInput = i.variant === "DECANT" ? "DECANT" : "FULL";
        const ml = variant === "DECANT" ? Number(i.decantMl) : null;
        if (variant === "DECANT" && ml !== 2 && ml !== 5 && ml !== 10) throw new Error("Tamanho de decant inválido.");
        return { ...i, variant, decantMl: ml, quantity: Math.min(999, Math.floor(Number(i.quantity))) };
      });
    if (items.length === 0) throw new Error("Carrinho vazio.");

    const fulfillment: FulfillmentType = data.fulfillment ?? "PICKUP";
    const name = (data.customerName ?? "").trim();
    const phone = digits(data.customerPhone);

    if (!data.dryRun) {
      if (name.length < 3) throw new Error("Informe o nome completo.");
      if (phone.length < 10 || phone.length > 11) throw new Error("Informe um WhatsApp válido com DDD.");
      if (fulfillment !== "PICKUP") {
        const a = data.address;
        if (!a || digits(a.cep).length !== 8 || !a.street || !a.number || !a.district || !a.city || !a.state) {
          throw new Error("Complete o endereço de entrega.");
        }
      }
      if (fulfillment === "SHIPPING" && (!data.shipping || !(Number(data.shipping.price) > 0))) {
        throw new Error("Escolha uma opção de envio.");
      }
    }

    // pedido já criado com a mesma chave? devolve o mesmo, sem duplicar
    if (data.idempotencyKey && !data.dryRun) {
      const { data: existing } = await db
        .from("catalog_orders")
        .select("id, order_number")
        .eq("idempotency_key", data.idempotencyKey)
        .maybeSingle();
      if (existing) {
        const { data: rows } = await db
          .from("catalog_order_items")
          .select("*")
          .eq("order_id", existing.id);
        const lines: OrderLine[] = (rows ?? []).map((r) => ({
          productId: r.product_id ?? "",
          name: r.product_name_snapshot,
          brand: null,
          variant: (r.variant === "DECANT" ? "DECANT" : "FULL") as CartVariantInput,
          decantMl: r.decant_ml ?? null,
          variantLabel: r.variant_label ?? (r.variant === "DECANT" ? `Decant ${r.decant_ml}ml` : "Frasco"),
          quantity: r.quantity,
          unitBasePrice: Number(r.unit_base_price ?? r.unit_sale_price),
          unitPrice: Number(r.unit_sale_price),
          subtotal: Number(r.subtotal),
          promotionName: null,
          promotionPercent: Number(r.promotion_percent ?? 0),
          promotionDiscount: Number(r.promotion_discount ?? 0),
          couponDiscount: Number(r.coupon_discount ?? 0),
          inStock: true,
          priceChanged: false,
        }));
        const { data: order } = await db
          .from("catalog_orders")
          .select(
            "sales_total, shipping_price, grand_total, total_quantity, pricing_tier, items_subtotal, promotion_discount, coupon_discount, coupon_code, coupon_percent, payment_method, payment_discount_percent, pix_total, card_total, final_total",
          )
          .eq("id", existing.id)
          .maybeSingle();
        return {
          orderId: existing.id,
          orderNumber: existing.order_number,
          lines,
          totalQuantity: order?.total_quantity ?? 0,
          tier: (order?.pricing_tier as "varejo" | "atacado") ?? "varejo",
          subtotal: Number(order?.items_subtotal ?? order?.sales_total ?? 0),
          promotionDiscount: Number(order?.promotion_discount ?? 0),
          couponDiscount: Number(order?.coupon_discount ?? 0),
          couponCode: order?.coupon_code ?? null,
          couponPercent: Number(order?.coupon_percent ?? 0),
          couponMessage: null,
          total: Number(order?.sales_total ?? 0),
          shippingPrice: Number(order?.shipping_price ?? 0),
          grandTotal: Number(order?.grand_total ?? order?.sales_total ?? 0),
          paymentMethod: (order?.payment_method === "CARD" ? "CARD" : "PIX") as PaymentMethod,
          paymentDiscountPercent: Number(order?.payment_discount_percent ?? 0),
          pixTotal: Number(order?.pix_total ?? order?.grand_total ?? 0),
          cardTotal: Number(order?.card_total ?? order?.grand_total ?? 0),
          finalTotal: Number(order?.final_total ?? order?.grand_total ?? 0),
          unavailable: [],
          changed: [],
        };

      }
    }

    const { priceCart } = await import("@/lib/promotions.server");
    const { data: settings } = await db.from("pricing_settings").select("*").maybeSingle();
    const minQty = settings?.wholesale_min_quantity ?? 6;
    const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
    // atacado é regra de FRASCOS: decants nunca contam nem recebem desconto
    const bottleQuantity = items.filter((i) => i.variant === "FULL").reduce((s, i) => s + i.quantity, 0);
    const tier: "varejo" | "atacado" = bottleQuantity >= minQty ? "atacado" : "varejo";

    // preço oficial: base recalculada + promoção + cupom (o navegador só manda o código)
    const priced = await priceCart(
      db,
      items.map((i) => ({
        productId: i.productId,
        variant: i.variant,
        decantMl: i.decantMl,
        quantity: i.quantity,
      })),
      { couponCode: data.couponCode ?? null, userId: viewerId, deviceId: data.deviceId ?? null },
    );
    const key = (productId: string, variant: string, ml: number | null) => `${productId}:${variant}:${ml ?? ""}`;
    const pricedByKey = new Map(priced.lines.map((l) => [key(l.productId, l.variant, l.decantMl), l]));

    const lines: OrderLine[] = [];
    const unavailable: string[] = [...priced.unavailable];
    const changed: string[] = [];
    const winners = new Map<string, { supplierProductId: string | null; supplierId: string | null; supplierName: string | null; url: string | null; cost: number | null; volumeMl: number | null }>();

    for (const item of items) {
      const line = pricedByKey.get(key(item.productId, item.variant, item.decantMl));
      if (!line) continue;
      // custo/fornecedor vem da fonte única de verdade (nunca chega ao cliente)
      const pricing = await calculateProductPricing(db, item.productId);
      if (!pricing) continue;
      const { data: p } = await db
        .from("products")
        .select("id, in_stock, volume_ml")
        .eq("id", item.productId)
        .maybeSingle();

      const isDecant = item.variant === "DECANT";
      const ml = item.decantMl as 2 | 5 | 10 | null;
      const variantLabel = isDecant && ml ? `Decant ${ml}ml` : p?.volume_ml ? `Frasco ${p.volume_ml}ml` : "Frasco";
      const priceChanged = item.unitPrice != null && Math.abs(Number(item.unitPrice) - line.unitFinalPrice) > 0.009;
      if (priceChanged) changed.push(pricing.productName);

      const best = pricing.offers.find((o) => o.supplierProductId && o.supplierId === pricing.winningSupplierId) ?? null;
      if (!winners.has(item.productId)) winners.set(item.productId, {
        supplierProductId: best?.supplierProductId ?? null,
        supplierId: pricing.winningSupplierId,
        supplierName: pricing.winningSupplierName,
        url: best?.url ?? null,
        cost: pricing.baseCost,
        volumeMl: p?.volume_ml ?? null,
      });

      lines.push({
        productId: pricing.productId,
        name: pricing.productName,
        brand: pricing.brand,
        variant: item.variant,
        decantMl: isDecant ? ml : null,
        variantLabel,
        quantity: line.quantity,
        unitBasePrice: line.unitBasePrice,
        unitPrice: line.unitFinalPrice,
        subtotal: line.subtotal,
        promotionName: line.promotionName,
        promotionPercent: line.promotionPercent,
        promotionDiscount: line.promotionDiscount,
        couponDiscount: line.couponDiscount,
        inStock: Boolean(p?.in_stock),
        priceChanged,
      });
    }

    const total = Number(lines.reduce((s, l) => s + l.subtotal, 0).toFixed(2));
    const subtotal = Number(lines.reduce((s, l) => s + l.unitBasePrice * l.quantity, 0).toFixed(2));
    const promotionDiscount = Number(lines.reduce((s, l) => s + l.promotionDiscount, 0).toFixed(2));
    const couponDiscount = Number(lines.reduce((s, l) => s + l.couponDiscount, 0).toFixed(2));
    const couponOk = priced.coupon.status === "OK";
    const shippingPrice = fulfillment === "SHIPPING" ? Number(data.shipping?.price ?? 0) : 0;
    const grandTotal = Number((total + shippingPrice).toFixed(2));

    // pagamento: o total dos produtos é o preço no Pix; o cartão é derivado
    // pela regra central e o frete nunca recebe a diferença.
    const paymentSettings = normalizePaymentSettings(settings as never);
    const paymentMethod: PaymentMethod = data.paymentMethod === "CARD" ? "CARD" : "PIX";
    const payment = getPaymentPricing(total, paymentSettings);
    const pixTotal = Number((payment.pixPrice + shippingPrice).toFixed(2));
    const cardTotal = Number((payment.cardPrice + shippingPrice).toFixed(2));
    const finalTotal = paymentMethod === "CARD" ? cardTotal : pixTotal;

    const base = {
      lines,
      totalQuantity,
      tier,
      subtotal,
      promotionDiscount,
      couponDiscount,
      couponCode: couponOk ? (priced.coupon as { code: string }).code : null,
      couponPercent: couponOk ? (priced.coupon as { percent: number }).percent : 0,
      couponMessage:
        priced.coupon.status === "NONE" || couponOk ? null : (priced.coupon as { message: string }).message,
      total,
      shippingPrice,
      grandTotal,
      paymentMethod,
      paymentDiscountPercent: payment.pixDiscountPercent,
      pixTotal,
      cardTotal,
      finalTotal,
      unavailable,
      changed,
    };

    if (data.dryRun || lines.length === 0) return { ...base, orderId: null, orderNumber: null };


    let costTotal = 0;
    const itemRows = lines.map((l) => {
      const best = winners.get(l.productId);
      // custo por unidade: frasco = custo do frasco; decant = fração do frasco (ml/volume), sem inventar
      const bottleCost = best?.cost ?? null;
      const cost =
        l.variant === "DECANT" && l.decantMl && bottleCost && best?.volumeMl
          ? decantUnitCost(bottleCost, best.volumeMl, l.decantMl)
          : l.variant === "DECANT"
            ? null
            : bottleCost;
      if (cost) costTotal += cost * l.quantity;
      const promo = pricedByKey.get(key(l.productId, l.variant, l.decantMl));
      return {
        product_id: l.productId,
        variant: l.variant,
        decant_ml: l.decantMl,
        variant_label: l.variantLabel,
        supplier_product_id: best?.supplierProductId ?? null,
        supplier_id: best?.supplierId ?? null,
        quantity: l.quantity,
        unit_base_price: l.unitBasePrice,
        unit_sale_price: l.unitPrice,
        promotion_id: promo?.promotionId ?? null,
        promotion_percent: l.promotionPercent,
        promotion_discount: l.promotionDiscount,
        coupon_discount: l.couponDiscount,
        unit_cost_snapshot: cost,
        subtotal: l.subtotal,
        supplier_snapshot: best?.supplierName ?? null,
        supplier_url_snapshot: best?.url ?? null,
        product_name_snapshot: l.name,
        image_snapshot: null as string | null,
      };
    });


    const address = fulfillment === "PICKUP" ? null : (data.address ?? null);
    const { data: order, error } = await db
      .from("catalog_orders")
      .insert({
        customer_user_id: viewerId,
        customer_name: name.slice(0, 120) || null,
        customer_phone: data.customerPhone?.slice(0, 20) ?? null,
        customer_phone_normalized: phone ? `55${phone}` : null,
        total_quantity: totalQuantity,
        pricing_tier: tier,
        sales_total: total,
        cost_total: Number(costTotal.toFixed(2)),
        status: "pendente",
        origin: "CATALOGO_WHATSAPP",
        fulfillment_type: fulfillment,
        shipping_cep: address ? digits(address.cep) : null,
        shipping_street: address?.street ?? null,
        shipping_number: address?.number ?? null,
        shipping_complement: address?.complement ?? null,
        shipping_district: address?.district ?? null,
        shipping_city: address?.city ?? null,
        shipping_state: address?.state ?? null,
        shipping_service: fulfillment === "SHIPPING" ? (data.shipping?.service ?? null) : null,
        shipping_price: shippingPrice,
        shipping_days: fulfillment === "SHIPPING" ? (data.shipping?.days ?? null) : null,
        shipping_quote: fulfillment === "SHIPPING" ? ((data.shipping?.quote ?? data.shipping) as never) : null,
        grand_total: grandTotal,
        items_subtotal: subtotal,
        promotion_discount: promotionDiscount,
        coupon_discount: couponDiscount,
        coupon_id: couponOk ? (priced.coupon as { couponId: string }).couponId : null,
        coupon_code: base.couponCode,
        coupon_percent: base.couponPercent,
        payment_method: paymentMethod,
        payment_discount_percent: payment.pixDiscountPercent,
        pix_total: pixTotal,
        card_total: cardTotal,
        final_total: finalTotal,
        ...(data.idempotencyKey ? { idempotency_key: data.idempotencyKey } : {}),
      })
      .select("id, order_number")
      .maybeSingle();
    if (error || !order) throw new Error("Não foi possível registrar o pedido agora.");

    const { error: itemsError } = await db
      .from("catalog_order_items")
      .insert(itemRows.map((r) => ({ ...r, order_id: order.id })));
    if (itemsError) throw new Error("Não foi possível registrar os itens do pedido.");

    // uso do cupom e métricas da promoção
    const { recordDiscountUsage } = await import("@/lib/promotions.server");
    await recordDiscountUsage(db, {
      orderId: order.id,
      priced,
      userId: viewerId,
      deviceId: data.deviceId ?? null,
    });

    // relacionamento: ficha do cliente e carrinho concluído (nunca quebra o pedido)
    try {
      const crm: { p_user_id?: string; p_name?: string; p_phone?: string } = {};
      if (viewerId) crm.p_user_id = viewerId;
      if (name) crm.p_name = name.slice(0, 120);
      if (phone) crm.p_phone = phone;
      if (crm.p_user_id || crm.p_phone) await db.rpc("crm_upsert_customer", crm);

      let cartQuery = db
        .from("shopping_carts")
        .update({ status: "CONVERTED", order_id: order.id, converted_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
        .in("status", ["ACTIVE", "ABANDONED"]);
      cartQuery = viewerId
        ? cartQuery.eq("user_id", viewerId)
        : cartQuery.is("user_id", null).eq("anonymous_id", data.deviceId ?? "__none__");
      await cartQuery;
    } catch {
      /* relacionamento é complementar: o pedido já está registrado */
    }

    // Aviso à equipe (sem dados sensíveis do cliente): nunca bloqueia o pedido.
    try {
      const { notifyStaff } = await import("@/lib/push.server");
      await notifyStaff({
        title: "Novo pedido na Orium",
        body: `Pedido #${order.order_number} · ${totalQuantity} ${totalQuantity === 1 ? "item" : "itens"}`,
        url: "/admin/pedidos",
        tag: `pedido-${order.id}`,
      });
    } catch {
      /* notificação é complementar */
    }

    return { ...base, orderId: order.id, orderNumber: order.order_number };
  });

