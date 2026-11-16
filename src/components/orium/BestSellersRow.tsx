import { useEffect, useRef, useState } from "react";
import { isOnRequest, useConsultIds } from "@/lib/price-on-request";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { brl, productTitle } from "@/lib/format";
import { useTopSold, type TopSoldProduct } from "@/lib/product-views";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { decantPrice, canDecant, canFullBottle } from "@/lib/decants";
import { usePromotions } from "@/lib/use-promotions";
import { priceUnit } from "@/lib/promotions";
import { PromotionBadge } from "@/components/orium/PromotionBadge";
import { ProductImage, type CatalogProduct } from "@/components/orium/ProductCard";
import { useCart } from "@/lib/cart";
import { flyToCart } from "@/lib/fly-to-cart";
import { FavoriteButton } from "@/components/orium/FavoriteButton";
import { cn } from "@/lib/utils";
import { useTapOpen } from "@/hooks/use-tap-open";
import { rememberProductPreview, warmProductImage } from "@/lib/product-preview";
import { HCarousel } from "@/components/orium/HCarousel";

/**
 * "Mais vendidos" — ordem vem exclusivamente de venda real (pedidos
 * confirmados), calculada no banco. Visualização, favorito e clique não
 * entram nesta lista; o ranking de acessos continua vivo só no Admin.
 */
export function BestSellersRow({
  onSeeAll,
  onChoose,
}: {
  onSeeAll?: () => void;
  /** Abre a escolha de decant/frasco (mesmo fluxo do catálogo). */
  onChoose?: (p: CatalogProduct) => void;
}) {
  const { items, isLoading } = useTopSold(30, 12);
  const scroller = useRef<HTMLDivElement | null>(null);
  const section = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const el = section.current;
    if (!el || typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // começo/fim do trilho: as setas do computador apagam quando não há mais para onde ir
  const [edge, setEdge] = useState({ start: true, end: false });
  const step = (el: HTMLElement) => {
    const a = el.children[0] as HTMLElement | undefined;
    const b = el.children[1] as HTMLElement | undefined;
    return a && b ? b.offsetLeft - a.offsetLeft : (a?.offsetWidth ?? 160) + 14;
  };
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setIndex(Math.round(el.scrollLeft / Math.max(1, step(el))));
    const start = el.scrollLeft <= 4;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setEdge((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  };
  useEffect(() => {
    onScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  /** Anda uma "página" de cards inteiros. */
  const nudge = (dir: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    const st = step(el);
    const perPage = Math.max(1, Math.floor((el.clientWidth + 1) / st));
    el.scrollBy({ left: dir * perPage * st, behavior: "smooth" });
  };

  if (isLoading) {
    return (
      <section className="mb-6">
        <div className="skeleton mb-3 h-6 w-44" />
        <div className="page-bleed-r flex gap-2.5 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-[38%] shrink-0 tab:w-[28%] md:w-[23%] lg:w-[19%]">
              <div className="skeleton r-card aspect-[4/5] w-full" />
              <div className="skeleton mt-2 h-3 w-3/4" />
              <div className="skeleton mt-1.5 h-3 w-1/2" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // sem venda real suficiente, nada é inventado: a seção simplesmente não aparece
  if (items.length < 4) return null;

  const dots = Math.min(items.length, 5);
  const activeDot = Math.min(dots - 1, Math.round((index / Math.max(1, items.length - 2)) * (dots - 1)));

  return (
    <section ref={section} aria-label="Mais vendidos" className={cn("mb-6", visible ? "reveal-in" : "reveal-pre")}>
      <h2 className="home-title">Os mais vendidos</h2>
      <div className="mb-5 flex items-end gap-3">
        <p className="home-subtitle min-w-0 flex-1 lg:max-w-none">As fragrâncias mais escolhidas pelos nossos clientes.</p>
        <div className="flex shrink-0 items-center gap-2">
          {onSeeAll ? (
            <button
              type="button"
              onClick={onSeeAll}
              className="press group inline-flex h-10 items-center gap-1 rounded-full bg-[#1F1F1F] pr-3 pl-4 text-[14px] font-semibold text-white transition-colors duration-200 hover:bg-[#2A2A2A] lg:h-11 lg:pr-3.5 lg:pl-5 lg:text-[15px]"
            >
              Ver todos
              <ChevronRight
                className="size-4 transition-transform duration-300 ease-[var(--ease-orium)] group-hover:translate-x-0.5"
                strokeWidth={2.4}
              />
            </button>
          ) : null}
          <div className="hidden items-center gap-2 lg:flex">
            <Arrow label="Anteriores" disabled={edge.start} onClick={() => nudge(-1)}>
              <ChevronLeft className="size-[18px]" strokeWidth={2.4} />
            </Arrow>
            <Arrow label="Próximos" disabled={edge.end} onClick={() => nudge(1)}>
              <ChevronRight className="size-[18px]" strokeWidth={2.4} />
            </Arrow>
          </div>
        </div>
      </div>

      <HCarousel
        ref={scroller}
        resetKey={items.length}
        onScroll={onScroll}
        className="page-bleed-r gap-3.5 lg:gap-6"
      >
        {items.map((p, i) => (
          <div
            key={p.id}
            className="w-[43%] max-w-[190px] shrink-0 snap-start tab:w-[28%] tab:max-w-none md:w-[23%] lg:w-[calc((100%-4*24px)/4.6)] wide:w-[calc((100%-5*24px)/5.7)]"
            style={{ "--d": `${Math.min(i, 6) * 45}ms` } as React.CSSProperties}
          >
            <MiniCard product={p} onChoose={onChoose} />
          </div>
        ))}
      </HCarousel>

      <div className="mt-4 flex items-center justify-center gap-[5px] lg:hidden" aria-hidden>
        {Array.from({ length: dots }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-[var(--motion-standard)] ease-[var(--ease-orium)]",
              i === activeDot ? "w-4 bg-[#D9D9D9]" : "w-1.5 bg-[#8B8B8B]",
            )}
          />
        ))}
      </div>
    </section>
  );
}

function Arrow({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="press grid size-11 place-items-center rounded-full bg-[#1F1F1F] text-white transition-[background-color,opacity] duration-200 hover:bg-[#2A2A2A] disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Card do ranking de vendas — vitrine da Home: foto em fundo branco, preço e "Adicionar". */
function MiniCard({ product, onChoose }: { product: TopSoldProduct; onChoose?: ((p: CatalogProduct) => void) | undefined }) {
  const settings = useDecantSettings();
  const promotions = usePromotions();
  const decantOk = canDecant(product);
  const bottleOk = canFullBottle(product);
  const imgRef = useRef<HTMLDivElement | null>(null);
  const cart = useCart();
  const priced = priceUnit(Number(product.retail_price ?? 0), promotions, {
    productId: product.id,
    variant: "FULL",
  });
  const asCatalog: CatalogProduct = { ...product, stock_quantity: null };

  const tap = useTapOpen({
    onPress: () => {
      rememberProductPreview(product);
      warmProductImage(product.image_url);
    },
  });

  const consult = isOnRequest(product as never, useConsultIds());
  const showBottle = !consult && bottleOk && Number(product.retail_price ?? 0) > 0;
  // sob consulta (o perfume ou a loja inteira): nenhum valor de decant nem botão de compra
  const from = !consult && decantOk && settings !== undefined ? decantPrice(product, settings, 2) : null;
  const onPromo = showBottle && !!priced.promotion && priced.basePrice > priced.finalPrice;

  return (
    <div className="stagger-in flex h-full flex-col" style={{ animationDelay: `var(--d, 0ms)` }}>
      <Link
        to="/perfume/$slug"
        params={{ slug: product.slug }}
        preload="intent"
        {...tap}
        className="tap-card group block flex-1"
      >
        <div ref={imgRef} className="relative aspect-square overflow-hidden rounded-[16px] bg-white">
          <ProductImage product={product} className="transition-transform duration-500 group-hover:scale-[1.04]" />
          <FavoriteButton
            productId={product.id}
            name={product.canonical_name}
            size="sm"
            className="absolute top-2 right-2"
          />
        </div>
        <div className="pt-2.5">
          <p className="truncate text-[11px] font-medium text-[#B1B1B1]">{product.brand ?? "Orium"}</p>
          <p className="line-clamp-2 text-[15px] leading-[1.25] font-semibold tracking-[-0.01em] text-white">
            {productTitle(product.canonical_name)}
          </p>
          {showBottle ? (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
              <span key={priced.finalPrice} className={cn("text-[14px] font-extrabold tabular-nums", onPromo ? "promo-price" : "price-morph")}>
                {brl(priced.finalPrice)}
              </span>
              {onPromo ? (
                <span className="text-[11px] font-bold text-[#A9A9A9] tabular-nums line-through">{brl(priced.basePrice)}</span>
              ) : null}
            </p>
          ) : null}
          {from != null ? (
            <p className="mt-0.5 text-[11px] font-bold whitespace-nowrap text-[#FFD599]">
              {showBottle ? "Decants a partir de " : "Decant 2 ml · "}
              <span className="tabular-nums">{brl(from)}</span>
            </p>
          ) : null}
          {consult ? <p className="mt-1 text-[13px] font-bold text-[#FFD599]">Sob consulta</p> : null}
          {!product.in_stock && !consult ? <p className="mt-0.5 text-[11px] text-muted-foreground">Indisponível</p> : null}
          {onPromo && priced.promotion ? <PromotionBadge promotion={priced.promotion} size="sm" compact className="mt-1" /> : null}
        </div>
      </Link>
      <div className="pt-2.5">
        {!consult && decantOk && onChoose ? (
          <button
            type="button"
            onClick={() => onChoose(asCatalog)}
            className="press inline-flex h-[30px] items-center rounded-full bg-[#FFD599] px-3.5 text-[12.5px] font-bold text-black"
          >
            Adicionar
          </button>
        ) : showBottle && product.in_stock ? (
          <button
            type="button"
            onClick={(e) => {
              cart.add(
                {
                  productId: product.id,
                  variant: "FULL",
                  slug: product.slug,
                  name: product.canonical_name,
                  brand: product.brand,
                  image: product.image_url,
                  volumeMl: product.volume_ml,
                  concentration: product.concentration,
                  retailPrice: Number(product.retail_price ?? 0),
                  wholesalePrice: Number(product.wholesale_price ?? 0),
                },
                1,
              );
              flyToCart(imgRef.current ?? e.currentTarget, product.image_url);
            }}
            className="press inline-flex h-[30px] items-center rounded-full bg-[#FFD599] px-3.5 text-[12.5px] font-bold text-black"
          >
            Adicionar
          </button>
        ) : (
          <Link
            to="/perfume/$slug"
            params={{ slug: product.slug }}
            className="press inline-flex h-[30px] items-center rounded-full border border-[#FFD599]/40 px-3.5 text-[12.5px] font-bold text-[#FFD599]"
          >
            {asCatalog.product_type === "PERFUME" ? "Ver perfume" : "Ver produto"}
          </Link>
        )}
      </div>
    </div>
  );
}
