/**
 * CRM DA ORIUM — somente equipe (owner/admin).
 * As funções do banco já checam a permissão, então nenhum dado de cliente
 * vaza para quem não é da equipe.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CrmCustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  user_id: string | null;
  orders_count: number;
  total_spent: number;
  avg_ticket: number;
  first_order_at: string | null;
  last_order_at: string | null;
  favorites_count: number;
  waiting_count: number;
  abandoned_count: number;
  active_cart_items: number;
  last_activity_at: string | null;
  total: number;
};

export type CrmCustomerDetail = {
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    user_id: string | null;
    created_at: string;
    archived_at: string | null;
    /** Quantos aparelhos/navegadores estão ligados a esta ficha. */
    devices: number;
    /** Ficha criada só pelo nome informado no aparelho (sem telefone/e-mail/conta). */
    provisional: boolean;
  };
  metrics: {
    orders_count: number;
    confirmed_count: number;
    total_spent: number;
    avg_ticket: number;
    first_order_at: string | null;
    last_order_at: string | null;
  };
  orders: Array<{
    id: string;
    order_number: string | null;
    status: string;
    is_confirmed: boolean;
    created_at: string;
    total: number;
    quantity: number;
    fulfillment: string;
  }>;
  decants: Array<{ name: string; brand: string | null; slug: string | null; ml: number | null; quantity: number; last_at: string }>;
  bottles: Array<{ name: string; brand: string | null; slug: string | null; volume_ml: number | null; quantity: number; last_at: string }>;
  others: Array<{ name: string; brand: string | null; slug: string | null; type: string | null; quantity: number; last_at: string }>;
  favorites: Array<{ product_id: string; name: string; brand: string | null; slug: string; image_url: string | null; in_stock: boolean; want_decant: boolean; created_at: string }>;
  waiting: Array<{ product_id: string; name: string; brand: string | null; slug: string; in_stock: boolean; channel: string; created_at: string }>;
  viewed: Array<{ name: string; brand: string | null; slug: string; views: number; last_at: string }>;
  recent_views?: Array<{
    product_id: string;
    name: string;
    brand: string | null;
    slug: string | null;
    image_url: string | null;
    in_stock: boolean;
    views: number;
    last_at: string;
  }>;
  negotiations: Array<{ id: string; item_id: string; item_name: string; created_at: string }>;
  carts: Array<{
    id: string;
    status: string;
    items_count: number;
    estimated_total: number;
    last_activity_at: string;
    abandoned_at: string | null;
    converted_at: string | null;
    items: Array<{ name: string | null; brand: string | null; variant: string; decant_ml: number | null; quantity: number; unit_price: number | null; slug: string | null }>;
  }>;
  notes: Array<{ id: string; note: string; created_at: string }>;
};

export type CrmOverview = {
  customers: number;
  abandoned_carts: number;
  active_carts: number;
  waiting_subscriptions: number;
  favorites: number;
  pending_notifications: number;
  waiting_products: Array<{ product_id: string; name: string; brand: string | null; slug: string; in_stock: boolean; people: number }>;
};

export const crmOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("crm_overview");
    if (error) throw new Error(error.message);
    return data as unknown as CrmOverview;
  });

export const crmCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q?: string | null; filter?: string | null; limit?: number; offset?: number }) => data)
  .handler(async ({ data, context }) => {
    const args: { p_q?: string; p_filter?: string; p_limit?: number; p_offset?: number } = {
      p_limit: data.limit ?? 20,
      p_offset: data.offset ?? 0,
    };
    if (data.q) args.p_q = data.q;
    if (data.filter) args.p_filter = data.filter;
    const { data: rows, error } = await context.supabase.rpc("crm_customer_list", args);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as unknown as CrmCustomerRow[];
    return { rows: list, total: Number(list[0]?.total ?? 0) };
  });

export const crmCustomer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: detail, error } = await context.supabase.rpc("crm_customer_detail", { p_customer_id: data.id });
    if (error) throw new Error(error.message);
    return (detail ?? null) as unknown as CrmCustomerDetail | null;
  });

/** Anotação interna — nunca aparece para o cliente. */
export const crmAddNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { customerId: string; note: string }) => data)
  .handler(async ({ data, context }) => {
    const note = (data.note ?? "").trim().slice(0, 2000);
    if (note.length < 2) throw new Error("Escreva a anotação.");
    const { error } = await context.supabase
      .from("crm_notes")
      .insert({ customer_id: data.customerId, note, created_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const crmDeleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("crm_notes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Marca como abandonados os carrinhos parados há mais tempo que o limite. */
export const crmMarkAbandoned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { minutes?: number }) => data)
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!staff) throw new Error("Sem permissão.");
    const { data: count, error } = await context.supabase.rpc("mark_abandoned_carts", {
      p_minutes: Math.max(5, Math.floor(Number(data.minutes ?? 45))),
    });
    if (error) throw new Error(error.message);
    return { marked: Number(count ?? 0) };
  });

/** Corrige nome/telefone/e-mail do cliente (somente equipe). */
export const crmCustomerUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; name?: string | null; phone?: string | null; email?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const args: { p_customer_id: string; p_name?: string; p_phone?: string; p_email?: string } = {
      p_customer_id: data.id,
    };
    if (data.name != null) args.p_name = data.name;
    if (data.phone != null) args.p_phone = data.phone;
    if (data.email != null) args.p_email = data.email;
    const { error } = await context.supabase.rpc("crm_customer_update", args);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Arquiva (ou desarquiva) o cliente sem apagar histórico de pedidos. */
export const crmCustomerArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; archived: boolean }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("crm_customer_set_archived", {
      p_customer_id: data.id,
      p_archived: data.archived,
    });
    if (error) throw new Error(error.message);
    return { archived: data.archived };
  });

export type CrmCleanupCounts = {
  fichas: number;
  favoritos: number;
  carrinhos: number;
  abandonados: number;
  visualizacoes: number;
  interesses: number;
  alertas: number;
  eventos: number;
};

/** Quantos registros de teste seriam apagados (nada é excluído aqui). */
export const crmCleanupPreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { includeReal?: boolean }) => data)
  .handler(async ({ data, context }) => {
    const { data: counts, error } = await context.supabase.rpc("crm_cleanup_preview", {
      p_include_real: !!data.includeReal,
    });
    if (error) throw new Error(error.message);
    return (counts ?? {}) as unknown as CrmCleanupCounts;
  });

/** Apaga só o que foi marcado. Pedidos, estoque, produtos e promoções nunca são tocados. */
export const crmCleanupApply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { scopes: string[]; includeReal?: boolean }) => data)
  .handler(async ({ data, context }) => {
    const scopes = (data.scopes ?? []).filter((s) => typeof s === "string" && s.length > 0).slice(0, 12);
    if (scopes.length === 0) throw new Error("Selecione o que deseja limpar.");
    const { data: result, error } = await context.supabase.rpc("crm_cleanup_apply", {
      p_scopes: scopes,
      p_include_real: !!data.includeReal,
    });
    if (error) throw new Error(error.message);
    return (result ?? {}) as unknown as Partial<CrmCleanupCounts>;
  });

/** Somente proprietário: apaga todas as fichas de clientes sem pedidos reais. */
export const crmPurgeCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("crm_purge_customers_without_orders");
    if (error) throw new Error(error.message);
    return (data ?? {}) as unknown as { fichas?: number };
  });

/** Exclui apenas a ficha do CRM. Pedidos e histórico financeiro continuam intactos. */
export const crmCustomerDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("crm_customer_delete", { p_customer_id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
