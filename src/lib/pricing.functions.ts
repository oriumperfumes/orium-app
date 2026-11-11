import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProductPricing } from "@/lib/pricing.server";

/** Diagnóstico completo de preço de um produto (staff). */
export const getProductPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string }) => data)
  .handler(async ({ data, context }): Promise<ProductPricing | null> => {
    const { supabase, userId } = context;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
    if (!isStaff) throw new Error("Sem permissão.");
    const { calculateProductPricing } = await import("@/lib/pricing.server");
    return calculateProductPricing(supabase, data.productId);
  });

/** Recalcula o preço de TODO o catálogo, em lotes (staff). */
export const recalculatePricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { cursor?: number }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
    if (!isStaff) throw new Error("Sem permissão.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recalculateAllPricing } = await import("@/lib/pricing.server");
    return recalculateAllPricing(supabaseAdmin, data.cursor ?? 0);
  });
