/**
 * Peças visuais da BLACK NOVEMBER — selo, contagem, escassez e preço.
 * Preto e branco de verdade com o dourado da Orium só no desconto.
 * Nada aqui decide preço: tudo recebe o que `priceUnit` já calculou.
 */
import type { Promotion } from "@/lib/promotions";
import { blackLabel, remaining, scarcity, useNowSeconds } from "@/lib/black";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Selo "BLACK | NOVEMBER" — bloco branco + bloco preto, como etiqueta de vitrine. */
export function BlackTag({
  promotion,
  size = "md",
  className,
}: {
  promotion?: Pick<Promotion, "name"> | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const { a, b } = blackLabel(promotion);
  return (
    <span
      className={cn(
        "black-tag inline-flex shrink-0 items-stretch overflow-hidden font-black tracking-[0.06em] uppercase leading-none ring-1 ring-white/25",
        size === "xs" && "rounded-[5px] text-[8.5px]",
        size === "sm" && "rounded-[6px] text-[9.5px]",
        size === "md" && "rounded-[7px] text-[11px]",
        size === "lg" && "rounded-[9px] text-[13px]",
        className,
      )}
      aria-label={`${a} ${b}`}
    >
      <span
        className={cn(
          "bg-white text-black",
          size === "xs" ? "px-1 py-[3px]" : size === "sm" ? "px-1.5 py-1" : size === "md" ? "px-2 py-[5px]" : "px-2.5 py-1.5",
        )}
      >
        {a}
      </span>
      <span
        className={cn(
          "bg-black text-white",
          size === "xs" ? "px-1 py-[3px]" : size === "sm" ? "px-1.5 py-1" : size === "md" ? "px-2 py-[5px]" : "px-2.5 py-1.5",
        )}
      >
        {b}
      </span>
    </span>
  );
}

/** "68% OFF" — o único dourado do bloco. */
export function BlackOff({ percent, className }: { percent: number; className?: string }) {
  if (!(percent > 0)) return null;
  return (
    <span className={cn("font-extrabold tracking-[-0.01em] text-[#FFD599] tabular-nums", className)}>
      {Math.round(percent)}% OFF
    </span>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Contagem regressiva até o fim REAL da promoção. Sem data de fim, não aparece.
 * `variant="boxes"`: dígitos em caixinhas (página do perfume e Home);
 * `variant="inline"`: uma linha curta (cards).
 */
export function BlackCountdown({
  endsAt,
  variant = "inline",
  label = "Acaba em",
  className,
}: {
  endsAt: string | number | null | undefined;
  variant?: "inline" | "boxes";
  label?: string;
  className?: string;
}) {
  const now = useNowSeconds();
  const end = endsAt == null ? NaN : typeof endsAt === "number" ? endsAt : new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  const r = remaining(end, now);
  if (!r) {
    // antes de hidratar (now = 0) reserva o espaço; depois do fim some.
    return now ? null : <span className={cn("block h-5", className)} aria-hidden />;
  }

  if (variant === "inline") {
    const text = r.d > 0 ? `${r.d}d ${pad(r.h)}:${pad(r.m)}:${pad(r.s)}` : `${pad(r.h)}:${pad(r.m)}:${pad(r.s)}`;
    return (
      <span className={cn("inline-flex items-center gap-1 text-[10.5px] font-semibold text-[#CFCFCF] tabular-nums", className)}>
        <span aria-hidden className="black-dot size-1.5 rounded-full bg-[#FFD599]" />
        {label} <span className="font-bold text-white">{text}</span>
      </span>
    );
  }

  const parts: Array<[number, string]> = [
    ...(r.d > 0 ? ([[r.d, "dias"]] as Array<[number, string]>) : []),
    [r.h, "horas"],
    [r.m, "min"],
    [r.s, "seg"],
  ];
  return (
    <div className={cn("flex items-center gap-2.5", className)} role="timer" aria-live="off">
      <span className="text-[12px] font-semibold text-[#A9A9A9]">{label}</span>
      <span className="flex items-start gap-1">
        {parts.map(([v, unit], i) => (
          <span key={unit} className="flex items-start gap-1">
            {i > 0 ? <span className="pt-[5px] text-[13px] font-bold text-[#5C5C5C]">:</span> : null}
            <span className="flex flex-col items-center">
              <span
                key={unit === "seg" ? v : undefined}
                className={cn(
                  "grid h-[30px] min-w-[32px] place-items-center rounded-[8px] bg-black px-1 text-[15px] font-extrabold text-white tabular-nums ring-1 ring-white/12",
                  unit === "seg" && "black-sec",
                )}
              >
                {unit === "dias" ? v : pad(v)}
              </span>
              <span className="mt-1 text-[9.5px] font-semibold tracking-wide text-[#7A7A7A] uppercase">{unit}</span>
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/** Escassez real do frasco: "Última unidade" / "Restam só N unidades". */
export function BlackScarcity({
  product,
  variant = "inline",
  className,
}: {
  product: { in_stock?: boolean | null; stock_quantity?: number | null };
  variant?: "inline" | "bar";
  className?: string;
}) {
  const s = scarcity(product);
  if (!s) return null;
  if (variant === "inline") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold text-white", className)}>
        <span aria-hidden className="black-dot size-1.5 rounded-full bg-white" />
        {s.text}!
      </span>
    );
  }
  // barra que mostra o pouco que sobrou (1 de 3 = um terço cheio)
  const fill = Math.max(12, Math.round((s.left / 3) * 100 * 0.6));
  return (
    <div className={cn("min-w-0", className)}>
      <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-white">
        <span aria-hidden className="black-dot size-2 rounded-full bg-white" />
        {s.text}!
        <span className="font-medium text-[#A9A9A9]">{s.left === 1 ? "Depois dela, acabou." : "Garanta a sua."}</span>
      </p>
      <span className="mt-2 block h-[5px] w-full overflow-hidden rounded-full bg-white/10">
        <span className="black-bar block h-full rounded-full bg-white" style={{ width: `${fill}%` }} />
      </span>
    </div>
  );
}

/** Preço no estilo vitrine: "de R$ 400" riscado em cima, preço grande + "68% OFF". */
export function BlackPrice({
  base,
  final,
  percent,
  size = "card",
  suffix,
  className,
}: {
  base: number;
  final: number;
  percent: number;
  size?: "card" | "page";
  suffix?: React.ReactNode;
  className?: string;
}) {
  const page = size === "page";
  return (
    <div className={cn("promo-price min-w-0", className)}>
      <p className={cn("text-[#8C8C8C] tabular-nums", page ? "text-[14px]" : "text-[11px]")}>
        <span className="line-through">{brl(base)}</span>
      </p>
      <p className={cn("flex flex-wrap items-baseline gap-x-2", page ? "mt-0.5" : "")}>
        <span
          className={cn(
            "leading-none font-extrabold tracking-tight text-white tabular-nums",
            page ? "text-[36px] tracking-[-0.035em]" : "text-[18px] tab:text-[20px] @min-[220px]/card:text-[22px]",
          )}
        >
          {brl(final)}
        </span>
        <BlackOff percent={percent} className={page ? "text-[17px]" : "text-[12px] @min-[220px]/card:text-[13px]"} />
        {suffix}
      </p>
    </div>
  );
}
