import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Fornecedores de consulta (Rasha…): fotos e ligação ao nosso catálogo, sem custo.
 * Agendado: {"step":"brand"} lê UMA marca nova na Fragrantica; {"step":"match"}
 * liga as ofertas e preenche as fotos. Separados para caber no tempo do servidor.
 */
export const Route = createFileRoute("/api/public/hooks/consult-enrich")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        let body: { step?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* corpo vazio */
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const mod = await import("@/lib/suppliers/consult-enrich.server");
        const result = body.step === "brand" ? await mod.learnOneConsultBrand(supabaseAdmin) : await mod.enrichConsultOffers(supabaseAdmin);
        return new Response(JSON.stringify({ ok: true, step: body.step ?? "match", ...result }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
