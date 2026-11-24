import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Sincronização automática dos fornecedores (chamada por agendamento).
 * Protegida: exige o segredo de automação do servidor (nunca vai ao navegador).
 * Nenhum dado é devolvido além do resumo da sincronização.
 *
 * Plano Free do Worker: 50 chamadas externas por requisição. Por isso cada chamada
 * executa UMA rodada de UM fornecedor, dentro de um orçamento de chamadas, e o
 * progresso fica gravado no fornecedor (cursor). O agendador chama de novo:
 *   - job de 3 h (`?since=<início do job>`): abre o ciclo dos fornecedores no intervalo;
 *   - job de continuação: retoma só o que ficou parcial.
 * Falha (erro do fornecedor, rodada que não avança, catálogo incompleto) devolve HTTP 500:
 * o agendador não pode registrar sucesso quando o processamento falhou.
 *
 * Filtros opcionais: ?supplier=<slug> (só esse fornecedor); ?force=1 (ignora pausa e intervalo);
 * ?since=<ISO> (ignora quem já foi tentado depois dessa data).
 */
export const Route = createFileRoute("/api/public/hooks/sync-suppliers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { withSubrequestBudget, FREE_PLAN_SUBREQUEST_BUDGET, usedSubrequests } = await import("@/lib/suppliers/subrequests.server");
        const json = (body: Record<string, unknown>, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

        return withSubrequestBudget(FREE_PLAN_SUBREQUEST_BUDGET, async () => {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runSupplierSync } = await import("@/lib/suppliers/engine.server");
          const { pickNext } = await import("@/lib/suppliers/sync-schedule");

          const params = new URL(request.url).searchParams;
          const onlySlug = params.get("supplier");
          const force = params.get("force") === "1";
          const sinceRaw = params.get("since");
          const since = sinceRaw ? Date.parse(sinceRaw) : null;
          if (sinceRaw && !Number.isFinite(since)) return json({ ok: false, error: "since inválido" }, 400);

          let query = supabaseAdmin
            .from("suppliers")
            .select("id, name, slug, sync_interval_minutes, last_successful_sync_at, last_sync_at, sync_cursor, sync_status, sync_locked_at, sync_run_started_at, auto_sync, priority, current_sync_run_id, consecutive_sync_failures")
            .eq("active", true);
          if (onlySlug) query = query.eq("slug", onlySlug);
          const { data: suppliers, error: listError } = await query;
          if (listError) return json({ ok: false, error: `Falha ao listar fornecedores: ${listError.message}` }, 500);

          const now = Date.now();
          const { next, decided } = pickNext(suppliers ?? [], now, { force, since });
          const skipped = decided
            .filter((x) => x.d.action === "skip")
            .map((x) => ({ supplier: x.s.name, skipped: true, reason: (x.d as { reason: string }).reason }));

          if (!next) return json({ ok: true, idle: true, results: skipped });

          const s = next.s;
          const decision = next.d;
          const result: Record<string, unknown> = { supplier: s.name };
          let failed = false;

          try {
            if (decision.action === "interrupted") {
              // Ciclo que não terminou: vira falha registrada em vez de ficar "sincronizando" para sempre.
              const nowIso = new Date().toISOString();
              if (s.current_sync_run_id) {
                await supabaseAdmin
                  .from("sync_runs")
                  .update({ status: "erro", stage: "IMPORT", error_code: "INTERRUPTED", error_message: decision.reason, finished_at: nowIso })
                  .eq("id", s.current_sync_run_id)
                  .is("finished_at", null);
              }
              await supabaseAdmin
                .from("suppliers")
                .update({
                  sync_status: "erro",
                  sync_message: decision.reason,
                  sync_error_code: "INTERRUPTED",
                  sync_stage: "IMPORT",
                  sync_locked_at: null,
                  sync_cursor: null,
                  sync_run_started_at: null,
                  current_sync_run_id: null,
                  last_sync_at: nowIso,
                  consecutive_sync_failures: Number(s.consecutive_sync_failures ?? 0) + 1,
                })
                .eq("id", s.id);
              failed = true;
              result.error = decision.reason;
              result.code = "INTERRUPTED";
            } else {
              const cursor = decision.action === "resume" ? decision.cursor : 0;
              const r = await runSupplierSync(s.id, cursor);
              result.action = decision.action;
              result.status = r.status;
              result.cursor = cursor;
              result.nextCursor = r.nextCursor;
              result.found = r.found;
              result.created = r.created;
              result.updated = r.updated;
              result.unchanged = r.unchanged;
              if (r.budgetStopped) result.budgetStopped = true;
              if (r.message) result.message = r.message;
              if (r.status === "erro") failed = true;
              if (r.catalogIncomplete) {
                failed = true;
                result.code = "CATALOG_INCOMPLETE";
              }
              // "bloqueado" (rodada em andamento / circuito aberto) e "sem-integracao" não gravaram nada: são avisos, não rodada falha.
            }
          } catch (e) {
            failed = true;
            result.error = e instanceof Error ? e.message : "falha";
          }

          result.subrequests = usedSubrequests();
          return json({ ok: !failed, results: [result, ...skipped] }, failed ? 500 : 200);
        });
      },
    },
  },
});
