import { useEffect, useState } from "react";

export type VisualViewportState = {
  /** altura realmente visível (descontando o teclado no iOS Safari) */
  height: number;
  /** início vertical da área realmente visível */
  offsetTop: number;
  /** quanto o teclado ocupa na parte de baixo da tela */
  keyboardOffset: number;
  /** teclado virtual aberto */
  isKeyboardOpen: boolean;
  /** o navegador expõe a Visual Viewport API */
  supported: boolean;
};

/**
 * Acompanha o viewport realmente visível.
 *
 * No iOS Safari o teclado virtual não altera o layout viewport (window.innerHeight),
 * apenas o visual viewport — por isso elementos `position: fixed; bottom: 0`
 * ficam escondidos atrás do teclado e o painel perde a proporção.
 * Aqui usamos window.visualViewport (com detecção de suporte) para saber a altura
 * visível real e o quanto o teclado ocupa.
 */
export function useVisualViewport(active = true): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>({
    height: 0,
    offsetTop: 0,
    keyboardOffset: 0,
    isKeyboardOpen: false,
    supported: false,
  });

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) {
      setState({ height: window.innerHeight, offsetTop: 0, keyboardOffset: 0, isKeyboardOpen: false, supported: false });
      return;
    }

    let frame = 0;
    /**
     * Altura da tela sem teclado (maior já vista nesta orientação). No Android
     * o layout encolhe junto com o teclado (interactive-widget=resizes-content),
     * então o teclado é detectado pela perda de altura, não só pela sobra.
     */
    let base = { w: window.innerWidth, h: Math.max(window.innerHeight, vv.height) };
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = vv.height;
        if (window.innerWidth !== base.w) base = { w: window.innerWidth, h: Math.max(window.innerHeight, height) };
        else base.h = Math.max(base.h, window.innerHeight);
        // iOS: o teclado cobre o layout (sobra entre o visível e o layout)
        const offset = Math.max(0, window.innerHeight - height - vv.offsetTop);
        // Android: o layout inteiro encolhe
        const shrink = Math.max(0, base.h - height);
        // barras do navegador variam ~120px; o teclado é sempre bem maior
        const isKeyboardOpen = offset > 140 || shrink > 160;
        setState((prev) => {
          const next = {
            height,
            offsetTop: vv.offsetTop,
            keyboardOffset: offset > 140 ? offset : 0,
            isKeyboardOpen,
            supported: true,
          };
          // nada mudou de verdade: sem novo render (evita tremer durante a digitação)
          return prev.height === next.height &&
            prev.offsetTop === next.offsetTop &&
            prev.keyboardOffset === next.keyboardOffset &&
            prev.isKeyboardOpen === next.isKeyboardOpen &&
            prev.supported
            ? prev
            : next;
        });
      });
    };

    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    window.addEventListener("orientationchange", read);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
      window.removeEventListener("orientationchange", read);
    };
  }, [active]);

  return state;
}
