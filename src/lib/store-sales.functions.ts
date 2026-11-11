/**
 * VENDAS DA LOJA — leitura e escrita (Admin/Owner apenas).
 *
 * A IA interpreta, o banco valida, o Admin confirma. Nada é registrado sem
 * passar por `store_sale_commit`, que grava venda + itens + snapshot de custo +
 * estoque + auditoria numa única transação idempotente.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DECANT_DEFAULT_PRICES, type DecantMl } from "@/lib/decants";
import type { MatchCandidate } from "@/lib/store-sales-match.server";

type Ctx = { supabase: any; userId: string };

async function staffDb(context: Ctx) {
  const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!isStaff) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export type SaleVariant = "FULL" | "DECANT" | "UNKNOWN";

export type SaleDraftItem = {
  /** identificador local do item na revisão */
  key: string;
  spoken_name: string;
  product_id: string | null;
  name: string;
  brand: string | null;
  image_url: string | null;
  variant: SaleVariant;
  decant_ml: DecantMl | null;
  quantity: number;
  unit_price: number | null;
  /** de onde veio o preço mostrado */
  price_source: "spoken" | "current" | "none";
  confidence: "high" | "medium" | "low";
  candidates: MatchCandidate[];
  /** a fala não disse se é frasco ou decant */
  needs_variant: boolean;
  /** é decant e o tamanho não foi dito */
  needs_size: boolean;
};


export type SaleDraft = {
  items: SaleDraftItem[];
  payment_method: string | null;
  customer_name: string | null;
  customer_id: string | null;
  discount: number | null;
  total: number | null;
  sold_at: string | null;
  transcript: string | null;
};

type DecantSettingsRow = { price_2ml: number; price_5ml: number; price_10ml: number } | null;

function decantPriceOf(candidate: MatchCandidate | null, settings: DecantSettingsRow, ml: DecantMl): number {
  const override = candidate?.[`decant_price_${ml}ml` as const];
  if (override != null && Number(override) > 0) return Number(override);
  const global = settings?.[`price_${ml}ml` as const];
  if (global != null && Number(global) > 0) return Number(global);
  return DECANT_DEFAULT_PRICES[ml];
}

/** Preço vigente da variante — só sugestão, sempre visível antes de confirmar. */
export function suggestPrice(
  candidate: MatchCandidate | null,
  settings: DecantSettingsRow,
  variant: SaleVariant,
  ml: DecantMl | null,
): number | null {
  if (!candidate) return null;
  if (variant === "DECANT") return ml ? decantPriceOf(candidate, settings, ml) : null;
  if (variant === "FULL") return candidate.retail_price ?? null;
  return null;
}

const saleModeOfCandidate = (c: MatchCandidate) => String(c.sale_mode ?? "BOTH").toUpperCase();

export function inferVariant(candidate: MatchCandidate | null, spoken: SaleVariant): { variant: SaleVariant; needs: boolean } {
  if (spoken !== "UNKNOWN") return { variant: spoken, needs: false };
  if (!candidate) return { variant: "UNKNOWN", needs: true };
  const mode = saleModeOfCandidate(candidate);
  const canDecant = candidate.product_type === "PERFUME" && candidate.decant_available && mode !== "FULL_ONLY";
  const canFull = mode !== "DECANT_ONLY" && candidate.retail_price != null;
  if (canFull && !canDecant) return { variant: "FULL", needs: false };
  if (canDecant && !canFull) return { variant: "DECANT", needs: true };
  return { variant: "UNKNOWN", needs: true };
}

export function resolveSoldAt(hint: string | null): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  const now = new Date();
  const back = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString();
  };
  if (h.includes("anteontem")) return back(2);
  if (h.includes("ontem")) return back(1);
  const iso = Date.parse(hint);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();
  return null;
}

/** Busca de produto para a venda manual (fuzzy, mesma identidade do catálogo). */
export const storeSaleProductSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await staffDb(context as never);
    const q = (data.q ?? "").trim();
    if (q.length < 2) return { results: [] as MatchCandidate[], decant: null as DecantSettingsRow };
    const { resolveProductCandidates } = await import("@/lib/store-sales-match.server");
    const results = await resolveProductCandidates(db, q, null);
    const { data: settings } = await db.from("decant_settings").select("*").maybeSingle();
    return { results, decant: (settings ?? null) as DecantSettingsRow };
  });

/** Produtos de uma venda existente, com preços vigentes (para a edição). */
export const storeSaleItemCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ids: string[] }) => data)
  .handler(async ({ data, context }) => {
    const db = await staffDb(context as never);
    const ids = (data.ids ?? []).filter(Boolean).slice(0, 40);
    const { candidateById } = await import("@/lib/store-sales-match.server");
    const rows: MatchCandidate[] = [];
    for (const id of ids) {
      const row = await candidateById(db, id);
      if (row) rows.push(row);
    }
    const { data: settings } = await db.from("decant_settings").select("*").maybeSingle();
    return { results: rows, decant: (settings ?? null) as DecantSettingsRow };
  });

/** Clientes do CRM para vincular a venda (opcional, nunca obrigatório). */
export const storeSaleCustomerSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await staffDb(context as never);
    const q = (data.q ?? "").trim();
    if (q.length < 2) return [];
    const { data: rows } = await db
      .from("crm_customers")
      .select("id, name, phone, phone_normalized")
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .is("archived_at", null)
      .limit(8);
    return (rows ?? []) as Array<{ id: string; name: string | null; phone: string | null }>;
  });


/** Registro final: atômico, validado no banco e idempotente. */
export const storeSaleCommit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      idempotency_key: string;
      entry_method: "voice" | "manual";
      payment_method: string;
      customer_id?: string | null;
      customer_name?: string | null;
      sold_at?: string | null;
      transcript?: string | null;
      discount?: number | null;
      total?: number | null;
      items: Array<{ product_id: string; variant: "FULL" | "DECANT"; decant_ml?: number | null; quantity: number; unit_price: number }>;
      /** fala → perfume confirmado pelo Admin (aprendizado de reconhecimento por voz) */
      learn?: Array<{ spoken_name: string; product_id: string; corrected: boolean }>;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!isStaff) throw new Error("Sem permissão.");
    if (!data.items?.length) throw new Error("Adicione pelo menos um perfume.");
    if (!data.payment_method) throw new Error("Escolha a forma de pagamento.");

    const { data: result, error } = await context.supabase.rpc("store_sale_commit", {
      p_payload: {
        idempotency_key: data.idempotency_key,
        entry_method: data.entry_method,
        payment_method: data.payment_method,
        customer_id: data.customer_id ?? null,
        customer_name: data.customer_name ?? null,
        sold_at: data.sold_at ?? null,
        transcript: data.transcript ?? null,
        discount: data.discount ?? null,
        total: data.total ?? null,
        items: data.items.map((i) => ({
          product_id: i.product_id,
          variant: i.variant,
          decant_ml: i.decant_ml ?? null,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      } as never,
    });
    if (error) throw new Error(error.message);
    const sale = result as { id: string; duplicate: boolean };

    // aprendizado: só com o que o Admin confirmou, e só na primeira gravação
    if (!sale.duplicate && data.learn?.length) {
      const { flat, phoneticKey } = await import("@/lib/store-sales-phonetics");
      const { forgetCatalogIndex } = await import("@/lib/store-sales-match.server");
      for (const l of data.learn) {
        const spoken = flat(l.spoken_name ?? "");
        if (spoken.length < 3 || !l.product_id) continue;
        await context.supabase
          .rpc("voice_alias_learn", {
            p_transcript: spoken,
            p_phonetic: phoneticKey(spoken),
            p_product_id: l.product_id,
          })
          .then(
            () => undefined,
            () => undefined,
          );
        await context.supabase
          .from("voice_match_log")
          .insert({
            transcript: data.transcript ?? null,
            spoken_name: l.spoken_name,
            confirmed_product_id: l.product_id,
            corrected: l.corrected === true,
            sale_id: sale.id,
          })
          .then(
            () => undefined,
            () => undefined,
          );
      }
      forgetCatalogIndex();
    }

    return sale;

  });

export const storeSaleCancel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; reason?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("store_sale_cancel", {
      p_id: data.id,
      p_reason: data.reason ?? "",
    });
    if (error) throw new Error(error.message);
    return result as { id: string; already: boolean };
  });

/**
 * Edição de venda: o banco estorna o impacto atual e aplica o novo na mesma
 * transação. `expected_seq` garante que dois toques em "Salvar alterações"
 * apliquem a movimentação uma única vez.
 */
export const storeSaleUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      id: string;
      expected_seq: number;
      payment_method: string;
      customer_id?: string | null;
      customer_name?: string | null;
      sold_at?: string | null;
      discount?: number | null;
      total?: number | null;
      items: Array<{ product_id: string; variant: "FULL" | "DECANT"; decant_ml?: number | null; quantity: number; unit_price: number }>;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!isStaff) throw new Error("Sem permissão.");
    if (!data.items?.length) throw new Error("A venda precisa de pelo menos um perfume.");
    if (!data.payment_method) throw new Error("Escolha a forma de pagamento.");

    const { data: result, error } = await context.supabase.rpc("store_sale_update", {
      p_payload: {
        id: data.id,
        expected_seq: data.expected_seq,
        payment_method: data.payment_method,
        customer_id: data.customer_id ?? null,
        customer_name: data.customer_name ?? null,
        sold_at: data.sold_at ?? null,
        discount: data.discount ?? null,
        total: data.total ?? null,
        items: data.items.map((i) => ({
          product_id: i.product_id,
          variant: i.variant,
          decant_ml: i.decant_ml ?? null,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      } as never,
    });
    if (error) throw new Error(error.message);
    return result as { id: string; already: boolean; edit_seq: number };
  });

/** Exclusão com reversão completa (soft delete: a auditoria permanece). */
export const storeSaleDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; reason?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!isStaff) throw new Error("Sem permissão.");
    const { data: result, error } = await context.supabase.rpc("store_sale_delete", {
      p_id: data.id,
      p_reason: data.reason ?? "",
    });
    if (error) throw new Error(error.message);
    return result as { id: string; already: boolean };
  });


export type StoreSaleListItem = {
  id: string;
  sale_number: string;
  sold_at: string;
  payment_method: string | null;
  total: number;
  gross_profit: number;
  cost_complete: boolean;
  status: string;
  entry_method: string;
  customer_name: string | null;
  items: Array<{
    name: string | null;
    brand: string | null;
    image_url: string | null;
    variant: string;
    decant_ml: number | null;
    quantity: number;
  }>;
};

export type StoreSaleListResult = {
  today: { total: number; count: number; profit: number };
  period: { total: number; count: number; profit: number };
  sales: StoreSaleListItem[];
};

export const storeSaleList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { from: string; to: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("store_sale_list", {
      p_from: data.from,
      p_to: data.to,
    });
    if (error) throw new Error(error.message);
    return result as StoreSaleListResult;
  });

/** Detalhes de auditoria: JSON puro (before/after, motivo, política de custo). */
export type SaleEventJson = string | number | boolean | null | SaleEventJson[] | { [key: string]: SaleEventJson };
export type SaleEventDetails = { [key: string]: SaleEventJson };

export type StoreSaleDetail = {

  id: string;
  sale_number: string;
  sold_at: string;
  status: string;
  entry_method: string;
  sale_channel: string;
  payment_method: string | null;
  customer_id: string | null;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  total: number;
  cost_total: number;
  gross_profit: number;
  cost_complete: boolean;
  transcript: string | null;
  edit_seq: number;
  deleted_at: string | null;
  items: Array<{
    id: string;
    product_id: string | null;
    name: string | null;
    brand: string | null;
    image_url: string | null;
    variant: string;
    decant_ml: number | null;
    quantity: number;
    unit_price: number;
    unit_cost: number | null;
    ml_consumed: number;
    subtotal: number;
  }>;
  events: Array<{ event: string; at: string; details: SaleEventDetails | null }>;
};


export const storeSaleDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("store_sale_detail", { p_id: data.id });
    if (error) throw new Error(error.message);
    return result as StoreSaleDetail;
  });
