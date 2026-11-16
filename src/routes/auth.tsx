import { createFileRoute, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useThemeColor } from "@/hooks/use-theme-color";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { resetRedirectUrl } from "@/lib/password-recovery";
import { Check, ChevronLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { OriumLogo } from "@/components/orium/OriumLogo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Orium Perfumes" },
      { name: "description", content: "Acesse sua conta Orium Perfumes." },
      { property: "og:title", content: "Entrar — Orium Perfumes" },
      { property: "og:description", content: "Acesse sua conta Orium Perfumes." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "/auth" }],
  }),
  component: AuthPage,
});

/** Símbolo do Google monocromático (herda a cor do botão). */
function GoogleMark({ className }: { className?: string | undefined }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "size-4"} fill="currentColor">
      <path d="M12.24 10.29v3.53h5.01c-.2 1.2-1.45 3.52-5.01 3.52-3.02 0-5.48-2.5-5.48-5.58S9.22 6.18 12.24 6.18c1.72 0 2.87.73 3.53 1.36l2.4-2.31C16.63 3.79 14.62 3 12.24 3 7.32 3 3.34 6.98 3.34 11.9s3.98 8.9 8.9 8.9c5.14 0 8.53-3.61 8.53-8.7 0-.59-.06-1.04-.15-1.49h-8.38Z" />
    </svg>
  );
}

function AuthPage() {
  // a barra de status no mesmo tom do fundo do login
  useThemeColor("#101010");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | "confirm" | "reset">(null);
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();

  const leave = () => {
    if (canGoBack) router.history.back();
    else void navigate({ to: "/", replace: true });
  };

  useEffect(() => {
    if (!loading && session) navigate({ to: "/", replace: true });
  }, [loading, session, navigate]);

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const canSubmit = validEmail && password.length >= 6 && (mode === "login" || name.trim().length >= 2) && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(/invalid/i.test(error.message) ? "E-mail ou senha incorretos." : error.message);
        toast.success("Bem-vindo de volta.");
        leave();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin, data: { name: name.trim() } },
        });
        if (error) throw error;
        if (!data.session) setSent("confirm");
        else leave();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível continuar.");
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!validEmail) {
      toast("Digite seu e-mail primeiro", { description: "Enviamos o link para criar uma senha nova." });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: resetRedirectUrl() });
    setBusy(false);
    if (error) toast.error("Não conseguimos enviar agora. Tente de novo.");
    else setSent("reset");
  };

  const google = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      toast.error("Não foi possível entrar com o Google.");
      return;
    }
    // sem erro: o Supabase redireciona o navegador para o Google
  };

  return (
    <main className="auth-page min-h-screen bg-[#101010] text-white tab:flex tab:flex-col">
      <div className="header-safe sticky top-0 z-10 bg-[#101010]">
        <div className="shell flex h-[52px] items-center tab:h-[68px]">
          <button
            type="button"
            onClick={leave}
            className="press -ml-2.5 inline-flex h-10 items-center gap-1 rounded-full pr-3 pl-1.5 text-[16px] font-semibold text-white"
          >
            <ChevronLeft className="size-[22px]" strokeWidth={2.4} />
            Voltar
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-5 pt-3 pb-[calc(2.5rem+env(safe-area-inset-bottom))] tab:my-auto tab:max-w-[480px] tab:rounded-[36px] tab:bg-[#151515] tab:px-10 tab:pt-10 tab:pb-10 tab:ring-1 tab:ring-white/[0.06] tab:shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
        <div className="auth-in">
          <OriumLogo size="lg" className="mb-6" />
          <h1 className="text-[40px] leading-[1.12] font-bold tracking-[-0.035em]">
            {sent ? "Confira seu e-mail" : mode === "login" ? "Entrar" : "Criar conta"}
          </h1>
          <p className="mt-1.5 text-[16px] leading-snug text-[#BABABA]">
            {sent === "confirm"
              ? "Enviamos um link para ativar sua conta."
              : sent === "reset"
                ? "Enviamos um link para você criar uma senha nova."
                : mode === "login"
                  ? "Seus favoritos, sua sacola e seus pedidos em qualquer aparelho."
                  : "Leva menos de um minuto."}
          </p>
        </div>

        {sent ? (
          <div className="auth-in mt-8 rounded-[24px] bg-[#1A1A1A] p-5">
            <p className="text-[15px] leading-relaxed text-[#CFCFCF]">
              Abra o e-mail enviado para <strong className="font-semibold text-white">{email.trim()}</strong> e toque no link.
              Se não aparecer, olhe também na caixa de spam.
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(null);
                setMode("login");
              }}
              className="press mt-5 h-[52px] w-full rounded-full bg-[#FFD599] text-[16px] font-bold text-[#15130F]"
            >
              Voltar para entrar
            </button>
          </div>
        ) : (
          <>
            {/* Entrar | Criar conta */}
            <div role="tablist" className="auth-in relative mt-7 grid grid-cols-2 rounded-full bg-[#1A1A1A] p-1">
              <span
                aria-hidden
                className="pd-thumb absolute top-1 bottom-1 left-1 rounded-full bg-white"
                style={{ width: "calc((100% - 0.5rem) / 2)", transform: `translateX(${mode === "login" ? 0 : 100}%)` }}
              />
              {(["login", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "relative z-10 h-11 rounded-full text-[15px] transition-colors duration-300",
                    mode === m ? "font-bold text-[#15130F]" : "font-medium text-[#CFCFCF]",
                  )}
                >
                  {m === "login" ? "Entrar" : "Criar conta"}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={google}
              className="auth-in press mt-5 flex h-[56px] w-full items-center justify-center gap-2.5 rounded-full bg-white text-[16px] font-bold text-[#15130F]"
            >
              <GoogleMark className="size-[18px]" />
              Continuar com Google
            </button>

            <div className="auth-in my-6 flex items-center gap-3 text-[13px] text-[#8C8C8C]">
              <span className="h-px flex-1 bg-white/10" /> ou com e-mail <span className="h-px flex-1 bg-white/10" />
            </div>

            <form onSubmit={submit} className="auth-in">
              <div className="overflow-hidden rounded-[20px] bg-[#1A1A1A]">
                {mode === "signup" ? (
                  <label key="name" className="g-field block px-4 pt-3 pb-2.5">
                    <span className="text-[13px] text-[#A9A9A9]">Nome</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como devemos te chamar" autoComplete="name" className="g-input" />
                  </label>
                ) : null}
                <label className={cn("g-field block px-4 pt-3 pb-2.5", mode === "signup" && "border-t border-white/10")}>
                  <span className="text-[13px] text-[#A9A9A9]">E-mail</span>
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
                <label className="g-field block border-t border-white/10 px-4 pt-3 pb-2.5">
                  <span className="text-[13px] text-[#A9A9A9]">Senha</span>
                  <span className="flex items-center gap-2">
                    <input
                      type={show ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === "login" ? "Sua senha" : "Mínimo de 6 caracteres"}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      className="g-input min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      aria-label={show ? "Esconder senha" : "Mostrar senha"}
                      className="press grid size-9 shrink-0 place-items-center rounded-full text-[#A9A9A9] hover:bg-white/10"
                    >
                      {show ? <EyeOff className="size-[18px]" strokeWidth={2} /> : <Eye className="size-[18px]" strokeWidth={2} />}
                    </button>
                  </span>
                </label>
              </div>

              {mode === "login" ? (
                <button type="button" onClick={forgot} className="press mt-3 text-[14px] font-semibold text-[#FFD599]">
                  Esqueci minha senha
                </button>
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
                {mode === "login" ? "Entrar" : "Criar minha conta"}
              </button>
            </form>

            {mode === "signup" ? (
              <ul className="auth-in mt-8 space-y-3">
                {["Seus favoritos salvos em qualquer aparelho", "Sacola guardada para terminar depois", "Pedidos e ofertas da Orium para você"].map((t) => (
                  <li key={t} className="flex items-center gap-3 text-[15px] text-[#CFCFCF]">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#2A2217] text-[#FFD599]">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
