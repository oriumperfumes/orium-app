/**
 * ESQUENTA BLACK — vitrine da Home.
 *
 * Só aparece enquanto existir promoção Black em vigor (nome com "Black" no
 * Admin). Mostra o maior desconto real, a contagem até o fim real da campanha
 * e os próprios perfumes em oferta, com escassez real de estoque.
 * Promoção do catálogo inteiro usa os mais vendidos como vitrine.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePromotions } from "@/lib/use-promotions";
import { blackEndsAt, blackMaxPercent, runningBlack } from "@/lib/black";
import { useTopSold } from "@/lib/product-views";
import { isOnRequest, useConsultIds } from "@/lib/price-on-request";
import { ProductCard, ProductCardSkeleton, type CatalogProduct } from "@/components/orium/ProductCard";
import { BlackCountdown, BlackTag } from "@/components/orium/black/Black";

const COLUMNS =
  "id, slug, canonical_name, brand, gender_norm, concentration, volume_ml, image_url, product_type, in_stock, stock_quantity, sale_mode, full_bottle_available, retail_price, wholesale_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, price_on_request";

const MARQUEE = (pct: number) =>
  ["Black November", pct > 0 ? `Até ${pct}% OFF` : "Ofertas reais", "Esquenta Black", "Perfumes árabes originais", "Enquanto durar o estoque"];

export function BlackShowcase({
  onChoose,
  onExplore,
}: {
  onChoose?: (p: CatalogProduct) => void;
  onExplore?: () => void;
}) {
  const promotions = usePromotions();
  const black = useMemo(() => runningBlack(promotions), [promotions]);
  const wholeCatalog = black.some((p) => (p.product_ids ?? []).length === 0);
  const picked = useMemo(
    () => [...new Set(black.flatMap((p) => p.product_ids ?? []))].slice(0, 24),
    [black],
  );
  const top = useTopSold(30, 12);
  const ids = wholeCatalog ? top.items.map((t) => t.id) : picked;
  const consultIds = useConsultIds();

  const { data, isLoading } = useQuery({
    queryKey: ["black-showcase", ids.join(",")],
    enabled: black.length > 0 && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("products")
        .select(COLUMNS)
        .in("id", ids)
        .eq("active", true);
      if (error) throw error;
      const order = new Map(ids.map((id, i) => [id, i]));
      return ((rows ?? []) as unknown as CatalogProduct[]).sort(
        (a, b) => Number(b.in_stock) - Number(a.in_stock) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      );
    },
  });

  if (black.length === 0) return null;
  const pct = Math.round(blackMaxPercent(black));
  const endsAt = blackEndsAt(black);
  const products = (data ?? []).filter((p) => !isOnRequest(p as never, consultIds));
  const words = MARQUEE(pct);

  return (
    <section aria-label="Esquenta Black" className="black-in relative mx-[calc(-1*var(--page-gutter))] overflow-hidden bg-black tab:mx-0 tab:rounded-[28px] tab:ring-1 tab:ring-white/10">
      {/* letreiro */}
      <div className="overflow-hidden border-b border-white/10 bg-white py-2 text-black" aria-hidden>
        <div className="black-marquee">
          {[0, 1].map((k) => (
            <span key={k} className="flex shrink-0 items-center">
              {[...words, ...words].map((w, i) => (
                <span key={`${k}-${i}`} className="flex items-center px-3 text-[11.5px] font-black tracking-[0.12em] uppercase">
                  {w}
                  <span className="ml-6 inline-block size-1.5 rotate-45 bg-black" />
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <div className="px-5 pt-6 pb-5 tab:px-6 tab:pt-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <BlackTag promotion={black[0]} size="md" />
            <h2 className="black-in mt-3 text-[44px] leading-[0.92] font-black tracking-[-0.045em] text-white uppercase tab:text-[56px]" style={{ "--d": "80ms" } as React.CSSProperties}>
              Esquenta
              <br />
              Black
            </h2>
            {pct > 0 ? (
              <p className="black-in mt-3 text-[16px] font-semibold text-[#CFCFCF]" style={{ "--d": "160ms" } as React.CSSProperties}>
                Até <span className="text-[22px] font-black text-[#FFD599]">{pct}% OFF</span> em perfumes originais
              </p>
            ) : null}
          </div>
          {endsAt ? (
            <BlackCountdown endsAt={endsAt} variant="boxes" label="Termina em" className="black-in" />
          ) : null}
        </div>

        <div className="-mx-5 mt-6 flex snap-x snap-mandatory scroll-px-5 gap-3.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] tab:-mx-6 tab:px-6 [&::-webkit-scrollbar]:hidden">
          {isLoading || (ids.length === 0 && top.isLoading)
            ? Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="w-[46%] shrink-0 snap-start tab:w-[30%] lg:w-[22%]">
                  <ProductCardSkeleton />
                </div>
              ))
            : products.map((p, i) => (
                <div key={p.id} className="w-[46%] shrink-0 snap-start tab:w-[30%] lg:w-[22%]">
                  <ProductCard product={p} index={i} onChoose={onChoose} />
                </div>
              ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
          <p className="text-[12px] leading-snug text-[#8C8C8C]">
            Preço riscado é o preço normal da Orium. Oferta válida enquanto durar o estoque{endsAt ? " ou até o fim da contagem" : ""}.
          </p>
          {onExplore ? (
            <button
              type="button"
              onClick={onExplore}
              className="press h-10 shrink-0 rounded-full bg-white px-4 text-[13.5px] font-bold text-black"
            >
              Ver catálogo
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
