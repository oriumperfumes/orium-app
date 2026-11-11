import { useEffect, useRef, useState } from "react";
import { MOTION, prefersReducedMotion } from "@/lib/motion";

type Props = {
  /** null/undefined = valor indisponível: mostra "—" em vez de 0 */
  value: number | null | undefined;
  /** "BRL" formata em moeda pt-BR; "percent" adiciona % */
  format?: "number" | "BRL" | "percent";
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
  /** texto quando o valor é indisponível */
  placeholder?: string;
};


function formatValue(v: number, format: Props["format"], decimals: number) {
  if (format === "BRL")
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  const n = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
  return format === "percent" ? `${n}%` : n;
}

/**
 * Count-up puramente visual: o valor final é sempre o número real recebido.
 * Só reanima quando o valor muda de verdade (não em rerender/foco).
 */
export function AnimatedMetric({
  value,
  format = "number",
  decimals = format === "BRL" ? 2 : 0,
  prefix,
  suffix,
  duration,
  className,
  placeholder = "—",
}: Props) {
  const known = typeof value === "number" && Number.isFinite(value);
  const target = known ? (value as number) : null;
  const [shown, setShown] = useState<number | null>(null);
  // espelho síncrono do que está na tela: evita "—" preso se o efeito for
  // reexecutado (StrictMode) e permite animar do valor anterior real.
  const shownRef = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  const put = (v: number | null) => {
    shownRef.current = v;
    setShown(v);
  };

  useEffect(() => {
    if (target === null) {
      put(null);
      return;
    }
    if (shownRef.current === target) return;
    // primeira vez anima de 0; depois anima do valor anterior real
    const from = shownRef.current ?? 0;

    if (prefersReducedMotion()) {
      put(target);
      return;
    }
    const span = Math.abs(target - from);
    const dur =
      duration ??
      (format === "BRL" || span >= 1000 ? MOTION.countUpLong : span >= 100 ? MOTION.countUp : MOTION.countUpShort);
    const start = performance.now();
    const delta = target - from;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out
      put(t < 1 ? from + delta * eased : target);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, format]);


  if (shown === null) {
    return (
      <span className={className} aria-label="valor indisponível">
        {placeholder}
      </span>
    );
  }

  const rounded = decimals > 0 ? shown : Math.round(shown);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {prefix}
      {formatValue(rounded, format, decimals)}
      {suffix}
    </span>
  );

}
