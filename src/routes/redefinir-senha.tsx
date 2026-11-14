import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useThemeColor } from "@/hooks/use-theme-color";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { OriumLogo } from "@/components/orium/OriumLogo";
import {
  clearRecovery,
  markResetRequested,
  readRecovery,
  type RecoveryMark,
} from "@/lib/password-recovery";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/redefinir-senha")({
  validateSearch: (search: Record<string, unknown>): { erro?: "link" } =>
    search["erro"] === "link" ? { erro: "link" } : {},
  head: () => ({
    meta: [{ title: "Nova senha — Orium Perfumes" }, { name: "robots", content: "noindex" }],
    links: [{ rel: "canonical", href: "/redefinir-senha" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  useThemeColor("#101010");
  const { erro } = Route.useSearch();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  // Lido depois da hidratação (sessionStorage não existe no servidor).
  const [mark, setMark] = useState<RecoveryMark | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMark(readRecovery());
    setReady(true);
  }, [session]);

  const bound = !!mark && !!session && session.user.id === mark.uid;
  const otherUser = !!mark && !!session && session.user.id !== mark.uid;

  useEffect(() => {
    if (!ready || loading || erro) return;
    if (otherUser) {
      // sessão de outra conta: o estado da recuperação não vale mais
      clearRecovery();
      void navigate({ to: "/", replace: true });
    } else if (!mark) {
      void navigate({ to: "/auth", replace: true });
    }
  }, [ready, loading, erro, otherUser, mark, navigate]);

  const linkProblem = erro === "link" || (ready && !loading && !!mark && !session);
  const showForm = !erro && ready && !loading && bound;

  return (
    <main className="auth-page min-h-screen bg-[#101010] text-white tab:flex tab:flex-col">
      <div className="mx-auto w-full max-w-md px-5 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))] tab:my-auto tab:max-w-[480px] tab:rounded-[36px] tab:bg-[#151515] tab:px-10 tab:pt-10 tab:pb-10 tab:ring-1 tab:ring-white/[0.06]">
        <OriumLogo size="lg" className="mb-6" />
        {linkProblem ? <ExpiredLink /> : showForm ? <NewPasswordForm /> : null}
      </div>
    </main>
  );
}

function NewPasswordForm() {
  const navigate = useNavigate();
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const { loading, session } = useAuth();

  const mismatch = pass2.length > 0 && pass !== pass2;
  const canSubmit = !loading && !!session && pass.length >= 6 && pass === pass2 && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    // a recuperação só vale para o usuário da sessão aberta pelo link
    if (readRecovery()?.uid !== session?.user.id) {
      clearRecovery();
      void navigate({ to: "/", replace: true });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pass });
    setBusy(false);
    if (error) {
      const code = (error as { code?: string }).code;
      toast.error(
        code === "same_password"
          ? "Escolha uma senha diferente da anterior."
          : code === "weak_password"
            ? "Senha fraca. Use mais caracteres, com letras e números."
            : "Não conseguimos salvar a senha agora. Tente de novo.",
      );
      return;
    }
    clearRecovery();
    toast.success("Senha alterada", { duration: 2200 });
    void navigate({ to: "/", replace: true });
  };

  return (
    <>
      <h1 className="text-[40px] leading-[1.12] font-bold tracking-[-0.035em]">Nova senha</h1>
      <p className="mt-1.5 text-[16px] leading-snug text-[#BABABA]">
        Escolha a senha que vai usar para entrar.
      </p>

      <form onSubmit={submit} className="mt-8">
        <div className="overflow-hidden rounded-[20px] bg-[#1A1A1A]">
          <label className="g-field block px-4 pt-3 pb-2.5">
            <span className="text-[13px] text-[#A9A9A9]">Nova senha</span>
            <span className="flex items-center gap-2">
              <input
                type={show ? "text" : "password"}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="Mínimo de 6 caracteres"
                autoComplete="new-password"
                className="g-input min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Esconder senha" : "Mostrar senha"}
                className="press grid size-9 shrink-0 place-items-center rounded-full text-[#A9A9A9] hover:bg-white/10"
              >
                {show ? (
                  <EyeOff className="size-[18px]" strokeWidth={2} />
                ) : (
                  <Eye className="size-[18px]" strokeWidth={2} />
                )}
              </button>
            </span>
          </label>
          <label className="g-field block border-t border-white/10 px-4 pt-3 pb-2.5">
            <span className="text-[13px] text-[#A9A9A9]">Confirmar senha</span>
            <input
              type={show ? "text" : "password"}
              value={pass2}
              onChange={(e) => setPass2(e.target.value)}
              placeholder="Repita a nova senha"
              autoComplete="new-password"
              className="g-input"
            />
          </label>
        </div>
        {mismatch ? (
          <p className="mt-2 text-[13px] text-[#FFB4A8]">As senhas não são iguais.</p>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "press mt-6 flex h-[60px] w-full items-center justify-center gap-2 rounded-full text-[17px] font-bold transition-colors duration-300",
            canSubmit ? "bg-[#FFD599] text-[#15130F]" : "bg-[#2A2A2A] text-[#8C8C8C]",
          )}
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : null}
          Salvar nova senha
        </button>
      </form>
    </>
  );
}

function ExpiredLink() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const again = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validEmail || busy) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    if (error) {
      toast.error("Não conseguimos enviar agora. Tente de novo em alguns minutos.");
    } else {
      markResetRequested();
      setSent(true);
    }
  };

  if (sent) {
    return (
      <>
        <h1 className="text-[40px] leading-[1.12] font-bold tracking-[-0.035em]">
          Confira seu e-mail
        </h1>
        <div className="mt-6 rounded-[24px] bg-[#1A1A1A] p-5">
          <p className="text-[15px] leading-relaxed text-[#CFCFCF]">
            Enviamos um novo link para{" "}
            <strong className="font-semibold text-white">{email.trim()}</strong>. Use o mais
            recente; os anteriores deixam de valer. Se não aparecer, olhe também na caixa de spam.
          </p>
          <button
            type="button"
            onClick={() => void navigate({ to: "/auth", replace: true })}
            className="press mt-5 h-[52px] w-full rounded-full bg-[#FFD599] text-[16px] font-bold text-[#15130F]"
          >
            Voltar para entrar
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="text-[40px] leading-[1.12] font-bold tracking-[-0.035em]">Link vencido</h1>
      <p className="mt-1.5 text-[16px] leading-snug text-[#BABABA]">
        Este link para criar uma senha nova expirou ou já foi usado. Peça outro e use o e-mail mais
        recente.
      </p>
      <form onSubmit={again} className="mt-8">
        <div className="overflow-hidden rounded-[20px] bg-[#1A1A1A]">
          <label className="g-field block px-4 pt-3 pb-2.5">
            <span className="text-[13px] text-[#A9A9A9]">E-mail da sua conta</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com"
              autoComplete="email"
              inputMode="email"
              className="g-input"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={!validEmail || busy}
          className={cn(
            "press mt-6 flex h-[60px] w-full items-center justify-center gap-2 rounded-full text-[17px] font-bold transition-colors duration-300",
            validEmail && !busy ? "bg-[#FFD599] text-[#15130F]" : "bg-[#2A2A2A] text-[#8C8C8C]",
          )}
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : null}
          Pedir outro link
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: "/auth", replace: true })}
          className="press mt-4 w-full text-[14px] font-semibold text-[#FFD599]"
        >
          Voltar para entrar
        </button>
      </form>
    </>
  );
}
