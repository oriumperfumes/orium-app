import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  clearRecovery,
  readRecovery,
  resetRequestedRecently,
  userIdFromToken,
  writeRecovery,
} from "@/lib/password-recovery";

/**
 * O Supabase devolve o resultado do link do e-mail no fragmento (#...) do endereço de retorno.
 * O cliente apaga o fragmento ao iniciar; por isso ele é lido aqui, no carregamento do módulo,
 * e tratado uma única vez.
 */
const initialHash = typeof window === "undefined" ? "" : window.location.hash;
let hashHandled = false;

/**
 * Leva o link de "Esqueci minha senha" direto ao formulário de nova senha.
 *
 * - Link válido: o formulário fica ligado ao usuário da sessão recebida.
 * - Link vencido ou já usado: só entra aqui com `otp_expired` E um pedido de recuperação recente
 *   neste navegador. Erros e cancelamentos do login Google não passam por este caminho.
 * - Sair da conta ou trocar de usuário apaga o estado da recuperação.
 */
export function RecoveryLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!hashHandled) {
      hashHandled = true;
      const params = new URLSearchParams(initialHash.replace(/^#/, ""));

      if (params.get("error_code") === "otp_expired" && resetRequestedRecently()) {
        clearRecovery();
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        void navigate({ to: "/redefinir-senha", search: { erro: "link" }, replace: true });
      } else if (params.get("type") === "recovery") {
        const uid = userIdFromToken(params.get("access_token"));
        if (uid) {
          writeRecovery(uid);
          void navigate({ to: "/redefinir-senha", replace: true });
        }
      }
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        writeRecovery(session.user.id);
        void navigate({ to: "/redefinir-senha", replace: true });
        return;
      }
      if (event === "SIGNED_OUT") {
        clearRecovery();
        return;
      }
      const mark = readRecovery();
      if (mark && session && mark.uid !== session.user.id) clearRecovery();
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  return null;
}
