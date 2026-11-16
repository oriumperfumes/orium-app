import { createFileRoute } from "@tanstack/react-router";

/**
 * Resumo dos pedidos para os widgets (iPhone/Scriptable, Windows, Android).
 * Sem login: exige a chave do widget (?key=ow_… ou "Authorization: Bearer ow_…"),
 * gerada e desligada em Admin → Widgets. Nunca fica em cache.
 */
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

export const Route = createFileRoute("/api/public/widget")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const auth = request.headers.get("authorization") ?? "";
        const token = url.searchParams.get("key") ?? (auth.startsWith("Bearer ") ? auth.slice(7) : null);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { buildWidgetSummary, checkWidgetKey } = await import("@/lib/widget.server");
        if (!(await checkWidgetKey(supabaseAdmin, token))) {
          return new Response(JSON.stringify({ error: "chave inválida ou desligada" }), { status: 401, headers });
        }
        const summary = await buildWidgetSummary(supabaseAdmin);
        if (url.searchParams.get("agenda") === "1") {
          // iPhone/Android gravam esses eventos no calendário do aparelho
          const { buildAgenda } = await import("@/lib/widget.server");
          summary.agenda = await buildAgenda(supabaseAdmin, `${url.origin}/admin/pedidos`);
        }
        if (url.searchParams.get("format") === "text") {
          // Rainmeter (desktop do Windows): 20 campos fixos separados por "|"
          const { widgetText } = await import("@/lib/widget.server");
          return new Response(widgetText(summary), { headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
        }
        return new Response(JSON.stringify(summary), { headers });
      },
      OPTIONS: async () => new Response(null, { status: 204, headers: { ...headers, "access-control-allow-headers": "authorization" } }),
    },
  },
});
