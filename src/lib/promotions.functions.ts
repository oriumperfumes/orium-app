import { createServerFn } from "@tanstack/react-start";
import type { PricedCart } from "@/lib/promotions.server";

export type QuoteInput = {
  items: Array<{ productId: string; variant?: "FULL" | "DECANT"; decantMl?: number | null; quantity: number }>;
  couponCode?: string | null;
  userId?: string | null;
  deviceId?: string | null;
};

/**
 * Cálculo oficial do carrinho: base → promoção → cupom.
 * O navegador manda apenas os itens e o CÓDIGO do cupom; o valor é sempre daqui.
 */
export const quoteCart = createServerFn({ method: "POST" })
  .inputValidator((data: QuoteInput) => data)
  .handler(async ({ data }): Promise<PricedCart & { unavailable: string[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { priceCart } = await import("@/lib/promotions.server");
    const { verifiedViewerId } = await import("@/lib/viewer.server");
    const viewerId = await verifiedViewerId();
    const items = (data.items ?? []).map((i) => ({
      productId: i.productId,
      variant: i.variant === "DECANT" ? ("DECANT" as const) : ("FULL" as const),
      decantMl: i.decantMl ?? null,
      quantity: Number(i.quantity) || 0,
    }));
    return priceCart(supabaseAdmin, items, {
      couponCode: data.couponCode ?? null,
      userId: viewerId,
      deviceId: data.deviceId ?? null,
    });
  });

/** Produto exato que a campanha promove — usado para abrir a página certa. */
export type AnnouncementTarget = {
  productId: string;
  slug: string;
  variant: "FULL" | "DECANT" | "ANY";
  decantMl: number | null;
} | null;

export type Announcement = {
  kind: "promotion" | "coupon";
  id: string;
  /** Comunicação escrita no Admin (com variáveis já resolvidas). */
  title: string;
  message: string;
  ctaLabel: string;
  footnote: string | null;
  theme: "DEFAULT" | "PROMO" | "DECANT" | "FULL";
  badge: string;
  code?: string;
  percent: number;
  target: AnnouncementTarget;
} | null;

const ANNOUNCE_FIELDS = "announce_title, announce_message, announce_cta, announce_footnote, announce_theme, announce_reset_at";


/** A campanha aparece UMA única vez por pessoa/aparelho, salvo se o Admin pedir para mostrar de novo. */
export const getAnnouncement = createServerFn({ method: "POST" })
  .inputValidator((data: { deviceId?: string | null; userId?: string | null }) => data)
  .handler(async ({ data }): Promise<Announcement> => {
    const { verifiedViewerId } = await import("@/lib/viewer.server");
    const viewerId = await verifiedViewerId();
    if (!data.deviceId && !viewerId) return null;
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { isRunning } = await import("@/lib/promotions");
    const { renderCampaign } = await import("@/lib/campaign-message");

    const seen = async (column: "promotion_id" | "coupon_id", id: string, since: string | null) => {
      let q = db.from("promotion_impressions").select("id", { count: "exact", head: true }).eq(column, id);
      q = viewerId ? q.eq("user_id", viewerId) : q.eq("device_id", data.deviceId!);
      if (since) q = q.gte("seen_at", since);
      const { count } = await q;
      return (count ?? 0) > 0;
    };

    const pct = (v: unknown) => Number(v).toFixed(0).replace(/\.0$/, "");

    /** Resolve o produto real da campanha pelo ID (nunca pelo nome) e confirma que ele ainda existe. */
    const resolveTarget = async (
      productIds: unknown,
      appliesTo: unknown,
      decantSizes: unknown,
    ): Promise<AnnouncementTarget> => {
      const ids = Array.isArray(productIds) ? (productIds as string[]).filter(Boolean) : [];
      const first = ids[0];
      if (ids.length !== 1 || !first) return null;
      const { data: prod } = await db
        .from("products")
        .select("id, slug, product_type")
        .eq("id", first)
        .eq("active", true)
        .eq("catalog_eligible", true)
        .maybeSingle();
      if (!prod?.slug) return null;
      const variant: "FULL" | "DECANT" | "ANY" =
        appliesTo === "DECANT" ? "DECANT" : appliesTo === "FULL" ? "FULL" : "ANY";
      const sizes = Array.isArray(decantSizes) ? (decantSizes as number[]).map(Number).filter(Boolean) : [];
      const decantMl = variant === "DECANT" && prod.product_type === "PERFUME" ? (sizes[0] ?? null) : null;
      return { productId: prod.id, slug: prod.slug, variant, decantMl };
    };

    const { data: promos } = await db
      .from("promotions")
      .select(`id, name, discount_percent, applies_to, product_ids, decant_sizes, active, starts_at, ends_at, ${ANNOUNCE_FIELDS}`)
      .eq("active", true)
      .eq("announce", true)
      .order("created_at", { ascending: false });


    for (const p of promos ?? []) {
      if (!isRunning(p as never)) continue;
      if (await seen("promotion_id", p.id, p.announce_reset_at ?? null)) continue;
      const percent = Number(p.discount_percent);
      const category = p.applies_to === "DECANT" ? "decants" : p.applies_to === "FULL" ? "frascos" : "todo o catálogo";
      const copy = renderCampaign(
        {
          title: p.announce_title,
          message: p.announce_message,
          cta: p.announce_cta,
          footnote: p.announce_footnote,
          theme: p.announce_theme,
        },
        { discount: pct(percent), product: p.name, category },
        `${pct(percent)}% OFF em ${p.name}`,
      );
      return {
        kind: "promotion",
        id: p.id,
        title: copy.title,
        message: copy.message,
        ctaLabel: copy.cta,
        footnote: copy.footnote,
        theme: copy.theme,
        badge: `${pct(percent)}% OFF`,
        percent,
        target: await resolveTarget(p.product_ids, p.applies_to, p.decant_sizes),
      };

    }

    const { data: coupons } = await db
      .from("coupons")
      .select(`id, code, discount_percent, applies_to, product_ids, decant_sizes, active, starts_at, ends_at, visibility, ${ANNOUNCE_FIELDS}`)

      .eq("active", true)
      .eq("announce", true)
      .eq("visibility", "PUBLIC")
      .order("created_at", { ascending: false });

    for (const c of coupons ?? []) {
      if (!isRunning(c as never)) continue;
      if (await seen("coupon_id", c.id, c.announce_reset_at ?? null)) continue;
      const percent = Number(c.discount_percent);
      const code = c.code.toUpperCase();
      const category = c.applies_to === "DECANT" ? "decants" : c.applies_to === "FULL" ? "frascos" : "todo o catálogo";
      const copy = renderCampaign(
        {
          title: c.announce_title,
          message: c.announce_message,
          cta: c.announce_cta,
          footnote: c.announce_footnote,
          theme: c.announce_theme,
        },
        { coupon: code, discount: pct(percent), category },
        `Use ${code} e economize ${pct(percent)}% no seu pedido.`,
      );
      return {
        kind: "coupon",
        id: c.id,
        title: copy.title,
        message: copy.message,
        ctaLabel: copy.cta,
        footnote: copy.footnote,
        theme: copy.theme,
        badge: `${code} · ${pct(percent)}% OFF`,
        code,
        percent,
        target: await resolveTarget(c.product_ids, c.applies_to, c.decant_sizes),
      };
    }


    return null;
  });

/** Marca a campanha como vista (e opcionalmente clicada) para nunca voltar. */
export const markAnnouncementSeen = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { kind: "promotion" | "coupon"; id: string; deviceId?: string | null; userId?: string | null; clicked?: boolean }) =>
      data,
  )
  .handler(async ({ data }) => {
    const { verifiedViewerId } = await import("@/lib/viewer.server");
    const viewerId = await verifiedViewerId();
    if (!data.id || (!data.deviceId && !viewerId)) return { ok: false };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await db.from("promotion_impressions").insert({
      promotion_id: data.kind === "promotion" ? data.id : null,
      coupon_id: data.kind === "coupon" ? data.id : null,
      user_id: viewerId,
      device_id: data.deviceId ?? null,
      clicked: Boolean(data.clicked),
    });
    if (data.kind === "promotion") {
      const { data: p } = await db.from("promotions").select("views, clicks").eq("id", data.id).maybeSingle();
      await db
        .from("promotions")
        .update({
          views: Number(p?.views ?? 0) + 1,
          clicks: Number(p?.clicks ?? 0) + (data.clicked ? 1 : 0),
        })
        .eq("id", data.id);
    }
    return { ok: true };
  });
