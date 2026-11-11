/**
 * RELACIONAMENTO COM O CLIENTE — carrinho salvo e aviso de volta ao estoque.
 *
 * Tudo roda no servidor: o visitante nunca escreve direto nessas tabelas.
 * Quando existe login, a identidade vem do token da sessão (nunca do corpo
 * da requisição), então ninguém pode gravar no carrinho de outra pessoa.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

export type CartSnapshotItem = {
  productId: string;
  variant: "FULL" | "DECANT";
  decantMl: number | null;
  quantity: number;
  unitPrice: number | null;
  name: string | null;
  brand: string | null;
  image: string | null;
};

/** Identidade confiável: só o token da sessão pode dizer quem é o cliente. */
async function viewerId(): Promise<string | null> {
  const header = getRequestHeader("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  try {
    const { publicServerClient } = await import("@/lib/supabase-public.server");
    const { data } = await publicServerClient().auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

const variantKeyOf = (i: CartSnapshotItem) =>
  i.variant === "DECANT" ? `${i.productId}:D${i.decantMl}` : `${i.productId}:FULL`;

/** Monta os argumentos do CRM sem chaves vazias (o tipo gerado não aceita null). */
function crmArgs(v: {
  userId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  deviceId?: string | null;
}): {
  p_user_id?: string;
  p_name?: string;
  p_phone?: string;
  p_email?: string;
  p_device_id?: string;
} {
  const out: {
    p_user_id?: string;
    p_name?: string;
    p_phone?: string;
    p_email?: string;
    p_device_id?: string;
  } = {};
  if (v.userId) out.p_user_id = v.userId;
  if (v.name) out.p_name = v.name;
  if (v.phone) out.p_phone = v.phone;
  if (v.email) out.p_email = v.email;
  // o aparelho mantém a MESMA ficha do visitante quando o telefone/conta aparece
  if (v.deviceId) out.p_device_id = v.deviceId;
  return out;
}

const clean = (v: string | null | undefined, max = 120) => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** Guarda o carrinho do cliente (logado ou visitante) para atendimento e recuperação. */
export const saveCart = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      anonymousId?: string | null;
      name?: string | null;
      phone?: string | null;
      items: CartSnapshotItem[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const userId = await viewerId();
    const anon = clean(data.anonymousId, 64);
    if (!userId && !anon) return { ok: false as const };

    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const items = (data.items ?? [])
      .filter((i) => i && i.productId && Number(i.quantity) > 0)
      .slice(0, 80)
      .map((i) => ({
        ...i,
        variant: i.variant === "DECANT" ? ("DECANT" as const) : ("FULL" as const),
        decantMl: i.variant === "DECANT" ? Number(i.decantMl) || null : null,
        quantity: Math.min(999, Math.floor(Number(i.quantity))),
      }));

    const OPEN = ["ACTIVE", "ABANDONED"];
    const findCart = async (column: "user_id" | "anonymous_id", value: string) =>
      (
        await db
          .from("shopping_carts")
          .select("id, status, abandoned_at")
          .eq(column, value)
          .in("status", OPEN)
          .maybeSingle()
      ).data;

    let cart = userId ? await findCart("user_id", userId) : null;

    if (userId && anon) {
      const anonCart = await findCart("anonymous_id", anon);
      if (anonCart && !cart) {
        await db.from("shopping_carts").update({ user_id: userId }).eq("id", anonCart.id);
        cart = anonCart;
      } else if (anonCart && cart && anonCart.id !== cart.id) {
        // o carrinho do visitante já foi unido ao da conta no aparelho
        await db.from("shopping_carts").delete().eq("id", anonCart.id);
      }
    }
    if (!cart && !userId && anon) cart = await findCart("anonymous_id", anon);

    const itemsCount = items.reduce((s, i) => s + i.quantity, 0);
    const estimated = Number(
      items.reduce((s, i) => s + (Number(i.unitPrice) || 0) * i.quantity, 0).toFixed(2),
    );
    const now = new Date().toISOString();
    const wasAbandoned = cart?.status === "ABANDONED";

    const base = {
      user_id: userId,
      anonymous_id: anon,
      status: "ACTIVE",
      items_count: itemsCount,
      estimated_total: estimated,
      customer_name: clean(data.name),
      customer_phone: clean(data.phone, 20),
      last_activity_at: now,
      updated_at: now,
      ...(wasAbandoned && itemsCount > 0 ? { recovered_at: now } : {}),
    };

    let cartId = cart?.id ?? null;
    if (cartId) {
      await db.from("shopping_carts").update(base as never).eq("id", cartId);
    } else {
      const { data: created } = await db
        .from("shopping_carts")
        .insert(base as never)
        .select("id")
        .maybeSingle();
      cartId = created?.id ?? null;
    }
    if (!cartId) return { ok: false as const };

    const keys = items.map(variantKeyOf);
    if (keys.length) {
      await db
        .from("cart_items")
        .delete()
        .eq("cart_id", cartId)
        .not("variant_key", "in", `(${keys.map((k) => `"${k}"`).join(",")})`);
      await db.from("cart_items").upsert(
        items.map((i) => ({
          cart_id: cartId,
          product_id: i.productId,
          variant_key: variantKeyOf(i),
          variant: i.variant,
          decant_ml: i.decantMl,
          quantity: i.quantity,
          unit_price: i.unitPrice,
          product_name: clean(i.name),
          brand: clean(i.brand),
          image_url: i.image ?? null,
        })) as never,
        { onConflict: "cart_id,variant_key" },
      );
    } else {
      await db.from("cart_items").delete().eq("cart_id", cartId);
    }

    // ficha do cliente no CRM (identidade por conta ou telefone)
    if (userId || base.customer_phone) {
      await db.rpc(
        "crm_upsert_customer",
        crmArgs({ userId, name: base.customer_name, phone: base.customer_phone, deviceId: anon }),
      );
    }

    return { ok: true as const, cartId, status: base.status, recovered: wasAbandoned && itemsCount > 0 };
  });

/** Avise-me quando voltar: um pedido de aviso por pessoa e perfume. */
export const subscribeBackInStock = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { productId: string; email?: string | null; phone?: string | null; anonymousId?: string | null }) => data,
  )
  .handler(async ({ data }) => {
    const userId = await viewerId();
    const email = clean(data.email, 160)?.toLowerCase() ?? null;
    const phoneDigits = (data.phone ?? "").replace(/\D/g, "");
    const phone = phoneDigits.length >= 10 ? phoneDigits.slice(0, 13) : null;

    if (!userId && !email && !phone) throw new Error("Informe um WhatsApp para avisarmos você.");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido.");

    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: product } = await db
      .from("products")
      .select("id, in_stock, canonical_name")
      .eq("id", data.productId)
      .eq("active", true)
      .maybeSingle();
    if (!product) throw new Error("Perfume não encontrado.");
    if (product.in_stock) return { ok: true as const, already: false, inStock: true, waiting: 0 };

    let query = db
      .from("back_in_stock_subscriptions")
      .select("id")
      .eq("product_id", data.productId)
      .eq("active", true);
    query = userId
      ? query.eq("user_id", userId)
      : email
        ? query.is("user_id", null).eq("email", email)
        : query.is("user_id", null).eq("phone_normalized", phone!.slice(-11));
    const { data: existing } = await query.maybeSingle();

    if (!existing) {
      await db.from("back_in_stock_subscriptions").insert({
        product_id: data.productId,
        user_id: userId,
        anonymous_id: clean(data.anonymousId, 64),
        email: userId ? email : email,
        phone: phone,
        channel: userId ? "ACCOUNT" : email ? "EMAIL" : "WHATSAPP",
      } as never);
      if (userId || phone) {
        await db.rpc(
          "crm_upsert_customer",
          crmArgs({ userId, phone, email, deviceId: clean(data.anonymousId, 64) }),
        );
      }
    }

    const { data: waiting } = await db.rpc("waiting_count", { p_product_id: data.productId });
    return { ok: true as const, already: !!existing, inStock: false, waiting: Number(waiting ?? 0) };
  });

/** Cancela o aviso — sempre disponível para quem pediu. */
export const cancelBackInStock = createServerFn({ method: "POST" })
  .inputValidator((data: { productId: string; anonymousId?: string | null }) => data)
  .handler(async ({ data }) => {
    const userId = await viewerId();
    const anon = clean(data.anonymousId, 64);
    if (!userId && !anon) return { ok: false as const };
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    let q = db
      .from("back_in_stock_subscriptions")
      .update({ active: false, canceled_at: new Date().toISOString() })
      .eq("product_id", data.productId)
      .eq("active", true);
    q = userId ? q.eq("user_id", userId) : q.is("user_id", null).eq("anonymous_id", anon!);
    await q;
    return { ok: true as const };
  });

/** Quantas pessoas estão esperando este perfume (número, sem dados pessoais). */
export const waitingCount = createServerFn({ method: "GET" })
  .inputValidator((data: { productId: string }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: count } = await supabaseAdmin.rpc("waiting_count", { p_product_id: data.productId });

    return { waiting: Number(count ?? 0) };
  });
