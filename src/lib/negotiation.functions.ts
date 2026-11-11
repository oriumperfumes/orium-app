import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Administração da área de Negociação: cadastro manual, foto real, importação
 * do Fragrantica e situação do item. Nada aqui toca catálogo, estoque,
 * reposição, precificação ou decants.
 */

type Ctx = {
  supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => Promise<{ data: unknown }> };
  userId: string;
};

const staffOnly = async (context: Ctx) => {
  const { data } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!data) throw new Error("Sem permissão.");
};

export type NegotiationInterestRow = {
  id: string;
  negotiation_item_id: string | null;
  item_name: string;
  /** Nome atual da ficha no CRM (cai para o nome informado quando não há ficha). */
  customer_name: string | null;
  customer_id: string | null;
  customer_phone: string | null;
  customer_archived: boolean;
  created_at: string;
};

/**
 * Quem demonstrou interesse: perfume, data/hora e a ficha real do CRM.
 *
 * O nome vem sempre de `crm_customers`, então corrigir o cliente em Clientes
 * corrige aqui também — uma única fonte de verdade.
 */
export const listNegotiationInterests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("negotiation_interests")
      .select("id, negotiation_item_id, item_name, customer_name, customer_id, created_at")
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) throw new Error(error.message);
    const rows = data ?? [];

    const ids = [...new Set(rows.map((r) => r.customer_id).filter((v): v is string => !!v))];
    const fichas = new Map<string, { name: string | null; phone: string | null; archived: boolean }>();
    if (ids.length) {
      const { data: customers } = await supabaseAdmin
        .from("crm_customers")
        .select("id, name, phone, archived_at")
        .in("id", ids);
      for (const c of customers ?? []) {
        fichas.set(c.id, { name: c.name, phone: c.phone, archived: !!c.archived_at });
      }
    }

    const interests: NegotiationInterestRow[] = rows.map((r) => {
      const ficha = r.customer_id ? fichas.get(r.customer_id) : undefined;
      return {
        id: r.id,
        negotiation_item_id: r.negotiation_item_id,
        item_name: r.item_name,
        customer_name: ficha?.name ?? r.customer_name ?? null,
        // ficha excluída no CRM deixa de ser clicável
        customer_id: ficha ? r.customer_id : null,
        customer_phone: ficha?.phone ?? null,
        customer_archived: ficha?.archived ?? false,
        created_at: r.created_at,
      };
    });
    return { interests };
  });

export type NegotiationInput = {
  id?: string | null;
  name: string;
  brand?: string | null;
  volumeMl?: number | null;
  description?: string | null;
  conditionNote?: string | null;
  status?: "AVAILABLE" | "NEGOTIATING" | "SOLD" | "HIDDEN";
  showWhenNegotiating?: boolean;
  imageUrl?: string | null;
  fragranticaUrl?: string | null;
  olfactoryFamily?: string | null;
  accords?: Array<{ name: string; intensity?: number | null }>;
  notes?: Array<{ level: "TOP" | "HEART" | "BASE" | "FLAT"; label: string }>;
  priority?: number;
};

/**
 * Ficha olfativa interna do item: um registro em `products` marcado como
 * `NEGOCIACAO`, invisível no catálogo, sem estoque, sem preço e sem decant.
 * Existe só para que Negociação use exatamente o mesmo sistema de informações
 * olfativas dos perfumes do catálogo (mesmas tabelas, editor e importador).
 */
async function ensureFragranceSubject(
  db: {
    from: (t: string) => any;
  },
  itemId: string,
  item: { name: string; brand: string | null; volume_ml: number | null; image_url: string | null },
): Promise<string | null> {
  const { data: current } = await db
    .from("negotiation_items")
    .select("product_id")
    .eq("id", itemId)
    .maybeSingle();

  const remoteImage = item.image_url && /^https?:\/\//i.test(item.image_url) ? item.image_url : null;
  const shared = {
    canonical_name: item.name,
    raw_name: item.name,
    brand: item.brand,
    volume_ml: item.volume_ml,
    image_url: remoteImage,
    product_type: "NEGOCIACAO",
    active: false,
    catalog_eligible: false,
    catalog_eligibility_reason: "Item da área Negociação (fora do catálogo)",
    decant_available: false,
    in_stock: false,
    stock_quantity: 0,
    canonical_identity_locked: true,
  };

  const existing = (current as { product_id: string | null } | null)?.product_id ?? null;
  if (existing) {
    await db.from("products").update(shared).eq("id", existing);
    return existing;
  }

  const { data: created, error } = await db
    .from("products")
    .insert({ ...shared, slug: `negociacao-${itemId}` })
    .select("id")
    .single();
  if (error) return null;
  const productId = (created as { id: string }).id;
  await db.from("negotiation_items").update({ product_id: productId }).eq("id", itemId);
  return productId;
}

/** Lista completa para o Admin (inclui Vendido e Oculto). */
export const listNegotiationAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data, error } = await db
      .from("negotiation_items")
      .select("*")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

/** Cria ou atualiza um item negociável. */
export const saveNegotiationItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: NegotiationInput) => {
    if (!data.name?.trim()) throw new Error("Informe o nome do perfume.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await staffOnly(ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const row = {
      name: data.name.trim(),
      brand: data.brand?.trim() || null,
      volume_ml: data.volumeMl && data.volumeMl > 0 ? Math.round(data.volumeMl) : null,
      description: data.description?.trim() || null,
      condition_note: data.conditionNote?.trim() || "Praticamente cheio",
      status: data.status ?? "AVAILABLE",
      show_when_negotiating: data.showWhenNegotiating ?? true,
      image_url: data.imageUrl || null,
      fragrantica_url: data.fragranticaUrl?.trim() || null,
      olfactory_family: data.olfactoryFamily?.trim() || null,
      accords: data.accords ?? [],
      notes: data.notes ?? [],
      priority: Number.isFinite(data.priority) ? Number(data.priority) : 0,
    };

    if (data.id) {
      const { data: updated, error } = await db
        .from("negotiation_items")
        .update(row)
        .eq("id", data.id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      const id = updated?.id ?? data.id;
      const productId = await ensureFragranceSubject(db as never, id, row);
      return { id, productId };
    }

    const { data: created, error } = await db
      .from("negotiation_items")
      .insert({ ...row, created_by: ctx.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const productId = await ensureFragranceSubject(db as never, created.id, row);
    return { id: created.id, productId };
  });

/** Remove somente este item de Negociação (e a ficha olfativa interna dele). */
export const deleteNegotiationItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: row } = await db
      .from("negotiation_items")
      .select("image_url, product_id")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await db.from("negotiation_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    const productId = (row as { product_id?: string | null } | null)?.product_id ?? null;
    if (productId) {
      await db.from("fragrance_accords").delete().eq("product_id", productId);
      await db.from("fragrance_notes").delete().eq("product_id", productId);
      await db.from("fragrance_details").delete().eq("product_id", productId);
      await db.from("products").delete().eq("id", productId).eq("product_type", "NEGOCIACAO");
    }

    const path = row?.image_url;
    if (path && !/^https?:\/\//i.test(path)) {
      await db.storage.from("negociacao").remove([path]);
    }
    return { ok: true };
  });

/** Foto real do item, enviada do celular (câmera ou galeria). */
export const uploadNegotiationPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { base64: string; contentType: string; cardBase64?: string }) => {
    if (!data.base64) throw new Error("Escolha uma foto.");
    if (!/^image\/(jpeg|png|webp)$/.test(data.contentType)) throw new Error("Use uma foto JPG, PNG ou WEBP.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const bytes = Buffer.from(data.base64, "base64");
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("Foto muito grande (máximo 8MB).");
    const ext = data.contentType === "image/png" ? "png" : data.contentType === "image/webp" ? "webp" : "jpg";
    const id = crypto.randomUUID();
    const path = `${id}.${ext}`;

    const { error } = await db.storage
      .from("negociacao")
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (error) throw new Error(error.message);

    // Versão leve do card/carrossel, quando o Admin já otimizou no navegador.
    // Nome derivado do principal: quem serve a foto sabe voltar ao original.
    if (data.cardBase64 && ext === "webp") {
      const card = Buffer.from(data.cardBase64, "base64");
      if (card.byteLength > 4 * 1024 * 1024) throw new Error("Miniatura muito grande.");
      await db.storage
        .from("negociacao")
        .upload(`${id}-card.webp`, card, { contentType: "image/webp", upsert: true });
    }
    return { path };
  });


/** Remove a foto do armazenamento (usado ao trocar/limpar a imagem). */
export const removeNegotiationPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { path: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    if (/^https?:\/\//i.test(data.path)) return { ok: true };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await db.storage.from("negociacao").remove([data.path, data.path.replace(/\.webp$/i, "-card.webp")]);
    return { ok: true };

  });

/**
 * Troca só a foto de um item (usado pela otimização das fotos antigas).
 * A foto nova entra como WebP; a antiga sai do armazenamento.
 */
export const setNegotiationPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; path: string }) => {
    if (!data.id || !data.path) throw new Error("Item ou foto inválidos.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: row, error: readError } = await db
      .from("negotiation_items")
      .select("image_url")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const { error } = await db.from("negotiation_items").update({ image_url: data.path }).eq("id", data.id);
    if (error) throw new Error(error.message);

    const old = row?.image_url;
    if (old && old !== data.path && !/^https?:\/\//i.test(old)) {
      await db.storage.from("negociacao").remove([old, old.replace(/\.webp$/i, "-card.webp")]);
    }
    return { path: data.path };
  });
