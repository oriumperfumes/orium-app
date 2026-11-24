/**
 * Edge Function `enrich-fragrances` — enriquecimento Fragrantica (motor V3) direto no Supabase.
 *
 * O lote inteiro tem prazo (DEADLINE_MS, com folga abaixo dos 150 s do plano gratuito): leituras e
 * esperas são cortadas pelo tempo restante e o lote encerra a tempo de registrar progresso e erros.
 * 403/429 da Fragrantica encerram o lote na hora (dados existentes preservados, motivo registrado);
 * timeout é falha temporária e nunca marca o perfume como inexistente.
 *
 * GERADO por scripts/build-edge-sync.mjs → supabase/functions/enrich-fragrances/index.ts.
 * Autenticação: igual à `sync-suppliers` (segredo no Vault conferido pela RPC orium_check_edge_cron_secret).
 * Corpo (JSON, opcional): { mode?: "not-found"|"partial"|"descriptions"|"missing-url"|"all", limit?: number, force?: boolean }
 */
import { supabaseAdmin } from "./client.edge";
import { runEnrichmentV3, type Mode } from "../../src/lib/catalog/enrichment-v3.server";

declare const Deno: { serve: (handler: (req: Request) => Response | Promise<Response>) => void };

/** Prazo do lote inteiro. O limite do Supabase Free é 150 s; sobra folga para gravar o registro e responder. */
const DEADLINE_MS = 100_000;
const MODES = ["not-found", "partial", "descriptions", "missing-url", "all"] as const;

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "unauthorized" }, 401);
  const { data: authorized, error: authError } = await supabaseAdmin.rpc("orium_check_edge_cron_secret", { token });
  if (authError || authorized !== true) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { mode?: string; limit?: number; force?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* corpo vazio: padrões */
  }
  const mode: Mode = (MODES as readonly string[]).includes(body.mode ?? "") ? (body.mode as Mode) : "all";
  const limit = Math.min(120, Math.max(1, Number(body.limit) || 25));

  const startedAt = new Date().toISOString();
  let result: Awaited<ReturnType<typeof runEnrichmentV3>>;
  try {
    result = await runEnrichmentV3(supabaseAdmin as never, { mode, limit, force: body.force === true, deadlineMs: DEADLINE_MS });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "falha";
    await supabaseAdmin.from("enrichment_batch_runs").insert({ started_at: startedAt, mode, requested_limit: limit, stop_reason: "error", detail, response_code: 500 });
    return json({ ok: false, error: detail }, 500);
  }

  // Falha é falha: fonte recusou (403/429) ou nenhum perfume foi lido com sucesso.
  const blocked = result.stopped?.reason === "blocked";
  const allFailed = result.processed > 0 && result.temporaryFailure === result.processed;
  const failed = blocked || allFailed;
  const responseCode = failed ? 502 : 200;

  const { error: logError } = await supabaseAdmin.from("enrichment_batch_runs").insert({
    started_at: startedAt,
    mode,
    requested_limit: limit,
    processed: result.processed,
    verified: result.verified,
    candidates: result.candidates,
    review: result.review,
    not_found: result.notFound,
    temporary_failure: result.temporaryFailure,
    not_started: result.notStarted,
    descriptions_written: result.descriptionsWritten,
    requests: result.requests,
    duration_ms: result.durationMs,
    stop_reason: result.stopped?.reason ?? (allFailed ? "all-failed" : null),
    http_status: result.stopped?.httpStatus ?? null,
    detail: result.stopped?.detail ?? null,
    response_code: responseCode,
  });

  return json(
    {
      ok: !failed,
      mode,
      limit,
      processed: result.processed,
      verified: result.verified,
      candidates: result.candidates,
      review: result.review,
      notFound: result.notFound,
      temporaryFailure: result.temporaryFailure,
      notStarted: result.notStarted,
      remaining: result.remaining,
      descriptionsWritten: result.descriptionsWritten,
      requests: result.requests,
      durationMs: result.durationMs,
      stopped: result.stopped,
      logError: logError?.message ?? null,
      items: result.items.slice(0, 12).map((i) => ({ name: i.productName, status: i.searchStatus, reason: i.reason, ms: i.durationMs })),
    },
    responseCode,
  );
});
