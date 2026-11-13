/**
 * ESTOQUE FÍSICO DA LOJA — somente frascos lacrados (products.local_stock).
 * Separado dos fornecedores. Toda mudança passa por inventory_adjust (histórico antes → depois).
 * Produtos que já entraram no estoque ficam "acompanhados" (products.stock_tracked) e geram
 * alertas: 1 un. = LOW_STOCK, 0 un. = OUT_OF_STOCK. Os alertas somem sozinhos ao repor.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export type StoreStockItem = {
  id: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  volume_ml: number | null;
  units: number;
  unit_cost: number | null;
  retail_price: number | null;
  cost_total: number;
  status: StockStatus;
  in_restock: boolean;
  restock_qty: number;
};
export type StockAlert = {
  id: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  units: number;
  status: StockStatus;
  in_restock: boolean;
  restock_qty: number;
};
export type StoreStock = {
  units: number;
  products: number;
  cost: number;
  sale_value: number;
  missing_cost: number;
  items: StoreStockItem[];
  alerts: StockAlert[];
};

export const storeStock = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any).rpc("admin_store_stock");
    if (error) throw new Error(error.message);
    return data as StoreStock;
  });

export const stockSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    const q = data.q.trim().replace(/[%,()]/g, " ");
    if (q.length < 2) return [];
    // raw_name e local_stock são colunas internas de products: só a equipe, pelo cliente de serviço.
    const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!isStaff) throw new Error("Sem permissão.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("products")
      .select("id, canonical_name, raw_name, brand, image_url, volume_ml, local_stock")
      .or(`canonical_name.ilike.%${q}%,brand.ilike.%${q}%,raw_name.ilike.%${q}%`)
      .order("local_stock", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const stockAdjust = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        mode: z.enum(["set", "add", "remove"]),
        quantity: z.number().int().min(0).max(9999),
        note: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("inventory_adjust", {
      p_product_id: data.productId,
      p_mode: data.mode,
      p_qty: data.quantity,
      p_reason: data.note?.trim() || null,
      p_source: "estoque",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Limpa a lista de estoque físico e zera todas as unidades em uma operação
 * atômica. A função SQL é SECURITY DEFINER e confere o usuário novamente.
 * Catálogo, estoque de fornecedores, reposição e movimentos anteriores ficam.
 */
export const stockClearAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ confirmation: z.literal("LIMPAR ESTOQUE") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).rpc("store_stock_clear_all", {
      p_confirmation: data.confirmation,
    });
    if (error) throw new Error(error.message);
    return result as { products: number; units: number; zeroed_products: number };
  });

/**
 * Coloca o perfume na lista real de Reposição (a aberta) com a quantidade escolhida.
 * Nunca duplica: se já estiver na lista, soma à linha existente.
 */
export const stockAddToRestock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(999).default(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: staff } = await sb.rpc("is_staff", { _user_id: context.userId });
    if (!staff) throw new Error("Sem permissão.");
    const { openRestockList } = await import("@/lib/orders-restock.server");
    const listId = await openRestockList(sb, context.userId);
    const { data: ex } = await sb
      .from("restock_items")
      .select("id, quantity")
      .eq("restock_list_id", listId)
      .eq("product_id", data.productId)
      .order("created_at")
      .limit(1);
    if (ex?.length) {
      const total = Number(ex[0].quantity ?? 0) + data.quantity;
      const { error } = await sb.from("restock_items").update({ quantity: total }).eq("id", ex[0].id);
      if (error) throw new Error(error.message);
      return { already: true, quantity: total };
    }
    const { data: cost } = await sb
      .from("product_costs")
      .select("best_cost, best_supplier_id")
      .eq("product_id", data.productId)
      .maybeSingle();
    const { error } = await sb.from("restock_items").insert({
      restock_list_id: listId,
      product_id: data.productId,
      supplier_id: cost?.best_supplier_id ?? null,
      quantity: data.quantity,
      unit_cost: Number(cost?.best_cost ?? 0),
    });
    if (error) throw new Error(error.message);
    return { already: false, quantity: data.quantity };
  });

/** Adiciona ou remove o perfume da lista permanente do Estoque da loja. */
export const stockSetTracked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ productId: z.string().uuid(), tracked: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("store_stock_set_tracked", {
      p_product_id: data.productId,
      p_tracked: data.tracked,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const stockMoves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("inventory_movements")
      .select("delta, before_qty, after_qty, mode, reason, source, created_at")
      .eq("product_id", data.productId)
      .not("mode", "like", "ml%")
      .order("created_at", { ascending: false })
      .limit(10);
    return rows ?? [];
  });
