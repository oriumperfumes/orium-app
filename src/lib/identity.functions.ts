import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Gender } from "@/lib/catalog/classify";

type Ctx = { supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => Promise<{ data: unknown }> }; userId: string };

const staffOnly = async (context: Ctx) => {
  const { data } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!data) throw new Error("Sem permissão.");
};

/** Reprocessa marca e nome oficial de todos os perfumes, em blocos. */
export const reidentifyCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { cursor?: number; useKnowledge?: boolean }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { runIdentityBackfill } = await import("@/lib/catalog/identity-run.server");
    return runIdentityBackfill(data.cursor ?? 0, data.useKnowledge ?? true);
  });

/** Aplica a sugestão de marca/nome revisada pela equipe. */
export const applyIdentitySuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { suggestionId: string; lock?: boolean }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { applyIdentity } = await import("@/lib/catalog/identity-run.server");
    const { data: s } = await db
      .from("product_identity_suggestions")
      .select("*")
      .eq("id", data.suggestionId)
      .maybeSingle();
    if (!s) throw new Error("Sugestão não encontrada.");
    if (!s.suggested_name) throw new Error("Sugestão sem nome.");
    await applyIdentity(db, s.product_id, {
      brandName: s.suggested_brand,
      brandId: s.suggested_brand_id,
      name: s.suggested_name,
      flanker: s.suggested_flanker,
      concentration: s.suggested_concentration,
      volumeMl: s.suggested_volume_ml,
      gender: (s.suggested_gender as Gender | null) ?? null,
      genderConfidence: 0.95,
      aliases: ((s.details as { aliases?: string[] } | null)?.aliases ?? []).concat(s.supplier_title ?? []),
      source: `${s.source}+revisao`,
      confidence: Number(s.confidence),
      lock: data.lock ?? true,
    });
    await db
      .from("product_identity_suggestions")
      .update({ status: "applied", reviewed_by: context.userId, reviewed_at: new Date().toISOString() })
      .eq("id", data.suggestionId);
    return { ok: true };
  });

/** Mantém o que já está no ar e para de sugerir para este perfume. */
export const keepCurrentIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { suggestionId: string; lock?: boolean }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: s } = await db
      .from("product_identity_suggestions")
      .select("product_id")
      .eq("id", data.suggestionId)
      .maybeSingle();
    if (s?.product_id) {
      await db
        .from("products")
        .update({ identity_status: "confirmada", ...(data.lock ? { canonical_identity_locked: true } : {}) })
        .eq("id", s.product_id);
    }
    await db
      .from("product_identity_suggestions")
      .update({ status: "rejected", reviewed_by: context.userId, reviewed_at: new Date().toISOString() })
      .eq("id", data.suggestionId);
    return { ok: true };
  });

/** Correção manual do dono: marca, nome, versão, concentração, volume, gênero e trava. */
export const saveProductIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      productId: string;
      brand?: string | null;
      name: string;
      flanker?: string | null;
      concentration?: string | null;
      volumeMl?: number | null;
      gender?: Gender | null;
      lock?: boolean;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { applyIdentity } = await import("@/lib/catalog/identity-run.server");
    await applyIdentity(db, data.productId, {
      brandName: data.brand ?? null,
      name: data.name,
      flanker: data.flanker ?? null,
      concentration: data.concentration ?? null,
      volumeMl: data.volumeMl ?? null,
      gender: data.gender ?? null,
      genderConfidence: 1,
      source: "correcao-manual",
      confidence: 1,
      lock: data.lock ?? true,
    });
    if (data.lock === false) {
      await db.from("products").update({ canonical_identity_locked: false }).eq("id", data.productId);
    }
    return { ok: true };
  });

/** Passada de normalização de nomes/linhas/apelidos sobre o catálogo atual, em blocos. */
export const normalizeCatalogNames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { cursor?: number }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { runNameNormalization } = await import("@/lib/catalog/identity-normalize.server");
    return runNameNormalization(data.cursor ?? 0);
  });

/** Auditoria geral: recoloca na fila tudo que está sem marca e devolve os números. */
export const auditCatalogIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context as unknown as Ctx);
    const { identityMetrics, requeueBrandless } = await import("@/lib/catalog/identity-normalize.server");
    const antes = await identityMetrics();
    const requeued = await requeueBrandless();
    return { antes, requeued };
  });

/** Números da identidade do catálogo para o painel. */
export const getIdentityMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context as unknown as Ctx);
    const { identityMetrics } = await import("@/lib/catalog/identity-normalize.server");
    return identityMetrics();
  });
