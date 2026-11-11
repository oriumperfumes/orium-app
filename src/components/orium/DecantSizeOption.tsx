import type { CSSProperties, ReactNode } from "react";
import type { DecantMl } from "@/lib/decants";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";

/** Preço por ml em centavos inteiros (sem erro de ponto flutuante). */
export function pricePerMl(price: number, ml: number) {
  const cents = Math.round(Number(price) * 100);
  return Math.round(cents / ml) / 100;
}

/** Nível do líquido por tamanho — o botão vira um pequeno recipiente. */
export const DECANT_FILL: Record<DecantMl, number> = { 2: 0.24, 5: 0.52, 10: 0.96 };

/** Uma onda que se repete perfeitamente a cada 100 unidades (loop horizontal sem emenda). */
const WAVE_BACK = "M0 7 C 16 2, 34 2, 50 6 S 84 11, 100 7 S 134 2, 150 6 S 184 11, 200 7 V14 H0Z";
const WAVE_FRONT = "M0 8 C 14 11, 36 11, 50 7 S 86 3, 100 8 S 136 11, 150 7 S 186 3, 200 8 V14.5 H0Z";
const CREST = "M0 8 C 14 11, 36 11, 50 7 S 86 3, 100 8 S 136 11, 150 7 S 186 3, 200 8";

/**
 * Botão único de tamanho de decant: vidro escuro + perfume âmbar.
 * Camadas: vidro · líquido (translateY, só GPU) com ondas SVG · reflexo · conteúdo.
 * A seleção é imediata; o líquido é apenas visual.
 */
export function DecantSizeOption({
  ml,
  selected,
  onSelect,
  className,
  children,
  price,
  showPrice = false,
}: {
  ml: DecantMl;
  selected: boolean;
  onSelect: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children?: ReactNode;
  /** bloco padrão: tamanho · preço · preço/ml (página do perfume e bottom sheet) */
  showPrice?: boolean;
  /** preço final efetivo cobrado (Pricing Engine + promoção) — mostra o valor por ml */
  price?: number;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-selected={selected}
      onClick={onSelect}
      style={{ "--fill": DECANT_FILL[ml] } as CSSProperties}
      className={cn("decant-vial min-w-0 rounded-2xl", className)}
    >
      <span aria-hidden className="decant-vial__tank">
        <span className="decant-vial__liquid">
          <span className="decant-vial__body" />
          <svg className="decant-vial__wave decant-vial__wave--back" viewBox="0 0 200 14" preserveAspectRatio="none">
            <path d={WAVE_BACK.replace(" V14 H0Z", "")} />
          </svg>
          <svg className="decant-vial__wave decant-vial__wave--front" viewBox="0 0 200 14" preserveAspectRatio="none">
            <path d={CREST} className="decant-vial__glow" />
            <path d={CREST} className="decant-vial__crest" />
          </svg>
          <span className="decant-vial__bubble" style={{ left: "22%", bottom: "18%" }} />
          <span className="decant-vial__bubble decant-vial__bubble--sm" style={{ left: "71%", bottom: "34%" }} />
        </span>
      </span>
      <span aria-hidden className="decant-vial__glass" />
      <span className="decant-vial__content">
        {showPrice && price != null ? (
          <>
            <span className={cn("text-[15px] font-semibold leading-none tracking-tight", selected ? "text-foreground" : "text-foreground/90")}>
              {ml}ml
            </span>
            <span
              className={cn(
                "mt-[3px] text-[13px] font-semibold leading-none tabular-nums",
                selected ? "decant-vial__price" : "text-foreground/80",
              )}
            >
              {brl(price)}
            </span>
            {price > 0 ? (
              <span className={cn("mt-[3px] text-[10.5px] font-medium leading-none tabular-nums", selected ? "text-foreground/90" : "text-foreground/65")}>
                {brl(pricePerMl(price, ml))}/ml
              </span>
            ) : null}
            {children}
          </>
        ) : (
          <>
            {children}
            {price != null && price > 0 ? (
              <span className={cn("text-[10px] leading-none tabular-nums", selected ? "text-foreground/90" : "text-foreground/65")}>
                {brl(pricePerMl(price, ml))}/ml
              </span>
            ) : null}
          </>
        )}
      </span>
    </button>
  );
}
