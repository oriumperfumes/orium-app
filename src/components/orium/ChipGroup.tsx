import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Chips separados da Orium — filtros rápidos, períodos, status.
 *
 * Cada chip é um botão independente que anima o seu próprio estado:
 * press (scale curto), fundo, cor do texto. Nada é medido em JavaScript,
 * então a resposta ao toque é imediata e a animação roda a 60 FPS.
 */

export type ChipOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
};

export function ChipGroup<T extends string | number>({
  value,
  onChange,
  options,
  label,
  wrap,
  className,
  chipClassName,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<ChipOption<T>>;
  label?: string;
  /** quebra em várias linhas em vez de rolar na horizontal */
  wrap?: boolean;
  className?: string;
  chipClassName?: string;

}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "chip-row flex max-w-full min-w-0 items-center gap-2",
        // sem wrap a linha rola dentro do próprio componente — nunca empurra a página
        wrap ? "flex-wrap" : "scrollbar-none overflow-x-auto",
        className,
      )}

    >

      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={opt.ariaLabel}
            data-on={on ? "" : undefined}
            onClick={() => {
              if (!on) onChange(opt.value);
            }}
            className={cn(
              "chip inline-flex min-h-9 shrink-0 items-center justify-center rounded-full px-4 text-[13px] whitespace-nowrap",
              on
                ? "bg-gold font-semibold text-gold-foreground"
                : "bg-surface-3 text-muted-foreground",
              chipClassName,
            )}

          >
            <span className="chip-label">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
