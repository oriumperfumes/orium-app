import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Pipeline de fotos de produto: toda foto de fornecedor/importação é baixada,
 * otimizada (3 versões WebP) e servida pela Orium. A origem fica só como
 * referência em `product_image_cache.source_url`.
 */

type Ctx = { supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> }; userId: string };
const staffOnly = async (context: unknown) => {
  const ctx = context as Ctx;
  const { data } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (!data) throw new Error("Sem permissão.");
};

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$)/i;

/** Baixa a foto de origem no servidor (evita bloqueio de CORS no navegador). */
export const fetchSourceImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string }) => {
    const u = new URL(d.url);
    if (u.protocol !== "https:" || PRIVATE_HOST.test(u.hostname)) throw new Error("Endereço de foto inválido.");
    return { url: u.toString() };
  })
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const res = await fetch(data.url, { redirect: "follow" });
    if (!res.ok) throw new Error(`Foto indisponível (${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    if (!/^image\//.test(type)) throw new Error("O endereço não é uma imagem.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 15 * 1024 * 1024) throw new Error("Foto muito grande (máx. 15MB).");
    return { base64: buf.toString("base64"), contentType: type, bytes: buf.byteLength };
  });

/** Grava as 3 versões e passa a usar a foto otimizada em todo produto com essa origem. */
export const registerOptimizedImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      sourceUrl: string;
      main: string;
      card: string;
      thumb: string;
      width: number;
      height: number;
      originalBytes: number;
      ms: number;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const id = crypto.randomUUID();
    const files: Array<[string, string, number]> = [
      [`${id}.webp`, data.main, 6],
      [`${id}-card.webp`, data.card, 3],
      [`${id}-thumb.webp`, data.thumb, 1],
    ];
    const sizes: number[] = [];
    for (const [path, b64, maxMb] of files) {
      const bytes = Buffer.from(b64, "base64");
      if (bytes.byteLength > maxMb * 1024 * 1024) throw new Error("Versão otimizada grande demais.");
      sizes.push(bytes.byteLength);
      const { error } = await db.storage.from("produtos").upload(path, bytes, { contentType: "image/webp", upsert: true });
      if (error) throw new Error(error.message);
    }
    const url = `/api/public/produto-foto?path=${id}.webp`;
    await db.from("product_image_cache" as never).upsert({
      source_url: data.sourceUrl,
      optimized_url: url,
      status: "ok",
      original_bytes: data.originalBytes,
      optimized_bytes: sizes[0],
      card_bytes: sizes[1],
      thumb_bytes: sizes[2],
      width: data.width,
      height: data.height,
      processing_ms: data.ms,
      error: null,
      updated_at: new Date().toISOString(),
    } as never);
    // reescreve image_url: o gatilho troca a origem pela versão otimizada
    const { data: touched } = await db
      .from("products")
      .select("id, image_url")
      .eq("image_url", data.sourceUrl);
    for (const row of (touched ?? []) as Array<{ id: string; image_url: string }>) {
      await db.from("products").update({ image_url: row.image_url } as never).eq("id", row.id);
    }
    return { url, products: touched?.length ?? 0, bytes: sizes };
  });

export const registerImageError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sourceUrl: string; error: string }) => d)
  .handler(async ({ data, context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    await db.from("product_image_cache" as never).upsert({
      source_url: data.sourceUrl,
      status: "error",
      error: data.error.slice(0, 300),
      updated_at: new Date().toISOString(),
    } as never);
    return { ok: true };
  });

/** OPTIMIZE_EXISTING_PRODUCT_IMAGES: fotos públicas ainda servidas direto do fornecedor. */
export const listImagesToOptimize = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await staffOnly(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await db
      .from("products")
      .select("image_url")
      .eq("active", true)
      .not("image_url", "is", null)
      .not("image_url", "like", "/api/public/produto-foto%")
      .limit(2000);
    const urls = [...new Set(((rows ?? []) as Array<{ image_url: string }>).map((r) => r.image_url))];
    const { data: failed } = await db
      .from("product_image_cache" as never)
      .select("source_url, error")
      .eq("status", "error");
    const errors = new Map(((failed ?? []) as Array<{ source_url: string; error: string }>).map((f) => [f.source_url, f.error]));
    return { pending: urls.map((url) => ({ url, error: errors.get(url) ?? null })) };
  });
