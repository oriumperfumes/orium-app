import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { DECANT_SIZES, canDecant, decantPrice, trackDecant, type DecantMl } from "@/lib/decants";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { useTopViewed } from "@/lib/product-views";
import { imgVariant } from "@/lib/product-img";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import vialsImg from "@/assets/home-decants-vials.webp";

const SIZE_NOTE: Record<DecantMl, string> = {
  2: "Para conhecer",
  5: "Para usar no dia a dia",
  10: "Para quem já se apaixonou",
};
const FEATURED: DecantMl = 5;

/**
 * Faixa de preço sem frasco: em vez de "nada encontrado", a Orium mostra que
 * os perfumes mais desejados cabem no orçamento em decant. O filtro de frasco
 * continua intacto — este painel só abre um caminho e só aparece sem resultado.
 */
export function DecantOfferSheet({
  open,
  onOpenChange,
  priceMax,
  onChooseSize,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Teto da faixa que ficou sem frasco. */
  priceMax: number | null;
  /** Escolheu um tamanho: remove a faixa de preço e passa a ver decants desse tamanho. */
  onChooseSize: (ml: DecantMl) => void;
}) {
  const settings = useDecantSettings();
  const { items } = useTopViewed(30, 6);
  const price = (ml: DecantMl) => decantPrice(null, settings, ml);
  const fits = (ml: DecantMl) => priceMax == null || price(ml) <= priceMax;

  // começa no maior tamanho que cabe no orçamento (o 5 ml, quando cabe)
  const best: DecantMl = fits(FEATURED) ? FEATURED : fits(2) ? 2 : FEATURED;
  const [ml, setMl] = useState<DecantMl>(best);
  useEffect(() => {
    if (open) setMl(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // perfumes de verdade, caros no frasco, que cabem no decant
  const showcase = items
    .filter((p) => p.image_url && canDecant(p as never) && Number(p.retail_price ?? 0) > (priceMax ?? 0))
    .slice(0, 3);

  const choose = () => {
    trackDecant("decant_size_selected", { details: { source: "price-empty", ml } });
    onChooseSize(ml);
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="decant-offer max-h-[92dvh] text-white">
        <div className="overflow-y-auto overscroll-contain px-5 pt-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {/* abertura clara, como o cartão de decants da Home */}
          <div className="do-in relative overflow-hidden rounded-[26px] bg-[#F2F1ED] px-5 pt-5 pb-0 text-[#15130F]">
            <p className="text-[13px] font-semibold text-[#8A6A2E]">
              {priceMax != null ? `Nenhum frasco até ${brl(priceMax)}` : "Nenhum frasco nessa faixa"}
            </p>
            <DrawerTitle className="mt-1 max-w-[15ch] text-[27px] leading-[1.08] font-bold tracking-[-0.03em] text-[#15130F]">
              Mas o perfume que você quer cabe em decant.
            </DrawerTitle>
            <DrawerDescription className="mt-2 max-w-[30ch] text-[14px] leading-snug text-[#5F5A53]">
              O mesmo perfume original, em 2, 5 ou 10 ml. Prove antes de levar o frasco.
            </DrawerDescription>
            <img
              src={vialsImg}
              alt=""
              aria-hidden
              width={520}
              height={404}
              className="do-vials pointer-events-none mx-auto mt-2 block h-auto w-[60%] max-w-[230px]"
            />
          </div>

          {showcase.length ? (
            <div className="do-in mt-5" style={{ "--do-d": "60ms" } as React.CSSProperties}>
              <p className="text-[13px] font-semibold text-[#A9A9A9]">Os mais procurados, em decant</p>
              <ul className="mt-2.5 space-y-2">
                {showcase.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-[18px] bg-[#1A1A1A] p-2 pr-4">
                    <span className="size-12 shrink-0 overflow-hidden rounded-[13px] bg-white">
                      <img
                        src={imgVariant(p.image_url, "thumb") ?? p.image_url ?? undefined}
                        alt=""
                        loading="lazy"
                        className="size-full object-contain p-1"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold">{productTitle(p.canonical_name)}</span>
                      {p.brand ? <span className="block truncate text-[12px] text-[#8C8C8C]">{p.brand}</span> : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[11.5px] text-[#8C8C8C] tabular-nums">
                        Frasco {brl(Number(p.retail_price))}
                      </span>
                      <span className="block text-[14px] font-bold text-[#FFD599] tabular-nums">
                        2 ml {brl(decantPrice(p as never, settings, 2))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="do-in mt-6" style={{ "--do-d": "110ms" } as React.CSSProperties}>
            <p className="text-[17px] font-bold tracking-[-0.01em]">Escolha o tamanho</p>
            <div role="radiogroup" aria-label="Tamanho do decant" className="mt-3 grid grid-cols-3 gap-2.5">
              {DECANT_SIZES.map((size) => {
                const on = ml === size;
                const ok = fits(size);
                return (
                  <button
                    key={size}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setMl(size)}
                    className={cn(
                      "do-size press relative flex min-h-[112px] flex-col items-center justify-center rounded-[20px] px-1 pt-4 pb-3 text-center",
                      on ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-white hover:bg-[#262626]",
                    )}
                  >
                    {size === FEATURED ? (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-[#FFD599] px-2 py-[3px] text-[9.5px] leading-none font-bold whitespace-nowrap text-[#15130F]">
                        Mais escolhido
                      </span>
                    ) : null}
                    <span className="text-[26px] leading-none font-bold tracking-[-0.03em]">
                      {size}
                      <span className="ml-0.5 text-[14px] font-semibold">ml</span>
                    </span>
                    <span className="mt-2 text-[15px] font-extrabold tabular-nums">{brl(price(size))}</span>
                    <span className={cn("mt-0.5 px-1 text-[10.5px] leading-tight", on ? "text-[#5F5A53]" : "text-[#8C8C8C]")}>
                      {SIZE_NOTE[size]}
                    </span>
                    {priceMax != null && ok ? (
                      <span
                        className={cn(
                          "mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold",
                          on ? "text-[#2E7D4F]" : "text-[#7FCF9F]",
                        )}
                      >
                        <Check className="size-3" strokeWidth={3} /> Cabe nos {brl(priceMax).replace(",00", "")}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="do-in sticky bottom-0 -mx-5 mt-4 space-y-1 bg-gradient-to-t from-[#121212] from-80% to-[#121212]/0 px-5 pt-4" style={{ "--do-d": "160ms" } as React.CSSProperties}>
            <button
              type="button"
              onClick={choose}
              className="press flex h-[56px] w-full items-center justify-center rounded-full bg-[#FFD599] text-[16px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]"
            >
              <span key={ml} className="value-in">
                Ver perfumes em decant de {ml} ml
              </span>
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="press h-12 w-full rounded-full text-[14px] font-semibold text-[#A9A9A9] transition-colors hover:text-white"
            >
              Continuar vendo frascos
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
