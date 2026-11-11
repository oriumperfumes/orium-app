import { ChevronRight } from "lucide-react";
import { useRevealOnce } from "@/components/orium/Reveal";
import { cn } from "@/lib/utils";

export type HomeBrand = { key: string; label: string; count: number };

/**
 * "As marcas que você procura." — as seis marcas com mais perfumes no
 * catálogo, contadas a partir dos próprios produtos (nada fixo no código).
 */
export function HomeBrands({
  brands,
  onPick,
  onSeeAll,
}: {
  brands: HomeBrand[];
  onPick: (brand: string) => void;
  onSeeAll: () => void;
}) {
  const { ref, seen } = useRevealOnce<HTMLElement>();
  const top = [...brands].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")).slice(0, 6);
  if (top.length < 4) return null;

  return (
    <section
      ref={ref}
      aria-label="Marcas"
      className={cn("mt-12 tab:mt-14", seen ? "home-cards-in" : "home-cards-pre")}
    >
      <h2 className="home-title max-w-[9.5em]">As marcas que você procura.</h2>
      <div className="mt-5 grid grid-cols-2 gap-2.5 tab:grid-cols-3 tab:gap-3">
        {top.map((b, i) => (
          <button
            key={b.key}
            type="button"
            onClick={() => onPick(b.key)}
            style={{ "--card-d": `${i * 45}ms` } as React.CSSProperties}
            className="home-card press flex min-h-[74px] flex-col justify-center gap-1 rounded-[18px] bg-white px-4 py-4 text-left text-[#15130F]"
          >
            <span className="line-clamp-2 text-[17px] leading-tight font-bold tracking-[-0.01em]">{b.label}</span>
            <span className="text-[13px] text-[#6B655D] tabular-nums">
              {b.count} {b.count === 1 ? "perfume" : "perfumes"}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onSeeAll}
        className="press group mt-4 inline-flex h-11 items-center gap-1 rounded-full bg-[#1F1F1F] pr-3.5 pl-5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[#2A2A2A]"
      >
        Ver todas as marcas
        <ChevronRight
          className="size-4 transition-transform duration-300 ease-[var(--ease-orium)] group-hover:translate-x-0.5"
          strokeWidth={2.4}
          aria-hidden
        />
      </button>
    </section>
  );
}
