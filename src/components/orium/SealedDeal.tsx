/**
 * Frasco lacrado em promoção — o cartão que puxa a venda na página do perfume.
 *
 * O lacre dourado carimba o desconto, a economia sobe até o valor real e o
 * preço por ml compara com o decant. Nada aqui decide preço: tudo vem do
 * `priceUnit`, e o selo Black só aparece em campanha Black de verdade.
 */
import { useEffect, useId, useState } from "react";
import { BlackTag } from "@/components/orium/black/Black";
import { PromotionBadge } from "@/components/orium/PromotionBadge";
import { isBlack } from "@/lib/black";
import { brl } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import type { PricedUnit } from "@/lib/promotions";
import { cn } from "@/lib/utils";

/** Contorno recortado do lacre, como selo de garantia. */
const SEAL_PATH = (() => {
  const steps = 168;
  const points: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const radius = 46 + 3.2 * Math.cos(angle * 14);
    points.push(
      `${(50 + radius * Math.cos(angle)).toFixed(2)} ${(50 + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return `M${points.join("L")}Z`;
})();

/** Sobe de zero até o valor. Usa relógio, para sempre terminar no número certo. */
function useCountUp(value: number, replay: unknown) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const startedAt = Date.now();
    const duration = 760;
    setShown(0);
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      setShown(progress === 1 ? value : value * (1 - (1 - progress) ** 3));
      if (progress === 1) window.clearInterval(timer);
    }, 32);
    return () => window.clearInterval(timer);
  }, [value, replay]);
  return shown;
}

function FoilSeal({ percent }: { percent: number }) {
  const gradient = `seal-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <span
      className="sealed-seal absolute top-3 right-3 grid size-[88px] place-items-center"
      aria-hidden
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        <defs>
          <linearGradient id={gradient} x1="10%" y1="0%" x2="90%" y2="100%">
            <stop offset="0" stopColor="#FFF0D2" />
            <stop offset="0.42" stopColor="#FFD599" />
            <stop offset="0.72" stopColor="#D9A25A" />
            <stop offset="1" stopColor="#FFE3B5" />
          </linearGradient>
        </defs>
        <path d={SEAL_PATH} fill={`url(#${gradient})`} />
        <circle
          cx="50"
          cy="50"
          r="37"
          fill="none"
          stroke="#15130F"
          strokeOpacity="0.28"
          strokeWidth="1"
        />
      </svg>
      <span className="relative flex flex-col items-center leading-none text-[#15130F]">
        <span className="text-[25px] font-black tracking-[-0.04em] tabular-nums">
          {Math.round(percent)}%
        </span>
        <span className="mt-0.5 text-[11px] font-black tracking-[0.08em]">OFF</span>
      </span>
    </span>
  );
}

export function SealedDeal({
  priced,
  word,
  volumeMl,
  decantPerMl,
  selected,
  onSelect,
}: {
  priced: PricedUnit;
  word: string;
  volumeMl?: number | null;
  /** Preço por ml do maior decant, para comparar com o frasco. */
  decantPerMl?: number | null;
  selected: boolean;
  /** Sem decant disponível o cartão é só informativo. */
  onSelect?: () => void;
}) {
  const saved = useCountUp(priced.saved, selected);
  const perMl = volumeMl ? priced.finalPrice / volumeMl : null;
  const showPerMl = perMl != null && decantPerMl != null && perMl < decantPerMl;

  const body = (
    <>
      {selected ? <span key="sheen" aria-hidden className="sealed-sheen" /> : null}
      <FoilSeal key={selected ? "seal-on" : "seal-off"} percent={priced.percent} />

      <span className="flex min-h-6 items-center pr-[92px]">
        {isBlack(priced.promotion) ? (
          <BlackTag promotion={priced.promotion} size="sm" />
        ) : (
          <PromotionBadge promotion={priced.promotion} size="sm" />
        )}
      </span>
      <span className="mt-3 block pr-[92px] text-[23px] leading-[1.08] font-extrabold tracking-[-0.025em] text-white">
        {word} lacrado
      </span>
      <span className="mt-1 block pr-[92px] text-[13.5px] text-[#CFC6B8]">
        {volumeMl ? `${volumeMl} ml, original da marca` : "Original da marca"}
      </span>

      <span className="mt-5 block text-[14px] text-[#9A9184] tabular-nums">
        <span className="sr-only">De </span>
        <span className="line-through">{brl(priced.basePrice)}</span>
      </span>
      <span className="mt-0.5 block text-[42px] leading-none font-black tracking-[-0.045em] text-white tabular-nums">
        <span className="sr-only">Por </span>
        {brl(priced.finalPrice)}
      </span>

      <span className="sealed-saving mt-3.5 inline-flex h-8 items-center rounded-full px-3 text-[13.5px] font-extrabold text-[#15130F]">
        <span className="sr-only">Você economiza {brl(priced.saved)}</span>
        <span aria-hidden className="tabular-nums">
          Você economiza {brl(saved)}
        </span>
      </span>

      {showPerMl ? (
        <span className="mt-3 block text-[13px] leading-snug text-[#CFC6B8] tabular-nums">
          <strong className="font-bold text-[#FFD599]">{brl(perMl)} por ml</strong> no frasco. No
          decant de 10 ml, {brl(decantPerMl)}.
        </span>
      ) : null}
    </>
  );

  const className = cn(
    "sealed-card relative isolate block w-full overflow-hidden rounded-[24px] p-[18px] text-left",
    selected && "is-on",
  );

  return onSelect ? (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(className, "press")}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
