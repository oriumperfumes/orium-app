import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Gestão de marcas do Admin.
 *
 * Toda escrita passa por uma rotina no banco (`admin_brand_*`), que valida
 * owner/admin e altera produtos + marca + apelidos numa única transação. Assim
 * um erro no meio do caminho nunca deixa produto apontando para marca apagada.
 */

type Ctx = {
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    from: (t: string) => any;
  };
  userId: string;
};

const rpc = async (context: unknown, fn: string, args?: Record<string, unknown>) => {
  const ctx = context as unknown as Ctx;
  const { data, error } = await ctx.supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

export type BrandRow = {
  id: string;
  canonical_name: string;
  segment: string;
  allow_perfumes: boolean;
  total: number;
  perfumes: number;
  others: number;
  publicos: number;
  other_types: string[];
  aliases: string[];
};

export type BrandDuplicate = {
  a_id: string;
  a_name: string;
  a_products: number;
  b_id: string;
  b_name: string;
  b_products: number;
  reason: string;
};

/** Lista de marcas com contagens reais (produtos, perfumes, outros tipos, públicos). */
export const listBrands = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q?: string; filter?: string; category?: string }) => data)
  .handler(async ({ data, context }) => {
    const rows = (await rpc(context, "admin_brand_list", {
      p_q: data.q?.trim() || null,
      p_filter: data.filter ?? "all",
      p_category: data.category ?? "all",
    })) as BrandRow[] | null;
    return { brands: rows ?? [] };
  });

/** Corrige o nome da marca — todos os produtos vinculados recebem o nome novo. */
export const renameBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { brandId: string; name: string }) => data)
  .handler(async ({ data, context }) => {
    const out = (await rpc(context, "admin_brand_rename", {
      p_brand_id: data.brandId,
      p_name: data.name,
    })) as { name: string; products: number };
    return out;
  });

/** Move todos os produtos de uma marca para outra (a de origem fica vazia). */
export const moveBrandProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fromId: string; toId: string }) => data)
  .handler(async ({ data, context }) => {
    const out = (await rpc(context, "admin_brand_move_products", {
      p_from: data.fromId,
      p_to: data.toId,
    })) as { moved: number; to: string };
    return out;
  });

/** Une duas marcas: produtos e apelidos vão para a marca correta e a antiga sai. */
export const mergeBrands = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fromId: string; toId: string }) => data)
  .handler(async ({ data, context }) => {
    const out = (await rpc(context, "admin_brand_merge", {
      p_from: data.fromId,
      p_to: data.toId,
    })) as { moved: number; from: string; to: string };
    return out;
  });

/** Exclui marca vazia. Com produtos vinculados a exclusão é bloqueada no banco. */
export const deleteBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { brandId: string }) => data)
  .handler(async ({ data, context }) => {
    return (await rpc(context, "admin_brand_delete", { p_brand_id: data.brandId })) as { name: string };
  });

/** Exclui de uma vez todas as marcas sem nenhum produto vinculado. */
export const deleteEmptyBrands = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = ((await rpc(context, "admin_brand_list", {
      p_q: null,
      p_filter: "empty",
      p_category: "all",
    })) ?? []) as BrandRow[];
    const empty = rows.filter((b) => Number(b.total) === 0);
    let deleted = 0;
    const failed: string[] = [];
    for (const b of empty) {
      try {
        await rpc(context, "admin_brand_delete", { p_brand_id: b.id });
        deleted += 1;
      } catch {
        failed.push(b.canonical_name);
      }
    }
    return { deleted, failed };
  });


/** Cria a marca (reaproveitando a existente quando o nome já é conhecido). */
export const createBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { data: staff } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
    if (!staff) throw new Error("Sem permissão.");
    const name = (data.name ?? "").trim();
    if (name.length < 2) throw new Error("Informe o nome da marca.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { brandKey } = await import("@/lib/suppliers/normalize.server");
    const key = brandKey(name);
    const { data: all } = await supabaseAdmin.from("brands").select("id, canonical_name");
    const clash = (all ?? []).find((b) => brandKey(b.canonical_name) === key);
    if (clash) return { id: clash.id, name: clash.canonical_name, existed: true };

    const { ensureBrand } = await import("@/lib/catalog/identity.server");
    const brand = await ensureBrand(supabaseAdmin, name, "painel");
    if (!brand?.id) throw new Error("Não foi possível criar a marca.");
    return { id: brand.id, name: brand.name, existed: false };
  });

/** Pares de marcas muito parecidas — sugestão, nunca união automática. */
export const listBrandDuplicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = (await rpc(context, "admin_brand_duplicates", { p_limit: 30 })) as BrandDuplicate[] | null;
    return { pairs: rows ?? [] };
  });

/** Marca um par como "não são a mesma marca" para sair das sugestões. */
export const ignoreBrandDuplicate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { aId: string; bId: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { data: staff } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
    if (!staff) throw new Error("Sem permissão.");
    const [a, b] = [data.aId, data.bId].sort();
    const { error } = await ctx.supabase
      .from("brand_duplicate_ignores")
      .upsert({ pair_key: `${a}:${b}`, brand_a: a, brand_b: b, actor: ctx.userId }, { onConflict: "pair_key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Últimas mesclagens, para conferência. */
export const listBrandMerges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { data, error } = await ctx.supabase
      .from("brand_merges")
      .select("id, from_brand_name, to_brand_name, products_moved, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return {
      merges: (data ?? []) as Array<{
        id: string;
        from_brand_name: string;
        to_brand_name: string;
        products_moved: number;
        created_at: string;
      }>,
    };
  });
