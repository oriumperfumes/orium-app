import { createFileRoute } from "@tanstack/react-router";
import { cronDenied } from "@/lib/cron-guard.server";

/**
 * Diagnóstico da Resposta ideal (equipe técnica): gera a resposta para uma conversa
 * real sem precisar de login, protegido pelo segredo do servidor. Não envia nada.
 */
export const Route = createFileRoute("/api/public/hooks/crm-reply-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await cronDenied(request);
        if (denied) return denied;
        const body = (await request.json().catch(() => ({}))) as { jid?: string; goal?: string };
        if (!body.jid) return new Response("jid obrigatório", { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { suggestReplyCore } = await import("@/lib/crm-wa.functions");
        const r = await suggestReplyCore(
          {
            userDb: supabaseAdmin,
            adminDb: supabaseAdmin,
            userId: "diagnostico",
            roles: ["owner"],
            threadId: null,
          },
          { jid: body.jid, goal: body.goal ?? "auto", tone: null },
          null,
        );
        return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
