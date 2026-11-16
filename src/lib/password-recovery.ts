/**
 * Recuperação de senha por link de e-mail.
 *
 * - O link de "Esqueci minha senha" volta para `/redefinir-senha` (destino explícito). Qualquer
 *   erro de link nesse endereço (vencido, já usado) é erro de recuperação, em qualquer navegador;
 *   erros e cancelamentos do login Google voltam para a origem do app e ficam no fluxo de login.
 * - `orium:recovery` (sessionStorage) guarda a sessão aberta pelo link: o usuário (`sub`) e a
 *   sessão específica (`session_id` do token). O formulário de nova senha só aparece enquanto a
 *   sessão atual for essa mesma sessão; um login comum da mesma conta é outra sessão.
 */
export const RESET_PATH = "/redefinir-senha";

const RECOVERY_KEY = "orium:recovery";
const RECOVERY_TTL_MS = 60 * 60 * 1000;

export type RecoveryMark = { uid: string; sid: string; t: number };

/** URL de retorno do e-mail de recuperação. Precisa estar em Redirect URLs do Supabase. */
export function resetRedirectUrl(): string {
  return `${window.location.origin}${RESET_PATH}`;
}

export function readRecovery(): RecoveryMark | null {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const mark = JSON.parse(raw) as Partial<RecoveryMark> | null;
    if (
      mark &&
      typeof mark.uid === "string" &&
      typeof mark.sid === "string" &&
      typeof mark.t === "number" &&
      Date.now() - mark.t < RECOVERY_TTL_MS
    ) {
      return { uid: mark.uid, sid: mark.sid, t: mark.t };
    }
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* sem storage: sem formulário */
  }
  return null;
}

export function writeRecovery(uid: string, sid: string): void {
  try {
    sessionStorage.setItem(
      RECOVERY_KEY,
      JSON.stringify({ uid, sid, t: Date.now() } satisfies RecoveryMark),
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

/** Usuário (`sub`) e sessão (`session_id`) do token. Só identifica; quem autentica é o Supabase. */
export function claimsFromToken(
  token: string | null | undefined,
): { uid: string; sid: string } | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { sub?: unknown; session_id?: unknown };
    return typeof claims.sub === "string" &&
      claims.sub &&
      typeof claims.session_id === "string" &&
      claims.session_id
      ? { uid: claims.sub, sid: claims.session_id }
      : null;
  } catch {
    return null;
  }
}

/** A sessão atual é exatamente a sessão aberta pelo link de recuperação? */
export function isRecoverySession(
  mark: RecoveryMark | null,
  accessToken: string | null | undefined,
): boolean {
  const claims = claimsFromToken(accessToken);
  return !!mark && !!claims && claims.uid === mark.uid && claims.sid === mark.sid;
}
