/**
 * Edge Function `sync-suppliers` — sincronização automática dos fornecedores direto no Supabase.
 *
 * Roda no próprio banco de produção, sem depender da hospedagem da loja. Reaproveita o motor
 * do app (src/lib/suppliers/engine.server.ts): gravações em lote, retomada pelo cursor e
 * orçamento de chamadas. GERADO por scripts/build-edge-sync.mjs → supabase/functions/sync-suppliers/index.ts.
 *
 * Autenticação: `Authorization: Bearer <segredo>` conferido no banco (RPC orium_check_edge_cron_secret,
 * segredo no Vault). verify_jwt fica desligado porque as chaves novas do Supabase não são JWT.
 *
 * Uma chamada executa poucas rodadas (limite de CPU de 2 s por requisição do plano gratuito) e devolve
 * HTTP 500 em falha. Quem continua o ciclo é o Supabase Cron (job de 3 h abre; job de continuação retoma).
 *
 * Parâmetros: ?supplier=<slug> · ?force=1 · ?since=<ISO>
 */
import { supabaseAdmin } from "./client.edge";
import { runSupplierSync } from "../../src/lib/suppliers/engine.server";
import { pickNext, type SyncCandidate, type SyncDecision } from "../../src/lib/suppliers/sync-schedule";

declare const Deno: { serve: (handler: (req: Request) => Response | Promise<Response>) => void };

const MAX_ROUNDS = 5;
/** Depois disso não começa outra rodada (a chamada termina bem antes do limite de tempo). */
const START_NEW_ROUND_BEFORE_MS = 30_000;

const SUPPLIER_COLUMNS =
  "id, name, slug, sync_interval_minutes, last_successful_sync_at, last_sync_at, sync_cursor, sync_status, sync_locked_at, sync_run_started_at, auto_sync, priority, current_sync_run_id, consecutive_sync_failures";

type Row = SyncCandidate & { current_sync_run_id: string | null; consecutive_sync_failures: number | null };

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function runOne(s: Row, decision: SyncDecision) {
  const result: Record<string, unknown> = { supplier: s.name };
  let failed = false;
  const t = Date.now();
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
    } else if (decision.action === "resume" || decision.action === "start") {
      const cursor = decision.action === "resume" ? decision.cursor : 0;
      const r = await runSupplierSync(s.id, cursor);
      Object.assign(result, {
        action: decision.action,
        status: r.status,
        cursor,
        nextCursor: r.nextCursor,
        found: r.found,
        created: r.created,
        updated: r.updated,
        unchanged: r.unchanged,
      });
      if (r.message) result.message = r.message;
      if (r.status === "erro") failed = true;
      if (r.catalogIncomplete) {
        failed = true;
        result.code = "CATALOG_INCOMPLETE";
      }
    }
  } catch (e) {
    failed = true;
    result.error = e instanceof Error ? e.message : "falha";
  }
  result.ms = Date.now() - t;
  return { result, failed };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "unauthorized" }, 401);
  const { data: authorized, error: authError } = await supabaseAdmin.rpc("orium_check_edge_cron_secret", { token });
  if (authError || authorized !== true) return json({ ok: false, error: "unauthorized" }, 401);

  const params = new URL(req.url).searchParams;
  const onlySlug = params.get("supplier");
  const force = params.get("force") === "1";
  const sinceRaw = params.get("since");
  const since = sinceRaw ? Date.parse(sinceRaw) : null;
  if (sinceRaw && !Number.isFinite(since)) return json({ ok: false, error: "since inválido" }, 400);

  const started = Date.now();
  const results: Array<Record<string, unknown>> = [];
  let failed = false;
  let rounds = 0;

  while (rounds < MAX_ROUNDS) {
    let query = supabaseAdmin.from("suppliers").select(SUPPLIER_COLUMNS).eq("active", true);
    if (onlySlug) query = query.eq("slug", onlySlug);
    const { data, error } = await query;
    if (error) {
      failed = true;
      results.push({ error: `Falha ao listar fornecedores: ${error.message}` });
      break;
    }
    const { next } = pickNext((data ?? []) as Row[], Date.now(), { force, since });
    if (!next) break;
    const outcome = await runOne(next.s, next.d);
    results.push(outcome.result);
    rounds++;
    if (outcome.failed) {
      failed = true;
      break;
    }
    if (Date.now() - started > START_NEW_ROUND_BEFORE_MS) break;
  }

  return json({ ok: !failed, idle: rounds === 0 && !failed, rounds, ms: Date.now() - started, results }, failed ? 500 : 200);
});
