import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Segmented control da Orium — uma única linguagem para todo controle de
 * opções lado a lado (Preços|Promoções|Cupons, Todos|Masculino|…, Decant|Frasco).
 *
 * O pill ativo desliza (transform) em vez de aparecer/desaparecer. O componente
 * nunca é remontado ao trocar de opção: apenas o indicador se move.
 */

export type SegmentOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  /** ícone opcional (lucide) */
  icon?: React.ComponentType<{ className?: string }>;
  ariaLabel?: string;
};

type Size = "compact" | "default" | "admin";

const SIZE: Record<Size, { track: string; item: string; text: string; radius: string; icon: string }> = {
  compact: { track: "p-0.5 rounded-full", item: "min-h-9 px-4", text: "text-[13px]", radius: "rounded-full", icon: "size-3.5" },
  default: { track: "p-1 rounded-full", item: "h-10 px-3", text: "text-[13px] font-medium", radius: "rounded-full", icon: "size-4" },
  admin: { track: "p-1 rounded-2xl", item: "h-11 px-3", text: "text-sm", radius: "rounded-xl", icon: "size-4" },
};

export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  size = "default",
  fill = "equal",
  label,
  asTabs,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<SegmentOption<T>>;
  size?: Size;
  /** equal = colunas iguais · auto = largura pelo conteúdo (linha rolável) */
  fill?: "equal" | "auto";
  label?: string;
  /** semântica de abas (tablist/tab) em vez de radiogroup */
  asTabs?: boolean;
  className?: string;
}) {
  const s = SIZE[size];
  const trackRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<T, HTMLButtonElement>());
  const [pill, setPill] = useState<{ x: number; w: number; h: number; y: number } | null>(null);
  const ready = useRef(false);

  const measure = () => {
    const track = trackRef.current;
    const el = itemRefs.current.get(value);
    if (!track || !el) return;
    setPill({
      x: el.offsetLeft - track.clientLeft,
      y: el.offsetTop - track.clientTop,
      w: el.offsetWidth,
      h: el.offsetHeight,
    });
  };

  useLayoutEffect(() => {
    measure();
    const id = requestAnimationFrame(() => {
      measure();
      ready.current = true;
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(track);
    for (const el of itemRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
    if (next) {
      onChange(next.value);
      itemRefs.current.get(next.value)?.focus();
    }
  };

  return (
    <div
      ref={trackRef}
      role={asTabs ? "tablist" : "radiogroup"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "seg-track relative isolate border border-border/70 bg-surface-3",
        fill === "equal" ? "grid" : "scrollbar-none flex w-max max-w-full gap-0 overflow-x-auto",
        s.track,
        className,
      )}
      style={fill === "equal" ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
    >
      {pill ? (
        <span
          aria-hidden
          className={cn("seg-pill bg-gold", s.radius, ready.current && "seg-pill-move")}
          style={{
            width: pill.w,
            height: pill.h,
            transform: `translate3d(${pill.x}px, ${pill.y}px, 0)`,
          }}
        />
      ) : null}

      {options.map(({ value: v, label: text, icon: Icon, ariaLabel }) => {
        const on = v === value;
        return (
          <button
            key={String(v)}
            ref={(el) => {
              if (el) itemRefs.current.set(v, el);
              else itemRefs.current.delete(v);
            }}
            type="button"
            role={asTabs ? "tab" : "radio"}
            {...(asTabs ? { "aria-selected": on } : { "aria-checked": on })}
            tabIndex={on ? 0 : -1}
            aria-label={ariaLabel}
            data-on={on ? "" : undefined}
            onClick={() => onChange(v)}
            className={cn(
              "seg-item relative z-[1] flex min-w-0 shrink-0 items-center justify-center gap-2 whitespace-nowrap",
              s.item,
              s.text,
              s.radius,
              on ? "text-gold-foreground" : "text-muted-foreground",
            )}
          >
            {Icon ? <Icon className={cn("seg-icon shrink-0", s.icon)} /> : null}
            <span className="truncate">{text}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Conteúdo de um segmented control: faz crossfade curto quando a opção muda.
 * A troca é imediata (nunca espera backend); só a entrada é animada.
 */
export function SegmentedPanel({
  value,
  children,
  className,
}: {
  value: string | number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div key={String(value)} className={cn("seg-panel", className)}>
      {children}
    </div>
  );
}
