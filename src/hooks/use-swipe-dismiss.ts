import { useCallback, useRef } from "react";

/**
 * Arrastar para fechar — avisos e pop-ups saem pela borda de onde vieram.
 * `dir="down"` para os que sobem do rodapé, `dir="up"` para os que descem do topo.
 *
 * - O cartão segue o dedo; no sentido contrário ele resiste (elástico).
 * - Soltou depois de ~70px (ou num gesto rápido): sai da tela e fecha.
 * - Senão, volta ao lugar com mola. Gesto horizontal é ignorado (carrosséis).
 * - Um arrasto de verdade nunca dispara o clique dos botões de dentro.
 */
export function useSwipeDismiss<T extends HTMLElement>(onDismiss: () => void, dir: "down" | "up" = "down") {
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  const cleanup = useRef<(() => void) | null>(null);

  // ref em forma de função: liga o gesto sempre que o elemento aparece
  // (avisos montam e desmontam o tempo todo)
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const sign = dir === "down" ? 1 : -1;
    let id = -1;
    let sx = 0;
    let sy = 0;
    let dy = 0;
    let t0 = 0;
    let tracking = false;
    let dragging = false;
    let swallowClick = false;

    el.style.touchAction = "pan-x";

    const reset = () => {
      el.style.transform = "";
      el.style.opacity = "";
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      id = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      dy = 0;
      t0 = performance.now();
      tracking = true;
      dragging = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== id) return;
      const ddx = e.clientX - sx;
      const ddy = e.clientY - sy;
      if (!dragging) {
        if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) return;
        if (Math.abs(ddx) > Math.abs(ddy)) {
          tracking = false; // gesto lateral: é do carrossel
          return;
        }
        dragging = true;
        try {
          el.setPointerCapture(id);
        } catch {
          /* alguns navegadores recusam: segue sem captura */
        }
        el.style.transition = "none";
      }
      dy = ddy * sign > 0 ? ddy : ddy * 0.22;
      el.style.transform = `translate3d(0, ${dy}px, 0)`;
      el.style.opacity = String(Math.max(0.35, 1 - Math.abs(dy) / 260));
    };
    const onUp = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== id) return;
      tracking = false;
      if (!dragging) return;
      dragging = false;
      swallowClick = true;
      window.setTimeout(() => (swallowClick = false), 60);
      const velocity = Math.abs(dy) / Math.max(1, performance.now() - t0);
      const go = dy * sign > 70 || (dy * sign > 24 && velocity > 0.55);
      el.style.transition = "transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease";
      if (go) {
        el.style.transform = `translate3d(0, ${sign * (el.offsetHeight + 120)}px, 0)`;
        el.style.opacity = "0";
        window.setTimeout(() => {
          cb.current();
          // o componente costuma sair da tela; se continuar montado, volta limpo
          window.setTimeout(() => {
            el.style.transition = "";
            reset();
          }, 50);
        }, 240);
      } else {
        reset();
        window.setTimeout(() => (el.style.transition = ""), 300);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("click", onClick, true);
    cleanup.current = () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("click", onClick, true);
    };
  }, [dir]);
}
