/**
 * FONTE ÚNICA DE VERDADE DO DESCONTO DA ORIUM (servidor).
 *
 *   preço base  →  promoção  →  cupom  →  preço final
 *
 * Catálogo, página do perfume, carrinho, checkout, WhatsApp e pedido usam este cálculo.
 * O frontend NUNCA envia valor de desconto: envia apenas o código do cupom.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { applyDecantCombos, type DecantCombo } from "@/lib/decant-combos";
import {
  applyPercent,
  bestPromotion,
  isRunning,
  matches,
  money,
  type AppliesTo,
  type Promotion,
} from "@/lib/promotions";

type Db = SupabaseClient<Database>;

export type CartLineInput = {
  productId: string;
  variant: "FULL" | "DECANT";
  decantMl?: number | null;
  quantity: number;
};

export type CouponRow = {
  id: string;
  code: string;
  discount_percent: number;
  visibility: "PUBLIC" | "SECRET";
  applies_to: AppliesTo;
  product_ids: string[];
  decant_sizes: number[];
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  max_per_user: number | null;
  stackable: boolean;
};

export type PricedLine = {
  productId: string;
  variant: "FULL" | "DECANT";
  decantMl: number | null;
  quantity: number;
  /** preço cheio, sem nenhum desconto */
  unitBasePrice: number;
  /** preço unitário depois da promoção */
  unitPrice: number;
  promotionId: string | null;
  promotionName: string | null;
  promotionPercent: number;
  promotionDiscount: number;
  /** parte do desconto que veio do combo de decants (já somada em promotionDiscount) */
  comboDiscount: number;
  comboId: string | null;
  couponPercent: number;
  couponDiscount: number;
  /** preço unitário final, já com cupom */
  unitFinalPrice: number;
  subtotal: number;
};

export type CouponFeedback =
  | { status: "NONE" }
  | { status: "OK"; code: string; percent: number; discount: number; couponId: string }
  | { status: "INVALID"; message: string }
  | { status: "EXPIRED"; message: string }
  | { status: "LIMIT"; message: string }
  | { status: "NOT_APPLICABLE"; message: string }
  | { status: "NO_STACK"; message: string };

export type PricedCart = {
  lines: PricedLine[];
  /** soma dos preços cheios */
  subtotal: number;
  promotionDiscount: number;
  couponDiscount: number;
  total: number;
  coupon: CouponFeedback;
};

/** Promoções em vigor agora. */
export async function loadActivePromotions(db: Db): Promise<Promotion[]> {
  const { data } = await db
    .from("promotions")
    .select(
      "id, name, discount_percent, applies_to, product_ids, decant_sizes, starts_at, ends_at, active, stackable, announce, headline, cta_label",
    )
    .eq("active", true);
  const now = Date.now();
  return ((data ?? []) as unknown as Promotion[]).filter((p) => isRunning(p, now));
}

/** Combos de decants em vigor agora (tabela ainda não existe → lista vazia, nunca quebra o carrinho). */
export async function loadActiveCombos(db: Db): Promise<DecantCombo[]> {
  try {
    const { data, error } = await (db as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (k: string, v: boolean) => Promise<{ data: unknown; error: unknown }> } };
    })
      .from("decant_combos")
      .select("id, name, quantity, combo_price, decant_sizes, starts_at, ends_at, active")
      .eq("active", true);
    if (error) return [];
    return (Array.isArray(data) ? data : []) as DecantCombo[];
  } catch {
    return [];
  }
}

export async function loadCouponByCode(db: Db, code: string): Promise<CouponRow | null> {
  const clean = (code ?? "").trim().toUpperCase();
  if (!clean) return null;
  const { data } = await db.from("coupons").select("*").ilike("code", clean).maybeSingle();
  return (data as unknown as CouponRow) ?? null;
}

/** Preço cheio de cada linha, direto do banco (nunca vem do navegador). */
async function loadBasePrices(db: Db, lines: CartLineInput[]) {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const [{ data: products }, { data: decantSettings }, { data: pricingSettings }] = await Promise.all([
    db
      .from("products")
      .select(
        "id, canonical_name, brand, slug, image_url, volume_ml, in_stock, active, catalog_eligible, product_type, retail_price, wholesale_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml",
      )
      .in("id", ids),
    db.from("decant_settings").select("*").maybeSingle(),
    db.from("pricing_settings").select("*").maybeSingle(),
  ]);
  return {
    products: new Map((products ?? []).map((p) => [p.id, p])),
    decantSettings,
    minQty: Number(pricingSettings?.wholesale_min_quantity ?? 6),
  };
}

const DECANT_FALLBACK: Record<number, number> = { 2: 19.9, 5: 39.9, 10: 69.9 };

export function decantBasePrice(
  product: {
    decant_price_2ml?: number | string | null;
    decant_price_5ml?: number | string | null;
    decant_price_10ml?: number | string | null;
  },
  settings: { price_2ml?: number | string | null; price_5ml?: number | string | null; price_10ml?: number | string | null } | null,
  ml: number,
) {
  const override = ml === 2 ? product.decant_price_2ml : ml === 5 ? product.decant_price_5ml : product.decant_price_10ml;
  if (override != null && Number(override) > 0) return money(Number(override));
  const global = ml === 2 ? settings?.price_2ml : ml === 5 ? settings?.price_5ml : settings?.price_10ml;
  if (global != null && Number(global) > 0) return money(Number(global));
  return DECANT_FALLBACK[ml] ?? 0;
}

async function couponUsageBlocked(
  db: Db,
  coupon: CouponRow,
  who: { userId?: string | null; deviceId?: string | null },
): Promise<string | null> {
  if (coupon.max_redemptions != null) {
    const { count } = await db
      .from("coupon_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", coupon.id);
    if ((count ?? 0) >= coupon.max_redemptions) return "Este cupom não está mais disponível.";
  }
  if (coupon.max_per_user != null) {
    const q = db.from("coupon_redemptions").select("id", { count: "exact", head: true }).eq("coupon_id", coupon.id);
    const scoped = who.userId ? q.eq("user_id", who.userId) : who.deviceId ? q.eq("device_id", who.deviceId) : null;
    if (scoped) {
      const { count } = await scoped;
      if ((count ?? 0) >= coupon.max_per_user) return "Você já usou este cupom.";
    }
  }
  return null;
}

/**
 * Calcula o carrinho inteiro. `couponCode` é opcional; quando inválido o carrinho
 * continua válido e a resposta explica o motivo em linguagem simples.
 */
export async function priceCart(
  db: Db,
  input: CartLineInput[],
  opts: { couponCode?: string | null; userId?: string | null; deviceId?: string | null } = {},
): Promise<PricedCart & { unavailable: string[] }> {
  const lines = input.filter((l) => l.productId && Number(l.quantity) > 0);
  const [{ products, decantSettings, minQty }, promotions, combos] = await Promise.all([
    loadBasePrices(db, lines),
    loadActivePromotions(db),
    loadActiveCombos(db),
  ]);

  const bottleQty = lines.filter((l) => l.variant === "FULL").reduce((s, l) => s + Number(l.quantity), 0);
  const wholesale = bottleQty >= minQty;

  const unavailable: string[] = [];
  const priced: PricedLine[] = [];

  for (const l of lines) {
    const p = products.get(l.productId);
    if (!p || !p.active || !p.catalog_eligible) {
      // saiu do catálogo (ex.: marca fora do posicionamento): não compra em silêncio
      if (p) unavailable.push(`${p.canonical_name} (indisponível no catálogo)`);
      continue;
    }
    const isDecant = l.variant === "DECANT";
    const ml = isDecant ? Number(l.decantMl) : null;
    if (isDecant && ml !== 2 && ml !== 5 && ml !== 10) continue;

    let base: number;
    if (isDecant) {
      // decant só existe em perfume: qualquer outra combinação é recusada aqui, no servidor
      if (p.product_type !== "PERFUME" || !p.decant_available) {
        unavailable.push(`${p.canonical_name} (decant ${ml}ml)`);
        continue;
      }
      base = decantBasePrice(p, decantSettings, ml!);
    } else {
      base = money(Number((wholesale ? p.wholesale_price : p.retail_price) ?? 0));
      if (!p.in_stock) unavailable.push(p.canonical_name);
    }

    const target = { productId: l.productId, variant: l.variant, decantMl: ml };
    const promo = bestPromotion(promotions, target);
    const promoPercent = promo ? Number(promo.discount_percent) : 0;
    const unitAfterPromo = promo ? applyPercent(base, promoPercent) : base;
    const quantity = Math.min(999, Math.floor(Number(l.quantity)));

    priced.push({
      productId: l.productId,
      variant: l.variant,
      decantMl: ml,
      quantity,
      unitBasePrice: base,
      unitPrice: unitAfterPromo,
      promotionId: promo?.id ?? null,
      promotionName: promo?.name ?? null,
      promotionPercent: promoPercent,
      promotionDiscount: money((base - unitAfterPromo) * quantity),
      comboDiscount: 0,
      comboId: null,
      couponPercent: 0,
      couponDiscount: 0,
      unitFinalPrice: unitAfterPromo,
      subtotal: money(unitAfterPromo * quantity),
    });
  }

  // Combo de decants: vem depois da promoção por percentual e antes do cupom.
  // A economia entra em promotionDiscount/subtotal para pedido, edição e Copilot
  // enxergarem o mesmo total; o cupom não acumula em cima de itens do combo.
  if (combos.length > 0) {
    const key = (l: PricedLine) => `${l.productId}:${l.variant}:${l.decantMl ?? ""}`;
    const result = applyDecantCombos(
      priced.map((l) => ({ key: key(l), variant: l.variant, ml: l.decantMl, unit: l.unitPrice, quantity: l.quantity })),
      combos,
    );
    const comboOf = result.applied[0]?.combo ?? null;
    for (const l of priced) {
      const d = result.byLine.get(key(l)) ?? 0;
      if (d <= 0) continue;
      l.comboDiscount = d;
      l.comboId = comboOf?.id ?? null;
      l.promotionDiscount = money(l.promotionDiscount + d);
      l.subtotal = money(l.subtotal - d);
      l.unitFinalPrice = money(l.subtotal / l.quantity);
      if (!l.promotionName && comboOf) l.promotionName = comboOf.name;
    }
  }

  let coupon: CouponFeedback = { status: "NONE" };

  if (opts.couponCode) {
    const row = await loadCouponByCode(db, opts.couponCode);
    if (!row || !row.active) {
      coupon = { status: "INVALID", message: "Cupom inválido ou indisponível." };
    } else if (!isRunning(row)) {
      coupon = { status: "EXPIRED", message: "Este cupom não está mais disponível." };
    } else {
      const blocked = await couponUsageBlocked(db, row, opts);
      if (blocked) {
        coupon = { status: "LIMIT", message: blocked };
      } else {
        const matched = priced.filter((l) =>
          matches(row, { productId: l.productId, variant: l.variant, decantMl: l.decantMl }),
        );
        // itens dentro de um combo já têm a melhor condição: o cupom não acumula
        const eligible = matched.filter((l) => !(l.comboDiscount > 0));
        const onlyCombo = matched.length > 0 && eligible.length === 0;
        if (eligible.length === 0) {
          coupon = onlyCombo
            ? { status: "NO_STACK", message: "Os decants do combo já estão na melhor condição. O cupom não acumula com o combo." }
            : { status: "NOT_APPLICABLE", message: "Este cupom não vale para os itens do carrinho." };
        } else {
          const withPromo = eligible.filter((l) => l.promotionId);
          const canStack = row.stackable;
          const targets = canStack ? eligible : eligible.filter((l) => !l.promotionId);

          if (targets.length === 0) {
            coupon = {
              status: "NO_STACK",
              message: "Estes itens já estão em promoção e o cupom não acumula. Mantivemos a melhor condição.",
            };
          } else {
            let discount = 0;
            for (const line of targets) {
              const from = canStack ? line.unitPrice : line.unitBasePrice;
              const finalUnit = applyPercent(from, row.discount_percent);
              // sem acumular: só troca se o cupom for melhor que a promoção do item
              if (!canStack && line.promotionId && finalUnit >= line.unitPrice) continue;
              const lineDiscount = money((line.unitPrice - finalUnit) * line.quantity);
              if (lineDiscount <= 0) continue;
              line.couponPercent = Number(row.discount_percent);
              line.unitFinalPrice = finalUnit;
              line.couponDiscount = lineDiscount;
              line.subtotal = money(finalUnit * line.quantity);
              discount += lineDiscount;
            }
            if (discount <= 0) {
              coupon = withPromo.length
                ? {
                    status: "NO_STACK",
                    message: "A promoção atual já é melhor que o cupom. Mantivemos a melhor condição.",
                  }
                : { status: "NOT_APPLICABLE", message: "Este cupom não vale para os itens do carrinho." };
            } else {
              coupon = {
                status: "OK",
                code: row.code.toUpperCase(),
                percent: Number(row.discount_percent),
                discount: money(discount),
                couponId: row.id,
              };
            }
          }
        }
      }
    }
  }

  const subtotal = money(priced.reduce((s, l) => s + l.unitBasePrice * l.quantity, 0));
  const promotionDiscount = money(priced.reduce((s, l) => s + l.promotionDiscount, 0));
  const couponDiscount = money(priced.reduce((s, l) => s + l.couponDiscount, 0));
  const total = money(priced.reduce((s, l) => s + l.subtotal, 0));

  return { lines: priced, subtotal, promotionDiscount, couponDiscount, total, coupon, unavailable };
}

/** Registra o uso do cupom e atualiza os contadores da promoção/cupom. */
export async function recordDiscountUsage(
  db: Db,
  args: {
    orderId: string;
    priced: PricedCart;
    userId?: string | null;
    deviceId?: string | null;
  },
) {
  const { priced } = args;
  if (priced.coupon.status === "OK") {
    await db.from("coupon_redemptions").insert({
      coupon_id: priced.coupon.couponId,
      order_id: args.orderId,
      user_id: args.userId ?? null,
      device_id: args.deviceId ?? null,
      discount_amount: priced.coupon.discount,
      order_total: priced.total,
    });
    const { data: c } = await db
      .from("coupons")
      .select("redemptions, sales_total, discount_total")
      .eq("id", priced.coupon.couponId)
      .maybeSingle();
    await db
      .from("coupons")
      .update({
        redemptions: Number(c?.redemptions ?? 0) + 1,
        sales_total: money(Number(c?.sales_total ?? 0) + priced.total),
        discount_total: money(Number(c?.discount_total ?? 0) + priced.coupon.discount),
      })
      .eq("id", priced.coupon.couponId);
  }

  const perCombo = new Map<string, { sales: number; discount: number }>();
  for (const l of priced.lines) {
    if (!l.comboId || l.comboDiscount <= 0) continue;
    const cur = perCombo.get(l.comboId) ?? { sales: 0, discount: 0 };
    cur.sales += l.subtotal;
    cur.discount += l.comboDiscount;
    perCombo.set(l.comboId, cur);
  }
  const comboDb = db as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } };
      update: (v: Record<string, unknown>) => { eq: (k: string, v: string) => Promise<unknown> };
    };
  };
  for (const [id, agg] of perCombo) {
    try {
      const { data: c } = await comboDb.from("decant_combos").select("orders_count, sales_total, discount_total").eq("id", id).maybeSingle();
      await comboDb.from("decant_combos").update({
        orders_count: Number(c?.orders_count ?? 0) + 1,
        sales_total: money(Number(c?.sales_total ?? 0) + agg.sales),
        discount_total: money(Number(c?.discount_total ?? 0) + agg.discount),
      }).eq("id", id);
    } catch {
      /* métrica secundária: nunca derruba o pedido */
    }
  }

  const perPromo = new Map<string, { sales: number; discount: number }>();
  for (const l of priced.lines) {
    if (!l.promotionId) continue;
    const cur = perPromo.get(l.promotionId) ?? { sales: 0, discount: 0 };
    cur.sales += l.subtotal;
    cur.discount += l.promotionDiscount;
    perPromo.set(l.promotionId, cur);
  }
  for (const [id, agg] of perPromo) {
    const { data: p } = await db
      .from("promotions")
      .select("orders_count, sales_total, discount_total")
      .eq("id", id)
      .maybeSingle();
    await db
      .from("promotions")
      .update({
        orders_count: Number(p?.orders_count ?? 0) + 1,
        sales_total: money(Number(p?.sales_total ?? 0) + agg.sales),
        discount_total: money(Number(p?.discount_total ?? 0) + agg.discount),
      })
      .eq("id", id);
  }
}
