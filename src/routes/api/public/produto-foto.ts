import { createFileRoute } from "@tanstack/react-router";

/** Cache da borda (Cloudflare). Fora dela (dev/preview), simplesmente não usa. */
function edgeCache(): Cache | null {
  try {
    const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
    return c?.default ?? null;
  } catch {
    return null;
  }
}

/**
 * Foto de um produto cadastrado manualmente. As fotos ficam num armazenamento
 * privado e são servidas por aqui: nada além de imagens desse espaço é acessível.
 *
 * O nome pedido pode ser a versão leve do card (`<id>-card.webp`); se ela não
 * existir, devolvemos a principal.
 *
 * Velocidade: a foto encontrada fica no cache da borda (Cloudflare), então só a
 * primeira visita de cada foto vai ao armazenamento; as seguintes saem direto
 * do servidor mais perto do cliente.
 */
export const Route = createFileRoute("/api/public/produto-foto")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).searchParams.get("path") ?? "";
        if (!/^[a-zA-Z0-9._-]+$/.test(path)) return new Response("Not found", { status: 404 });

        // Foto já servida antes? Sai do cache da borda (perto do cliente), sem ir ao armazenamento.
        const edge = edgeCache();
        const cacheKey = new Request(new URL(`/api/public/produto-foto?path=${encodeURIComponent(path)}`, request.url).toString());
        const hit = edge ? await edge.match(cacheKey).catch(() => undefined) : undefined;
        if (hit) return hit;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const bucket = supabaseAdmin.storage.from("produtos");

        let { data, error } = await bucket.download(path);
        // só guarda na borda a versão exata pedida (a reserva pode virar outra depois)
        const exact = !error && !!data;
        // thumb → card → principal: foto antiga sem todas as versões continua abrindo
        if ((error || !data) && /-thumb\.webp$/i.test(path)) {
          ({ data, error } = await bucket.download(path.replace(/-thumb\.webp$/i, "-card.webp")));
          if (error || !data) ({ data, error } = await bucket.download(path.replace(/-thumb\.webp$/i, ".webp")));
        }
        if ((error || !data) && /-card\.webp$/i.test(path)) {
          ({ data, error } = await bucket.download(path.replace(/-card\.webp$/i, ".webp")));
        }
        if (error || !data) return new Response("Not found", { status: 404 });

        const res = new Response(await data.arrayBuffer(), {
          headers: {
            "content-type": data.type || "image/webp",
            // Cada foto tem nome único: trocar a foto gera outra URL.
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
        // a foto já está na memória: guardar na borda é instantâneo
        if (edge && exact) await edge.put(cacheKey, res.clone()).catch(() => undefined);
        return res;
      },
    },
  },
});
