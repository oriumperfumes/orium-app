import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Sincronização de fornecedores — exclusiva de owner/admin.
 * Roda em lotes: enquanto `nextCursor` não for nulo, a tela chama de novo.
 */
export const syncSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { supplierId: string; cursor?: number }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
    if (!isStaff) throw new Error("Sem permissão.");

    const { runSupplierSync } = await import("@/lib/suppliers/engine.server");
    return runSupplierSync(data.supplierId, data.cursor ?? 0);
  });

/** Teste curto da fonte, sem alterar ofertas. */
export const testSupplierConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { supplierId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
    if (!isStaff) throw new Error("Sem permissão.");
    const { data: supplier } = await supabase.from("suppliers").select("id, slug, name, adapter, adapter_config, website").eq("id", data.supplierId).maybeSingle();
    if (!supplier) throw new Error("Fornecedor não encontrado.");
    const { getAdapter } = await import("@/lib/suppliers/adapters.server");
    const adapter = getAdapter(supplier);
    if (!adapter?.healthCheck) throw new Error("Este fornecedor não possui teste de conexão.");
    const result = await adapter.healthCheck();
    await supabase.from("suppliers").update({ last_health_check_at: new Date().toISOString(), last_health_check: result as never, ...(result.ok ? { circuit_open_until: null, consecutive_sync_failures: 0 } : {}) }).eq("id", data.supplierId);
    return result;
  });

/** Libera o bloqueio quando uma sincronização foi interrompida. */
export const resetSupplierSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { supplierId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
    if (!isStaff) throw new Error("Sem permissão.");
    await supabase
      .from("suppliers")
      .update({ sync_locked_at: null, sync_cursor: null, sync_status: "idle" })
      .eq("id", data.supplierId);
    return { ok: true };
  });

/** Reprocessa as fotos: de um perfume específico ou de todos que estão sem foto. */
export const reprocessProductImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId?: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
    if (!isStaff) throw new Error("Sem permissão.");

    const { reprocessImages } = await import("@/lib/suppliers/engine.server");
    return reprocessImages(data.productId);
  });
