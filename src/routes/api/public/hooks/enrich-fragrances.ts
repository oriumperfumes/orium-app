import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Enriquecimento Fragrantica (motor V3) em lotes — usado pelo agendamento e
 * pelas execuções longas do Admin. Protegido: exige o segredo de automação do servidor. Devolve apenas o resumo do lote.
 */
export const Route = createFileRoute("/api/public/hooks/enrich-fragrances")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        let body: { mode?: string; limit?: number; force?: boolean } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* corpo vazio: usa padrões */
        }

        const allowed = ["not-found", "partial", "descriptions", "missing-url", "all"] as const;
        const mode = (allowed as readonly string[]).includes(body.mode ?? "")
          ? (body.mode as (typeof allowed)[number])
          : "all";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runEnrichmentV3 } = await import("@/lib/catalog/enrichment-v3.server");
        const r = await runEnrichmentV3(supabaseAdmin as never, {
          mode,
          limit: Math.min(120, Math.max(1, Number(body.limit) || 40)),
          force: body.force === true,
        });

        return new Response(JSON.stringify({ ok: true, ...r, items: r.items.slice(0, 20) }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
