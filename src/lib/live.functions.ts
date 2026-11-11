/**
 * AO VIVO — presença do visitante e atendimento humano.
 *
 * Princípios:
 * - registramos SOMENTE navegação e intenção de compra (página atual, perfume
 *   aberto, resumo do carrinho). Nunca senha, cartão, texto digitado em campos
 *   privados ou localização;
 * - a identidade nunca vem do corpo da requisição: quem tem conta é lido do
 *   token; quem é anônimo fica anônimo até se identificar por vontade própria;
 * - só a equipe (admin/owner) enxerga sessões; o visitante só recebe o que foi
 *   endereçado à sessão dele.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const text = (v: unknown, max = 160) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};
const uuid = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);

export type LiveIntent = "baixa" | "media" | "alta";

export type LiveInteraction = {
  id: string;
  kind: "mensagem" | "cupom" | "ajuda" | "salvar_escolhas";
  message: string | null;
  coupon_code: string | null;
  product_id: string | null;
  created_at: string;
  seen_at: string | null;
  accepted_at: string | null;
  dismissed_at: string | null;
};

export type LiveSessionRow = {
  session_key: string;
  visitor_id: string;
  customer_id: string | null;
  last_action?: string | null;
  /** a mesma pessoa aparece em mais de um aparelho agora */
  multi_device?: boolean;
  identified: boolean;
  display_name: string | null;
  phone: string | null;
  device: string | null;
  source: string | null;
  current_route: string | null;
  current_product_id: string | null;
  current_product_name: string | null;
  current_variant: string | null;
  current_decant_ml: number | null;
  cart_items: number;
  cart_total: number;
  favorites_count: number;
  views_count: number;
  intent: LiveIntent;
  in_checkout: boolean;
  browser: string | null;
  os: string | null;
  standalone: boolean | null;
  viewport: string | null;
  timezone: string | null;
  language: string | null;
  theme: string | null;
  connection: string | null;
  first_source: string | null;
  visitor_sessions: number | null;
  visitor_first_seen: string | null;
  last_query: string | null;
  declined_at: string | null;
  started_at: string;
  last_activity_at: string;
};

function intentOf(p: {
  inCheckout: boolean;
  cartItems: number;
  favorites: number;
  views: number;
  negotiation: boolean;
}): LiveIntent {
  if (p.inCheckout || p.cartItems > 0 || p.negotiation) return "alta";
  if (p.favorites > 0 || p.views >= 3) return "media";
  return "baixa";
}

/** Batida de presença do visitante — assíncrona, nunca bloqueia a navegação. */
export const livePing = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      sessionKey: string;
      visitorId: string;
      route?: string | null;
      productId?: string | null;
      productName?: string | null;
      variant?: string | null;
      decantMl?: number | null;
      device?: string | null;
      source?: string | null;
      cartItems?: number;
      cartTotal?: number;
      favorites?: number;
      views?: number;
      inCheckout?: boolean;
      negotiation?: boolean;
      ended?: boolean;
      query?: string | null;
      context?: {
        browser?: string | null;
        os?: string | null;
        standalone?: boolean | null;
        viewport?: string | null;
        timezone?: string | null;
        language?: string | null;
        theme?: string | null;
        connection?: string | null;
      } | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    try {
      const sessionKey = text(data.sessionKey, 80);
      const visitorId = text(data.visitorId, 80);
      if (!sessionKey || !visitorId) return { ok: false as const, pending: [] as LiveInteraction[] };

      const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
      const { verifiedViewerId } = await import("@/lib/viewer.server");
      const userId = await verifiedViewerId();

      const { data: visitor } = await db
        .from("analytics_visitors")
        .select("customer_id, first_source, device, sessions_count, first_seen_at")
        .eq("visitor_id", visitorId)
        .maybeSingle();

      let customerId = visitor?.customer_id ?? null;
      let displayName: string | null = null;
      let phone: string | null = null;

      if (!customerId && userId) {
        const { data: byUser } = await db
          .from("crm_customers")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();
        customerId = byUser?.id ?? null;
      }
      if (customerId) {
        const { data: c } = await db
          .from("crm_customers")
          .select("name, phone")
          .eq("id", customerId)
          .maybeSingle();
        displayName = text(c?.name, 80);
        phone = text(c?.phone, 20);
      }

      const cartItems = int(data.cartItems);
      const favorites = int(data.favorites);
      const views = int(data.views);
      const inCheckout = !!data.inCheckout;

      const row = {
        session_key: sessionKey,
        visitor_id: visitorId,
        customer_id: customerId,
        user_id: userId,
        identified: !!displayName,
        display_name: displayName,
        phone,
        device: text(data.device, 20) ?? visitor?.device ?? null,
        source: text(data.source, 60) ?? visitor?.first_source ?? null,
        current_route: text(data.route, 200),
        current_product_id: uuid(data.productId),
        current_product_name: text(data.productName, 120),
        current_variant: data.variant === "DECANT" ? "DECANT" : data.variant === "FULL" ? "FULL" : null,
        current_decant_ml: data.decantMl ? int(data.decantMl) : null,
        cart_items: cartItems,
        cart_total: num(data.cartTotal),
        favorites_count: favorites,
        views_count: views,
        in_checkout: inCheckout,
        intent: intentOf({
          inCheckout,
          cartItems,
          favorites,
          views,
          negotiation: !!data.negotiation,
        }),
        browser: text(data.context?.browser, 40),
        os: text(data.context?.os, 40),
        standalone: typeof data.context?.standalone === "boolean" ? data.context.standalone : null,
        viewport: text(data.context?.viewport, 20),
        timezone: text(data.context?.timezone, 60),
        language: text(data.context?.language, 20),
        theme: text(data.context?.theme, 12),
        connection: text(data.context?.connection, 20),
        first_source: visitor?.first_source ?? null,
        visitor_sessions: visitor?.sessions_count ?? null,
        visitor_first_seen: visitor?.first_seen_at ?? null,
        last_query: text(data.query, 120),
        last_activity_at: data.ended
          ? new Date(Date.now() - 10 * 60 * 1000).toISOString()
          : new Date().toISOString(),
      };

      // O nome do perfume é resolvido no servidor a partir do catálogo.
      if (row.current_product_id && !row.current_product_name) {
        const { data: p } = await db
          .from("products")
          .select("canonical_name")
          .eq("id", row.current_product_id)
          .maybeSingle();
        row.current_product_name = p?.canonical_name ?? null;
      }

      // Última ação útil: o perfume visto antes, preservado mesmo ao voltar ao catálogo.
      const { data: prev } = await db
        .from("live_sessions")
        .select("current_product_name, last_action")
        .eq("session_key", sessionKey)
        .maybeSingle();
      const lastAction =
        row.current_product_name
          ? `Visualizou ${row.current_product_name}`
          : prev?.current_product_name
            ? `Visualizou ${prev.current_product_name}`
            : (prev?.last_action ?? null);

      await db
        .from("live_sessions")
        .upsert({ ...row, is_active: !data.ended, last_action: lastAction } as never, { onConflict: "session_key" });

      // UMA PESSOA + UM APARELHO = UM CARD: sessões antigas da mesma identidade
      // no mesmo tipo de aparelho deixam de aparecer no Ao Vivo.
      if (!data.ended) {
        let others = db
          .from("live_sessions")
          .update({ is_active: false } as never)
          .eq("is_active", true)
          .neq("session_key", sessionKey);
        if (customerId) others = others.eq("customer_id", customerId);
        else if (userId) others = others.eq("user_id", userId);
        else others = others.eq("visitor_id", visitorId);
        others = row.device ? others.eq("device", row.device) : others.is("device", null);
        await others;
      }



      const { data: pending } = await db
        .from("live_interactions")
        .select("id, kind, message, coupon_code, product_id, created_at, seen_at, accepted_at, dismissed_at")
        .eq("session_key", sessionKey)
        .is("dismissed_at", null)
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
        .limit(3);

      return { ok: true as const, pending: (pending ?? []) as LiveInteraction[] };
    } catch {
      return { ok: false as const, pending: [] as LiveInteraction[] };
    }
  });

/** O visitante confirma que viu, aceitou ou dispensou a abordagem da equipe. */
export const liveAck = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; sessionKey: string; action: "seen" | "accepted" | "dismissed" }) => data)
  .handler(async ({ data }) => {
    const id = uuid(data.id);
    const sessionKey = text(data.sessionKey, 80);
    if (!id || !sessionKey) return { ok: false as const };

    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const patch =
      data.action === "accepted"
        ? { accepted_at: now, seen_at: now }
        : data.action === "dismissed"
          ? { dismissed_at: now, seen_at: now }
          : { seen_at: now };

    // A sessão faz parte da chave: ninguém responde no lugar de outra pessoa.
    const { data: rows } = await db
      .from("live_interactions")
      .update(patch as never)
      .eq("id", id)
      .eq("session_key", sessionKey)
      .select("customer_id, kind, coupon_code")
      .maybeSingle();

    if (data.action === "dismissed") {
      await db.from("live_sessions").update({ declined_at: now } as never).eq("session_key", sessionKey);
    }

    if (rows?.customer_id) {
      await db.rpc("crm_log_event", {
        p_customer_id: rows.customer_id,
        p_event:
          data.action === "accepted"
            ? rows.kind === "cupom"
              ? "cupom_aceito"
              : "atendimento_aceito"
            : "abordagem_dispensada",
        p_details: { kind: rows.kind, coupon: rows.coupon_code } as never,
      });
    }
    return { ok: true as const };
  });

/** Abordagens pendentes desta sessão (chamado pelo próprio visitante). */
export const liveInbox = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionKey: string }) => data)
  .handler(async ({ data }) => {
    const sessionKey = text(data.sessionKey, 80);
    if (!sessionKey) return { pending: [] as LiveInteraction[] };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: pending } = await db
      .from("live_interactions")
      .select("id, kind, message, coupon_code, product_id, created_at, seen_at, accepted_at, dismissed_at")
      .eq("session_key", sessionKey)
      .is("dismissed_at", null)
      .is("accepted_at", null)
      .order("created_at", { ascending: false })
      .limit(3);
    return { pending: (pending ?? []) as LiveInteraction[] };
  });

/* ─────────────────────────  Equipe (admin/owner)  ───────────────────────── */

const ACTIVE_MINUTES = 6;

async function assertStaff(ctx: { supabase: { rpc: (fn: string, args: unknown) => Promise<{ data: unknown }> }; userId: string }) {
  const { data } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (!data) throw new Error("Sem permissão.");
}

export type LiveOverview = {
  visitors: number;
  identified: number;
  carts: number;
  viewingProduct: number;
  inCheckout: number;
  sessions: LiveSessionRow[];
};

export const liveOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context as never);
    const since = new Date(Date.now() - ACTIVE_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await context.supabase
      .from("live_sessions")
      .select(
        "session_key, visitor_id, customer_id, user_id, identified, display_name, phone, device, source, current_route, current_product_id, current_product_name, current_variant, current_decant_ml, cart_items, cart_total, favorites_count, views_count, intent, in_checkout, declined_at, started_at, last_activity_at, last_action",
      )
      .eq("is_active", true)
      .gte("last_activity_at", since)
      .order("last_activity_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    // Deduplicação final: mesma pessoa + mesmo aparelho vira um único card,
    // mantendo o registro mais recente e o maior carrinho/intenção conhecidos.
    const byKey = new Map<string, LiveSessionRow>();
    for (const raw of (data ?? []) as unknown as Array<LiveSessionRow & { user_id?: string | null }>) {
      const r = { ...raw, cart_total: Number(raw.cart_total ?? 0) };
      const who = r.customer_id ?? r.user_id ?? r.visitor_id;
      const key = `${who}|${r.device ?? "?"}`;
      const cur = byKey.get(key);
      if (!cur) {
        byKey.set(key, r);
        continue;
      }
      // cur é o mais recente (ordem desc); herda dados úteis do mais antigo
      cur.last_action = cur.last_action ?? r.last_action ?? (r.current_product_name ? `Visualizou ${r.current_product_name}` : null);
      cur.display_name = cur.display_name ?? r.display_name;
      cur.phone = cur.phone ?? r.phone;
      cur.identified = cur.identified || r.identified;
      cur.source = cur.source ?? r.source;
    }
    const rows = [...byKey.values()];
    // Mesma pessoa em aparelhos diferentes: marca para o card dizer "— Celular".
    const people = new Map<string, number>();
    for (const r of rows) {
      const who = r.customer_id ?? (r as { user_id?: string | null }).user_id ?? r.visitor_id;
      people.set(who, (people.get(who) ?? 0) + 1);
    }
    for (const r of rows) {
      const who = r.customer_id ?? (r as { user_id?: string | null }).user_id ?? r.visitor_id;
      r.multi_device = (people.get(who) ?? 0) > 1;
    }

    const weight = (r: LiveSessionRow) =>
      (r.in_checkout ? 5000 : 0) +
      (r.cart_items > 0 ? 2500 : 0) +
      (r.intent === "alta" ? 1200 : r.intent === "media" ? 600 : 0) +
      (r.identified ? 300 : 0);

    rows.sort(
      (a, b) =>
        weight(b) - weight(a) ||
        new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime(),
    );

    return {
      visitors: rows.length,
      identified: rows.filter((r) => r.identified).length,
      carts: rows.filter((r) => r.cart_items > 0).length,
      viewingProduct: rows.filter((r) => !!r.current_product_id).length,
      inCheckout: rows.filter((r) => r.in_checkout).length,
      sessions: rows,
    } satisfies LiveOverview;
  });

export type LiveSessionDetail = {
  session: LiveSessionRow;
  timeline: Array<{
    id: string;
    event: string;
    created_at: string;
    product_name: string | null;
    variant: string | null;
    decant_ml: number | null;
    price: number | null;
    query: string | null;
    seconds: number | null;
  }>;
  /** Interesse real por perfume nesta visita: aberturas + tempo de atenção. */
  interests: Array<{ name: string; opens: number; seconds: number }>;
  interactions: LiveInteraction[];
  recentProducts: Array<{ id: string; name: string; brand: string | null }>;
  cart: Array<{ name: string | null; brand: string | null; variant: string; decant_ml: number | null; quantity: number; unit_price: number | null }>;
  favorites: Array<{ name: string; brand: string | null }>;
};

export const liveSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionKey: string }) => data)
  .handler(async ({ data, context }) => {
    await assertStaff(context as never);
    // Leitura interna da equipe: já validamos a permissão acima.
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: session, error } = await db
      .from("live_sessions")
      .select("*")
      .eq("session_key", data.sessionKey)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) return null;

    const visitorId = (session as { visitor_id: string }).visitor_id;

    const [events, interactions, carts, favorites] = await Promise.all([
      db
        .from("analytics_events")
        .select("id, event, created_at, product_id, variant, decant_ml, price, query, meta, products(canonical_name)")
        .eq("session_key", data.sessionKey)
        .order("created_at", { ascending: false })
        .limit(60),
      db
        .from("live_interactions")
        .select("id, kind, message, coupon_code, product_id, created_at, seen_at, accepted_at, dismissed_at")
        .eq("session_key", data.sessionKey)
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("shopping_carts")
        .select("id, status, cart_items(quantity, variant, decant_ml, unit_price, product_name, brand)")
        .eq("anonymous_id", visitorId)
        .neq("status", "converted")
        .order("last_activity_at", { ascending: false })
        .limit(1),
      db
        .from("favorites")
        .select("products(canonical_name, brand)")
        .eq("anonymous_id", visitorId)
        .limit(12),
    ]);


    type Ev = {
      id: string;
      event: string;
      created_at: string;
      product_id: string | null;
      variant: string | null;
      decant_ml: number | null;
      price: number | null;
      query: string | null;
      meta?: { seconds?: number } | null;
      products?: { canonical_name?: string | null } | null;
    };
    const evRows = ((events.data ?? []) as unknown as Ev[]).map((e) => ({
      id: e.id,
      event: e.event,
      created_at: e.created_at,
      product_name: e.products?.canonical_name ?? null,
      variant: e.variant,
      decant_ml: e.decant_ml,
      seconds: Number.isFinite(Number(e.meta?.seconds)) ? Number(e.meta?.seconds) : null,
      price: e.price == null ? null : Number(e.price),
      query: e.query,
    }));

    const seen = new Set<string>();
    const recentProducts: Array<{ id: string; name: string; brand: string | null }> = [];
    for (const e of (events.data ?? []) as unknown as Ev[]) {
      if (e.event !== "product_view" || !e.product_id || seen.has(e.product_id)) continue;
      seen.add(e.product_id);
      recentProducts.push({ id: e.product_id, name: e.products?.canonical_name ?? "Perfume", brand: null });
      if (recentProducts.length >= 6) break;
    }

    type CartRow = {
      cart_items?: Array<{
        quantity: number;
        variant: string;
        decant_ml: number | null;
        unit_price: number | null;
        product_name: string | null;
        brand: string | null;
      }> | null;
    };
    const cart = (((carts.data ?? []) as unknown as CartRow[])[0]?.cart_items ?? []).map((i) => ({
      name: i.product_name ?? null,
      brand: i.brand ?? null,
      variant: i.variant,
      decant_ml: i.decant_ml,
      quantity: Number(i.quantity ?? 0),
      unit_price: i.unit_price == null ? null : Number(i.unit_price),
    }));


    type FavRow = { products?: { canonical_name?: string | null; brand?: string | null } | null };
    const favs = ((favorites.data ?? []) as unknown as FavRow[])
      .filter((f) => f.products?.canonical_name)
      .map((f) => ({ name: f.products!.canonical_name as string, brand: f.products?.brand ?? null }));

    // Interesse por perfume: soma de aberturas e do tempo realmente visível.
    const byProduct = new Map<string, { name: string; opens: number; seconds: number }>();
    for (const e of (events.data ?? []) as unknown as Ev[]) {
      const name = e.products?.canonical_name ?? null;
      if (!name || (e.event !== "product_view" && e.event !== "product_dwell")) continue;
      const cur = byProduct.get(name) ?? { name, opens: 0, seconds: 0 };
      if (e.event === "product_view") cur.opens += 1;
      if (e.event === "product_dwell") cur.seconds += Number(e.meta?.seconds ?? 0);
      byProduct.set(name, cur);
    }
    const interests = [...byProduct.values()]
      .sort((a, b) => b.seconds - a.seconds || b.opens - a.opens)
      .slice(0, 8);

    return {
      session: { ...(session as unknown as LiveSessionRow), cart_total: Number((session as { cart_total: number }).cart_total ?? 0) },
      timeline: evRows,
      interests,
      interactions: (interactions.data ?? []) as unknown as LiveInteraction[],
      recentProducts,
      cart,
      favorites: favs,
    } satisfies LiveSessionDetail;
  });

/** Cupons realmente válidos hoje — a equipe nunca envia benefício que não existe. */
export const liveCoupons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context as never);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();
    const { data, error } = await db
      .from("coupons")
      .select("id, code, discount_percent, applies_to, active, starts_at, ends_at, max_redemptions, redemptions")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((c) => (!c.starts_at || c.starts_at <= nowIso) && (!c.ends_at || c.ends_at >= nowIso))
      .filter((c) => !c.max_redemptions || Number(c.redemptions ?? 0) < Number(c.max_redemptions))
      .map((c) => ({
        code: c.code,
        discountPercent: Number(c.discount_percent),
        appliesTo: c.applies_to as string,
        endsAt: c.ends_at as string | null,
      }));
  });

const COOLDOWN_MS = 3 * 60 * 1000;

/** Envia mensagem, cupom ou oferta de ajuda para uma sessão ativa. */
export const liveSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      sessionKey: string;
      kind: "mensagem" | "cupom" | "ajuda" | "salvar_escolhas";
      message?: string | null;
      couponCode?: string | null;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context as never);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const sessionKey = text(data.sessionKey, 80);
    if (!sessionKey) throw new Error("Sessão inválida.");

    const { data: session } = await db
      .from("live_sessions")
      .select("session_key, visitor_id, customer_id, declined_at, current_product_id")
      .eq("session_key", sessionKey)
      .maybeSingle();
    if (!session) throw new Error("Esta sessão não está mais ativa.");
    if (session.declined_at) throw new Error("O visitante recusou atendimento nesta visita. Respeite a escolha.");

    const { data: last } = await db
      .from("live_interactions")
      .select("created_at, accepted_at, dismissed_at")
      .eq("session_key", sessionKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (last && !last.accepted_at && !last.dismissed_at) {
      const age = Date.now() - new Date(last.created_at).getTime();
      if (age < COOLDOWN_MS) {
        const left = Math.ceil((COOLDOWN_MS - age) / 60000);
        throw new Error(`Aguarde ${left} min ou a resposta do visitante antes de abordar de novo.`);
      }
    }

    let message = text(data.message, 240);
    let couponCode: string | null = null;

    if (data.kind === "cupom") {
      const code = (data.couponCode ?? "").trim().toUpperCase();
      const nowIso = new Date().toISOString();
      const { data: coupon } = await db
        .from("coupons")
        .select("code, discount_percent, active, starts_at, ends_at, max_redemptions, redemptions")
        .eq("code", code)
        .maybeSingle();
      const valid =
        coupon &&
        coupon.active &&
        (!coupon.starts_at || coupon.starts_at <= nowIso) &&
        (!coupon.ends_at || coupon.ends_at >= nowIso) &&
        (!coupon.max_redemptions || Number(coupon.redemptions ?? 0) < Number(coupon.max_redemptions));
      if (!valid || !coupon) throw new Error("Este cupom não está válido — escolha outro ou crie um novo.");
      couponCode = coupon.code;
      message = message ?? `Uma condição especial para você: ${Number(coupon.discount_percent)}% OFF.`;
    }

    if (data.kind === "mensagem" && (!message || message.length < 3)) {
      throw new Error("Escreva a mensagem.");
    }
    if (data.kind === "ajuda") message = message ?? "Ficou em dúvida? Posso te ajudar a escolher.";
    if (data.kind === "salvar_escolhas")
      message = message ?? "Quer salvar seus favoritos e receber ajuda da Orium?";

    const { data: created, error } = await db
      .from("live_interactions")
      .insert({
        session_key: sessionKey,
        visitor_id: session.visitor_id,
        customer_id: session.customer_id,
        kind: data.kind,
        message,
        coupon_code: couponCode,
        product_id: session.current_product_id,
        created_by: context.userId,
      } as never)
      .select("id, kind, message, coupon_code, product_id, created_at, seen_at, accepted_at, dismissed_at")
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (session.customer_id) {
      await db.rpc("crm_log_event", {
        p_customer_id: session.customer_id,
        p_event:
          data.kind === "cupom" ? "cupom_enviado" : data.kind === "ajuda" ? "ajuda_oferecida" : "mensagem_enviada",
        p_details: { message, coupon: couponCode } as never,
      });
    }

    return { ok: true as const, interaction: created as unknown as LiveInteraction };
  });

/** Cupom individual desta sessão: uso único, validade curta, validado no backend. */
export const liveCreateCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionKey: string; percent: number; hours?: number }) => data)
  .handler(async ({ data, context }) => {
    await assertStaff(context as never);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const percent = Math.min(40, Math.max(5, Math.round(Number(data.percent))));
    const hours = Math.min(168, Math.max(2, Math.round(Number(data.hours ?? 48))));
    const suffix = (text(data.sessionKey, 80) ?? "").replace(/-/g, "").slice(-4).toUpperCase() || "ORIU";
    const code = `ORI-${suffix}-${percent}`;

    const values = {
      discount_percent: percent,
      visibility: "SECRET",
      applies_to: "BOTH",
      active: true,
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
      max_redemptions: 1,
      max_per_user: 1,
      created_by: context.userId,
    };

    const { data: existing } = await db.from("coupons").select("id").eq("code", code).maybeSingle();
    const { error } = existing
      ? await db.from("coupons").update(values as never).eq("id", existing.id)
      : await db.from("coupons").insert({ code, ...values } as never);
    if (error) throw new Error(error.message);
    return { code, percent };
  });

