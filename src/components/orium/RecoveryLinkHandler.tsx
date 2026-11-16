import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  RESET_PATH,
  claimsFromToken,
  clearRecovery,
  readRecovery,
  writeRecovery,
} from "@/lib/password-recovery";

/**
 * O Supabase devolve o resultado do link do e-mail no fragmento (#...) do endereço de retorno.
 * O cliente apaga o fragmento ao iniciar; por isso o endereço é lido aqui, no carregamento do
 * módulo, e tratado uma única vez.
 */
const initialPath = typeof window === "undefined" ? "" : window.location.pathname;
const initialHash = typeof window === "undefined" ? "" : window.location.hash;
let hashHandled = false;

/**
 * Leva o link de "Esqueci minha senha" ao formulário de nova senha.
 *
 * - Link válido: a recuperação fica ligada à sessão aberta pelo link (usuário e `session_id`).
 * - Link vencido ou já usado: só é tratado quando o erro chega em `/redefinir-senha`, o destino
 *   explícito do e-mail. Erros e cancelamentos do login Google voltam para a origem e não passam
 *   por aqui, em qualquer navegador.
 * - Sair da conta ou abrir outra sessão apaga o estado da recuperação.
 */
export function RecoveryLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!hashHandled) {
      hashHandled = true;
      const params = new URLSearchParams(initialHash.replace(/^#/, ""));

      if (initialPath === RESET_PATH && (params.get("error_code") || params.get("error"))) {
        clearRecovery();
        window.history.replaceState(null, "", `${RESET_PATH}?erro=link`);
        void navigate({ to: RESET_PATH, search: { erro: "link" }, replace: true });
      } else if (params.get("type") === "recovery") {
        const claims = claimsFromToken(params.get("access_token"));
        if (claims) {
          writeRecovery(claims.uid, claims.sid);
          void navigate({ to: RESET_PATH, replace: true });
        }
      }
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        const claims = claimsFromToken(session?.access_token);
        if (claims) {
          writeRecovery(claims.uid, claims.sid);
          void navigate({ to: RESET_PATH, replace: true });
        }
        return;
      }
      if (event === "SIGNED_OUT") {
        clearRecovery();
        return;
      }
      const mark = readRecovery();
      if (!mark || !session) return;
      const claims = claimsFromToken(session.access_token);
      if (!claims || claims.uid !== mark.uid || claims.sid !== mark.sid) clearRecovery();
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  return null;
}
