import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Limpeza do catálogo em lote (duplicados e posicionamento de marcas).
 * Protegido: exige o segredo de automação do servidor (nunca vai ao navegador).
 */
export const Route = createFileRoute("/api/public/hooks/catalog-hygiene")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        let body: { mode?: "duplicates" | "brands" | "all"; maxMerges?: number } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* corpo vazio: usa padrões */
        }
        const mode = body.mode ?? "all";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runDuplicateAudit, runBrandSegmentation } =
          await import("@/lib/catalog/hygiene.server");

        const brands =
          mode === "duplicates" ? null : await runBrandSegmentation(supabaseAdmin as never);
        const duplicates =
          mode === "brands"
            ? null
            : await runDuplicateAudit(supabaseAdmin as never, {
                maxMerges: Math.min(300, Math.max(10, Number(body.maxMerges) || 150)),
              });

        return new Response(JSON.stringify({ ok: true, brands, duplicates }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
