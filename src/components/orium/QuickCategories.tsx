import { Flame, Mars, Venus, VenusAndMars, Droplets, SprayCan, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Atalhos circulares logo abaixo do hero: os caminhos que o cliente realmente
 * usa (mais procurados, gêneros, decants e corporais). Todos apontam para
 * filtros e visões que já existem — nenhuma tela nova, nenhum dado inventado.
 */
export type QuickItem = {
  key: string;
  label: string;
  icon: "top" | "male" | "female" | "unisex" | "decant" | "splash" | "body";
  active: boolean;
  onSelect: () => void;
};

const ICONS = {
  top: Flame,
  male: Mars,
  female: Venus,
  unisex: VenusAndMars,
  decant: Droplets,
  splash: SprayCan,
  body: Layers,
} as const;

export function QuickCategories({ items }: { items: QuickItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Atalhos do catálogo" className="mt-4">
      <ul className="page-bleed scrollbar-none flex gap-3 overflow-x-auto pb-0.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li key={item.key} className="shrink-0">
              <button
                type="button"
                onClick={item.onSelect}
                aria-pressed={item.active}
                className="press group flex w-[68px] flex-col items-center gap-1.5"
              >
                <span
                  className={cn(
                    "grid size-14 place-items-center rounded-full border transition-colors duration-200",
                    item.active
                      ? "border-gold bg-gold text-gold-foreground shadow-soft"
                      : "border-border/70 bg-surface-3 text-foreground/85",
                  )}
                >
                  <Icon className="size-5" strokeWidth={1.7} />
                </span>
                {/* duas linhas reservadas: os círculos ficam sempre na mesma linha de base */}
                <span
                  className={cn(
                    "line-clamp-2 flex h-7 w-full items-start justify-center text-center text-[11px] leading-[1.25]",
                    item.active ? "font-semibold text-gold" : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
