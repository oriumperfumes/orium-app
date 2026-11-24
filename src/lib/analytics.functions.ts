/**
 * GRAVAÇÃO DA JORNADA — sempre no servidor.
 *
 * O visitante nunca escreve direto nas tabelas de analytics. Quando existe
 * login, a identidade vem do token da sessão (nunca do corpo da requisição).
 */
import { createServerFn } from "@tanstack/react-start";

type IncomingEvent = {
  event: string;
  productId?: string | null;
  variant?: string | null;
  decantMl?: number | null;
  price?: number | null;
  promotionId?: string | null;
  path?: string | null;
  query?: string | null;
  meta?: Record<string, unknown> | null;
};

const ALLOWED = new Set([
  "session_started",
  "product_view",
  "card_clicked",
  "product_open",
  "product_dwell",
  "filters_applied",
  "decant_selected",
  "bottle_selected",
  "search",
  "favorite_added",
  "favorite_removed",
  "cart_item_added",
  "cart_opened",
  "checkout_started",
  "whatsapp_checkout_clicked",
  "lead_identified",
  "consultant_help_clicked",
  "discovery_clicked",
  "negotiation_interest",
  "order_created",
]);

const text = (v: unknown, max = 160) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

const uuid = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

export const trackEvents = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      visitorId: string;
      sessionKey: string;
      session?: {
        device?: string | null;
        source?: string | null;
        referrer?: string | null;
        landingPath?: string | null;
        utmSource?: string | null;
        utmMedium?: string | null;
        utmCampaign?: string | null;
        utmContent?: string | null;
        utmTerm?: string | null;
        context?: {
          browser?: string | null;
          os?: string | null;
          standalone?: boolean | null;
          screen?: string | null;
          viewport?: string | null;
          dpr?: number | null;
          touch?: boolean | null;
          orientation?: string | null;
          language?: string | null;
          timezone?: string | null;
          theme?: string | null;
          connection?: string | null;
          saveData?: boolean | null;
          memoryGb?: number | null;
          cpuCores?: number | null;
        } | null;
      } | null;
      events: IncomingEvent[];
    }) => data,
  )
  .handler(async ({ data }) => {
    try {
      const visitorId = text(data.visitorId, 80);
      const sessionKey = text(data.sessionKey, 80);
      if (!visitorId || !sessionKey) return { ok: false as const };

      const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
      const { verifiedViewerId } = await import("@/lib/viewer.server");
      const userId = await verifiedViewerId();

      const now = new Date().toISOString();
      const s = data.session ?? null;
      const device = text(s?.device, 20);
      const source = text(s?.source, 60);
      const c = s?.context ?? null;
      const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
      const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
      // Contexto técnico público do navegador — nunca dado privado.
      const tech = {
        browser: text(c?.browser, 40),
        os: text(c?.os, 40),
        standalone: bool(c?.standalone),
        screen: text(c?.screen, 20),
        viewport: text(c?.viewport, 20),
        dpr: num(c?.dpr),
        touch: bool(c?.touch),
        language: text(c?.language, 20),
        timezone: text(c?.timezone, 60),
        theme: text(c?.theme, 12),
      };

      // visitante: primeira origem NUNCA é sobrescrita
      const { data: existing } = await db
        .from("analytics_visitors")
        .select("visitor_id, customer_id, sessions_count")
        .eq("visitor_id", visitorId)
        .maybeSingle();

      if (!existing) {
        await db.from("analytics_visitors").insert({
          visitor_id: visitorId,
          user_id: userId,
          device,
          first_source: source,
          first_referrer: text(s?.referrer, 300),
          first_landing: text(s?.landingPath, 200),
          utm_source: text(s?.utmSource, 80),
          utm_medium: text(s?.utmMedium, 80),
          utm_campaign: text(s?.utmCampaign, 120),
          utm_content: text(s?.utmContent, 120),
          utm_term: text(s?.utmTerm, 120),
          last_source: source,
          last_referrer: text(s?.referrer, 300),
          sessions_count: 1,
          ...tech,
        } as never);
      } else if (s) {
        // Visita nova do mesmo aparelho: contamos a recorrência sem apagar a origem.
        const prev = existing as { sessions_count?: number } | null;
        await db
          .from("analytics_visitors")
          .update({
            last_seen_at: now,
            sessions_count: Number((prev as { sessions_count?: number } | null)?.sessions_count ?? 1) + 1,
            last_source: source,
            last_referrer: text(s.referrer, 300),
            ...(userId ? { user_id: userId } : {}),
            ...(device ? { device } : {}),
            ...tech,
          } as never)
          .eq("visitor_id", visitorId);
      } else {
        await db
          .from("analytics_visitors")
          .update({
            last_seen_at: now,
            ...(userId ? { user_id: userId } : {}),
            ...(device ? { device } : {}),
          } as never)
          .eq("visitor_id", visitorId);
      }

      const customerId = existing?.customer_id ?? null;

      if (s) {
        await db.from("analytics_sessions").upsert(
          {
            session_key: sessionKey,
            visitor_id: visitorId,
            user_id: userId,
            customer_id: customerId,
            device,
            source,
            referrer: text(s.referrer, 300),
            landing_path: text(s.landingPath, 200),
            utm_source: text(s.utmSource, 80),
            utm_medium: text(s.utmMedium, 80),
            utm_campaign: text(s.utmCampaign, 120),
            utm_content: text(s.utmContent, 120),
            utm_term: text(s.utmTerm, 120),
            ...tech,
            orientation: text(c?.orientation, 12),
            connection: text(c?.connection, 20),
            save_data: bool(c?.saveData),
            memory_gb: num(c?.memoryGb),
            cpu_cores: num(c?.cpuCores),
            last_event_at: now,
          } as never,
          { onConflict: "session_key" },
        );
      } else {
        await db
          .from("analytics_sessions")
          .update({ last_event_at: now, ...(customerId ? { customer_id: customerId } : {}) } as never)
          .eq("session_key", sessionKey);
      }

      const rows = (data.events ?? [])
        .filter((e) => e && ALLOWED.has(e.event))
        .slice(0, 40)
        .map((e) => ({
          event: e.event,
          visitor_id: visitorId,
          session_key: sessionKey,
          user_id: userId,
          customer_id: customerId,
          product_id: uuid(e.productId),
          variant: e.variant === "DECANT" ? "DECANT" : e.variant === "FULL" ? "FULL" : null,
          decant_ml: Number.isFinite(Number(e.decantMl)) && e.decantMl ? Math.floor(Number(e.decantMl)) : null,
          price: Number.isFinite(Number(e.price)) && e.price ? Number(e.price) : null,
          promotion_id: uuid(e.promotionId),
          path: text(e.path, 200),
          query: text(e.query, 120),
          device,
          source,
          meta: (e.meta ?? {}) as never,
        }));

      if (rows.length) await db.from("analytics_events").insert(rows as never);
      return { ok: true as const, stored: rows.length };
    } catch {
      return { ok: false as const };
    }
  });

/**
 * Visitante anônimo vira lead: cria OU atualiza a MESMA ficha do CRM
 * (telefone normalizado / conta / aparelho) e liga o histórico anterior.
 */
export const identifyLead = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      visitorId: string;
      name: string;
      phone?: string | null;
      email?: string | null;
      trigger: string;
      marketingOptin?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const visitorId = text(data.visitorId, 80);
    const name = text(data.name, 80);
    const digits = (data.phone ?? "").replace(/\D/g, "");
    const phone = digits.length >= 10 ? digits.slice(-11) : null;
    const email = text(data.email, 160)?.toLowerCase() ?? null;
    const trigger = text(data.trigger, 40) ?? "outro";

    if (!name || name.length < 2) throw new Error("Informe seu nome.");
    if (!phone && !email) throw new Error("Informe um WhatsApp para continuarmos.");

    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { verifiedViewerId } = await import("@/lib/viewer.server");
    const userId = await verifiedViewerId();

    const args: { p_name?: string; p_phone?: string; p_email?: string; p_device_id?: string; p_user_id?: string } = {
      p_name: name,
    };
    if (phone) args.p_phone = phone;
    if (email) args.p_email = email;
    if (visitorId) args.p_device_id = visitorId;
    if (userId) args.p_user_id = userId;

    const { data: cid, error } = await db.rpc("crm_upsert_customer", args);
    if (error) throw new Error(error.message);
    const customerId = (cid as string | null) ?? null;
    if (!customerId) throw new Error("Não conseguimos salvar seus dados agora.");

    if (visitorId) {
      const { data: visitor } = await db
        .from("analytics_visitors")
        .select("first_source")
        .eq("visitor_id", visitorId)
        .maybeSingle();

      await db.from("analytics_visitors").update({ customer_id: customerId } as never).eq("visitor_id", visitorId);
      await db.from("analytics_sessions").update({ customer_id: customerId } as never).eq("visitor_id", visitorId);
      await db.from("analytics_events").update({ customer_id: customerId } as never).eq("visitor_id", visitorId);

      const patch: Record<string, unknown> = { lead_trigger: trigger };
      if (visitor?.first_source) patch['first_source'] = visitor.first_source;
      if (data.marketingOptin) {
        patch['marketing_optin'] = true;
        patch['marketing_optin_at'] = new Date().toISOString();
      }
      await db.from("crm_customers").update(patch as never).eq("id", customerId);

      await db.from("analytics_events").insert({
        event: "lead_identified",
        visitor_id: visitorId,
        customer_id: customerId,
        user_id: userId,
        meta: { trigger } as never,
      } as never);
    }

    return { ok: true as const, customerId, name, phone };
  });
