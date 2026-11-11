import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Trilho horizontal único da Orium — o mesmo dos "perfumes parecidos" da página
 * do perfume, agora reaproveitado também nos carrosséis da Home.
 *
 * Regras que vivem aqui (e em nenhum outro lugar):
 * - rolagem nativa: inércia e desaceleração do próprio sistema, sem drag em JS;
 * - snap suave (`snap-proximity`) sempre ativo, para o gesto terminar alinhado
 *   sem "puxar" o card à força;
 * - `hcarousel` (styles.css) mantém o movimento só na horizontal: gesto
 *   vertical vai direto para a página e o card nunca sobe nem desce;
 * - a lista abre no começo real, com o 1º card inteiro visível.
 */
export const HCarousel = forwardRef<
  HTMLDivElement,
  {
    className?: string;
    /** Muda quando a lista muda: reancorar o início. */
    resetKey?: unknown;
    onScroll?: () => void;
    children: React.ReactNode;
    "aria-label"?: string;
  }
>(function HCarousel({ className, resetKey, onScroll, children, ...rest }, forwarded) {
  const inner = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(forwarded, () => inner.current as HTMLDivElement);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    // O snap pode reposicionar a lista durante a montagem e cortar o 1º card.
    const pin = () => {
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    };
    pin();
    const raf = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(raf);
  }, [resetKey]);

  return (
    <div
      ref={inner}
      onScroll={onScroll}
      className={cn("hcarousel flex snap-x snap-proximity pb-1", className)}
      {...rest}
    >
      {children}
    </div>
  );
});
