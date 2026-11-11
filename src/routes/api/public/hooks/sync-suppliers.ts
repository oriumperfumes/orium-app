import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Sincronização automática dos fornecedores (chamada por agendamento).
 * Protegida: exige o segredo de automação do servidor (nunca vai ao navegador).
 * Nenhum dado é devolvido além do resumo da sincronização.
 */
export const Route = createFileRoute("/api/public/hooks/sync-suppliers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runSupplierSync } = await import("@/lib/suppliers/engine.server");

        // Filtros opcionais: ?supplier=<slug> sincroniza só um fornecedor; ?force=1 ignora o intervalo.
        const params = new URL(request.url).searchParams;
        const onlySlug = params.get("supplier");
        const force = params.get("force") === "1";

        let query = supabaseAdmin
          .from("suppliers")
          .select("id, name, slug, active, sync_interval_minutes, last_successful_sync_at, sync_cursor, sync_status, auto_sync, priority")
          .eq("active", true);
        if (onlySlug) query = query.eq("slug", onlySlug);
        const { data: suppliers } = await query;

        const results: Array<Record<string, unknown>> = [];
        for (const s of suppliers ?? []) {
          if (!force && (s.auto_sync === false || s.priority === "inactive")) {
            results.push({ supplier: s.name, skipped: true, reason: "sincronizacao-automatica-pausada" });
            continue;
          }
          const interval = force ? 0 : (s.sync_interval_minutes ?? 30) * 60_000;
          const last = s.last_successful_sync_at ? Date.parse(s.last_successful_sync_at) : 0;

          const resuming = (s.sync_status === "parcial" || s.sync_status === "sincronizando") && (s.sync_cursor ?? 0) > 0;
          if (!resuming && Date.now() - last < interval) {
            results.push({ supplier: s.name, skipped: true });
            continue;
          }
          try {
            let cursor: number | null = resuming ? (s.sync_cursor ?? 0) : 0;
            let created = 0;
            let updated = 0;
            let rounds = 0;
            while (cursor !== null && rounds < 80) {
              const r = await runSupplierSync(s.id, cursor);
              created += r.created;
              updated += r.updated;
              if (r.status === "erro" || r.status === "bloqueado" || r.status === "sem-integracao") break;
              cursor = r.nextCursor;
              rounds += 1;
            }
            results.push({ supplier: s.name, created, updated });
          } catch (e) {
            results.push({ supplier: s.name, error: e instanceof Error ? e.message : "falha" });
          }
        }

        return new Response(JSON.stringify({ ok: true, results }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
