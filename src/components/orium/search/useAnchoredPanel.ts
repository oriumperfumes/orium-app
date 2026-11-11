import { useEffect, useState } from "react";

export type PanelBox = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "bottom" | "top";
  ready: boolean;
};

const GAP = 8;
const MIN_HEIGHT = 168;
const MAX_HEIGHT = 520;

/**
 * MOTOR DE POSIÇÃO DO PAINEL DA BUSCA.
 *
 * Mede a barra visível (âncora) e a área realmente visível da tela
 * (visualViewport, então o teclado do celular conta) e devolve posição, largura
 * e altura máxima do painel:
 *
 * - preferência abaixo da barra; se não couber, vira para cima (flip);
 * - nunca encosta na borda: mantém uma margem lateral (shift);
 * - largura acompanha a barra, limitada pela tela;
 * - altura é o espaço real disponível, então o último item nunca corta;
 * - recalcula em scroll, resize, giro de tela, teclado e troca de barra.
 */
export function useAnchoredPanel(anchor: HTMLElement | null, active: boolean, deps: unknown[] = []): PanelBox {
  const [box, setBox] = useState<PanelBox>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: MAX_HEIGHT,
    placement: "bottom",
    ready: false,
  });

  useEffect(() => {
    if (!active || !anchor || typeof window === "undefined") return;

    let frame = 0;

    const measure = () => {
      const a = anchor.getBoundingClientRect();
      if (a.width === 0 && a.height === 0) return;

      const vv = window.visualViewport;
      const vTop = vv?.offsetTop ?? 0;
      const vLeft = vv?.offsetLeft ?? 0;
      const vWidth = vv?.width ?? window.innerWidth;
      const vHeight = vv?.height ?? window.innerHeight;
      const vBottom = vTop + vHeight;
      const pad = vWidth >= 768 ? 24 : 12;

      const below = vBottom - (a.bottom + GAP) - pad;
      const above = a.top - GAP - vTop - pad;
      const placement: "bottom" | "top" = below >= MIN_HEIGHT || below >= above ? "bottom" : "top";
      const available = placement === "bottom" ? below : above;

      const width = Math.min(Math.max(a.width, 200), vWidth - pad * 2);
      const left = Math.min(Math.max(a.left, vLeft + pad), vLeft + vWidth - width - pad);
      const maxHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(available)));
      const top = placement === "bottom" ? a.bottom + GAP : Math.max(vTop + pad, a.top - GAP - maxHeight);

      setBox((prev) =>
        prev.ready &&
        prev.top === top &&
        prev.left === left &&
        prev.width === width &&
        prev.maxHeight === maxHeight &&
        prev.placement === placement
          ? prev
          : { top, left, width, maxHeight, placement, ready: true },
      );
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    schedule();

    const vv = window.visualViewport;
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("scroll", schedule, true);
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(anchor);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("scroll", schedule, true);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, active, ...deps]);

  return box;
}
