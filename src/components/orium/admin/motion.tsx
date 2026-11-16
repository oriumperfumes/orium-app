import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Peças de movimento do Admin — todas com a mesma curva (`--ease-orium`) e
 * respeitando "reduzir movimento" do aparelho (as classes em styles.css somem).
 *
 * - `Collapse`: abre/fecha medindo a altura (sem salto), conteúdo sobe em cascata.
 * - `PillTrack`: a pílula branca desliza até a aba escolhida.
 * - `AnimatedNumber`: o número conta até o valor novo.
 * - `ViewSwap`: troca de tela entra suave.
 */

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Abre/fecha com altura animada. Fica montado durante a saída. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      // um quadro depois, para a transição partir do 0
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 420);
    return () => clearTimeout(t);
  }, [open]);
  if (!mounted) return null;
  return (
    <div className={cn("ui-collapse", className)} data-open={shown}>
      <div className="ui-collapse-inner">{children}</div>
    </div>
  );
}

/**
 * Grupo de abas com pílula deslizante. Os botões filhos marcam o ativo com
 * `aria-pressed="true"` (ou `data-active="true"`) e devem ter fundo transparente.
 */
export function PillTrack({
  children,
  activeKey,
  className,
  pillClassName = "bg-white",
  role = "group",
  label,
}: {
  children: ReactNode;
  activeKey: string | number | null | undefined;
  className?: string;
  pillClassName?: string;
  role?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const first = useRef(true);
  useIsoLayout(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const on = el.querySelector<HTMLElement>('[aria-pressed="true"],[data-active="true"]');
      if (!on) return setBox(null);
      setBox({ x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight });
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    Array.from(el.children).forEach((c) => ro?.observe(c));
    return () => ro?.disconnect();
  }, [activeKey]);
  useEffect(() => {
    if (box) first.current = false;
  }, [box]);
  return (
    <div ref={ref} role={role} aria-label={label} className={cn("ui-pilltrack relative", className)}>
      {box ? (
        <span
          aria-hidden
          className={cn("ui-pill pointer-events-none absolute top-0 left-0", pillClassName, first.current && "ui-pill-instant")}
          style={{ width: box.w, height: box.h, transform: `translate3d(${box.x}px, ${box.y}px, 0)` }}
        />
      ) : null}
      {children}
    </div>
  );
}

/** Número que conta até o valor novo (dinheiro ou inteiro). */
export function AnimatedNumber({ value, format = (n) => String(Math.round(n)), duration = 700 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - p, 4);
      const v = start + (value - start) * e;
      from.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

/** Troca de tela (Painel/Quadro/Lista…): entra subindo um pouco e aparecendo. */
export function ViewSwap({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <div key={id} className={cn("ui-view-in", className)}>
      {children}
    </div>
  );
}
