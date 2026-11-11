/**
 * LEITURA DO FUNIL — somente equipe.
 * As funções do banco checam a permissão, então nenhum dado de visitante
 * vaza para quem não é da equipe.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FunnelStep = { key: string; label: string; people: number };

export type FunnelReport = {
  from: string;
  to: string;
  visitors: number;
  identified: number;
  anonymous: number;
  sessions: number;
  events: number;
  steps: FunnelStep[];
  /** Pedidos do período: rastreados pelo funil x totais (inclui manuais/antigos). */
  orders: {
    total: number;
    total_confirmed: number;
    tracked: number;
    tracked_confirmed: number;
    untracked: number;
  };
  /** Microconversões paralelas — nunca etapas obrigatórias do funil. */
  micro: {
    favorites: number;
    help: number;
    leads: number;
    searches: number;
    negotiation: number;
  };
  sources: Array<{ source: string; campaign: string | null; visitors: number; leads: number }>;
  order_sources: Array<{ source: string; orders: number }>;
  devices: Array<{ device: string; visitors: number }>;
  device_conversion: Array<{ device: string; added: number; whatsapp: number }>;
  variants: {
    decant_views: number;
    bottle_views: number;
    decant_added: number;
    bottle_added: number;
    decant_2ml: number;
    decant_5ml: number;
    decant_10ml: number;
  };
  products: Array<{
    product_id: string;
    name: string;
    brand: string | null;
    slug: string | null;
    views: number;
    visitors: number;
    added: number;
  }>;
  added_products: Array<{ product_id: string; name: string; brand: string | null; added: number; ordered: number }>;
  carts: {
    abandoned: number;
    active: number;
    abandoned_total: number;
    abandoned_avg: number;
    recovered: number;
  };
  abandoned_products: Array<{ name: string; quantity: number }>;
  lead_triggers: Array<{ trigger: string; leads: number }>;
};

export const conversionFunnel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { from: string; to: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: report, error } = await context.supabase.rpc("analytics_funnel", {
      p_from: data.from,
      p_to: data.to,
    });
    if (error) throw new Error(error.message);
    return report as unknown as FunnelReport;
  });

export type CustomerJourney = {
  first_source: string | null;
  lead_trigger: string | null;
  marketing_optin: boolean | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  device: string | null;
  utm_campaign: string | null;
  searches: Array<{ query: string; at: string }>;
  help_requests: Array<{ name: string | null; slug: string | null; at: string }>;
};

export const customerJourney = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: journey, error } = await context.supabase.rpc("crm_customer_journey", {
      p_customer_id: data.id,
    });
    if (error) throw new Error(error.message);
    return (journey ?? {}) as unknown as CustomerJourney;
  });
