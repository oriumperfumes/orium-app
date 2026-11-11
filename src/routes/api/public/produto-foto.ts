import { createFileRoute } from "@tanstack/react-router";

/**
 * Foto de um produto cadastrado manualmente. As fotos ficam num armazenamento
 * privado e são servidas por aqui: nada além de imagens desse espaço é acessível.
 *
 * O nome pedido pode ser a versão leve do card (`<id>-card.webp`); se ela não
 * existir, devolvemos a principal.
 */
export const Route = createFileRoute("/api/public/produto-foto")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).searchParams.get("path") ?? "";
        if (!/^[a-zA-Z0-9._-]+$/.test(path)) return new Response("Not found", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const bucket = supabaseAdmin.storage.from("produtos");

        let { data, error } = await bucket.download(path);
        // thumb → card → principal: foto antiga sem todas as versões continua abrindo
        if ((error || !data) && /-thumb\.webp$/i.test(path)) {
          ({ data, error } = await bucket.download(path.replace(/-thumb\.webp$/i, "-card.webp")));
          if (error || !data) ({ data, error } = await bucket.download(path.replace(/-thumb\.webp$/i, ".webp")));
        }
        if ((error || !data) && /-card\.webp$/i.test(path)) {
          ({ data, error } = await bucket.download(path.replace(/-card\.webp$/i, ".webp")));
        }
        if (error || !data) return new Response("Not found", { status: 404 });

        return new Response(await data.arrayBuffer(), {
          headers: {
            "content-type": data.type || "image/webp",
            // Cada foto tem nome único: trocar a foto gera outra URL.
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
