/**
 * Leituras e escritas de `products` que envolvem colunas INTERNAS (custo manual, preços-base, estoque local,
 * chaves de identidade, disponibilidade etc.).
 *
 * O papel de banco `authenticated` é o mesmo para clientes logados e para a equipe e só lê as colunas públicas de
 * products (mesmo conjunto de `anon`) e não escreve na tabela. Estas funções confirmam a equipe no banco
 * (is_staff, como as demais *.functions.ts) e só então usam o cliente de serviço.
 * Nunca devolva estas linhas a quem não é equipe.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INTERNAL_REASON } from "@/lib/consult-offers.functions";

type StaffCtx = {
  supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => PromiseLike<{ data: unknown }> };
  userId: string;
};

async function requireStaff(context: StaffCtx) {
  const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!isStaff) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Tela de manutenção de produtos do Admin (admin.produtos). */
const MAINTENANCE_COLUMNS =
  "id, canonical_name, raw_name, brand, brand_id, source, sale_mode, gender_norm, product_type, concentration, volume_ml, flanker, image_url, in_stock, stock_quantity, local_stock, availability_override, availability_source, manual_pricing, retail_price, wholesale_price, active, catalog_eligible, identity_status, identity_verified, canonical_identity_locked, brand_review_required, suspicious_price, search_aliases, created_at";

export const adminMaintenanceProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await requireStaff(context);
    const { data, error } = await db
      .from("products")
      .select(MAINTENANCE_COLUMNS)
      .order("canonical_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Compositor de pedidos do Admin: catálogo visível + estoque local de cada frasco. */
const COMPOSER_COLUMNS =
  "id, canonical_name, brand, volume_ml, image_url, retail_price, wholesale_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, local_stock, gender_norm, catalog_eligibility_reason";

export const adminComposerProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await requireStaff(context);
    const { data, error } = await db
      .from("products")
      .select(COMPOSER_COLUMNS)
      .eq("active", true)
      .or(`catalog_eligible.eq.true,catalog_eligibility_reason.eq.${INTERNAL_REASON}`)
      .order("canonical_name")
      .limit(3000);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Decants de um produto (antes gravados direto do navegador; products não aceita mais escrita de `authenticated`). */
const price = z.number().positive().max(100000).nullable();
export const adminSetProductDecants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        decant_available: z.boolean(),
        decant_price_2ml: price,
        decant_price_5ml: price,
        decant_price_10ml: price,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context);
    const { productId, ...values } = data;
    const { error } = await db.from("products").update(values).eq("id", productId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
