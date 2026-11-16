import { createFileRoute } from "@tanstack/react-router";

/**
 * Foto de um item de Negociação. As fotos ficam num armazenamento privado e
 * são servidas por aqui: nada além de imagens desse espaço é acessível.
 *
 * O nome pedido pode ser a versão leve do card (`<id>-card.webp`); se ela não
 * existir — fotos antigas, ainda sem variante — devolvemos a principal.
 */
export const Route = createFileRoute("/api/public/negociacao-foto")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).searchParams.get("path") ?? "";
        // Só nomes simples do próprio espaço: sem subir diretórios.
        if (!/^[a-zA-Z0-9._-]+$/.test(path)) return new Response("Not found", { status: 404 });

        // foto já servida antes sai do cache da borda, sem ir ao armazenamento
        const edge = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null;
        const cacheKey = new Request(new URL(`/api/public/negociacao-foto?path=${encodeURIComponent(path)}`, request.url).toString());
        const hit = edge ? await edge.match(cacheKey).catch(() => undefined) : undefined;
        if (hit) return hit;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const bucket = supabaseAdmin.storage.from("negociacao");

        let { data, error } = await bucket.download(path);
        let variant = /-card\.webp$/i.test(path) ? "card" : "full";
        if ((error || !data) && /-card\.webp$/i.test(path)) {
          variant = "full";
          ({ data, error } = await bucket.download(path.replace(/-card\.webp$/i, ".webp")));
        }
        if (error || !data) return new Response("Not found", { status: 404 });

        const res = new Response(await data.arrayBuffer(), {
          headers: {
            "content-type": data.type || "image/jpeg",
            // Diz qual versão foi entregue: o Admin usa isso para saber
            // quais fotos ainda não têm a variante leve do card.
            "x-orium-variant": variant,
            // Cada foto tem nome único: trocar a foto gera outra URL.
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
        // só a versão exata pedida (a reserva "full" no lugar do card pode mudar depois)
        if (edge && variant === (/-card\.webp$/i.test(path) ? "card" : "full")) await edge.put(cacheKey, res.clone()).catch(() => undefined);
        return res;
      },
    },
  },
});
