/**
 * Aviso da Orium — o mesmo desenho para todos os pop-ups que sobem do rodapé
 * (salvar escolhas, nova versão, mensagens da equipe).
 *
 * - Celular: cartão acima da barra inferior, com alça para arrastar e fechar.
 * - Computador: cartão no canto inferior esquerdo, sem cobrir o conteúdo.
 * - Entra subindo com mola curta; ao fechar, desce pelo mesmo caminho.
 * - Fundo sólido (sem desfoque) e sem brilho: só tipografia, foto e dourado.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss";
import { cn } from "@/lib/utils";
import { useAppReady } from "@/lib/splash-state";

export type PopAction = { label: ReactNode; onClick: () => void; disabled?: boolean };

export function PopCard({
  media,
  eyebrow,
  title,
  text,
  primary,
  secondary,
  onDismiss,
  dismissLabel = "Fechar",
  children,
  role = "dialog",
  className,
  z = 45,
  mediaTop = false,
}: {
  /** Fotos dos produtos, símbolo… fica à esquerda do texto. */
  media?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  primary?: PopAction;
  secondary?: PopAction;
  /** Fechar (✕, arrastar para baixo ou ação secundária que só dispensa). */
  onDismiss: () => void;
  dismissLabel?: string;
  /** Conteúdo extra entre o texto e os botões (cupom, por exemplo). */
  children?: ReactNode;
  role?: "dialog" | "status";
  className?: string;
  z?: number;
  /** Fotos em fileira acima do texto (o texto ganha a largura toda). */
  mediaTop?: boolean;
}) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const leave = (after?: () => void) => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    window.setTimeout(() => (after ?? onDismiss)(), 260);
  };
  // arrastou para baixo: o próprio gesto já tirou o cartão da tela
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const swipe = useSwipeDismiss<HTMLDivElement>(() => {
    done.current = true;
    onDismiss();
  }, "down");
  // Reabre o "pode fechar" a cada montagem: o React (modo de teste) monta, desmonta e
  // monta de novo o mesmo componente, e o valor travado em `true` fazia o ✕ não responder.
  useEffect(() => {
    done.current = false;
    return () => void (done.current = true);
  }, []);
  // a abertura do app é limpa: o aviso só entra depois dela
  const ready = useAppReady();
  const cardEl = useRef<HTMLDivElement | null>(null);
  const setCard = useCallback(
    (el: HTMLDivElement | null) => {
      cardEl.current = el;
      swipe(el);
    },
    [swipe],
  );
  // Tocar fora do cartão também fecha (só nos avisos que pedem uma decisão).
  useEffect(() => {
    if (!ready || role !== "dialog") return;
    let on = false;
    const armed = window.setTimeout(() => (on = true), 450);
    const away = (e: PointerEvent) => {
      if (!on) return;
      const t = e.target as Node | null;
      if (!t || cardEl.current?.contains(t)) return;
      leaveRef.current();
    };
    document.addEventListener("pointerdown", away, true);
    return () => {
      window.clearTimeout(armed);
      document.removeEventListener("pointerdown", away, true);
    };
  }, [ready, role]);
  if (!ready) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center px-3 pb-[calc(5.75rem+env(safe-area-inset-bottom))] lg:justify-start lg:px-6 lg:pb-6"
      style={{ zIndex: z }}
    >
      <div
        ref={setCard}
        role={role}
        aria-live={role === "status" ? "polite" : undefined}
        className={cn("pop-card pointer-events-auto w-full max-w-[420px] lg:max-w-[400px]", leaving ? "is-out" : "is-in", className)}
      >
        <span aria-hidden className="pop-grip lg:hidden" />
        {media && mediaTop ? (
          <div className="pop-step mb-3 pt-1" style={{ "--pd": "40ms" } as React.CSSProperties}>
            {media}
          </div>
        ) : null}
        <div className="flex items-start gap-3.5">
          {media && !mediaTop ? <div className="pop-step shrink-0" style={{ "--pd": "40ms" } as React.CSSProperties}>{media}</div> : null}
          <div className="min-w-0 flex-1 pt-0.5">
            {eyebrow ? (
              <p className="pop-step text-[12px] font-semibold text-[#FFD599]" style={{ "--pd": "70ms" } as React.CSSProperties}>
                {eyebrow}
              </p>
            ) : null}
            <p
              className="pop-step mt-0.5 pr-6 text-[17px] leading-[1.22] font-bold tracking-[-0.015em] text-white text-balance"
              style={{ "--pd": "100ms" } as React.CSSProperties}
            >
              {title}
            </p>
            {text ? (
              <p className="pop-step mt-1 text-[13.5px] leading-snug text-[#A9A9A9]" style={{ "--pd": "130ms" } as React.CSSProperties}>
                {text}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={dismissLabel}
            onClick={() => leave()}
            className={cn("pop-close press -mt-1 -mr-1.5", media && mediaTop && "absolute top-4 right-4 mt-0 mr-0")}
          >
            <X className="size-[15px]" strokeWidth={2.4} />
          </button>
        </div>
        {children ? (
          <div className="pop-step mt-3" style={{ "--pd": "160ms" } as React.CSSProperties}>
            {children}
          </div>
        ) : null}
        {primary || secondary ? (
          <div className="pop-step mt-4 flex items-center gap-2" style={{ "--pd": "190ms" } as React.CSSProperties}>
            {primary ? (
              <button
                type="button"
                disabled={primary.disabled}
                onClick={() => leave(primary.onClick)}
                className="press flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#FFD599] px-5 text-[15px] font-bold text-[#15130F] transition-[background-color,opacity] duration-200 hover:bg-[#FFDDAA] disabled:opacity-50"
              >
                {primary.label}
              </button>
            ) : null}
            {secondary ? (
              <button
                type="button"
                disabled={secondary.disabled}
                onClick={() => leave(secondary.onClick)}
                className="press h-12 shrink-0 rounded-full px-4 text-[14px] font-semibold text-[#A9A9A9] transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                {secondary.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Fotos dos produtos do cliente empilhadas (até 3), num quadro branco cada. */
export function ThumbStack({ images, more = 0 }: { images: string[]; more?: number }) {
  if (!images.length) return null;
  const shown = images.slice(0, 3);
  const step = 40;
  const tilt = shown.length === 1 ? [0] : shown.length === 2 ? [-4, 4] : [-6, 0, 6];
  return (
    <div className="relative h-[64px]" style={{ width: 56 + (shown.length - 1) * step + (more > 0 ? 30 : 0) }}>
      {shown.map((src, i) => (
        <span
          key={src + i}
          className="pop-thumb absolute grid size-[56px] place-items-center overflow-hidden rounded-[16px] bg-white shadow-[0_8px_18px_-8px_rgba(0,0,0,0.7)] ring-[3px] ring-[#161616]"
          style={{ left: i * step, top: 4, zIndex: 10 + i, "--ti": i, rotate: `${tilt[i]}deg` } as React.CSSProperties}
        >
          <img src={src} alt="" className="size-full object-contain p-1" loading="lazy" decoding="async" />
        </span>
      ))}
      {more > 0 ? (
        <span
          className="pop-thumb absolute grid h-[30px] min-w-[38px] place-items-center rounded-full bg-[#2A2A2A] px-2 text-[12.5px] font-bold text-white ring-[3px] ring-[#161616]"
          style={{ left: (shown.length - 1) * step + 44, top: 17, zIndex: 20, "--ti": shown.length } as React.CSSProperties}
        >
          +{more}
        </span>
      ) : null}
    </div>
  );
}

/** Quadro do símbolo/ícone quando não há foto de produto. */
export function PopIcon({ children }: { children: ReactNode }) {
  return <span className="grid size-[52px] place-items-center rounded-[16px] bg-[#232323] text-[#FFD599]">{children}</span>;
}
