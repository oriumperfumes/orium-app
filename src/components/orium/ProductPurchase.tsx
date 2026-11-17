/**
 * Página do perfume — "Como você quer levar?" (Figma).
 *
 * Decant (recomendado) ou Frasco em dois cartões; no decant, o seletor
 * 2 · 5 · 10 ml desliza; preço grande com quanto tempo dura; e a barra fixa
 * "Adicionar à sacola" sempre à mão, com o que está escolhido.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { brl, productTitle } from "@/lib/format";
import { useCart } from "@/lib/cart";
import { flyToCart } from "@/lib/fly-to-cart";
import { DECANT_SIZES, trackDecant, type DecantMl } from "@/lib/decants";
import { useDecantPrices } from "@/components/orium/DecantPicker";
import { usePromotions } from "@/lib/use-promotions";
import { priceUnit } from "@/lib/promotions";
import { PromotionBadge } from "@/components/orium/PromotionBadge";
import { isBlack } from "@/lib/black";
import { BlackCountdown, BlackPrice, BlackScarcity, BlackTag } from "@/components/orium/black/Black";
import { PixNote } from "@/components/orium/PixNote";
import { DeliveryEstimate } from "@/components/orium/badges";
import type { CatalogProduct } from "@/components/orium/ProductCard";
import { cn } from "@/lib/utils";
import { comboAcceptsSize } from "@/lib/decant-combos";
import { ComboTag, DecantComboPromo, useFeaturedCombo } from "@/components/orium/DecantCombo";

export type BuyMode = "decant" | "bottle";

const SIZE_COPY: Record<DecantMl, { lasts: string; text: string }> = {
  2: {
    lasts: "cerca de 1 semana usando todo dia",
    text: "Tirado do frasco original, em vidro com borrifador. O jeito certo de conhecer antes de decidir.",
  },
  5: {
    lasts: "cerca de 2 semanas usando todo dia",
    text: "Tirado do frasco original, em vidro com borrifador. Tempo de sobra para usar em ocasiões diferentes.",
  },
  10: {
    lasts: "cerca de 1 mês usando todo dia",
    text: "Tirado do frasco original, em vidro com borrifador. Cabe no bolso, e você pode ter um perfume diferente a cada mês.",
  },
};

export function ProductPurchase({
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
  initialSize?: DecantMl | undefined;
  onSizeChange?: (ml: DecantMl) => void;
  minQty: number;
  flyFrom?: RefObject<HTMLElement | null>;
}) {
  const cart = useCart();
  const promotions = usePromotions();
  const { featured: comboRow } = useFeaturedCombo();
  const prices = useDecantPrices(product);
  const [ml, setMl] = useState<DecantMl>(initialSize ?? 5);
  const [qty, setQty] = useState(1);
  const [state, setState] = useState<"idle" | "done" | "view">("idle");
  const timers = useRef<number[]>([]);

  useEffect(() => setMl(initialSize ?? 5), [initialSize, product.id]);
  useEffect(() => onSizeChange?.(ml), [ml, onSizeChange]);
  useEffect(() => {
    setQty(1);
    setState("idle");
  }, [product.id]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  // mudou a escolha: o botão volta a ser "Adicionar"
  useEffect(() => setState("idle"), [mode, ml]);

  const decantPriced = (size: DecantMl) =>
    priceUnit(prices[size], promotions, { productId: product.id, variant: "DECANT", decantMl: size });
  const bottlePriced = priceUnit(Number(product.retail_price ?? 0), promotions, { productId: product.id, variant: "FULL" });
  const isDecant = mode === "decant" && decantOk;
  const active = isDecant ? decantPriced(ml) : bottlePriced;
  const total = isDecant ? active.finalPrice : active.finalPrice * qty;
  const isPerfume = product.product_type === "PERFUME" || product.product_type == null;
  const bottleWord = isPerfume ? "Frasco" : "Produto";
  const showChooser = decantOk && bottleOk;
  const fromPrice = Math.min(...DECANT_SIZES.map((s) => decantPriced(s).finalPrice));
  /** Black November na escolha atual: vitrine com contagem, escassez real e "Comprar agora". */
  const black = isBlack(active.promotion) ? active.promotion : null;
  const bottleBlack = isBlack(bottlePriced.promotion);
  const decantBlack = DECANT_SIZES.some((s) => isBlack(decantPriced(s).promotion));

  const pickSize = (size: DecantMl) => {
    setMl(size);
    onModeChange("decant");
    trackDecant("decant_size_selected", { productId: product.id, variant: `DECANT_${size}` });
  };

  const add = () => {
    if (state === "view") {
      cart.setOpen(true);
      return;
    }
    if (state === "done") return;
    if (isDecant) {
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
          retailPrice: prices[ml],
          wholesalePrice: prices[ml],
        },
        1,
      );
      trackDecant("decant_added", { productId: product.id, variant: `DECANT_${ml}`, details: { price: prices[ml] } });
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
        qty,
      );
    }
    toast.success("Adicionado à sacola", {
      description: `${productTitle(product.canonical_name)} · ${isDecant ? `decant ${ml} ml` : bottleWord.toLowerCase()}`,
      duration: 2200,
      action: { label: "Ver sacola", onClick: () => cart.setOpen(true) },
    });
    flyToCart(flyFrom?.current ?? null, product.image_url);
    setState("done");
    timers.current.forEach((t) => window.clearTimeout(t));
    if (black) {
      // "Comprar agora": a sacola abre logo em seguida, pronta para fechar o pedido.
      timers.current = [
        window.setTimeout(() => cart.setOpen(true), 650),
        window.setTimeout(() => setState("idle"), 1400),
      ];
      return;
    }
    timers.current = [
      window.setTimeout(() => setState("view"), 900),
      window.setTimeout(() => setState("idle"), 5200),
    ];
  };

  const summary = isDecant
    ? `Decant · ${ml} ml`
    : qty > 1
      ? `${qty} × ${brl(active.finalPrice)}`
      : `${bottleWord}${product.volume_ml ? ` · ${product.volume_ml} ml` : ""}`;

  const buyBar = (
    <>
      <div className="min-w-0 flex-1">
        <p key={summary} className="value-in truncate text-[13px] text-[#A9A9A9]">{summary}</p>
        <p key={total} className="value-in mt-0.5 truncate text-[22px] leading-tight font-bold tracking-[-0.02em] text-white tabular-nums lg:text-[26px]">
          {brl(total)}
        </p>
      </div>
      <button
        type="button"
        onClick={add}
        disabled={!(decantOk || bottleOk)}
        aria-live="polite"
        className={cn(
          "press flex h-[54px] shrink-0 items-center justify-center gap-2 rounded-full px-7 text-[16px] font-bold transition-colors duration-300 lg:h-[58px] lg:px-9",
          state === "view" ? "bg-white text-[#15130F]" : "bg-[#FFD599] text-[#15130F] hover:bg-[#FFDDAA]",
        )}
      >
        {state === "done" ? (
          <span className="check-pop inline-flex items-center gap-2">
            <Check className="size-5" strokeWidth={2.8} /> Adicionado
          </span>
        ) : state === "view" ? (
          <span className="value-in">Ver sacola</span>
        ) : (
          <span className="value-in">{black ? "Comprar agora" : "Adicionar à sacola"}</span>
        )}
      </button>
    </>
  );

  return (
    <>
      {showChooser ? (
        <section aria-label="Como você quer levar?" className="mt-8">
          <h2 className="text-[18px] font-bold tracking-[-0.01em] text-white">Como você quer levar?</h2>
          <div role="radiogroup" className="mt-3 grid grid-cols-[1.55fr_1fr] gap-2.5">
            <button
              type="button"
              role="radio"
              aria-checked={isDecant}
              onClick={() => onModeChange("decant")}
              className={cn(
                "pd-choice press relative flex min-h-[124px] flex-col items-start justify-end rounded-[20px] p-4 pt-11 text-left",
                isDecant ? "is-on bg-[#221C14] ring-1 ring-[#FFD599] ring-inset" : "bg-[#1A1A1A] ring-1 ring-white/10 ring-inset",
              )}
            >
              {/* na Black o selo da campanha ocupa o lugar do "Recomendado" */}
              {decantBlack ? (
                <BlackTag size="sm" className="absolute top-3.5 left-3.5" />
              ) : (
                <span className="absolute top-3.5 left-3.5 rounded-full bg-[#FFD599] px-2.5 py-1 text-[11px] leading-none font-bold text-[#15130F]">
                  Recomendado
                </span>
              )}
              <span className="text-[18px] leading-tight font-bold text-white">Decant</span>
              <span className="mt-1 text-[13px] text-[#CFCFCF]">2, 5 ou 10 ml</span>
              <span className="text-[13px] text-[#CFCFCF]">a partir de {brl(fromPrice)}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!isDecant}
              onClick={() => onModeChange("bottle")}
              className={cn(
                "pd-choice press relative flex min-h-[124px] flex-col items-start justify-end rounded-[20px] p-4 text-left",
                !isDecant ? "is-on bg-[#221C14] ring-1 ring-[#FFD599] ring-inset" : "bg-[#1A1A1A] ring-1 ring-white/10 ring-inset",
              )}
            >
              {bottleBlack ? <BlackTag size="sm" className="absolute top-3.5 left-3.5" /> : null}
              <span className="text-[18px] leading-tight font-bold text-white">{bottleWord}</span>
              {product.volume_ml ? <span className="mt-1 text-[13px] text-[#A9A9A9]">{product.volume_ml} ml</span> : null}
              <span className="text-[13px] text-[#A9A9A9] tabular-nums">
                {bottleBlack ? <span className="mr-1.5 text-[#6E6E6E] line-through">{brl(bottlePriced.basePrice)}</span> : null}
                {brl(bottlePriced.finalPrice)}
              </span>
            </button>
          </div>
        </section>
      ) : null}

      {/* seletor de tamanho do decant: o fundo branco desliza até o escolhido */}
      {isDecant ? (
        <div
          role="radiogroup"
          aria-label="Tamanho do decant"
          className={cn("pd-sizes relative grid grid-cols-3 rounded-full bg-[#1A1A1A] p-1", showChooser ? "mt-5" : "mt-9")}
        >
          <span
            aria-hidden
            className="pd-thumb absolute top-1 bottom-1 left-1 rounded-full bg-white"
            style={{ width: "calc((100% - 0.5rem) / 3)", transform: `translateX(${DECANT_SIZES.indexOf(ml) * 100}%)` }}
          />
          {DECANT_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={ml === s}
              onClick={() => pickSize(s)}
              className={cn(
                "relative z-10 h-11 rounded-full text-[15px] transition-colors duration-300",
                ml === s ? "font-bold text-[#15130F]" : "font-medium text-[#CFCFCF]",
              )}
            >
              {s} ml
              {comboRow && comboAcceptsSize(comboRow.combo, s) ? <ComboTag combo={comboRow.combo} className="-top-[22px]" /> : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* a promoção vem antes do preço: é o que decide a compra */}
      {isDecant ? <DecantComboPromo ml={ml} onPick={pickSize} className="mt-5" /> : null}

      {/* preço e o que você leva */}
      <div className={isDecant && comboRow ? "mt-5" : "mt-6"}>
        {black ? (
          <div key={`black-${mode}-${ml}`} className="pd-price rounded-[22px] bg-[#0A0A0A] p-4 ring-1 ring-white/10">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
              <BlackTag promotion={black} size="md" />
              <BlackCountdown endsAt={black.ends_at} variant="boxes" />
            </div>
            <BlackPrice
              size="page"
              className="mt-4"
              base={active.basePrice}
              final={active.finalPrice}
              percent={Number(black.discount_percent)}
            />
            <p className="mt-1.5 text-[13px] font-semibold text-[#CFCFCF]">
              Você economiza <span className="text-white tabular-nums">{brl(active.saved)}</span>
              {isDecant ? <span className="font-medium text-[#8C8C8C]"> · {SIZE_COPY[ml].lasts}</span> : null}
            </p>
            {!isDecant ? <BlackScarcity product={product} variant="bar" className="mt-4" /> : null}
          </div>
        ) : (
        <div key={`${mode}-${ml}`} className="pd-price flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[32px] leading-none font-bold tracking-[-0.03em] text-white tabular-nums">
            {brl(active.finalPrice)}
          </span>
          {active.promotion ? (
            <span className="text-[14px] text-[#8C8C8C] line-through tabular-nums">{brl(active.basePrice)}</span>
          ) : null}
          {isDecant ? <span className="text-[14px] font-semibold text-[#FFD599]">{SIZE_COPY[ml].lasts}</span> : null}
        </div>
        )}
        {active.promotion && !black ? <PromotionBadge promotion={active.promotion} size="sm" className="mt-2.5" /> : null}
        <p className="mt-3 text-[15px] leading-relaxed text-[#A9A9A9]">
          {isDecant
            ? SIZE_COPY[ml].text
            : isPerfume
              ? `Frasco original e lacrado${product.volume_ml ? ` de ${product.volume_ml} ml` : ""}, direto da marca.`
              : "Produto original e lacrado, direto da marca."}
        </p>
        {!isDecant && product.wholesale_price ? (
          <p className="mt-2 text-[14px] text-[#A9A9A9]">
            A partir de {minQty} peças: <strong className="font-bold text-[#FFD599]">{brl(Number(product.wholesale_price))} cada</strong>
          </p>
        ) : null}
        <PixNote amount={total} className="mt-2" />
      </div>

      {!isDecant ? (
        <div className="mt-5 flex items-center">
          <span className="text-[15px] font-semibold text-white">Quantidade</span>
          <div className="ml-auto flex h-11 items-center rounded-full bg-[#1F1F1F]">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              aria-label="Diminuir quantidade"
              className="press grid size-11 place-items-center rounded-full text-white disabled:opacity-35"
            >
              <Minus className="size-4" strokeWidth={2.4} />
            </button>
            <span key={qty} className="value-in min-w-7 text-center text-[15px] font-bold text-white tabular-nums">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(99, q + 1))}
              aria-label="Aumentar quantidade"
              className="press grid size-11 place-items-center rounded-full text-white"
            >
              <Plus className="size-4" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      ) : null}

      <DeliveryEstimate productId={product.id} inStock={product.in_stock} className="mt-5 text-[#A9A9A9]" />

      {/* computador: o total e o botão ficam aqui mesmo, ao lado da foto */}
      <div className="mt-6 hidden items-center gap-5 rounded-[24px] bg-[#161616] p-5 ring-1 ring-white/[0.06] lg:flex">
        {buyBar}
      </div>

      {typeof document !== "undefined"
        ? createPortal(
            <div className="pd-bar fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-[#0A0A0A] px-5 pt-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] lg:hidden">
              <div className="mx-auto flex max-w-xl items-center gap-4">{buyBar}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
