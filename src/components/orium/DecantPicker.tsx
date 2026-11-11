import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, Plus, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";
import { useCart } from "@/lib/cart";
import { useKit } from "@/lib/kit";
import { flyToCart } from "@/lib/fly-to-cart";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { DECANT_SIZES, DECANT_HINT, decantPrice, trackDecant, canDecant, type DecantMl, type DecantPriced } from "@/lib/decants";
import { usePromotions } from "@/lib/use-promotions";
import { priceUnit } from "@/lib/promotions";
import { useGlobalDecantSize } from "@/lib/decant-size";
import { cn } from "@/lib/utils";
import { PixNote } from "./PixNote";
import { DecantSizeOption } from "./DecantSizeOption";
import { ComboTag, DecantComboPromo, useComboForSize } from "./DecantCombo";

export type DecantProduct = DecantPriced & {
  id: string;
  product_type?: string | null;
  slug: string;
  canonical_name: string;
  brand: string | null;
  image_url: string | null;
  volume_ml: number | null;
  concentration: string | null;
  in_stock?: boolean | null;
  stock_quantity?: number | null;
};

const stop = (e: React.SyntheticEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/** Preços dos três tamanhos já resolvidos (override → global → oficial). */
export function useDecantPrices(product: DecantPriced | null | undefined) {
  const settings = useDecantSettings();
  return {
    2: decantPrice(product, settings, 2),
    5: decantPrice(product, settings, 5),
    10: decantPrice(product, settings, 10),
  } as Record<DecantMl, number>;
}

/** Seletor 2ml | 5ml | 10ml — três opções lado a lado, sempre cabem em 320px. */
export function SizeSelector({
  value,
  onChange,
  prices,
  size = "md",
  showHint,
  className,
}: {
  value: DecantMl;
  onChange: (ml: DecantMl) => void;
  prices: Record<DecantMl, number>;
  size?: "sm" | "md" | undefined;
  showHint?: boolean | undefined;
  className?: string | undefined;
}) {
  const comboFor = useComboForSize();
  const anyCombo = DECANT_SIZES.some((ml) => comboFor(ml));
  return (
    <div className={cn("grid grid-cols-3 gap-1.5", anyCombo && "pt-2", className)} role="radiogroup" aria-label="Tamanho do decant">
      {DECANT_SIZES.map((ml) => {
        const on = value === ml;
        const combo = comboFor(ml);
        return (
          <div key={ml} className="relative min-w-0">
            {combo ? <ComboTag combo={combo} /> : null}
          <DecantSizeOption
            ml={ml}
            selected={on}
            onSelect={(e) => {
              stop(e);
              onChange(ml);
            }}
            className={cn("h-full w-full", size === "sm" ? "min-h-11 gap-0.5 px-1 py-1" : "min-h-14 gap-0.5 px-1 py-1.5")}
            price={prices[ml]}
          >
            <span className={cn("font-semibold leading-none", size === "sm" ? "text-[12px]" : "text-[13px]")}>{ml}ml</span>
            {showHint ? (
              <span className={cn("mt-1 text-[9.5px] leading-tight", on ? "text-foreground/85" : "text-muted-foreground/80")}>{DECANT_HINT[ml]}</span>
            ) : null}
            <span
              className={cn(
                "mt-1 leading-none tabular-nums",
                size === "sm" ? "text-[10px]" : "text-[11px]",
                on ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {brl(prices[ml])}
            </span>
          </DecantSizeOption>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Bloco completo de compra de decant: tamanho + CTA "Adicionar 5ml • R$ 39,90".
 * Modo kit: vira "+ Adicionar ao kit" / check.
 */
export function DecantPicker({
  product,
  flyFrom,
  compact,
  showHint,
  className,
  cta,
}: {
  product: DecantProduct;
  flyFrom?: RefObject<HTMLElement | null>;
  compact?: boolean;
  showHint?: boolean;
  className?: string;
  /** rótulo alternativo (página do perfume) */
  cta?: string;
}) {
  const cart = useCart();
  const kit = useKit();
  const prices = useDecantPrices(product);
  const promotions = usePromotions();
  // preço mostrado já com promoção; o carrinho guarda o preço cheio e recalcula sozinho
  const displayPrices = {
    2: priceUnit(prices[2], promotions, { productId: product.id, variant: "DECANT", decantMl: 2 }).finalPrice,
    5: priceUnit(prices[5], promotions, { productId: product.id, variant: "DECANT", decantMl: 5 }).finalPrice,
    10: priceUnit(prices[10], promotions, { productId: product.id, variant: "DECANT", decantMl: 10 }).finalPrice,
  } as Record<DecantMl, number>;
  const globalMl = useGlobalDecantSize();
  const [ml, setMl] = useState<DecantMl>(globalMl);
  const [added, setAdded] = useState<DecantMl | null>(null);
  const [hint, setHint] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // outro perfume → seletor volta ao padrão, carrinho intocado
  useEffect(() => {
    setMl(globalMl);
    setAdded(null);
    setHint(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  // banner mudou o tamanho enquanto a página estava aberta → acompanha
  useEffect(() => {
    setMl(globalMl);
  }, [globalMl]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const inKit = kit.has(product.id);
  const available = canDecant(product);

  const pick = (next: DecantMl) => {
    setMl(next);
    trackDecant("decant_size_selected", { productId: product.id, variant: `DECANT_${next}` });
  };

  const add = (e: React.MouseEvent) => {
    stop(e);
    if (!available) return;
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
    flyToCart(flyFrom?.current ?? (e.currentTarget as HTMLElement), product.image_url);
    trackDecant("decant_added", { productId: product.id, variant: `DECANT_${ml}`, details: { price: prices[ml] } });
    toast.success("Adicionado", {
      description: `${product.canonical_name} · ${ml}ml • ${brl(displayPrices[ml])}`,
      duration: 1600,
    });
    setAdded(ml);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(null), 1300);
  };

  const toggleKit = (e: React.MouseEvent) => {
    stop(e);
    kit.toggle({
      productId: product.id,
      slug: product.slug,
      name: product.canonical_name,
      brand: product.brand,
      image: product.image_url,
      ml,
      prices,
    });
  };

  if (!available) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-border/70 px-3 py-2.5 text-center text-xs text-muted-foreground", className)}>
        Decant indisponível
      </div>
    );
  }

  return (
    <div className={className} onClick={stop}>
      <div className="mb-1.5 flex items-center justify-between">
        <p className={cn("font-medium", compact ? "text-[11px]" : "text-xs")}>Escolha o tamanho</p>
        {showHint ? null : (
          <button
            type="button"
            aria-label="Sobre os tamanhos"
            aria-expanded={hint}
            onClick={(e) => {
              stop(e);
              setHint((v) => !v);
            }}
            className="press -mr-1 grid size-7 place-items-center rounded-full text-muted-foreground"
          >
            <Info className="size-3.5" />
          </button>
        )}
      </div>

      <SizeSelector value={ml} onChange={pick} prices={displayPrices} size={compact ? "sm" : "md"} showHint={showHint} />

      {hint ? (
        <ul className="value-in mt-2 space-y-0.5 rounded-xl bg-surface-3 px-3 py-2 text-[11px] text-muted-foreground">
          {DECANT_SIZES.map((s) => (
            <li key={s}>
              <span className="font-semibold text-foreground">{s}ml</span> — {DECANT_HINT[s]}
            </li>
          ))}
        </ul>
      ) : null}

      {kit.active ? (
        <Button
          size="lg"
          variant={inKit ? "default" : "outline"}
          className={cn("press mt-2 h-11 w-full rounded-full text-sm", inKit && "bg-gold text-gold-foreground hover:bg-gold")}
          onClick={toggleKit}
        >
          {inKit ? (
            <>
              <Check className="check-pop size-4" /> No kit · {ml}ml
            </>
          ) : (
            <>
              <Plus className="size-4" /> Adicionar ao kit
            </>
          )}
        </Button>
      ) : (
        <Button
          size="lg"
          className={cn("press mt-2 w-full rounded-full", compact ? "h-11 text-sm" : "h-12 text-[15px]")}
          onClick={add}
          aria-live="polite"
        >
          {added ? (
            <span key="ok" className="check-pop inline-flex items-center gap-1.5">
              <Check className="size-4" /> Adicionado ✓
            </span>
          ) : (
            <span key={ml} className="price-morph inline-flex items-center gap-1.5">
              <Plus className="size-4" /> {cta ?? "Adicionar"} {ml}ml • {brl(displayPrices[ml])}
            </span>
          )}
        </Button>
      )}

      <DecantComboPromo ml={ml} onPick={pick} className="mt-2.5" />
      <PixNote amount={displayPrices[ml]} className="mt-2" />
    </div>
  );
}
