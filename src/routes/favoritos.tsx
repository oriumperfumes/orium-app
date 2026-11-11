import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Check, Heart } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/orium/SiteHeader";
import { SiteFooter } from "@/components/orium/SiteFooter";
import { ProductCard, ProductCardSkeleton, ProductImage, type CatalogProduct } from "@/components/orium/ProductCard";
import { lazyUI, MountWhen } from "@/lib/lazy-ui";

import { useFavorites } from "@/lib/favorites";
import { useCart } from "@/lib/cart";
import { flyToCart } from "@/lib/fly-to-cart";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { usePromotions } from "@/lib/use-promotions";
import { priceUnit } from "@/lib/promotions";
import { canDecant, decantPrice, trackDecant, type DecantMl } from "@/lib/decants";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

const BuySheet = lazyUI(() => import("@/components/orium/BuySheet").then((m) => ({ default: m.BuySheet })));

export const Route = createFileRoute("/favoritos")({
  head: () => ({
    meta: [
      { title: "Meus favoritos — Orium Perfumes" },
      { name: "description", content: "Os perfumes que você salvou para experimentar depois." },
      { property: "og:title", content: "Meus favoritos — Orium Perfumes" },
      { property: "og:description", content: "Sua lista de perfumes salvos na Orium." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FavoritesPage,
});

const COLUMNS =
  "id, slug, canonical_name, brand, concentration, volume_ml, image_url, in_stock, stock_quantity, retail_price, wholesale_price, gender_norm, product_type, sale_mode, full_bottle_available, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml";

/**
 * Favoritos — os mesmos cards do catálogo (o "Adicionar" abre a mesma folha
 * de compra, decant primeiro) e, no topo, o kit para provar todos de uma vez.
 */
function FavoritesPage() {
  const router = useRouter();
  const { entries, ready, count } = useFavorites();
  const [buy, setBuy] = useState<CatalogProduct | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const ids = entries.map((e) => e.productId);

  const { data, isLoading } = useQuery({
    queryKey: ["favorite-products", ids.join(",")],
    enabled: ready && ids.length > 0,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("products")
        .select(COLUMNS)
        .in("id", ids)
        .eq("active", true)
        .eq("catalog_eligible", true);
      const order = new Map(ids.map((id, i) => [id, i]));
      return (rows ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) as CatalogProduct[];
    },
  });

  // tirou o coração aqui: o card sai na hora, sem esperar o banco
  const products = (data ?? []).filter((p) => ids.includes(p.id));
  const goBack = () => {
    if (window.history.length > 1) router.history.back();
    else void router.navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-[#101010] text-white">
      <SiteHeader onBack={goBack} backLabel="Voltar" />
      <main className="shell pt-4 pb-10 lg:pt-10 lg:pb-24">
        <h1 className="text-[40px] leading-[1.15] font-bold tracking-[-0.035em] tab:text-[48px]">Favoritos</h1>
        {count > 0 ? (
          <p className="mt-1 text-[16px] text-[#A9A9A9]">
            {count === 1 ? "1 perfume salvo" : `${count} perfumes salvos`}
          </p>
        ) : null}

        {ready && count === 0 ? <EmptyFavorites /> : null}

        {isLoading && products.length === 0 ? (
          <div className="mt-7 product-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : null}

        {products.length > 0 ? (
          <>
            <TasteKit products={products} />
            <div className="mt-8 product-grid">
              {products.map((p, i) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  index={i}
                  onChoose={(x) => {
                    setBuy(x);
                    setBuyOpen(true);
                  }}
                />
              ))}
            </div>
          </>
        ) : null}
      </main>
      <SiteFooter />
      <MountWhen when={buyOpen}>
        <BuySheet product={buy} open={buyOpen} onOpenChange={setBuyOpen} />
      </MountWhen>
    </div>
  );
}

/**
 * "Prove todos": um decant de cada favorito numa tacada só — o caminho mais
 * curto entre "gostei" e "quero", sem comprometer com o frasco.
 */
function TasteKit({ products }: { products: CatalogProduct[] }) {
  const cart = useCart();
  const settings = useDecantSettings();
  const promotions = usePromotions();
  const [ml, setMl] = useState<DecantMl>(2);
  const [added, setAdded] = useState(false);

  const items = useMemo(() => products.filter((p) => canDecant(p)), [products]);
  const lines = items.map((p) => {
    const base = decantPrice(p, settings, ml);
    const final = priceUnit(base, promotions, { productId: p.id, variant: "DECANT", decantMl: ml }).finalPrice;
    return { p, base, final };
  });
  const total = lines.reduce((sum, l) => sum + l.final, 0);
  const allIn = lines.length > 0 && lines.every((l) => cart.quantityOf(l.p.id, "DECANT", ml) > 0);

  if (items.length < 2) return null;

  const addAll = () => {
    cart.addMany(
      lines.map(({ p, base }) => ({
        item: {
          productId: p.id,
          variant: "DECANT" as const,
          decantMl: ml,
          slug: p.slug,
          name: p.canonical_name,
          brand: p.brand,
          image: p.image_url,
          volumeMl: ml,
          concentration: p.concentration,
          retailPrice: base,
          wholesalePrice: base,
        },
        quantity: 1,
      })),
    );
    for (const { p, base } of lines) {
      trackDecant("decant_added", { productId: p.id, variant: `DECANT_${ml}`, details: { price: base, from: "favorites_kit" } });
    }
    setAdded(true);
    flyToCart(null, items[0]?.image_url);
    toast.success("Kit na sacola", {
      description: `${items.length} decants de ${ml} ml`,
      duration: 1800,
      action: { label: "Ver sacola", onClick: () => cart.setOpen(true) },
    });
    window.setTimeout(() => setAdded(false), 1800);
  };

  const shown = items.slice(0, 4);
  const more = items.length - shown.length;

  return (
    <section className="acc-card mt-6 rounded-[28px] bg-[#1A1A1A] p-5 tab:max-w-[560px] tab:p-6">
      <div className="flex items-center">
        {shown.map((p, i) => (
          <span
            key={p.id}
            className="relative block size-[54px] shrink-0 overflow-hidden rounded-[16px] bg-white ring-[3px] ring-[#1A1A1A]"
            style={{ marginLeft: i ? -12 : 0, zIndex: shown.length - i }}
          >
            <ProductImage product={p} />
          </span>
        ))}
        {more > 0 ? (
          <span
            className="relative grid size-[54px] shrink-0 place-items-center rounded-[16px] bg-[#2A2A2A] text-[15px] font-bold ring-[3px] ring-[#1A1A1A]"
            style={{ marginLeft: -12 }}
          >
            +{more}
          </span>
        ) : null}
      </div>

      <h2 className="mt-4 text-[22px] leading-tight font-bold tracking-[-0.02em]">Prove todos antes de escolher</h2>
      <p className="mt-1 text-[15px] leading-snug text-[#A9A9A9]">
        Um decant de cada favorito. Use alguns dias e só depois decida qual frasco levar.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Tamanho do decant" className="flex rounded-full bg-[#101010] p-1">
          {([2, 5] as DecantMl[]).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={ml === v}
              onClick={() => setMl(v)}
              className={cn(
                "press h-9 rounded-full px-4 text-[14px] font-bold transition-colors duration-200",
                ml === v ? "bg-white text-[#15130F]" : "text-[#A9A9A9]",
              )}
            >
              {v} ml
            </button>
          ))}
        </div>
        <span className="text-right">
          <span className="block text-[12px] text-[#8C8C8C]">{items.length} decants</span>
          <span key={`${ml}-${total}`} className="value-in block text-[20px] font-bold tabular-nums">
            {brl(total)}
          </span>
        </span>
      </div>

      <button
        type="button"
        onClick={addAll}
        className={cn(
          "press mt-4 flex h-[54px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-bold transition-colors duration-200",
          allIn && !added ? "bg-[#1F1F1F] text-white" : "bg-[#FFD599] text-[#15130F]",
        )}
      >
        {added ? (
          <span className="check-pop inline-flex items-center gap-2">
            <Check className="size-5" strokeWidth={2.6} /> Adicionado
          </span>
        ) : allIn ? (
          "Já está na sacola · adicionar de novo"
        ) : (
          "Adicionar kit à sacola"
        )}
      </button>
      {products.length > items.length ? (
        <p className="mt-3 text-center text-[12px] text-[#8C8C8C]">
          {products.length - items.length === 1
            ? "1 favorito não tem decant e ficou de fora."
            : `${products.length - items.length} favoritos não têm decant e ficaram de fora.`}
        </p>
      ) : null}
    </section>
  );
}

function EmptyFavorites() {
  return (
    <div className="mt-10 rounded-[28px] bg-[#1A1A1A] px-6 py-12 text-center tab:mx-auto tab:max-w-[560px]">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-[#101010]">
        <Heart className="size-7 text-[#FFD599]" strokeWidth={1.8} />
      </span>
      <p className="mt-5 text-[20px] font-bold tracking-[-0.02em]">Nada salvo ainda</p>
      <p className="mx-auto mt-2 max-w-[28ch] text-[15px] leading-relaxed text-[#A9A9A9]">
        Toque no coração de um perfume para guardar aqui e decidir com calma.
      </p>
      <Link
        to="/"
        search={{ ver: "catalogo" } as never}
        className="press mt-6 inline-flex h-[52px] items-center justify-center rounded-full bg-[#FFD599] px-7 text-[16px] font-bold text-[#15130F]"
      >
        Explorar perfumes
      </Link>
    </div>
  );
}
