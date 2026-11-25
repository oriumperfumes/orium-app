/**
 * VENDAS — leitura do livro único (Admin/Owner). Só lê: cada venda continua
 * sendo gravada no lugar dela (Pedidos, balcão via store_sale_commit,
 * Negociação via saveNegotiationSale). O banco confere is_staff.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LedgerResult } from "@/lib/sales-ledger";

export const salesLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { from: string; to: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context as { supabase: any }).supabase.rpc(
      "sales_ledger",
      {
        p_from: data.from,
        p_to: data.to,
      },
    );
    if (error) throw new Error(error.message === "forbidden" ? "Sem permissão." : error.message);
    return result as LedgerResult;
  });
