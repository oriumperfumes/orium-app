/**
 * SCROLL REVEAL — seções abaixo da dobra entram suavemente quando aparecem
 * na tela (opacity 0→1 + translateY 10px→0, ~340ms).
 *
 * Regras: IntersectionObserver (nada de listener de scroll), anima UMA vez,
 * só transform/opacity, e se a seção já estiver visível ao abrir a página
 * (posição restaurada) ela aparece imediatamente.
 * Este sistema é independente da transição de abertura da página (route motion).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * Marca como visível na primeira vez que o elemento aparece na tela.
 * O ref é uma função: funciona mesmo quando o elemento só surge depois
 * (seção que espera dados) — antes, ela ficava invisível para sempre.
 */
export function useRevealOnce<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen]);

  return { ref, seen } as const;
}

export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  /** atraso curto para stagger discreto (30–60ms entre itens) */
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "ul";
}) {
  const { ref, seen } = useRevealOnce<HTMLElement>();
  const Component = Tag as "div";
  return (
    <Component
      ref={ref as never}
      style={{ ["--delay" as string]: `${delay}ms` }}
      className={`reveal ${seen ? "is-in" : ""} ${className}`}
    >
      {children}
    </Component>
  );
}
