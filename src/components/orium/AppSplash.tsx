/**
 * Abertura do app instalado (PWA) — só existe quando a Orium roda pela tela
 * inicial. O símbolo dourado se desenha, um perfume âmbar sobe dentro do
 * círculo enquanto o app carrega e a saudação aparece embaixo. Ao terminar,
 * tudo se abre suavemente para a loja.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { OriumSymbol, SYMBOL_VIEWBOX } from "@/components/orium/OriumSymbol";
import { storedWelcomeName, timeGreeting } from "@/lib/pwa";
import { useAuth } from "@/lib/auth";
import { setSplashing } from "@/lib/splash-state";

/** Antes da pintura no cliente; no servidor não roda (nem avisa). */
const useBeforePaint = typeof document === "undefined" ? useEffect : useLayoutEffect;

/** Tempo mínimo da abertura: o bastante para o símbolo aparecer, sem prender quem já carregou. */
const MIN_VISIBLE = 650;
/** Rede lenta nunca prende o cliente na abertura. */
const MAX_VISIBLE = 1800;

export function AppSplash() {
  const [active, setActive] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { session, loading } = useAuth();
  const [name, setName] = useState<string | null>(null);
  const [shownAt, setShownAt] = useState(0);

  // Assume o lugar da cobertura pintada no primeiro frame (classe orium-booting)
  // antes de qualquer pintura de conteúdo: nunca há flash da Home.
  useBeforePaint(() => {
    const booting = document.documentElement.classList.contains("orium-booting");
    // A abertura é só da abertura do app: navegar, recarregar ou voltar de
    // uma página não a repete (a sessão já foi aberta).
    if (!booting) return;
    try {
      sessionStorage.setItem("orium-opened", "1");
    } catch {
      /* sem armazenamento: segue sem lembrar */
    }
    setActive(true);
    setSplashing(true);
    setShownAt(performance.now());
    setName(storedWelcomeName());
    document.documentElement.classList.remove("orium-booting");
  }, []);

  useEffect(() => {
    if (!active) return;
    const done = () => {
      setLeaving(true);
      window.setTimeout(() => {
        setActive(false);
        // só agora avisos e pop-ups podem aparecer
        setSplashing(false);
      }, 520);
    };
    const guard = window.setTimeout(done, MAX_VISIBLE);
    if (!loading) {
      const wait = Math.max(120, MIN_VISIBLE - (performance.now() - shownAt));
      const t = window.setTimeout(done, wait);
      return () => {
        window.clearTimeout(guard);
        window.clearTimeout(t);
      };
    }
    return () => window.clearTimeout(guard);
  }, [active, loading, shownAt]);

  useEffect(() => {
    if (session) setName((current) => current ?? storedWelcomeName());
  }, [session]);

  if (!active) return null;

  const greeting = name ? `Bem-vindo, ${name}` : timeGreeting();

  return (
    <div aria-hidden className={`orium-splash ${leaving ? "is-leaving" : ""}`}>
      <div className="splash-stage">
        <div className="splash-mark">
          {/* o perfume sobe dentro do círculo enquanto o app carrega */}
          <svg viewBox={SYMBOL_VIEWBOX} className="splash-liquid" aria-hidden>
            <defs>
              <clipPath id="orium-splash-clip">
                <circle cx="512" cy="604.5" r="243" />
              </clipPath>
              <linearGradient id="orium-splash-amber" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FFD599" stopOpacity="0.34" />
                <stop offset="1" stopColor="#C9893A" stopOpacity="0.22" />
              </linearGradient>
            </defs>
            <g clipPath="url(#orium-splash-clip)">
              <g className="splash-rise">
                <path
                  className="splash-wave"
                  fill="url(#orium-splash-amber)"
                  d="M-200 640 Q -80 612 40 640 T 280 640 T 520 640 T 760 640 T 1000 640 T 1240 640 T 1480 640 T 1720 640 V 900 H -200 Z"
                />
              </g>
            </g>
          </svg>
          <OriumSymbol className="splash-symbol" strokeWidth={24} />
        </div>
        <p className="splash-greet">{greeting}</p>
      </div>
    </div>
  );
}
