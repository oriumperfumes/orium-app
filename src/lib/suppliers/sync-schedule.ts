/**
 * Quem a sincronização automática atende a cada chamada.
 *
 * No Worker Free cada requisição só faz ~50 chamadas externas, então uma chamada
 * executa UMA rodada de UM fornecedor. O agendador do banco chama de novo
 * (job de 3 h abre o ciclo; o job de continuação só retoma o que ficou parcial).
 * Esta função decide, sem I/O, o que fazer com cada fornecedor.
 */

export type SyncCandidate = {
  id: string;
  name: string;
  slug: string;
  sync_interval_minutes: number | null;
  last_successful_sync_at: string | null;
  last_sync_at: string | null;
  sync_cursor: number | null;
  sync_status: string | null;
  sync_locked_at: string | null;
  sync_run_started_at: string | null;
  auto_sync: boolean | null;
  priority: string | null;
};

/** Uma rodada ainda em andamento (travou o fornecedor há menos que isso). */
export const ROUND_IN_FLIGHT_MS = 120_000;
/** Um ciclo (várias rodadas) que passou disso foi interrompido de verdade: vira falha, não "sincronizando" para sempre. */
export const CYCLE_MAX_MS = 3 * 60 * 60_000;
/** O job de 3 h roda um pouco antes de completar o intervalo do fornecedor; esta folga evita pular o ciclo. */
export const INTERVAL_TOLERANCE_MS = 5 * 60_000;

export type SyncDecision =
  | { action: "resume"; cursor: number }
  | { action: "start" }
  | { action: "interrupted"; reason: string }
  | { action: "skip"; reason: "sincronizacao-automatica-pausada" | "rodada-em-andamento" | "fora-do-intervalo" | "ciclo-ja-tentado" };

const ms = (v: string | null | undefined) => (v ? Date.parse(v) : NaN);

/** Rodada em andamento = travado depois do último encerramento (o motor grava os dois iguais ao encerrar). */
export function roundInFlight(s: SyncCandidate, now: number): boolean {
  const lock = ms(s.sync_locked_at);
  if (!Number.isFinite(lock)) return false;
  const last = ms(s.last_sync_at);
  if (Number.isFinite(last) && lock <= last) return false;
  return now - lock < ROUND_IN_FLIGHT_MS;
}

export function decideSupplier(s: SyncCandidate, now: number, opts: { force?: boolean; since?: number | null } = {}): SyncDecision {
  if (!opts.force && (s.auto_sync === false || s.priority === "inactive")) return { action: "skip", reason: "sincronizacao-automatica-pausada" };

  const midCycle = (s.sync_status === "parcial" || s.sync_status === "sincronizando") && s.sync_cursor !== null && s.sync_cursor !== undefined;
  if (midCycle) {
    if (roundInFlight(s, now)) return { action: "skip", reason: "rodada-em-andamento" };
    const started = ms(s.sync_run_started_at);
    if (Number.isFinite(started) && now - started > CYCLE_MAX_MS) {
      return { action: "interrupted", reason: "Ciclo de sincronização interrompido antes da conclusão (passou de 3 horas)." };
    }
    return { action: "resume", cursor: s.sync_cursor ?? 0 };
  }

  if (!opts.force) {
    const interval = (s.sync_interval_minutes ?? 30) * 60_000;
    const lastOk = ms(s.last_successful_sync_at);
    if (Number.isFinite(lastOk) && now - lastOk < interval - INTERVAL_TOLERANCE_MS) return { action: "skip", reason: "fora-do-intervalo" };
    // Um ciclo por abertura do job de 3 h: quem já foi tentado depois dela (mesmo com erro) espera a próxima.
    if (opts.since != null) {
      const lastTry = ms(s.last_sync_at);
      if (Number.isFinite(lastTry) && lastTry >= opts.since) return { action: "skip", reason: "ciclo-ja-tentado" };
    }
  }
  return { action: "start" };
}

/** Retomada primeiro (termina o que começou); depois quem está há mais tempo sem tentativa. */
export function pickNext<T extends SyncCandidate>(candidates: T[], now: number, opts: { force?: boolean; since?: number | null } = {}) {
  const decided = candidates.map((s) => ({ s, d: decideSupplier(s, now, opts) }));
  const rank = (d: SyncDecision) => (d.action === "interrupted" ? 0 : d.action === "resume" ? 1 : d.action === "start" ? 2 : 9);
  const lastTry = (s: T) => (Number.isFinite(ms(s.last_sync_at)) ? ms(s.last_sync_at) : 0);
  const sorted = [...decided].sort((a, b) => rank(a.d) - rank(b.d) || lastTry(a.s) - lastTry(b.s));
  return { next: sorted.find((x) => rank(x.d) < 9) ?? null, decided };
}
