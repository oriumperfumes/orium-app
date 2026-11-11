import { createServerFn } from "@tanstack/react-start";

/**
 * OFERTAS DA ORIUM — dados oficiais do popup/carrossel promocional.
 *
 * Fonte única: Admin → Precificação → Promoções. Nada é cadastrado duas vezes.
 * O produto de cada oferta é resolvido pelo ID real (nunca por nome) e o preço
 * exibido é sempre recalculado aqui, no servidor.
 */
export type Offer = {
  promotionId: string;
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  volumeMl: number | null;
  inStock: boolean;
  variant: "FULL" | "DECANT";
  decantMl: number | null;
  basePrice: number;
  finalPrice: number;
  percent: number;
  /** "Só hoje" só aparece quando a promoção realmente termina hoje. */
  endsToday: boolean;
  title: string;
  ctaLabel: string;
  /** Selo "Exclusivo no app" — regra central, decidida no Admin. */
  appBadge: string | null;
};

export type OfferReason =
  | "ELIGIBLE"
  | "INACTIVE"
  | "OUTSIDE_PERIOD"
  | "CAMPAIGN_NOT_PUBLIC"
  | "PRODUCT_INVALID"
  | "PRODUCT_UNAVAILABLE"
  | "ALREADY_SEEN";

export type OfferDiagnostic = {
  promotionId: string;
  name: string;
  active: boolean;
  inPeriod: boolean;
  productValid: boolean;
  productAvailable: boolean;
  popupEnabled: boolean;
  alreadySeen: boolean;
  reason: OfferReason;
};

export type OffersResult = {
  offers: Offer[];
  diagnostics: OfferDiagnostic[];
  anonymousId: string | null;
};

export const getOffers = createServerFn({ method: "POST" })
  .inputValidator((data: { deviceId?: string | null; userId?: string | null; previewPromotionId?: string | null }) => data)
  .handler(async ({ data }): Promise<OffersResult> => {
    const { verifiedViewerId } = await import("@/lib/viewer.server");
    const viewerId = await verifiedViewerId();
    if (!data.deviceId && !viewerId) return { offers: [], diagnostics: [], anonymousId: null };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { isRunning, applyPercent, appBadgeLabel } = await import("@/lib/promotions");

    let promoQuery = db
      .from("promotions")
      .select(
        "id, name, discount_percent, applies_to, product_ids, decant_sizes, active, starts_at, ends_at, announce, announce_cta, announce_title, announce_reset_at, app_exclusive, app_badge_label",
      )
      .order("discount_percent", { ascending: false });
    promoQuery = data.previewPromotionId
      ? promoQuery.eq("id", data.previewPromotionId)
      : promoQuery.eq("active", true).eq("announce", true);
    const { data: promos } = await promoQuery;

    /** Uma campanha vista (ou fechada) nunca volta para a mesma pessoa. */
    const seen = async (id: string, since: string | null) => {
      let q = db.from("promotion_impressions").select("id", { count: "exact", head: true }).eq("promotion_id", id);
      q = viewerId ? q.eq("user_id", viewerId) : q.eq("device_id", data.deviceId!);
      if (since) q = q.gte("seen_at", since);
      const { count } = await q;
      return (count ?? 0) > 0;
    };

    const out: Offer[] = [];
    const diagnostics: OfferDiagnostic[] = [];
    for (const p of promos ?? []) {
      if (out.length >= 5) break;
      const inPeriod = isRunning(p as never);
      const ids = Array.isArray(p.product_ids) ? (p.product_ids as string[]).filter(Boolean) : [];
      const productId = ids.length === 1 ? ids[0] : null;
      const wasSeen = data.previewPromotionId ? false : await seen(p.id, p.announce_reset_at ?? null);
      const diagnostic: OfferDiagnostic = {
        promotionId: p.id,
        name: p.name,
        active: Boolean(p.active),
        inPeriod,
        productValid: false,
        productAvailable: false,
        popupEnabled: Boolean(p.announce),
        alreadySeen: wasSeen,
        reason: !p.active
          ? "INACTIVE"
          : !p.announce
            ? "CAMPAIGN_NOT_PUBLIC"
            : !inPeriod
              ? "OUTSIDE_PERIOD"
              : !productId
                ? "PRODUCT_INVALID"
                : wasSeen
                  ? "ALREADY_SEEN"
                  : "PRODUCT_INVALID",
      };
      if ((!data.previewPromotionId && (!p.active || !p.announce || !inPeriod || wasSeen)) || !productId) {
        diagnostics.push(diagnostic);
        continue;
      }

      const { data: prod } = await db
        .from("products")
        .select(
          "id, slug, canonical_name, brand, image_url, volume_ml, in_stock, retail_price, product_type, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml",
        )
        .eq("id", productId)
        .eq("active", true)
        .eq("catalog_eligible", true)
        .maybeSingle();
      if (!prod?.slug) {
        diagnostics.push(diagnostic);
        continue;
      }
      diagnostic.productValid = true;
      diagnostic.productAvailable = Boolean(prod.in_stock);
      if (!prod.in_stock) {
        diagnostic.reason = "PRODUCT_UNAVAILABLE";
        diagnostics.push(diagnostic);
        continue;
      }

      const percent = Number(p.discount_percent);
      const canDecant = prod.product_type === "PERFUME" && prod.decant_available !== false;
      const sizes = Array.isArray(p.decant_sizes) ? (p.decant_sizes as number[]).map(Number).filter(Boolean) : [];
      const decantOnly = p.applies_to === "DECANT";
      const useDecant = decantOnly && canDecant;
      const decantMl = useDecant ? (sizes[0] ?? 2) : null;

      // Promoção de perfume mostra sempre o preço do FRASCO COMPLETO.
      let basePrice = Number(prod.retail_price ?? 0);
      if (useDecant) {
        const { data: cfg } = await db.from("decant_settings").select("*").maybeSingle();
        const override = (prod as Record<string, unknown>)[`decant_price_${decantMl}ml`];
        const global = cfg ? (cfg as Record<string, unknown>)[`price_${decantMl}ml`] : null;
        const fallback = { 2: 19.9, 5: 39.9, 10: 69.9 }[decantMl as 2 | 5 | 10] ?? 19.9;
        basePrice = Number(override ?? 0) > 0 ? Number(override) : Number(global ?? 0) > 0 ? Number(global) : fallback;
      }
      if (!(basePrice > 0)) {
        diagnostics.push(diagnostic);
        continue;
      }

      const ends = p.ends_at ? new Date(p.ends_at) : null;
      const saoPauloDay = (date: Date) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      const endsToday = !!ends && saoPauloDay(ends) === saoPauloDay(new Date());

      out.push({
        promotionId: p.id,
        productId: prod.id,
        slug: prod.slug,
        name: prod.canonical_name,
        brand: prod.brand,
        image: prod.image_url,
        volumeMl: prod.volume_ml,
        inStock: Boolean(prod.in_stock),
        variant: useDecant ? "DECANT" : "FULL",
        decantMl,
        basePrice: Number(basePrice.toFixed(2)),
        finalPrice: applyPercent(basePrice, percent),
        percent,
        endsToday,
        title: (p.announce_title ?? "").trim() || "Oferta especial no app",
        ctaLabel: (p.announce_cta ?? "").trim() || "Aproveitar oferta",
        appBadge: appBadgeLabel(p as never),
      });
      if (!data.previewPromotionId) diagnostic.reason = "ELIGIBLE";
      diagnostics.push(diagnostic);
    }
    console.info("[campaign-popup]", {
      promotions_found: promos?.length ?? 0,
      eligible_promotions: out.length,
      impression_state: diagnostics.map((item) => ({ id: item.promotionId, seen: item.alreadySeen })),
      anonymous_id: data.deviceId ? `${data.deviceId.slice(0, 8)}…` : null,
      selected_campaign: out[0]?.promotionId ?? null,
      reason_not_shown: out.length ? null : diagnostics[0]?.reason ?? "NO_ACTIVE_PROMOTIONS",
    });
    return { offers: out, diagnostics, anonymousId: data.deviceId ?? null };
  });

/** Registra que a pessoa já viu (ou clicou) o conjunto de ofertas — não reaparece. */
export const markOffersSeen = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { ids: string[]; deviceId?: string | null; userId?: string | null; clickedId?: string | null }) => data,
  )
  .handler(async ({ data }) => {
    const ids = [...new Set((data.ids ?? []).filter(Boolean))];
    const { verifiedViewerId } = await import("@/lib/viewer.server");
    const viewerId = await verifiedViewerId();
    if (!ids.length || (!data.deviceId && !viewerId)) return { ok: false };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await db.from("promotions").select("id, views, clicks, announce_reset_at").in("id", ids);
    for (const r of rows ?? []) {
      let existingQuery = db
        .from("promotion_impressions")
        .select("id, clicked")
        .eq("promotion_id", r.id)
        .order("seen_at", { ascending: false })
        .limit(1);
      existingQuery = viewerId
        ? existingQuery.eq("user_id", viewerId)
        : existingQuery.eq("device_id", data.deviceId ?? "");
      if (r.announce_reset_at) existingQuery = existingQuery.gte("seen_at", r.announce_reset_at);
      const { data: existing } = await existingQuery.maybeSingle();
      const clickedNow = r.id === data.clickedId;
      if (existing) {
        if (clickedNow && !existing.clicked) {
          await db.from("promotion_impressions").update({ clicked: true }).eq("id", existing.id);
          await db.from("promotions").update({ clicks: Number(r.clicks ?? 0) + 1 }).eq("id", r.id);
        }
        continue;
      }
      await db.from("promotion_impressions").insert({
        promotion_id: r.id,
        coupon_id: null,
        user_id: viewerId,
        device_id: data.deviceId ?? null,
        clicked: clickedNow,
      });
      await db
        .from("promotions")
        .update({
          views: Number(r.views ?? 0) + 1,
          clicks: Number(r.clicks ?? 0) + (clickedNow ? 1 : 0),
        })
        .eq("id", r.id);
    }
    return { ok: true };
  });
