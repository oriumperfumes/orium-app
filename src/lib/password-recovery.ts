/**
 * Estado da recuperação de senha no navegador.
 *
 * - `orium:recovery` (sessionStorage): vale só para o usuário da sessão aberta pelo link
 *   do e-mail. O formulário de nova senha só aparece se a sessão atual for desse usuário.
 * - `orium:reset-requested` (localStorage): "pedi um link de recuperação há pouco". Só com
 *   ele um link vencido (otp_expired) é tratado como recuperação; erros e cancelamentos do
 *   login Google ficam no fluxo de login.
 */
const RECOVERY_KEY = "orium:recovery";
const REQUEST_KEY = "orium:reset-requested";
const RECOVERY_TTL_MS = 60 * 60 * 1000;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

export type RecoveryMark = { uid: string; t: number };

export function readRecovery(): RecoveryMark | null {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const mark = JSON.parse(raw) as Partial<RecoveryMark> | null;
    if (
      mark &&
      typeof mark.uid === "string" &&
      typeof mark.t === "number" &&
      Date.now() - mark.t < RECOVERY_TTL_MS
    ) {
      return { uid: mark.uid, t: mark.t };
    }
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* sem storage: sem formulário */
  }
  return null;
}

export function writeRecovery(uid: string): void {
  try {
    sessionStorage.setItem(
      RECOVERY_KEY,
      JSON.stringify({ uid, t: Date.now() } satisfies RecoveryMark),
    );
  } catch {
    /* ignora */
  }
}

export function clearRecovery(): void {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* ignora */
  }
}

export function markResetRequested(): void {
  try {
    localStorage.setItem(REQUEST_KEY, String(Date.now()));
  } catch {
    /* ignora */
  }
}

export function resetRequestedRecently(): boolean {
  try {
    const t = Number(localStorage.getItem(REQUEST_KEY));
    return Number.isFinite(t) && t > 0 && Date.now() - t < REQUEST_TTL_MS;
  } catch {
    return false;
  }
}

/** `sub` (id do usuário) do token do link. Só identifica o dono; quem autentica é o Supabase. */
export function userIdFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}
