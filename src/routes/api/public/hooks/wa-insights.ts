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
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
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
