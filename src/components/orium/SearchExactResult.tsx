import { Sparkles } from "lucide-react";
import { ProductCard, ProductCardSkeleton, type CatalogProduct } from "@/components/orium/ProductCard";
import type { ExactMatch, SimilarProduct } from "@/lib/search-intent";

type Props = {
  exact: ExactMatch;
  similar: SimilarProduct[];
  similarLoading: boolean;
  minQty: number;
  onChoose: (p: CatalogProduct) => void;
  adminInsight?: ((id: string) => unknown) | undefined;
};

/**
 * Resposta para quando o cliente procurou UM perfume específico:
 * o perfume encontrado em destaque e, abaixo, perfumes com cheiro parecido.
 *
 * A semelhança vem dos dados olfativos reais (acordes, notas, família). Se o
 * perfume procurado estiver indisponível, os parecidos passam a ser a saída —
 * disponíveis primeiro, sem trocar semelhança por estoque.
 */
export function SearchExactResult({
  exact,
  similar,
  similarLoading,
  minQty,
  onChoose,
  adminInsight,
}: Props) {
  const unavailable = !exact.in_stock;

  return (
    <section className="mb-8">
      <p className="mb-2.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {unavailable ? "Você procurou · indisponível agora" : "Você procurou"}
      </p>

      <div className="grid grid-cols-2 items-stretch gap-2.5 sm:gap-4 lg:grid-cols-4">
        <ProductCard
          product={exact}
          index={0}
          minQty={minQty}
          onChoose={onChoose}
          adminInsight={(adminInsight?.(exact.id) ?? null) as never}
        />
      </div>

      {similarLoading ? (
        <div className="mt-8 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : similar.length > 0 ? (
        <div className="mt-8">
          <div className="mb-1 flex items-center gap-1.5">
            <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
            <h2 className="display text-lg leading-tight">Você também pode gostar</h2>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            {unavailable
              ? "Outras fragrâncias selecionadas para você, prontas para enviar."
              : "Outras fragrâncias que podem combinar com o que você procura."}
          </p>
          <div className="list-swap grid grid-cols-2 items-stretch gap-2.5 sm:gap-4 lg:grid-cols-4">
            {similar.map((p, i) => (
              <ProductCard
                key={p.id}
                product={p}
                index={i % 8}
                minQty={minQty}
                onChoose={onChoose}
                adminInsight={(adminInsight?.(p.id) ?? null) as never}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
