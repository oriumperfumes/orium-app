import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Ordenar" do Catálogo — pílula escura com seta (Figma). Abre um cartão
 * logo abaixo, alinhado à direita, com a opção atual marcada em dourado.
 */
export function SortMenu<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K;
  options: Array<[K, string]>;
  onChange: (k: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const current = options.find(([k]) => k === value)?.[1] ?? options[0]?.[1] ?? "";

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="press inline-flex h-[34px] items-center gap-1.5 rounded-[18px] bg-[#1F1F1F] pr-3 pl-4 text-[13px] font-semibold text-white transition-colors duration-200 hover:bg-[#2A2A2A]"
      >
        <span key={current} className="value-in">{current}</span>
        <ChevronDown
          className={cn("size-3.5 transition-transform duration-300 ease-[var(--ease-orium)]", open && "rotate-180")}
          strokeWidth={2.4}
        />
      </button>

      <div
        role="listbox"
        aria-label="Ordenar por"
        className={cn(
          "sort-menu o-pop absolute top-[calc(100%+8px)] right-0 z-30 w-56 p-1.5",
          open ? "is-open" : "pointer-events-none",
        )}
      >
        {options.map(([k, label]) => {
          const on = k === value;
          return (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={on}
              tabIndex={open ? 0 : -1}
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
              className={cn(
                "flex h-11 w-full items-center justify-between rounded-[14px] px-3.5 text-left text-[14px] transition-colors duration-150",
                on ? "bg-white/[0.06] font-bold text-white" : "font-medium text-[#CFCFCF] hover:bg-white/[0.04]",
              )}
            >
              {label}
              {on ? <Check className="size-4 text-[#FFD599]" strokeWidth={2.6} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
