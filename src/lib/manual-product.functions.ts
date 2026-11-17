import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Cadastro manual de perfumes da Orium.
 *
 * O produto entra no catálogo normal, mas marcado como `source = 'manual'`:
 * a sincronização dos fornecedores nunca sobrescreve preço, estoque, foto nem
 * desativa esse produto. Tudo aqui é exclusivo de owner/admin.
 */

type Ctx = {
  supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => Promise<{ data: unknown }> };
  userId: string;
  claims?: { email?: string } | null;
};

const staffOnly = async (context: unknown) => {
  const ctx = context as Ctx;
  const { data } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (!data) throw new Error("Sem permissão.");
  return ctx;
};

export type SaleModeInput = "DECANT" | "FULL" | "BOTH";
export type VisibilityInput = "ATIVO" | "OCULTO" | "INDISPONIVEL";

export type ManualProductInput = {
  id?: string | null;
  name: string;
  brandId?: string | null;
  newBrandName?: string | null;
  volumeMl?: number | null;
  concentration?: string | null;
  gender?: string | null;
  description?: string | null;
  saleMode: SaleModeInput;
  visibility: VisibilityInput;
  stockQuantity?: number | null;
  manualPricing?: boolean;
  cost?: number | null;
  retailPrice?: number | null;
  wholesalePrice?: number | null;
  imageUrl?: string | null;
  fragranticaUrl?: string | null;
  /** Fixa o produto no topo do catálogo. */
  pinned?: boolean;
  /** Mostra o selo "Novidade" — só vale se estiver fixado. */
  pinnedNew?: boolean;
  /** Preço próprio de cada decant; null = usa o preço global da Orium. */
  decantPrice2ml?: number | null;
  decantPrice5ml?: number | null;
  decantPrice10ml?: number | null;
  /** Preço sob consulta: o site mostra "Consultar no WhatsApp" em vez do preço (ex.: perfumes da Rasha). */
  priceOnRequest?: boolean;
};

const slugify = (txt: string) =>
  txt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function uniqueSlug(db: Db, base: string, ignoreId?: string | null) {
  const root = base || "perfume";
  for (let i = 0; i < 40; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const { data } = await db.from("products").select("id").eq("slug", candidate).maybeSingle();
    if (!data || (ignoreId && data.id === ignoreId)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

/** Preço automático da Orium: custo + margem configurada, com arredondamento comercial. */
async function autoPrices(db: Db, cost: number | null) {
  if (cost == null || !(cost > 0)) return { retail: null as number | null, wholesale: null as number | null };
  const { data: s } = await db
    .from("pricing_settings")
    .select("retail_markup, wholesale_markup, psych_pricing_active, psych_max_reduction")
    .maybeSingle();
  const retailBase = cost + Number(s?.retail_markup ?? 0);
  const wholesaleBase = cost + Number(s?.wholesale_markup ?? 0);
  const commercial = async (base: number) => {
    const { data } = await db.rpc("commercial_price", {
      p_base: base,
      p_active: s?.psych_pricing_active ?? false,
      p_max: s?.psych_max_reduction ?? 0,
    });
    const value = Number(data);
    return Number.isFinite(value) && value > 0 ? value : Math.round(base * 100) / 100;
  };
  return { retail: await commercial(retailBase), wholesale: await commercial(wholesaleBase) };
}

async function saveManual(data: ManualProductInput, ctx: Ctx) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { ensureBrand } = await import("@/lib/catalog/identity.server");

  const name = (data.name ?? "").trim();
  if (name.length < 2) throw new Error("Informe o nome do perfume.");

  let brandId = data.brandId ?? null;
  let brandName: string | null = null;
  if (data.newBrandName?.trim()) {
    const created = await ensureBrand(db as never, data.newBrandName.trim(), "cadastro-manual");
    brandId = created?.id ?? null;
    brandName = created?.name ?? data.newBrandName.trim();
  } else if (brandId) {
    const { data: b } = await db.from("brands").select("canonical_name").eq("id", brandId).maybeSingle();
    brandName = b?.canonical_name ?? null;
  }
  if (!brandName) throw new Error("Escolha ou crie a marca.");

  const price = (value: number | null | undefined) =>
    value != null && Number(value) > 0 ? Number(value) : null;

  const cost = data.cost != null && Number(data.cost) > 0 ? Number(data.cost) : null;
  const onRequest = data.priceOnRequest === true;
  // sob consulta: só frasco, sem preço nem decant (o cliente pergunta no WhatsApp)
  if (onRequest) data = { ...data, saleMode: "FULL", manualPricing: true };
  const sellsBottle = data.saleMode !== "DECANT";
  const manualPricing = data.manualPricing !== false;

  let retail: number | null = null;
  let wholesale: number | null = null;
  if (sellsBottle) {
    if (manualPricing) {
      retail = data.retailPrice != null && Number(data.retailPrice) > 0 ? Number(data.retailPrice) : null;
      wholesale =
        data.wholesalePrice != null && Number(data.wholesalePrice) > 0 ? Number(data.wholesalePrice) : retail;
      if (retail == null && !onRequest) throw new Error("Informe o preço de venda do frasco.");
    } else {
      const auto = await autoPrices(db, cost);
      if (auto.retail == null) throw new Error("Informe o custo para usar a precificação automática.");
      retail = auto.retail;
      wholesale = auto.wholesale;
    }
  }

  const stock = sellsBottle
    ? data.stockQuantity != null && Number(data.stockQuantity) > 0
      ? Math.round(Number(data.stockQuantity))
      : 0
    : null;

  const row = {
    canonical_name: name,
    raw_name: name,
    brand: brandName,
    brand_id: brandId,
    gender: data.gender ?? null,
    gender_norm: data.gender ?? "UNKNOWN",
    gender_confidence: data.gender ? 1 : 0,
    concentration: data.concentration?.trim() || null,
    volume_ml: data.volumeMl != null && Number(data.volumeMl) > 0 ? Math.round(Number(data.volumeMl)) : null,
    product_type: "PERFUME",
    catalog_eligible: true,
    catalog_eligibility_reason: "cadastro-manual",
    source: "manual",
    sale_mode: data.saleMode,
    visibility_status: data.visibility,
    manual_pricing: manualPricing,
    manual_cost: cost,
    stock_quantity: stock,
    image_url: data.imageUrl || null,
    image_urls: data.imageUrl ? [data.imageUrl] : [],
    retail_price: retail,
    wholesale_price: wholesale,
    base_retail_price: retail,
    base_wholesale_price: wholesale,
    identity_source: "cadastro-manual",
    identity_status: "confirmado",
    identity_confidence: 1,
    identity_verified: true,
    canonical_identity_locked: true,
    // Decant com preço próprio (perfume mais caro); null volta ao preço global.
    decant_price_2ml: price(data.decantPrice2ml),
    decant_price_5ml: price(data.decantPrice5ml),
    decant_price_10ml: price(data.decantPrice10ml),
    pinned_at: data.pinned ? new Date().toISOString() : null,
    pinned_new: data.pinned ? data.pinnedNew === true : false,
    price_on_request: onRequest,
    ...(onRequest ? { decant_available: false, retail_price: null, wholesale_price: null, base_retail_price: null, base_wholesale_price: null } : {}),
    updated_at: new Date().toISOString(),
  };

  let productId = data.id ?? null;
  let before: Record<string, unknown> | null = null;

  if (productId) {
    const { data: current } = await db.from("products").select("*").eq("id", productId).maybeSingle();
    if (!current) throw new Error("Produto não encontrado.");
    if ((current as { source?: string }).source !== "manual")
      throw new Error("Este produto vem de fornecedor e não pode ser editado por aqui.");
    before = current as Record<string, unknown>;
    const slug = await uniqueSlug(db, slugify(`${brandName} ${name}`), productId);
    // já fixado antes: mantém a data original para não pular na frente de novo
    const keptPin = (current as { pinned_at?: string | null }).pinned_at ?? null;
    const pinnedAt = data.pinned ? (keptPin ?? row.pinned_at) : null;
    const { error } = await db
      .from("products")
      .update({ ...row, pinned_at: pinnedAt, slug })
      .eq("id", productId);
    if (error) throw new Error(error.message);
  } else {
    const slug = await uniqueSlug(db, slugify(`${brandName} ${name}`));
    const { data: created, error } = await db
      .from("products")
      .insert({ ...row, slug })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    productId = created.id;
  }

  // Descrição e link do Fragrantica ficam na ficha olfativa, como nos demais.
  const description = data.description?.trim() || null;
  const fragranticaUrl = data.fragranticaUrl?.trim() || null;
  if (description || fragranticaUrl) {
    await db.from("fragrance_details").upsert(
      {
        product_id: productId,
        ...(description ? { description, description_source: "orium-manual" } : {}),
        ...(fragranticaUrl ? { fragrantica_url: fragranticaUrl } : {}),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "product_id" },
    );
  }

  await db.from("product_identity_history").insert({
    product_id: productId,
    before: (before ?? {}) as never,
    after: row as never,
    action: data.id ? "produto-manual-editado" : "produto-manual-criado",
    changed_by: ctx.userId,
    changed_by_email: ctx.claims?.email ?? null,
  });

  return { id: productId as string };
}

/** Mesmo cadastro da tela, para o Copilot (permissão já validada por ele). */
export const saveManualCore = (data: ManualProductInput, ctx: { userId: string; claims?: { email?: string } | null }) =>
  saveManual(data, ctx as Ctx);

/** Preço automático (custo + margem da loja, preço comercial) — prévia do Copilot. */
export async function autoPricesFor(cost: number | null) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  return autoPrices(db, cost);
}

/** Cria ou atualiza um perfume cadastrado à mão. */
export const saveManualProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ManualProductInput) => data)
  .handler(async ({ data, context }) => {
    const ctx = await staffOnly(context);
    return saveManual(data, ctx);
  });

/** Exclui o produto manual. Pedidos antigos permanecem intactos. */
export const deleteManualProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const ctx = await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: row } = await db
      .from("products")
      .select("id, source, image_url, canonical_name")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Produto não encontrado.");
    if ((row as { source?: string }).source !== "manual")
      throw new Error("Só produtos cadastrados manualmente podem ser excluídos por aqui.");

    // Vínculos do cliente e ficha olfativa saem; pedidos e itens de pedido não.
    await db.from("favorites").delete().eq("product_id", data.id);
    await db.from("cart_items").delete().eq("product_id", data.id);
    await db.from("product_views").delete().eq("product_id", data.id);
    await db.from("back_in_stock_subscriptions").delete().eq("product_id", data.id);
    await db.from("fragrance_accords").delete().eq("product_id", data.id);
    await db.from("fragrance_notes").delete().eq("product_id", data.id);
    await db.from("fragrance_details").delete().eq("product_id", data.id);
    await db.from("product_costs").delete().eq("product_id", data.id);
    await db.from("pricing_overrides").delete().eq("product_id", data.id);

    await db.from("product_identity_history").insert({
      product_id: data.id,
      before: row as never,
      after: {} as never,
      action: "produto-manual-excluido",
      changed_by: ctx.userId,
      changed_by_email: ctx.claims?.email ?? null,
    });

    const { error } = await db.from("products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    const path = (row as { image_url?: string | null }).image_url ?? null;
    const file = path?.startsWith("/api/public/produto-foto") ? new URL(path, "http://x").searchParams.get("path") : null;
    if (file) await db.storage.from("produtos").remove([file, file.replace(/\.webp$/i, "-card.webp")]);

    return { ok: true };
  });

/** Foto do produto enviada do celular (câmera ou galeria), já otimizada em WebP. */
export const uploadProductPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { base64: string; contentType: string; cardBase64?: string; thumbBase64?: string }) => {
    if (!data.base64) throw new Error("Escolha uma foto.");
    if (!/^image\/(jpeg|png|webp)$/.test(data.contentType)) throw new Error("Use uma foto JPG, PNG ou WEBP.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const bytes = Buffer.from(data.base64, "base64");
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("Foto muito grande (máximo 8MB).");
    const ext = data.contentType === "image/png" ? "png" : data.contentType === "image/webp" ? "webp" : "jpg";
    const id = crypto.randomUUID();
    const path = `${id}.${ext}`;

    const { error } = await db.storage
      .from("produtos")
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (error) throw new Error(error.message);

    if (data.cardBase64 && ext === "webp") {
      const card = Buffer.from(data.cardBase64, "base64");
      if (card.byteLength > 4 * 1024 * 1024) throw new Error("Miniatura muito grande.");
      await db.storage.from("produtos").upload(`${id}-card.webp`, card, {
        contentType: "image/webp",
        upsert: true,
      });
    }
    if (data.thumbBase64 && ext === "webp") {
      const thumb = Buffer.from(data.thumbBase64, "base64");
      if (thumb.byteLength > 2 * 1024 * 1024) throw new Error("Miniatura muito grande.");
      await db.storage.from("produtos").upload(`${id}-thumb.webp`, thumb, { contentType: "image/webp", upsert: true });
    }
    return { url: `/api/public/produto-foto?path=${path}` };
  });

/** Marcas disponíveis para o cadastro manual (nome + id, sem dados internos). */
export const listBrandOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data } = await db.from("brands").select("id, canonical_name").order("canonical_name").limit(1500);
    return { brands: (data ?? []) as Array<{ id: string; canonical_name: string }> };
  });

/** Produto manual para edição (inclui descrição e link do Fragrantica). */
export const getManualProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: product } = await db.from("products").select("*").eq("id", data.id).maybeSingle();
    const { data: details } = await db
      .from("fragrance_details")
      .select("description, fragrantica_url")
      .eq("product_id", data.id)
      .maybeSingle();
    return { product, details };
  });
