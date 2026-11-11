import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ProductCard, ProductCardSkeleton, type CatalogProduct } from "@/components/orium/ProductCard";
import { lazyUI, MountWhen } from "@/lib/lazy-ui";

import { Reveal } from "@/components/orium/Reveal";
import { HCarousel } from "@/components/orium/HCarousel";
import { useOlfactorySimilar } from "@/lib/search-intent";
import { useGlobalDecantSize } from "@/lib/decant-size";
import { canDecant } from "@/lib/decants";

const BuySheet = lazyUI(() => import("@/components/orium/BuySheet").then((m) => ({ default: m.BuySheet })));

/**
 * "Perfumes parecidos que você pode gostar" — mesma inteligência olfativa da
 * busca (acordes, notas com posição na pirâmide e família olfativa).
 *
 * A aba aberta (Decant ou Frasco) NÃO muda o critério de semelhança: muda só
 * como o parecido é apresentado e comprado, e dá prioridade a quem está
 * disponível naquela forma.
 */
export function SimilarPerfumes({
  productId,
  brand,
  type,
  minQty,
  decantMode,
}: {
  productId: string;
  brand: string | null;
  type: string | null;
  minQty: number;
  /** Aba aberta na página: Decant (true) ou Frasco (false). */
  decantMode: boolean;
}) {
  const size = useGlobalDecantSize();
  const { items, isLoading } = useOlfactorySimilar(productId, 12);

  /** Sem dados olfativos suficientes o banco não devolve nada — aí, e só aí, cai no fallback. */
  const needsFallback = !isLoading && items.length < 4;
  const { data: fallback } = useQuery({
    queryKey: ["similar-fallback", productId, brand, type],
    enabled: needsFallback,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const base = () =>
        supabase
          .from("products")
          .select(
            "id, slug, canonical_name, brand, concentration, volume_ml, image_url, in_stock, stock_quantity, retail_price, wholesale_price, product_type, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml",
          )
          .eq("active", true)
          .eq("catalog_eligible", true)
          .eq("in_stock", true)
          .neq("id", productId)
          .limit(8);
      const sameType = type ? ((await base().eq("product_type", type)).data ?? []) : [];
      const sameBrand = brand ? ((await base().eq("brand", brand)).data ?? []) : [];
      const seen = new Set<string>();
      return [...sameBrand, ...sameType].filter((p) => (seen.has(p.id) ? false : seen.add(p.id)));
    },
  });

  const list = useMemo(() => {
    const source: CatalogProduct[] = needsFallback
      ? ([...(items as CatalogProduct[]), ...((fallback ?? []) as CatalogProduct[])] as CatalogProduct[])
      : (items as CatalogProduct[]);

    // Um perfume por identidade canônica: MRX e Smart Mania do mesmo perfume
    // nunca aparecem lado a lado.
    const seen = new Set<string>();
    const unique = source.filter((p) => {
      if (p.id === productId) return false;
      const key = `${(p.brand ?? "").trim().toLowerCase()}|${p.canonical_name.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // A ordem de semelhança é preservada; a aba só promove quem está
    // realmente disponível na forma escolhida.
    const fits = (p: CatalogProduct) => (decantMode ? canDecant(p) && p.in_stock : p.in_stock);
    return [...unique.filter(fits), ...unique.filter((p) => !fits(p))].slice(0, 8);
  }, [items, fallback, needsFallback, productId, decantMode]);

  const [buy, setBuy] = useState<CatalogProduct | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);

  if (isLoading) {
    return (
      <section className="mt-12">
        <div className="h-6 w-56 skeleton rounded-full" />
        <div className="mt-4 product-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </section>
    );
  }

  if (list.length === 0) return null;

  return (
    <section className="mt-12">
      <Reveal>
        <h2 className="text-[20px] leading-tight font-bold tracking-[-0.02em] text-white lg:text-[28px]">Você também pode gostar</h2>
      </Reveal>

      {/* mobile: carrossel horizontal com snap; desktop: grid.
          `hcarousel` garante movimento só na horizontal: gesto vertical rola a página. */}
      <HCarousel
        resetKey={list.length}
        className="page-bleed-r mt-4 gap-[18px] lg:mr-0 lg:grid lg:grid-cols-4 lg:gap-x-6 lg:gap-y-11 lg:pr-0 lg:[overflow:visible] lg:[&>*:nth-child(n+5)]:hidden wide:grid-cols-5 wide:[&>*:nth-child(5)]:flex"
      >
        {list.map((p, i) => (
          <Reveal
            key={p.id}
            delay={60 + i * 40}
            className="flex w-[46%] max-w-[200px] shrink-0 snap-start tab:w-[30%] tab:max-w-none md:w-[23%] lg:w-full lg:shrink [&>*]:w-full"
          >
            <ProductCard
              product={p}
              index={i}
              minQty={minQty}
              viewOverride={decantMode ? size : "frasco"}
              onChoose={(prod) => {
                setBuy(prod);
                setBuyOpen(true);
              }}
            />
          </Reveal>
        ))}
      </HCarousel>

      <MountWhen when={buyOpen}>
        <BuySheet product={buy} open={buyOpen} onOpenChange={setBuyOpen} />
      </MountWhen>
    </section>
  );
}
