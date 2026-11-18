import { imgSrcSet, imgVariant } from "@/lib/product-img";
import { Link, useRouter } from "@tanstack/react-router";
import { Plus, Minus, Check, Loader2, MessageCircle } from "lucide-react";
import { memo, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { brl, productTitle } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart";
import { flyToCart } from "@/lib/fly-to-cart";
import { variantKey, decantPrice, canDecant, canFullBottle } from "@/lib/decants";
import { usePriceView, type PriceView } from "@/lib/decant-size";
import { usePaymentSettings } from "@/lib/payment";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { usePromotions } from "@/lib/use-promotions";
import { priceUnit, promotionCta } from "@/lib/promotions";
import { PromotionBadge } from "@/components/orium/PromotionBadge";
import { isBlack, scarcity } from "@/lib/black";
import { BlackCountdown, BlackPrice, BlackScarcity, BlackTag } from "@/components/orium/black/Black";
import { cn } from "@/lib/utils";
import { nameHeroTile, rememberProductPreview, warmProductImage, warmProductRoute } from "@/lib/product-preview";
import { AdminCatalogChip } from "@/components/orium/AdminCatalogChip";
import { FavoriteButton } from "@/components/orium/FavoriteButton";
import { ReadyTag } from "@/components/orium/badges";
import { track } from "@/lib/analytics";
import { useTapOpen } from "@/hooks/use-tap-open";
import type { AdminProductInsight } from "@/lib/admin-insight.functions";
import { consultLink, isOnRequest, useConsultIds } from "@/lib/price-on-request";



export type CatalogProduct = {
  id: string;
  slug: string;
  canonical_name: string;
  brand: string | null;
  concentration: string | null;
  volume_ml: number | null;
  image_url: string | null;
  in_stock: boolean;
  stock_quantity: number | null;
  retail_price: number | null;
  wholesale_price: number | null;
  gender_norm?: string | null;
  product_type?: string | null;
  decant_available?: boolean | null;
  sale_mode?: string | null;
  full_bottle_available?: boolean | null;
  decant_price_2ml?: number | null;
  decant_price_5ml?: number | null;
  decant_price_10ml?: number | null;
  accords?: string[] | null;
  sold?: number | null;
  is_pinned?: boolean | null;
  is_new?: boolean | null;
};

const stopLink = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/** Foto com proporção fixa e fade ao carregar — zero salto de layout. */
export function ProductImage({
  product,
  className,
  eager,
  variant = "card",
}: {
  product: Pick<CatalogProduct, "image_url" | "brand" | "canonical_name">;
  className?: string;
  eager?: boolean;
  /** thumb: miniaturas (busca) · card: grade/carrossel */
  variant?: "thumb" | "card";
}) {
  const [loaded, setLoaded] = useState(false);
  if (!product.image_url) {
    return (
      <span
        className={cn(
          "display grid size-full place-items-center px-3 text-center text-lg text-muted-foreground/70",
          className,
        )}
      >
        {product.brand ?? "Orium"}
      </span>
    );
  }
  return (
    <img
      src={imgVariant(product.image_url, variant) ?? product.image_url}
      srcSet={variant === "card" ? imgSrcSet(product.image_url) : undefined}
      sizes={variant === "card" ? "(min-width: 1024px) 22vw, (min-width: 640px) 33vw, 50vw" : undefined}
      alt={`${product.brand ?? ""} ${product.canonical_name}`}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      width={600}
      height={750}
      // foto que já veio do cache (ou carregou antes do React assumir) aparece na hora
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
      }}
      onLoad={() => setLoaded(true)}
      className={cn("img-fade size-full object-cover", loaded && "is-loaded", className)}
    />
  );
}

/** Adicionar / quantidade do FRASCO — usado na página do perfume e em produtos sem decant. */
export function AddToCartButton({
  product,
  quantity = 1,
  className,
  full,
  flyFrom,
  label,
}: {
  product: CatalogProduct;
  quantity?: number;
  className?: string;
  full?: boolean;
  flyFrom?: RefObject<HTMLElement | null>;
  label?: string;
}) {
  const cart = useCart();
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  const key = variantKey(product.id, "FULL");
  const inCart = cart.quantityOf(product.id, "FULL");
  const disabled = !canFullBottle(product) || !product.retail_price;

  const doAdd = (e: React.MouseEvent) => {
    stopLink(e);
    if (disabled) return;
    setPending(true);
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
      quantity,
    );
    flyToCart(flyFrom?.current ?? (e.currentTarget as HTMLElement), product.image_url);
    toast.success(`${productTitle(product.canonical_name)} adicionado`, {
      duration: 1800,
      action: { label: "Ver sacola", onClick: () => cart.setOpen(true) },
    });
    setTimeout(() => {
      setPending(false);
      setAdded(true);
      setTimeout(() => setAdded(false), 1200);
    }, 160);
  };

  if (disabled) {
    return (
      <Button size="lg" variant="secondary" disabled className={cn("h-11 w-full rounded-full text-sm", className)}>
        Indisponível
      </Button>
    );
  }

  if (inCart > 0 && !full) {
    return (
      <div
        className={cn(
          "flex h-11 items-center justify-between rounded-full border border-foreground/80 bg-foreground text-background",
          className,
        )}
      >
        <button
          className="press grid h-11 w-11 place-items-center rounded-full"
          aria-label={`Diminuir ${product.canonical_name}`}
          onClick={(e) => {
            stopLink(e);
            cart.setQuantity(key, inCart - 1);
          }}
        >
          <Minus className="size-4" />
        </button>
        <span key={inCart} className="value-in text-sm font-semibold tabular-nums">
          {inCart}
        </span>
        <button
          className="press grid h-11 w-11 place-items-center rounded-full"
          aria-label={`Aumentar ${product.canonical_name}`}
          onClick={doAdd}
        >
          <Plus className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <Button
      size="lg"
      className={cn("press h-11 w-full rounded-full text-sm", full && "h-13 text-base", className)}
      onClick={doAdd}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : added ? (
        <>
          <Check className="size-4" /> Adicionado
        </>
      ) : (
        <>
          <Plus className="size-4" /> {label ?? "Adicionar"}
        </>
      )}
    </Button>
  );
}

/**
 * Card único da Orium: um perfume, com as formas de compra atrás de um só botão.
 * Mobile: foto, marca, nome, preço inicial do decant, preço do frasco e "Escolher".
 */
function ProductCardBase({
  product,
  index = 0,
  onChoose,
  adminInsight,
  viewOverride,
}: {
  product: CatalogProduct;
  index?: number;
  minQty?: number;
  onChoose?: (p: CatalogProduct) => void;
  /** Camada operacional (Visão Admin) — só chega aqui quando o backend autorizou. */
  adminInsight?: AdminProductInsight | null;
  /**
   * Apresentação forçada (Decant 5ml, Frasco…). Usada onde o contexto manda,
   * como as recomendações da página do perfume, que seguem a aba aberta.
   * Sem override, o card segue a escolha global do cliente.
   */
  viewOverride?: PriceView | undefined;
}) {

  const imgRef = useRef<HTMLDivElement | null>(null);
  const consult = isOnRequest(product as never, useConsultIds());
  const settings = useDecantSettings();
  const promotions = usePromotions();
  const cart = useCart();
  const decant = canDecant(product);
  const globalView = usePriceView();
  const payment = usePaymentSettings();
  /**
   * O preço cadastrado é o preço no Pix — o card só sinaliza isso, sem tabela.
   * Fica em linha própria para nunca ser espremido ao lado do preço no mobile.
   */
  const pixTag = payment.active ? (
    <span className="text-[10.5px] leading-none font-medium text-[#8C8C8C]">no Pix</span>
  ) : null;
  const priceView = viewOverride ?? globalView;
  /** Produto "somente Decant" nunca mostra nem vende frasco. */
  const bottleOk = canFullBottle(product);
  /**
   * Só existe visão de decant quando o produto é perfume com decant liberado.
   * Quando o produto é vendido apenas em decant, essa é sempre a visão.
   */
  const showDecant = decant && (priceView !== "frasco" || !bottleOk);
  const size = priceView === "frasco" ? 2 : priceView;

  const fromBase = showDecant ? decantPrice(product, settings, size) : null;
  /** Menor preço de decant (2ml) — linha dourada quando o card mostra o frasco. */
  const decantFrom = decant && settings !== undefined ? decantPrice(product, settings, 2) : null;
  const fromPriced =
    fromBase != null
      ? priceUnit(fromBase, promotions, { productId: product.id, variant: "DECANT", decantMl: size })

      : null;
  const bottleBase = bottleOk && product.retail_price != null ? Number(product.retail_price) : null;
  const bottlePriced =
    bottleBase != null ? priceUnit(bottleBase, promotions, { productId: product.id, variant: "FULL" }) : null;
  const percent = Math.max(
    fromPriced?.promotion ? Number(fromPriced.promotion.discount_percent) : 0,
    bottlePriced?.promotion ? Number(bottlePriced.promotion.discount_percent) : 0,
  );
  /** Promoção de perfume/frasco manda no card: preço do frasco em destaque, decant como nota. */
  const bottleOnPromo = !!bottlePriced?.promotion && bottlePriced.basePrice > 0;
  /** Em modo Frasco o preço do frasco (com promoção) é sempre o preço principal. */
  const showBottleFirst = priceView === "frasco" || !showDecant || bottleOnPromo;
  /** Black November: o visual de vitrine vale para a promoção que o card está mostrando. */
  const shownPromo = showBottleFirst ? bottlePriced?.promotion : fromPriced?.promotion;
  const black = !consult && isBlack(shownPromo) ? shownPromo! : null;


  // Rolagem e carrossel nunca contam como abertura do perfume.
  const router = useRouter();
  const tap = useTapOpen({
    onPress: () => {
      rememberProductPreview(product);
      warmProductImage(product.image_url);
      warmProductRoute(router as never);
    },
    onOpen: () => {
      nameHeroTile(imgRef.current);
      track("card_clicked", { productId: product.id });
    },
  });

  return (
    <div
      className="card-cv stagger-in @container/card flex h-full flex-col"
      style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
    >
      <Link
        to="/perfume/$slug"
        params={{ slug: product.slug }}
        preload="intent"
        viewTransition
        {...tap}
        className="tap-card group flex flex-1 flex-col"
      >
        <div
          ref={imgRef}
          className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[16px] bg-white @min-[220px]/card:rounded-[20px]"
        >
          <ProductImage product={product} eager={index < 2} />
          {/* Um selo por vez: novidade só aparece quando não há promoção. */}
          {product.is_new && (percent === 0 || consult) ? (
            <span className="gold-chip absolute top-2.5 left-2.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
              Novidade
            </span>
          ) : null}

          {black ? (
            <BlackTag promotion={black} size="xs" className="absolute top-2.5 left-2.5" />
          ) : percent > 0 && !consult ? (
            <span className="gold-chip absolute top-2.5 left-2.5 rounded-full px-2 py-0.5 text-[10px] font-bold">
              -{Math.round(percent)}%
            </span>
          ) : null}
          <FavoriteButton
            productId={product.id}
            name={product.canonical_name}
            size="sm"
            className="absolute top-2 right-2"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col pt-2.5">
          {/* marca → nome → acordes num bloco só; altura reservada para 2 linhas de nome */}
          <div className="min-h-[3.9rem] tab:min-h-[4.1rem] @min-[220px]/card:min-h-[4.6rem]">
            <p className="flex h-4 items-center truncate text-[11px] font-medium text-[#B1B1B1] @min-[220px]/card:h-5 @min-[220px]/card:text-[12.5px]">
              {product.brand}
            </p>
            <h3 className="line-clamp-2 text-[15px] leading-[1.25] font-semibold tracking-[-0.01em] text-white @min-[220px]/card:text-[16.5px]">
              {productTitle(product.canonical_name)}
            </h3>
            {(product.accords ?? []).length ? (
              <p className="mt-0.5 truncate text-[10.5px] leading-4 text-[#A9A9A9] @min-[220px]/card:text-[12px] @min-[220px]/card:leading-5">
                {(product.accords ?? []).slice(0, 3).join(", ")}
              </p>
            ) : null}
            <ReadyTag productId={product.id} inStock={product.in_stock} className="mt-1" />
          </div>

          <div className="mt-1.5 flex-1">
            {consult ? (
              <>
                <p className="text-[10.5px] text-muted-foreground">
                  {product.volume_ml ? `Frasco ${product.volume_ml}ml` : "Frasco completo"}
                </p>
                <p className="text-[16px] leading-tight font-bold tracking-tight text-[#FFD599] @min-[220px]/card:text-[18px]">Sob consulta</p>
                <p className="mt-0.5 text-[10.5px] text-[#8C8C8C]">Preço no WhatsApp</p>
              </>
            ) : black && showBottleFirst && bottlePriced != null ? (
              <>
                <BlackPrice
                  key={`bf-${bottlePriced.finalPrice}`}
                  base={bottlePriced.basePrice}
                  final={bottlePriced.finalPrice}
                  percent={percent}
                />
                {/* uma urgência por card: estoque real baixo vence; senão, o relógio */}
                <div className="mt-1.5">
                  {scarcity(product) ? <BlackScarcity product={product} /> : <BlackCountdown endsAt={black.ends_at} />}
                </div>
              </>
            ) : black && fromPriced != null ? (
              <>
                <p className="text-[10.5px] text-muted-foreground">Decant {size}ml</p>
                <BlackPrice
                  key={`bd-${size}-${fromPriced.finalPrice}`}
                  base={fromPriced.basePrice}
                  final={fromPriced.finalPrice}
                  percent={percent}
                />
                <BlackCountdown endsAt={black.ends_at} className="mt-1.5" />
              </>
            ) : showBottleFirst && bottlePriced != null ? (
              <>
                <div
                  key={`frasco-${bottlePriced.finalPrice}`}
                  className={cn("min-w-0", bottleOnPromo ? "promo-price" : "price-morph")}
                >
                  {bottleOnPromo ? (
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="text-[11px] text-muted-foreground line-through tabular-nums">
                        {brl(bottlePriced.basePrice)}
                      </span>
                      {percent > 0 ? (
                        <span className="text-[10.5px] font-semibold text-rose-500">-{Math.round(percent)}%</span>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="flex items-baseline gap-1.5">
                    <span className="text-[17px] leading-none font-extrabold tracking-tight tabular-nums tab:text-[19px] @min-[220px]/card:text-[21px]">{brl(bottlePriced.finalPrice)}</span>
                    {pixTag}
                  </p>
                </div>
                {decant && decantFrom != null ? (
                  <p className="mt-1 text-[11.5px] font-bold text-[#FFD599] @min-[220px]/card:text-[12.5px]">
                    Decants a partir de <span className="tabular-nums">{brl(decantFrom)}</span>
                  </p>
                ) : null}
                {bottleOnPromo ? <PromotionBadge promotion={bottlePriced.promotion} size="sm" className="mt-1.5" /> : null}
                {!product.in_stock ? (
                  <p className="mt-1 truncate text-[10.5px] text-muted-foreground">Indisponível</p>
                ) : null}
              </>
            ) : fromPriced != null ? (
              <>
                <p className="text-[10.5px] text-muted-foreground">Decant {size}ml</p>
                <div key={`${size}-${fromPriced.finalPrice}`} className="price-morph min-w-0">
                  {fromPriced.promotion ? (
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="text-[11px] text-muted-foreground line-through tabular-nums">
                        {brl(fromPriced.basePrice)}
                      </span>
                      {percent > 0 ? (
                        <span className="text-[10.5px] font-semibold text-rose-500">-{Math.round(percent)}%</span>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="flex items-baseline gap-1.5">
                    <span className="text-[17px] leading-none font-extrabold tracking-tight tabular-nums tab:text-[19px] @min-[220px]/card:text-[21px]">{brl(fromPriced.finalPrice)}</span>
                    {pixTag}
                  </p>
                </div>
                {fromPriced.promotion ? (
                  <PromotionBadge promotion={fromPriced.promotion} size="sm" className="mt-1.5" />
                ) : null}
                {!product.in_stock ? (
                  <p className="mt-1 truncate text-[10.5px] text-muted-foreground">Indisponível</p>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-[10.5px] text-muted-foreground">
                  {product.volume_ml ? `Frasco ${product.volume_ml}ml` : "Frasco completo"}
                </p>
                <div className="min-w-0">
                  <p className="flex items-baseline gap-1.5">
                    <span className="text-[17px] leading-none font-extrabold tracking-tight tabular-nums tab:text-[19px] @min-[220px]/card:text-[21px]">{brl(bottlePriced?.finalPrice ?? product.retail_price)}</span>
                    {pixTag}
                  </p>
                </div>
                {!product.in_stock ? (
                  <p className="mt-1 truncate text-[10.5px] text-muted-foreground">Indisponível</p>
                ) : null}
              </>
            )}
          </div>

        </div>
      </Link>

      {adminInsight ? (
        <AdminCatalogChip insight={adminInsight} name={productTitle(product.canonical_name)} />
      ) : null}

      {/* CTA sempre na mesma altura, qualquer que seja o tamanho do nome. */}
      <div className="pt-2.5">
        {consult ? (
          <a
            href={consultLink(product)}
            target="_blank"
            rel="noreferrer"
            onClick={() => track("consultant_help_clicked", { productId: product.id, meta: { reason: "sob-consulta" } })}
            className="press inline-flex h-[34px] items-center gap-1.5 rounded-full bg-[#FFD599] px-4 text-[13px] font-bold text-black transition-colors hover:bg-[#FFDDAA] @min-[220px]/card:h-[40px] @min-[220px]/card:px-5 @min-[220px]/card:text-[14px]"
          >
            <MessageCircle className="size-4" strokeWidth={2.4} /> Consultar
          </a>
        ) : bottleOnPromo && black && canFullBottle(product) ? (
          <button
            type="button"
            onClick={(e) => {
              // "Comprar agora" da Black: o frasco vai direto para a sacola, que já abre para fechar o pedido.
              stopLink(e);
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
              flyToCart(e.currentTarget as HTMLElement, product.image_url);
              window.setTimeout(() => cart.setOpen(true), 450);
            }}
            className="press inline-flex h-[34px] items-center rounded-full bg-[#FFD599] px-4 text-[13px] font-bold text-black transition-colors hover:bg-[#FFDDAA] @min-[220px]/card:h-[40px] @min-[220px]/card:px-5 @min-[220px]/card:text-[14px]"
          >
            Comprar agora
          </button>
        ) : bottleOnPromo ? (
          <Link
            to="/perfume/$slug"
            params={{ slug: product.slug }}
            search={{ frasco: 1 }}
            className="press inline-flex h-[34px] items-center rounded-full bg-[#FFD599] px-4 text-[13px] font-bold text-black transition-colors hover:bg-[#FFDDAA] @min-[220px]/card:h-[40px] @min-[220px]/card:px-5 @min-[220px]/card:text-[14px]"
          >
            {black ? "Comprar agora" : promotionCta(bottlePriced!.promotion, "Ver oferta")}
          </Link>
        ) : onChoose && decant ? (
          <button
            type="button"
            className="press inline-flex h-[34px] items-center rounded-full bg-[#FFD599] px-4 text-[13px] font-bold text-black transition-colors hover:bg-[#FFDDAA] @min-[220px]/card:h-[40px] @min-[220px]/card:px-5 @min-[220px]/card:text-[14px]"
            onClick={() => onChoose(product)}
          >
            {black ? "Comprar agora" : fromPriced?.promotion ? promotionCta(fromPriced.promotion, "Adicionar") : "Adicionar"}
          </button>
        ) : onChoose ? (
          <Link
            to="/perfume/$slug"
            params={{ slug: product.slug }}
            className="press inline-flex h-[34px] items-center rounded-full border border-[#FFD599]/40 px-4 text-[13px] font-bold text-[#FFD599] @min-[220px]/card:h-[40px] @min-[220px]/card:px-5 @min-[220px]/card:text-[14px]"
          >
            {product.product_type === "PERFUME" ? "Ver perfume" : "Ver produto"}
          </Link>
        ) : (
          <AddToCartButton product={product} flyFrom={imgRef} />
        )}
      </div>

    </div>
  );
}

/**
 * Memo: tocar em um card não pode rerenderizar centenas de cards do catálogo.
 */
export const ProductCard = memo(ProductCardBase);

/** Mesma silhueta do card real: zero salto quando o produto chega. */
export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="skeleton aspect-square rounded-[16px]" />
      <div className="pt-2.5">
        <div className="skeleton h-3 w-14" />
        <div className="skeleton mt-2 h-4 w-28" />
        <div className="skeleton mt-1.5 h-3 w-20" />
        <div className="skeleton mt-2.5 h-4 w-24" />
        <div className="skeleton mt-3 h-[34px] w-24 rounded-full" />
      </div>
    </div>
  );
}
