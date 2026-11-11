/**
 * FAVORITOS DE VISITANTE (sem conta).
 *
 * O favorito continua sendo do PERFUME inteiro — nunca de Decant ou Frasco.
 * Aqui só guardamos, ligado ao aparelho, para a equipe conseguir ver o que a
 * pessoa salvou mesmo antes de ela criar conta. Se falhar, nada muda na tela.
 */
import { createServerFn } from "@tanstack/react-start";

export const syncAnonymousFavorite = createServerFn({ method: "POST" })
  .inputValidator((data: { productId: string; anonymousId: string; favorite: boolean }) => data)
  .handler(async ({ data }) => {
    try {
      const anon = (data.anonymousId ?? "").trim().slice(0, 64);
      if (!anon || !data.productId) return { ok: false as const };
      const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

      if (!data.favorite) {
        await db
          .from("favorites")
          .delete()
          .is("user_id", null)
          .eq("anonymous_id", anon)
          .eq("product_id", data.productId);
        return { ok: true as const };
      }

      const { data: product } = await db
        .from("products")
        .select("id")
        .eq("id", data.productId)
        .maybeSingle();
      if (!product) return { ok: false as const };

      const { data: existing } = await db
        .from("favorites")
        .select("id")
        .eq("anonymous_id", anon)
        .eq("product_id", data.productId)
        .maybeSingle();
      if (!existing) {
        await db
          .from("favorites")
          .insert({ product_id: data.productId, anonymous_id: anon } as never);
      }
      return { ok: true as const };
    } catch {
      return { ok: false as const };
    }
  });
