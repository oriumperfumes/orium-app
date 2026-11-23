import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Análise das conversas do WhatsApp em lotes (agendamento a cada 5 min).
 * Protegido pelo segredo de automação do servidor. Devolve só o resumo do lote.
 */
export const Route = createFileRoute("/api/public/hooks/wa-insights")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // aceita o segredo do servidor ou o do cofre do banco (usado pelo pg_cron)
        const denied = await authenticateCronRequest(request);
        if (denied) {
          const token =
            /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: ok } = token
            ? await (supabaseAdmin as any).rpc("orium_cron_ok", { p_token: token })
            : { data: false };
          if (!ok) return new Response("Unauthorized", { status: 401 });
        }
        let body: { limit?: number } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* corpo vazio: usa padrões */
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runInsightsBatch } = await import("@/lib/wa-insights.server");
        const r = await runInsightsBatch(
          supabaseAdmin as never,
          Math.min(15, Math.max(1, Number(body.limit) || 8)),
        );
        return new Response(JSON.stringify({ ok: true, ...r }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
