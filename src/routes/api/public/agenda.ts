import { createFileRoute } from "@tanstack/react-router";

/**
 * Agenda da Orium (.ics) para assinar no Calendário do iPhone, Google Agenda
 * e Outlook. Mesma chave dos widgets (?key=ow_…). Nunca fica em cache.
 */
export const Route = createFileRoute("/api/public/agenda")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("key");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { buildCalendar, checkWidgetKey } = await import("@/lib/widget.server");
        if (!(await checkWidgetKey(supabaseAdmin, token))) return new Response("chave inválida ou desligada", { status: 401 });
        const ics = await buildCalendar(supabaseAdmin, `${url.origin}/admin/pedidos`);
        return new Response(ics, {
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            "content-disposition": 'inline; filename="orium-pedidos.ics"',
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
