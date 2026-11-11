/**
 * Área comercial da página do perfume — composição editorial, sem cards
 * grandes: tamanhos de decant, frasco original, preço, CTA dourado e CTA
 * compacto fixo quando o botão principal sai da tela.
 *
 * A fonte de verdade continua sendo o modo efetivo (`mode`) recebido da página:
 * nunca mostramos visual de Frasco com dados de Decant.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { brl, productTitle } from "@/lib/format";
import { useCart } from "@/lib/cart";
import { flyToCart } from "@/lib/fly-to-cart";
import { DECANT_SIZES, trackDecant, type DecantMl } from "@/lib/decants";
import { useDecantPrices } from "@/components/orium/DecantPicker";
import { DecantSizeOption } from "@/components/orium/DecantSizeOption";
import { useGlobalDecantSize } from "@/lib/decant-size";
import { usePromotions } from "@/lib/use-promotions";
import { priceUnit, promotionCta } from "@/lib/promotions";
import { PromotionBadge, PromotionNote } from "@/components/orium/PromotionBadge";
import { PixNote } from "@/components/orium/PixNote";
import type { CatalogProduct } from "@/components/orium/ProductCard";
import { cn } from "@/lib/utils";
import { DeliveryEstimate } from "@/components/orium/badges";

export type BuyMode = "decant" | "bottle";

export function ProductBuyPanel({
  product,
  mode,
  onModeChange,
  decantOk,
  bottleOk,
  initialSize,
  onSizeChange,
  minQty,
  flyFrom,
}: {
  product: CatalogProduct;
  mode: BuyMode;
  onModeChange: (m: BuyMode) => void;
  decantOk: boolean;
  bottleOk: boolean;
  /** tamanho inicial desta página (link/campanha); escolha aqui é LOCAL */
  initialSize?: DecantMl | undefined;
  onSizeChange?: (ml: DecantMl) => void;
  minQty: number;
  flyFrom?: RefObject<HTMLElement | null>;
}) {
  const cart = useCart();
  const promotions = usePromotions();
  const basePrices = useDecantPrices(product);
  const globalMl = useGlobalDecantSize();
  const [ml, setMl] = useState<DecantMl>(initialSize ?? globalMl);
  const [quantity, setQuantity] = useState(1);
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const ctaRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMl(initialSize ?? globalMl), [initialSize, globalMl, product.id]);
  useEffect(() => onSizeChange?.(ml), [ml, onSizeChange]);
  useEffect(() => {
    setQuantity(1);
    setState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // CTA compacto só quando o botão principal não está visível
  useEffect(() => {
    const el = ctaRef.current;
    if (!el || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver((entries) => setStuck(!entries[0]?.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const decantPriced = (size: DecantMl) =>
    priceUnit(basePrices[size], promotions, { productId: product.id, variant: "DECANT", decantMl: size });
  const bottlePriced = priceUnit(Number(product.retail_price ?? 0), promotions, {
    productId: product.id,
    variant: "FULL",
  });

  const active = mode === "decant" ? decantPriced(ml) : bottlePriced;
  const unitPrice = active.finalPrice;
  const totalPrice = mode === "bottle" ? unitPrice * quantity : unitPrice;

  const pickSize = (size: DecantMl) => {
    setMl(size); // local: nunca altera o modo do catálogo
    onModeChange("decant");
    trackDecant("decant_size_selected", { productId: product.id, variant: `DECANT_${size}` });
  };

  const add = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (state === "pending") return;
    setState("pending");

    if (mode === "decant") {
      cart.add(
        {
          productId: product.id,
          variant: "DECANT",
          decantMl: ml,
          slug: product.slug,
          name: product.canonical_name,
          brand: product.brand,
          image: product.image_url,
          volumeMl: ml,
          concentration: product.concentration,
          retailPrice: basePrices[ml],
          wholesalePrice: basePrices[ml],
        },
        1,
      );
      trackDecant("decant_added", { productId: product.id, variant: `DECANT_${ml}`, details: { price: basePrices[ml] } });
      toast.success("Adicionado", { description: `${productTitle(product.canonical_name)} · ${ml}ml`, duration: 1600 });
    } else {
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
      toast.success(`${productTitle(product.canonical_name)} adicionado`, {
        duration: 1800,
        action: { label: "Ver sacola", onClick: () => cart.setOpen(true) },
      });
    }

    flyToCart(flyFrom?.current ?? (e.currentTarget as HTMLElement), product.image_url);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState("done");
      timer.current = setTimeout(() => setState("idle"), 1300);
    }, 140);
  };

  const label =
    state === "pending" ? "Adicionando..." : state === "done" ? "Adicionado ✓" : promotionCta(active.promotion, "Adicionar à sacola");

  return (
    <>
      {decantOk ? (
        <section className="mt-7">
          <h2 className="text-[15px] font-semibold">Escolha o tamanho</h2>
          <div className="mt-3 grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Tamanho do decant">
            {DECANT_SIZES.map((size) => {
              const on = mode === "decant" && ml === size;
              const priced = decantPriced(size);
              return (
                <DecantSizeOption
                  key={size}
                  ml={size}
                  selected={on}
                  onSelect={() => pickSize(size)}
                  price={priced.finalPrice}
                  showPrice
                  className="gap-0 py-2.5"
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {bottleOk ? (
        <button
          type="button"
          aria-pressed={mode === "bottle"}
          onClick={() => onModeChange("bottle")}
          className={cn(
            "mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors duration-150 motion-reduce:transition-none",
            mode === "bottle" ? "border-gold/70 bg-gold/10" : "border-border/70 bg-surface-2",
          )}
        >
          <span className="min-w-0">
            <span className="block text-[13px] text-muted-foreground">
              Frasco original{product.volume_ml ? ` ${product.volume_ml}ml` : ""}
            </span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-[19px] leading-none font-bold tabular-nums">{brl(bottlePriced.finalPrice)}</span>
              {bottlePriced.promotion ? (
                <>
                  <span className="text-[12px] text-muted-foreground line-through tabular-nums">
                    {brl(bottlePriced.basePrice)}
                  </span>
                  <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background">
                    -{Math.round(Number(bottlePriced.promotion.discount_percent))}%
                  </span>
                </>
              ) : null}
            </span>
          </span>
          <span
            aria-hidden
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full border",
              mode === "bottle" ? "border-gold bg-gold text-gold-foreground" : "border-border",
            )}
          >
            {mode === "bottle" ? <Check className="size-3" /> : null}
          </span>
        </button>
      ) : decantOk ? (
        <p className="mt-3 text-xs text-muted-foreground">Este perfume é vendido pela Orium apenas em decant.</p>
      ) : null}

      {/* preço em foco + pagamento real */}
      <div className="mt-6">
        <p key={unitPrice} className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[30px] leading-none font-bold tracking-tight tabular-nums">{brl(unitPrice)}</span>
          <span className="text-xs font-medium text-muted-foreground">no Pix</span>
          {active.promotion ? (
            <span className="text-[13px] text-muted-foreground line-through tabular-nums">{brl(active.basePrice)}</span>
          ) : null}
        </p>
        <PixNote amount={unitPrice} className="mt-1.5" />
        {active.promotion ? (
          <div className="mt-2.5">
            <PromotionBadge promotion={active.promotion} size="lg" />
            <PromotionNote promotion={active.promotion} variant="long" className="mt-1.5" />
          </div>
        ) : null}
        {mode === "bottle" && product.wholesale_price ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            A partir de {minQty} peças:{" "}
            <strong className="font-semibold text-gold">{brl(Number(product.wholesale_price))} cada</strong>
          </p>
        ) : null}
      </div>

      {mode === "bottle" ? (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[13px] text-muted-foreground">Quantidade</span>
          <div className="flex items-center rounded-full border border-border/70">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="Diminuir quantidade"
              className="press grid size-11 place-items-center rounded-full"
            >
              <Minus className="size-4" />
            </button>
            <span className="min-w-7 text-center text-sm font-medium tabular-nums">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => Math.min(99, q + 1))}
              aria-label="Aumentar quantidade"
              className="press grid size-11 place-items-center rounded-full"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      <DeliveryEstimate productId={product.id} inStock={product.in_stock} className="mt-4" />

      <div ref={ctaRef} className="mt-5">
        <button
          type="button"
          onClick={add}
          aria-live="polite"
          className="press flex h-14 w-full items-center justify-center gap-2 rounded-[22px] bg-gradient-to-b from-gold-soft to-gold text-[16px] font-semibold text-gold-foreground shadow-soft"
        >
          {state === "done" ? <Check className="check-pop size-5" /> : <ShoppingBag className="size-[18px]" />}
          {label}
        </button>
      </div>

      {stuck && typeof document !== "undefined"
        ? createPortal(
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-surface-1/92 px-4 pt-3 pb-safe backdrop-blur-xl">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="min-w-0">
              <p className="truncate text-[17px] leading-none font-bold tabular-nums">{brl(totalPrice)}</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {mode === "decant" ? `Decant ${ml}ml` : quantity > 1 ? `${quantity} × ${brl(unitPrice)}` : "Frasco completo"}
              </p>
            </div>
            <button
              type="button"
              onClick={add}
              className="press ml-auto flex h-12 flex-1 max-w-44 items-center justify-center gap-1.5 rounded-full bg-gradient-to-b from-gold-soft to-gold text-[15px] font-semibold text-gold-foreground"
            >
              {state === "done" ? <Check className="size-4" /> : <ShoppingBag className="size-4" />}
              {state === "done" ? "Adicionado" : "Adicionar"}
            </button>
          </div>
        </div>,
        document.body,
          )
        : null}
    </>
  );
}
