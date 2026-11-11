import { Reveal } from "@/components/orium/Reveal";
import { HCarousel } from "@/components/orium/HCarousel";
import { NegotiationCard } from "@/components/orium/NegotiationRow";
import { useNegotiationItems } from "@/lib/negotiation";

/**
 * "Outros perfumes em negociação" — no fim da ficha de um item negociável.
 *
 * Mesmo carrossel das recomendações do catálogo (snap horizontal, reveal,
 * `hcarousel` para o gesto vertical continuar rolando a página) e o mesmo card
 * já usado na vitrine de Negociação. Só itens públicos da própria área; o item
 * aberto fica fora da lista.
 */
export function OtherNegotiations({ currentId }: { currentId: string }) {
  const { items, isLoading } = useNegotiationItems(24);
  const list = items.filter((i) => i.id !== currentId).slice(0, 12);

  // Sem outros itens não existe seção: nada de título vazio.
  if (isLoading || list.length === 0) return null;

  return (
    <section className="mt-12">
      <Reveal>
        <h2 className="display text-xl leading-tight">Outros perfumes em negociação</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Outras oportunidades deslacradas que você também pode negociar.
        </p>
      </Reveal>

      <HCarousel
        resetKey={list.length}
        className="page-bleed-r mt-4 gap-3 lg:mr-0 lg:grid lg:grid-cols-4 lg:pr-0 lg:[overflow:visible]"
      >
        {list.map((item, i) => (
          <Reveal
            key={item.id}
            delay={60 + i * 40}
            className="flex w-[62%] shrink-0 snap-start tab:w-[38%] md:w-[31%] lg:w-full lg:shrink [&>*]:w-full"
          >
            <NegotiationCard item={item} />
          </Reveal>
        ))}
      </HCarousel>
    </section>
  );
}
