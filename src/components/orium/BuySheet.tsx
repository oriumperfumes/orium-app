import { useEffect, useRef, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { brl, productTitle } from "@/lib/format";
import { useCart } from "@/lib/cart";
import { flyToCart } from "@/lib/fly-to-cart";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { usePromotions } from "@/lib/use-promotions";
import { priceUnit } from "@/lib/promotions";
import { PromotionBadge } from "@/components/orium/PromotionBadge";
import { DECANT_SIZES, decantPrice, trackDecant, canDecant, canFullBottle, type DecantMl } from "@/lib/decants";
import { usePriceView } from "@/lib/decant-size";
import { cn } from "@/lib/utils";
import { comboAcceptsSize } from "@/lib/decant-combos";
import { ComboTag, DecantComboPromo, comboAddTotal, useFeaturedCombo } from "@/components/orium/DecantCombo";
import { DeliveryEstimate } from "@/components/orium/badges";
import type { CatalogProduct } from "./ProductCard";

type Choice = { kind: "decant"; ml: DecantMl } | { kind: "full" };

/** O decant que a maioria leva — vem marcado e pré-selecionado. */
const FEATURED_ML: DecantMl = 5;

const SIZE_NOTE: Record<DecantMl, string> = {
  2: "Para provar",
  5: "Dia a dia",
  10: "Para quem ama",
};

/**
 * "Adicionar" dos cards (Home, catálogo, parecidos) — escolha rápida sem sair
 * da tela. Mesmo visual do app: folha escura, foto no quadro branco, tamanhos
 * grandes e um único botão dourado. O decant vem na frente (é o foco da
 * loja), mas o frasco completo está a um toque, sem esconder nada.
 */
export function BuySheet({
  product,
  open,
  onOpenChange,
}: {
  product: CatalogProduct | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const cart = useCart();
  const settings = useDecantSettings();
  const promotions = usePromotions();
  const priceView = usePriceView();
  const { featured: comboRow } = useFeaturedCombo();
  const decantOk = canDecant(product);
  const fullOk = !!product && canFullBottle(product) && !!product.retail_price;

  // decant primeiro: o tamanho que o catálogo está mostrando, senão o mais escolhido
  const initialChoice = (): Choice => {
    if (!decantOk) return { kind: "full" };
    return { kind: "decant", ml: priceView === "frasco" ? FEATURED_ML : priceView };
  };
  const [choice, setChoice] = useState<Choice>(initialChoice);
  const [qty, setQty] = useState(1);
  const [done, setDone] = useState(false);
  const imgRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setChoice(initialChoice());
    setQty(1);
    setDone(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  if (!product) return null;

  const prices = {
    2: decantPrice(product, settings, 2),
    5: decantPrice(product, settings, 5),
    10: decantPrice(product, settings, 10),
  } as Record<DecantMl, number>;
  const decantPriced = {
    2: priceUnit(prices[2], promotions, { productId: product.id, variant: "DECANT", decantMl: 2 }),
    5: priceUnit(prices[5], promotions, { productId: product.id, variant: "DECANT", decantMl: 5 }),
    10: priceUnit(prices[10], promotions, { productId: product.id, variant: "DECANT", decantMl: 10 }),
  } as Record<DecantMl, ReturnType<typeof priceUnit>>;
  const fullPriced = priceUnit(Number(product.retail_price ?? 0), promotions, { productId: product.id, variant: "FULL" });
  const activePromo =
    fullPriced.promotion ?? decantPriced[2].promotion ?? decantPriced[5].promotion ?? decantPriced[10].promotion ?? null;

  const unit = choice.kind === "decant" ? decantPriced[choice.ml].finalPrice : fullPriced.finalPrice;
  // com combo no ar, escolher a quantidade do combo já mostra o preço dele
  const comboOn = choice.kind === "decant" && !!comboRow && comboAcceptsSize(comboRow.combo, choice.ml);
  const total = comboOn && comboRow ? comboAddTotal(comboRow.combo, unit, qty) : unit * qty;
  const label = choice.kind === "decant" ? `Decant ${choice.ml} ml` : `Frasco ${product.volume_ml ? `${product.volume_ml} ml` : ""}`.trim();
  const accords = (product.accords ?? []).slice(0, 3);

  const add = () => {
    if (done) return;
    if (choice.kind === "decant") {
      cart.add(
        {
          productId: product.id,
          variant: "DECANT",
          decantMl: choice.ml,
          slug: product.slug,
          name: product.canonical_name,
          brand: product.brand,
          image: product.image_url,
          volumeMl: choice.ml,
          concentration: product.concentration,
          retailPrice: prices[choice.ml],
          wholesalePrice: prices[choice.ml],
        },
        qty,
      );
      trackDecant("decant_added", {
        productId: product.id,
        variant: `DECANT_${choice.ml}`,
        details: { price: prices[choice.ml], qty, source: "buy_sheet" },
      });
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
    setDone(true);
    // sem a barra inferior na tela (ex.: página do perfume), confirma com um aviso
    if (!document.querySelector(".orium-nav.is-shown")) {
      toast.success("Adicionado à sacola", {
        description: `${productTitle(product.canonical_name)} · ${label}`,
        duration: 2200,
        action: { label: "Ver sacola", onClick: () => cart.setOpen(true) },
      });
    }
    // a foto viaja até o carrinho da barra inferior; a folha desce logo depois
    flyToCart(imgRef.current, product.image_url);
    window.setTimeout(() => onOpenChange(false), 520);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="buy-sheet rounded-t-[30px] border-0 bg-[#121212] px-0 pb-0 text-white [&>div:first-child]:mt-3 [&>div:first-child]:h-1.5 [&>div:first-child]:w-11 [&>div:first-child]:bg-white/20">
        {/* perfume */}
        <div className="bs-in flex items-center gap-4 px-5 pt-5" style={{ "--bs-d": "0ms" } as React.CSSProperties}>
          <span ref={imgRef} className="grid size-[84px] shrink-0 place-items-center overflow-hidden rounded-[16px] bg-white">
            {product.image_url ? <img src={product.image_url} alt="" className="size-full object-contain p-1.5" /> : null}
          </span>
          <div className="min-w-0 flex-1">
            {product.brand ? <p className="truncate text-[12px] font-medium text-[#B1B1B1]">{product.brand}</p> : null}
            <DrawerTitle className="mt-0.5 line-clamp-2 text-[20px] leading-[1.15] font-bold tracking-[-0.02em] text-white">
              {productTitle(product.canonical_name)}
            </DrawerTitle>
            <DrawerDescription className={cn("mt-1 truncate text-[13px] text-[#A9A9A9]", !accords.length && "sr-only")}>
              {accords.length ? accords.join(", ") : "Escolha como levar"}
            </DrawerDescription>
            {activePromo ? <PromotionBadge promotion={activePromo} size="sm" className="mt-1.5" /> : null}
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto overscroll-contain px-5 pt-6 pb-2">
          {decantOk ? (
            <section className="bs-in" style={{ "--bs-d": "50ms" } as React.CSSProperties}>
              <div className="flex items-baseline justify-between">
                <h3 className="text-[17px] font-bold tracking-[-0.01em]">Decant</h3>
                <span className="text-[12px] text-[#A9A9A9]">Prove antes do frasco</span>
              </div>
              <div role="radiogroup" aria-label="Tamanho do decant" className="mt-3 grid grid-cols-3 gap-2.5">
                {DECANT_SIZES.map((ml) => {
                  const on = choice.kind === "decant" && choice.ml === ml;
                  const pr = decantPriced[ml];
                  return (
                    <button
                      key={ml}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setChoice({ kind: "decant", ml });
                        trackDecant("decant_size_selected", { productId: product.id, variant: `DECANT_${ml}` });
                      }}
                      className={cn(
                        "bs-size press relative flex min-h-[104px] flex-col items-center justify-center rounded-[20px] px-1 pt-4 pb-3 text-center",
                        on ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-white hover:bg-[#262626]",
                      )}
                    >
                      {comboRow && comboAcceptsSize(comboRow.combo, ml) ? (
                        <ComboTag combo={comboRow.combo} />
                      ) : ml === FEATURED_ML ? (
                        <span
                          className={cn(
                            "absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-[3px] text-[9.5px] leading-none font-bold whitespace-nowrap",
                            "bg-[#FFD599] text-[#15130F]",
                          )}
                        >
                          Mais escolhido
                        </span>
                      ) : null}
                      <span className="text-[24px] leading-none font-bold tracking-[-0.03em]">
                        {ml}
                        <span className="ml-0.5 text-[14px] font-semibold">ml</span>
                      </span>
                      <span className="mt-2 text-[14px] font-extrabold tabular-nums">{brl(pr.finalPrice)}</span>
                      {pr.promotion ? (
                        <span className={cn("text-[10.5px] line-through tabular-nums", on ? "text-[#8A857E]" : "text-[#8C8C8C]")}>
                          {brl(prices[ml])}
                        </span>
                      ) : (
                        <span className={cn("mt-0.5 text-[10.5px] leading-tight", on ? "text-[#5F5A53]" : "text-[#8C8C8C]")}>
                          {SIZE_NOTE[ml]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {choice.kind === "decant" ? (
                <DecantComboPromo
                  ml={choice.ml}
                  onPick={(ml) => setChoice({ kind: "decant", ml })}
                  className="mt-3"
                />
              ) : null}
            </section>
          ) : null}

          {fullOk ? (
            <section className="bs-in mt-6" style={{ "--bs-d": "100ms" } as React.CSSProperties}>
              <h3 className="text-[17px] font-bold tracking-[-0.01em]">Frasco completo</h3>
              <button
                type="button"
                role="radio"
                aria-checked={choice.kind === "full"}
                onClick={() => setChoice({ kind: "full" })}
                className={cn(
                  "bs-size press mt-3 flex min-h-[60px] w-full items-center justify-between gap-3 rounded-[20px] px-4 text-left",
                  choice.kind === "full" ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-white hover:bg-[#262626]",
                )}
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold">
                    {product.volume_ml ? `${product.volume_ml} ml` : "Frasco original"}
                  </span>
                  <span className={cn("block truncate text-[12px]", choice.kind === "full" ? "text-[#5F5A53]" : "text-[#8C8C8C]")}>
                    {product.concentration ? `${product.concentration} · lacrado` : "Original e lacrado"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[15px] font-extrabold tabular-nums">{brl(fullPriced.finalPrice)}</span>
                  {fullPriced.promotion ? (
                    <span className="block text-[11px] text-[#8C8C8C] line-through tabular-nums">{brl(fullPriced.basePrice)}</span>
                  ) : null}
                </span>
              </button>
            </section>
          ) : decantOk ? (
            <p className="bs-in mt-5 text-[12.5px] text-[#8C8C8C]" style={{ "--bs-d": "100ms" } as React.CSSProperties}>
              Frasco completo indisponível no momento.
            </p>
          ) : null}

          <div className="bs-in mt-6 flex items-center" style={{ "--bs-d": "150ms" } as React.CSSProperties}>
            <span className="text-[15px] font-semibold">Quantidade</span>
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
              <span key={qty} className="value-in min-w-7 text-center text-[15px] font-bold tabular-nums">
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

          <DeliveryEstimate productId={product.id} inStock={product.in_stock} className="mt-5 text-[#A9A9A9]" />
        </div>

        <div className="px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={add}
            disabled={choice.kind === "full" ? !fullOk : !decantOk}
            className={cn(
              "press flex h-[54px] w-full items-center justify-between rounded-full pr-2 pl-6 text-[16px] font-bold text-[#15130F] transition-colors duration-200 disabled:opacity-40",
              done ? "bg-white" : "bg-[#FFD599]",
            )}
          >
            {done ? (
              <span className="check-pop mx-auto inline-flex items-center gap-2">
                <Check className="size-5" strokeWidth={2.6} /> Adicionado
              </span>
            ) : (
              <>
                <span key={label} className="value-in truncate">
                  Adicionar {label.toLowerCase().startsWith("decant") ? label.replace("Decant ", "") : "frasco"}
                </span>
                <span key={`${total}-${qty}`} className="value-in ml-3 shrink-0 rounded-full bg-[#15130F] px-4 py-2.5 text-[15px] font-extrabold text-white tabular-nums">
                  {brl(total)}
                </span>
              </>
            )}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
