import { createFileRoute } from "@tanstack/react-router";

/**
 * A ponte do WhatsApp pede aqui um link de envio para guardar uma mídia
 * (foto, áudio, vídeo, figurinha, documento) no armazenamento privado "wa-media".
 * Protegido pelo token da ponte (conferido pelo banco). Não recebe o arquivo:
 * devolve um link assinado e a ponte envia direto para o armazenamento.
 */
export const Route = createFileRoute("/api/public/hooks/wa-media-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { token?: string; path?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Bad request", { status: 400 });
        }
        const token = String(body.token ?? "");
        const path = String(body.path ?? "");
        if (!/^[a-z0-9_-]+\/[A-Za-z0-9._-]{4,120}\.[a-z0-9]{2,5}$/.test(path))
          return new Response("Bad path", { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: ok } = await (supabaseAdmin as any).rpc("wa_bridge_ok", { p_token: token });
        if (!ok) return new Response("Unauthorized", { status: 401 });
        const { data, error } = await supabaseAdmin.storage
          .from("wa-media")
          .createSignedUploadUrl(path, { upsert: true });
        if (error || !data) return new Response(error?.message ?? "Falhou", { status: 500 });
        return new Response(JSON.stringify({ path: data.path, token: data.token }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
