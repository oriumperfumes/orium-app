import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Foto principal do produto. Prioridade:
 * 1. upload do Admin  2. foto de fornecedor escolhida pelo Admin  3. automática.
 * A escolha manual é imposta por gatilho no banco, então nenhuma sincronização
 * consegue trocá-la.
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

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function offerImages(db: Db, productId: string) {
  const { data } = await db
    .from("supplier_products")
    .select("id, supplier_id, image_url, image_urls, in_stock, last_synced_at")
    .eq("product_id", productId);
  return (data ?? []) as Array<{
    id: string;
    supplier_id: string;
    image_url: string | null;
    image_urls: unknown;
    in_stock: boolean | null;
    last_synced_at: string | null;
  }>;
}

/** Melhor imagem automática: oferta em estoque e sincronizada mais recente. */
async function autoImage(db: Db, productId: string, exclude?: string | null) {
  const offers = (await offerImages(db, productId))
    .filter((o) => o.image_url && o.image_url !== exclude)
    .sort(
      (a, b) =>
        Number(Boolean(b.in_stock)) - Number(Boolean(a.in_stock)) ||
        String(b.last_synced_at ?? "").localeCompare(String(a.last_synced_at ?? "")),
    );
  const urls = offers.map((o) => o.image_url as string);
  return { best: urls[0] ?? null, gallery: [...new Set(urls)] };
}

async function reachable(url: string) {
  if (url.startsWith("/api/public/produto-foto")) return true; // foto própria da Orium
  try {
    const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-1024" }, signal: AbortSignal.timeout(8000) });
    const type = res.headers.get("content-type") ?? "";
    return res.ok && (type.startsWith("image/") || type === "" || type.includes("octet-stream"));
  } catch {
    return false;
  }
}

export const productImageOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const [{ data: p }, offers, { data: suppliers }] = await Promise.all([
      db
        .from("products")
        .select("image_url, image_mode, image_manual_url, image_source_supplier_id, image_manual_broken, image_manual_set_at")
        .eq("id", data.productId)
        .maybeSingle(),
      offerImages(db, data.productId),
      db.from("suppliers").select("id, name"),
    ]);
    const name = (id: string) => suppliers?.find((s) => s.id === id)?.name ?? "Fornecedor";
    const options: Array<{ key: string; url: string; supplierId: string; offerId: string; supplier: string }> = [];
    const seen = new Set<string>();
    for (const o of offers) {
      const urls = [o.image_url, ...(Array.isArray(o.image_urls) ? (o.image_urls as string[]) : [])].filter(
        (u): u is string => typeof u === "string" && u.startsWith("http"),
      );
      for (const url of urls.slice(0, 3)) {
        if (seen.has(url)) continue;
        seen.add(url);
        options.push({ key: `${o.id}:${url}`, url, supplierId: o.supplier_id, offerId: o.id, supplier: name(o.supplier_id) });
      }
    }
    return {
      current: {
        url: p?.image_url ?? null,
        mode: (p?.image_mode ?? "auto") as "auto" | "supplier" | "upload",
        manualUrl: p?.image_manual_url ?? null,
        supplier: p?.image_source_supplier_id ? name(p.image_source_supplier_id) : null,
        broken: Boolean(p?.image_manual_broken),
        setAt: p?.image_manual_set_at ?? null,
      },
      options,
    };
  });

export const setProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { productId: string; mode: "auto" | "supplier" | "upload"; url?: string | null; offerId?: string | null }) =>
      data,
  )
  .handler(async ({ data, context }) => {
    const ctx = await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: before } = await db
      .from("products")
      .select("image_url, image_mode, image_manual_url, image_source_supplier_id")
      .eq("id", data.productId)
      .maybeSingle();
    if (!before) throw new Error("Produto não encontrado.");

    let patch: Record<string, unknown>;
    if (data.mode === "auto") {
      const { best, gallery } = await autoImage(db, data.productId);
      patch = {
        image_mode: "auto",
        image_manual_url: null,
        image_source_supplier_id: null,
        image_source_offer_id: null,
        image_manual_broken: false,
        image_manual_set_at: null,
        image_manual_set_by: null,
        image_url: best ?? before.image_url,
        image_urls: gallery.length ? gallery : before.image_url ? [before.image_url] : [],
      };
    } else {
      const url = (data.url ?? "").trim();
      if (!url.startsWith("https://") && !url.startsWith("/api/public/produto-foto?path=")) throw new Error("Imagem inválida.");
      let supplierId: string | null = null;
      let offerId: string | null = null;
      if (data.mode === "supplier") {
        const offer = (await offerImages(db, data.productId)).find(
          (o) =>
            o.id === data.offerId &&
            (o.image_url === url || (Array.isArray(o.image_urls) && (o.image_urls as string[]).includes(url))),
        );
        if (!offer) throw new Error("Essa foto não pertence a um fornecedor deste perfume.");
        supplierId = offer.supplier_id;
        offerId = offer.id;
      }
      patch = {
        image_mode: data.mode,
        image_manual_url: url,
        image_source_supplier_id: supplierId,
        image_source_offer_id: offerId,
        image_manual_broken: false,
        image_manual_set_at: new Date().toISOString(),
        image_manual_set_by: ctx.userId,
      };
    }
    const { error } = await db.from("products").update(patch as never).eq("id", data.productId);
    if (error) throw new Error(error.message);

    await db.from("product_identity_history").insert({
      product_id: data.productId,
      before: before as never,
      after: { image_mode: data.mode, image_url: data.mode === "auto" ? patch["image_url"] : data.url } as never,
      action: data.mode === "auto" ? "imagem automática" : "imagem manual",
      changed_by: ctx.userId,
      changed_by_email: ctx.claims?.email ?? null,
    });
    return { ok: true };
  });

/**
 * Confere se a foto escolhida manualmente ainda abre. Se quebrou, marca
 * "Imagem selecionada indisponível" e usa a automática só como apoio temporário —
 * a escolha continua registrada até o Admin decidir outra.
 */
export const checkProductImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productId: string }) => data)
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: p } = await db
      .from("products")
      .select("image_mode, image_manual_url, image_manual_broken")
      .eq("id", data.productId)
      .maybeSingle();
    if (!p || p.image_mode === "auto" || !p.image_manual_url) return { broken: false };
    const ok = await reachable(p.image_manual_url);
    if (ok && p.image_manual_broken) {
      await db.from("products").update({ image_manual_broken: false } as never).eq("id", data.productId);
    } else if (!ok && !p.image_manual_broken) {
      const { best, gallery } = await autoImage(db, data.productId, p.image_manual_url);
      await db
        .from("products")
        .update({ image_manual_broken: true, image_url: best, image_urls: gallery } as never)
        .eq("id", data.productId);
    }
    return { broken: !ok };
  });
