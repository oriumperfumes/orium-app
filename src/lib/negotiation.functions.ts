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
  /** ml que ainda restam no frasco */
  remainingMl?: number | null;
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
export async function ensureFragranceSubject(
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
    if (data.remainingMl != null && data.volumeMl && data.remainingMl > data.volumeMl)
      throw new Error("O que resta não pode passar do tamanho do frasco.");
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
      remaining_ml: data.remainingMl != null && data.remainingMl >= 0 ? Math.round(data.remainingMl) : null,
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

export type NegotiationCatalogHit = {
  id: string;
  name: string;
  brand: string | null;
  volumeMl: number | null;
  concentration: string | null;
  imageUrl: string | null;
  /** já tem acordes/notas/descrição para copiar */
  hasFragrance: boolean;
};

/**
 * Busca no catálogo para "Adicionar à Negociação a partir do catálogo".
 * Só leitura: devolve nome, marca, volume, foto e se já existe ficha olfativa
 * (que é copiada depois com `copyFragranceFrom`). Nada do catálogo muda.
 */
export const searchCatalogForNegotiation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q: string }) => ({ q: String(data?.q ?? "").slice(0, 80) }))
  .handler(async ({ data, context }) => {
    await staffOnly(context as unknown as Ctx);
    // o termo entra num filtro `or(...)`: tira o que muda a sintaxe do filtro
    const term = data.q.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
    const empty: NegotiationCatalogHit[] = [];
    if (term.length < 2) return { items: empty };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const words = term.split(" ").filter((w) => w.length >= 2);
    let query = db
      .from("products")
      .select("id, canonical_name, brand, volume_ml, concentration, image_url, product_type, active, catalog_eligible")
      .neq("product_type", "NEGOCIACAO");
    // cada palavra precisa aparecer no nome ou na marca ("club nuit" acha "Club de Nuit")
    for (const w of words.slice(0, 4)) query = query.or(`canonical_name.ilike.%${w}%,brand.ilike.%${w}%`);
    const { data: rows, error } = await query.limit(40);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Array<{
      id: string;
      canonical_name: string;
      brand: string | null;
      volume_ml: number | null;
      concentration: string | null;
      image_url: string | null;
      active: boolean | null;
      catalog_eligible: boolean | null;
    }>;
    const ids = list.map((r) => r.id);
    if (!ids.length) return { items: empty };

    const [{ data: details }, { data: accords }, { data: notes }] = await Promise.all([
      db.from("fragrance_details").select("product_id, description").in("product_id", ids),
      db.from("fragrance_accords").select("product_id").in("product_id", ids),
      db.from("fragrance_notes").select("product_id").in("product_id", ids),
    ]);
    const withInfo = new Set<string>([
      ...((accords ?? []) as Array<{ product_id: string }>).map((r) => r.product_id),
      ...((notes ?? []) as Array<{ product_id: string }>).map((r) => r.product_id),
      ...((details ?? []) as Array<{ product_id: string; description: string | null }>).filter((d) => d.description).map((d) => d.product_id),
    ]);

    const t = term.toLowerCase();
    const items: NegotiationCatalogHit[] = list
      .map((r) => ({
        id: r.id,
        name: r.canonical_name,
        brand: r.brand,
        volumeMl: r.volume_ml,
        concentration: r.concentration,
        imageUrl: r.image_url,
        hasFragrance: withInfo.has(r.id),
        score:
          (r.canonical_name.toLowerCase().startsWith(t) ? 4 : 0) +
          (r.active && r.catalog_eligible ? 2 : 0) +
          (r.image_url ? 1 : 0) +
          (withInfo.has(r.id) ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 18)
      .map(({ score: _score, ...rest }) => rest);

    return { items };
  });

export type NegotiationSaleInput = {
  itemId: string;
  /** quanto a peça foi vendida (valor recebido) */
  price: number;
  /** quanto a peça custou (opcional, para o lucro) */
  cost?: number | null;
  paymentMethod: string;
  customerId?: string | null;
  customerName?: string | null;
  soldAt?: string | null;
  idempotencyKey: string;
};

/**
 * Vende uma peça do mostruário da Negociação.
 *
 * A venda entra em Vendas da loja pelo mesmo `store_sale_commit` (faturamento,
 * lucro, histórico e cancelamento iguais aos outros), usando a ficha interna
 * do item como produto. Depois a peça sai da vitrine como Vendida.
 */
export const sellNegotiationItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: NegotiationSaleInput) => {
    if (!data.itemId) throw new Error("Escolha a peça vendida.");
    if (!(Number(data.price) > 0)) throw new Error("Informe por quanto a peça foi vendida.");
    if (!data.paymentMethod) throw new Error("Escolha a forma de pagamento.");
    if (data.cost != null && !(Number(data.cost) >= 0)) throw new Error("Custo inválido.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx & { supabase: any };
    await staffOnly(ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: item, error: itemErr } = await db
      .from("negotiation_items")
      .select("id, name, brand, volume_ml, image_url, product_id, status")
      .eq("id", data.itemId)
      .maybeSingle();
    if (itemErr) throw new Error(itemErr.message);
    if (!item) throw new Error("Peça não encontrada.");

    const productId =
      item.product_id ??
      (await ensureFragranceSubject(db as never, item.id, {
        name: item.name,
        brand: item.brand,
        volume_ml: item.volume_ml,
        image_url: item.image_url,
      }));
    if (!productId) throw new Error("Não foi possível preparar a peça para a venda.");

    // a foto real da peça vai junto no histórico da venda; o custo, para o lucro
    const photo = item.image_url
      ? /^https?:\/\//i.test(item.image_url)
        ? item.image_url
        : `/api/public/negociacao-foto?path=${encodeURIComponent(item.image_url)}`
      : null;
    const patch: Record<string, unknown> = {};
    if (photo) patch.image_url = photo;
    if (data.cost != null) patch.manual_cost = Number(data.cost);
    if (Object.keys(patch).length) await db.from("products").update(patch as never).eq("id", productId);

    const price = Math.round(Number(data.price) * 100) / 100;
    const { data: result, error } = await ctx.supabase.rpc("store_sale_commit", {
      p_payload: {
        idempotency_key: data.idempotencyKey,
        entry_method: "manual",
        payment_method: data.paymentMethod,
        customer_id: data.customerId ?? null,
        customer_name: data.customerName ?? null,
        sold_at: data.soldAt ?? null,
        transcript: "Mostruário da Negociação",
        discount: null,
        total: price,
        items: [{ product_id: productId, variant: "FULL", decant_ml: null, quantity: 1, unit_price: price }],
      },
    });
    if (error) throw new Error(error.message);

    await db.from("negotiation_items").update({ status: "SOLD" }).eq("id", item.id);
    return result as { id: string; duplicate: boolean };
  });

/* ------------------------------------------------------------------ *
 * Controle de pagamento da peça vendida (tabela `negotiation_sales`).
 * Não gera venda em "Vendas da loja" e não mexe em estoque/preço: é só o
 * caderno de quem comprou, por quanto e quanto falta receber.
 * ------------------------------------------------------------------ */

export type NegotiationSale = {
  item_id: string;
  customer_id: string | null;
  customer_name: string | null;
  sale_price: number;
  amount_paid: number;
  payment_method: "PIX" | "CARTAO" | "DINHEIRO" | null;
  payment_due_date: string | null;
  sold_at: string;
  note: string | null;
};

const SALE_COLUMNS =
  "item_id, customer_id, customer_name, sale_price, amount_paid, payment_method, payment_due_date, sold_at, note";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Vendas registradas, com o nome atual da ficha do CRM (uma fonte só). */
export const listNegotiationSales = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context as unknown as Ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data, error } = await db.from("negotiation_sales").select(SALE_COLUMNS);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as NegotiationSale[];

    const ids = [...new Set(rows.map((r) => r.customer_id).filter((v): v is string => !!v))];
    if (ids.length) {
      const { data: customers } = await db.from("crm_customers").select("id, name").in("id", ids);
      const names = new Map((customers ?? []).map((c) => [c.id, c.name]));
      for (const r of rows) if (r.customer_id && names.get(r.customer_id)) r.customer_name = names.get(r.customer_id) ?? r.customer_name;
    }
    return { sales: rows.map((r) => ({ ...r, sale_price: Number(r.sale_price), amount_paid: Number(r.amount_paid) })) };
  });

export type NegotiationSalePayInput = {
  itemId: string;
  customerId?: string | null;
  customerName?: string | null;
  /** valor combinado da venda, em reais */
  price: number;
  /** quanto já foi pago (total acumulado), em reais */
  paid: number;
  paymentMethod?: "PIX" | "CARTAO" | "DINHEIRO" | null;
  /** até quando o restante deve ser pago (AAAA-MM-DD) */
  dueDate?: string | null;
  note?: string | null;
  soldAt?: string | null;
};

/**
 * Marca a peça como Vendida e grava/atualiza o pagamento: para quem, por
 * quanto, quanto já entrou e até quando vence o restante. Pode ser chamada
 * de novo a cada recebimento (o `paid` é o total acumulado).
 */
export const saveNegotiationSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: NegotiationSalePayInput) => {
    if (!data.itemId) throw new Error("Escolha a peça vendida.");
    const price = Number(data.price);
    const paid = Number(data.paid);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Informe por quanto a peça foi vendida.");
    if (!Number.isFinite(paid) || paid < 0) throw new Error("Valor pago inválido.");
    if (r2(paid) > r2(price)) throw new Error("O valor pago não pode passar do valor da venda.");
    if (data.paymentMethod && !["PIX", "CARTAO", "DINHEIRO"].includes(data.paymentMethod)) throw new Error("Forma de pagamento inválida.");
    if (data.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate)) throw new Error("Data de vencimento inválida.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await staffOnly(ctx);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const { data: item, error: itemErr } = await db.from("negotiation_items").select("id").eq("id", data.itemId).maybeSingle();
    if (itemErr) throw new Error(itemErr.message);
    if (!item) throw new Error("Peça não encontrada.");

    // ficha do CRM manda no nome; sem ficha, vale o nome digitado
    let customerName = data.customerName?.trim() || null;
    if (data.customerId) {
      const { data: c } = await db.from("crm_customers").select("name").eq("id", data.customerId).maybeSingle();
      if (c?.name) customerName = c.name;
    }

    const price = r2(Number(data.price));
    const paid = r2(Number(data.paid));
    const row = {
      item_id: data.itemId,
      customer_id: data.customerId ?? null,
      customer_name: customerName,
      sale_price: price,
      amount_paid: paid,
      payment_method: data.paymentMethod ?? null,
      // pago por completo: não há mais vencimento
      payment_due_date: paid >= price ? null : (data.dueDate ?? null),
      note: data.note?.trim() || null,
      updated_at: new Date().toISOString(),
      ...(data.soldAt ? { sold_at: data.soldAt } : {}),
    };
    const { data: saved, error } = await db
      .from("negotiation_sales")
      .upsert({ ...row, created_by: ctx.userId }, { onConflict: "item_id" })
      .select(SALE_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    const { error: statusErr } = await db.from("negotiation_items").update({ status: "SOLD" }).eq("id", data.itemId);
    if (statusErr) throw new Error(statusErr.message);
    return { sale: saved as unknown as NegotiationSale };
  });
