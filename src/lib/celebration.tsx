import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * PROMOTION CELEBRATION SYSTEM
 *
 * Uma única linguagem de celebração para todos os momentos de recompensa real
 * da Orium: promoção revelada, cupom público recebido, cupom aplicado.
 * Nada aqui decide regra de negócio — só celebra um ganho que já é verdadeiro.
 *
 * Princípios:
 * - celebração só em recompensa real (nunca em card, scroll ou re-render);
 * - uma vez por campanha/cupom por pessoa (`celebrateOnce`);
 * - partículas curtas, champagne, removidas do DOM ao terminar;
 * - `pointer-events: none` — nunca bloqueia o toque no CTA;
 * - `prefers-reduced-motion` troca movimento por brilho/fade.
 */

/** Tokens de celebração — mesmos tempos em todo o app. */
export const CELEBRATION = {
  tap: 100,
  micro: 160,
  reveal: 280,
  spring: 300,
  confetti: 900,
  countUp: 560,
  stagger: 60,
} as const;

/** Atraso em cascata (40–80ms entre elementos), pronto para `style`. */
export const step = (i: number) => ({ "--d": `${i * CELEBRATION.stagger}ms` }) as React.CSSProperties;

const STORE_KEY = "orium-celebrated";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Memória volátil: cobre navegação anônima onde localStorage é bloqueado. */
const volatile = new Set<string>();

/**
 * `true` apenas na primeira vez que aquele momento acontece para a pessoa.
 * Chame no instante da recompensa (não em render) — a chave é consumida.
 */
export function celebrateOnce(key: string): boolean {
  if (!key) return false;
  if (volatile.has(key)) return false;
  const list = read();
  if (list.includes(key)) {
    volatile.add(key);
    return false;
  }
  volatile.add(key);
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify([...list, key].slice(-120)));
  } catch {
    /* modo privado: a memória volátil já evita repetir na sessão */
  }
  return true;
}

/** Já celebrado? (consulta sem consumir) */
export function alreadyCelebrated(key: string): boolean {
  return volatile.has(key) || read().includes(key);
}

/** Decisão já tomada nesta sessão (sobrevive a remontagens do React). */
const pending = new Map<string, boolean>();

/**
 * Liga a celebração uma única vez para aquela chave e desliga sozinha ao fim do
 * burst. Remontar o componente (abrir o carrinho de novo, por exemplo) não
 * repete: a decisão fica registrada assim que a animação acontece.
 */
export function useCelebrateOnce(key: string | null, delay: number = CELEBRATION.reveal): boolean {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!key) return;
    let allowed = pending.get(key);
    if (allowed === undefined) {
      allowed = celebrateOnce(key);
      pending.set(key, allowed);
    }
    if (!allowed) return;
    const start = setTimeout(() => {
      pending.set(key, false);
      setOn(true);
    }, delay);
    const stop = setTimeout(() => setOn(false), delay + CELEBRATION.confetti + 300);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [key, delay]);

  return on;
}



const COLORS = [
  "color-mix(in oklab, var(--gold) 92%, white)",
  "color-mix(in oklab, var(--gold) 70%, white)",
  "color-mix(in oklab, var(--gold) 45%, white)",
  "color-mix(in oklab, var(--foreground) 18%, white)",
  "oklch(0.97 0.012 85)",
];

type Piece = {
  id: number;
  x: number;
  tx: number;
  ty: number;
  rot: number;
  delay: number;
  size: number;
  color: string;
  round: boolean;
};

function build(count: number): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i += 1) {
    const spread = (i / Math.max(count - 1, 1)) * 2 - 1;
    pieces.push({
      id: i,
      x: 50 + spread * 34 + (Math.random() * 8 - 4),
      tx: spread * 46 + (Math.random() * 26 - 13),
      ty: -46 - Math.random() * 42,
      rot: Math.random() * 320 - 160,
      delay: Math.round(Math.random() * 120),
      size: 4 + Math.round(Math.random() * 4),
      color: COLORS[i % COLORS.length] ?? COLORS[0]!,
      round: i % 3 === 0,
    });
  }
  return pieces;
}

/**
 * Burst curto de partículas champagne. Renderiza só enquanto anima e some do
 * DOM em seguida. Deve ficar dentro de um contêiner `relative`.
 */
export function ConfettiBurst({
  active,
  intensity = "medium",
  className,
}: {
  active: boolean;
  intensity?: "soft" | "medium";
  className?: string;
}) {
  const [live, setLive] = useState(false);
  const reduced = useMemo(() => (active ? prefersReducedMotion() : false), [active]);
  const pieces = useMemo(() => (live && !reduced ? build(intensity === "soft" ? 10 : 16) : []), [live, reduced, intensity]);

  useEffect(() => {
    if (!active) return;
    setLive(true);
    const t = setTimeout(() => setLive(false), CELEBRATION.confetti + 200);
    return () => clearTimeout(t);
  }, [active]);

  if (!live) return null;

  // Movimento reduzido: brilho champagne no lugar das partículas.
  if (reduced) {
    return <span aria-hidden className={cn("celebrate-glow pointer-events-none absolute inset-0", className)} />;
  }

  return (
    <span aria-hidden className={cn("confetti-layer pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={
            {
              left: `${p.x}%`,
              width: `${p.size}px`,
              height: `${p.round ? p.size : p.size * 1.8}px`,
              background: p.color,
              borderRadius: p.round ? "50%" : "1px",
              animationDelay: `${p.delay}ms`,
              "--tx": `${p.tx}px`,
              "--ty": `${p.ty}px`,
              "--rot": `${p.rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}

/** Count-up rápido (400–650ms) para valores de economia/desconto reais. */
export function CountUp({
  value,
  format,
  duration = CELEBRATION.countUp,
  className,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(() => value);
  const from = useRef(value);
  const started = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = started.current ? from.current : 0;
    started.current = true;
    if (start === value) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(start + (value - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={cn("tabular-nums", className)}>{format(shown)}</span>;
}

/** Check comemorativo reutilizável (cupom, promoção, pedido concluído). */
export function SuccessCheck({ className }: { className?: string }) {
  return (
    <span className={cn("celebrate-check grid place-items-center rounded-full", className)}>
      <Check className="check-pop size-3.5" strokeWidth={3} aria-hidden />
    </span>
  );
}

/**
 * Contêiner de celebração: posiciona o burst sobre o conteúdo sem bloquear
 * toques. Use em popup de oferta, card de cupom e cupom aplicado.
 */
export function PromotionCelebration({
  celebrate,
  intensity = "medium",
  className,
  children,
}: {
  celebrate: boolean;
  intensity?: "soft" | "medium";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative", className)}>
      {children}
      <ConfettiBurst active={celebrate} intensity={intensity} />
    </div>
  );
}
