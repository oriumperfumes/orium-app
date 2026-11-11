import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { rememberProductPreview, warmProductImage } from "@/lib/product-preview";
import { useSearchUI } from "./search-context";

/**
 * BARRA DE PESQUISA — a mesma nos dois lugares (no fluxo da Home e encaixada no
 * topo ao rolar). Quem está visível registra a âncora do painel, então o painel
 * sempre aparece colado na barra que o cliente está vendo.
 */
export function SearchBar({
  compact,
  active,
  activeFilters,
  onOpenFilters,
}: {
  compact: boolean;
  active: boolean;
  activeFilters: number;
  onOpenFilters: () => void;
}) {
  const s = useSearchUI();
  const navigate = useNavigate();
  const field = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (active) s.registerAnchor(field.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, compact]);

  return (
    <form
      role="search"
      className="flex items-center gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        s.submit(s.term);
      }}
    >
      <div ref={field} className="relative min-w-0 flex-1">
        <Search
          className={cn(
            "pointer-events-none absolute top-1/2 z-10 size-[18px] -translate-y-1/2",
            compact ? "left-3.5 text-[oklch(0.97_0.008_88/0.8)]" : "left-4 text-[oklch(0.97_0.008_88/0.8)]",
          )}
        />
        <input
          ref={input}
          value={s.term}
          onChange={(e) => {
            s.setTerm(e.target.value);
            s.setOpen(true);
          }}
          onFocus={() => s.setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              s.setOpen(true);
              s.move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              s.move(-1);
            } else if (e.key === "Escape") {
              s.close();
            } else if (e.key === "Enter" && s.activeIndex >= 0) {
              const p = s.results[s.activeIndex];
              if (p) {
                e.preventDefault();
                rememberProductPreview(p as unknown as { slug: string } & Record<string, unknown>);
                warmProductImage(p.image_url);
                s.rememberSearch(s.term);
                s.keepQuery(s.term);
                s.close();
                void navigate({ to: "/perfume/$slug", params: { slug: p.slug } });
              }
            }
          }}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          role="combobox"
          aria-expanded={s.open}
          aria-controls="orium-search-results"
          aria-autocomplete="list"
          {...(s.activeIndex >= 0 ? { "aria-activedescendant": `orium-search-opt-${s.activeIndex}` } : {})}
          aria-label="Qual perfume você procura?"
          placeholder="Encontre seu perfume"
          className={cn(
            "r-btn w-full min-w-0 border pr-11 pl-11 text-base outline-none transition-[background-color,border-color,box-shadow] duration-[var(--t-micro)] focus:border-gold/55 focus:shadow-soft",
            compact
              ? "glass-dark h-11 text-[oklch(0.97_0.008_88)] [--glass-a:0.5] placeholder:text-[oklch(0.97_0.008_88/0.6)]"
              : "glass-dark h-13 text-[oklch(0.97_0.008_88)] [--glass-a:0.3] placeholder:text-[oklch(0.97_0.008_88/0.6)] focus:[--glass-a:0.72]",
          )}
        />
        {s.term ? (
          <button
            type="button"
            onClick={() => {
              s.clear();
              input.current?.focus();
            }}
            aria-label="Apagar busca"
            className={cn(
              "press absolute top-1/2 right-1.5 grid -translate-y-1/2 place-items-center rounded-full text-muted-foreground",
              compact ? "size-9" : "size-10",
            )}
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => {
          // o sheet de filtros assume a tela; a busca digitada continua
          s.close();
          onOpenFilters();
        }}
        aria-label="Abrir filtros"
        className={cn(
          "press r-btn relative grid shrink-0 place-items-center border transition-colors duration-[var(--t-micro)]",
          compact ? "size-11" : "size-13",
          activeFilters > 0
            ? "border-gold/60 bg-gold/15 text-gold"
            : compact
              ? "glass-dark text-[oklch(0.97_0.008_88)] [--glass-a:0.5]"
              : "glass-dark text-[oklch(0.97_0.008_88)] [--glass-a:0.3]",
        )}
      >
        <SlidersHorizontal className="size-[18px]" />
        {activeFilters > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-gold text-[10px] font-bold text-gold-foreground">
            {activeFilters}
          </span>
        )}
      </button>
    </form>
  );
}
