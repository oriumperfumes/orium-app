/**
 * ARRASTAR NÃO É CLICAR.
 *
 * Único lugar da Orium que decide se um gesto sobre um card foi um toque real
 * (abrir o perfume) ou apenas rolagem/carrossel. Nada aqui bloqueia a rolagem
 * nativa: só observamos o ponteiro e, quando houve arrasto, cancelamos o clique
 * que o navegador dispara depois do gesto.
 *
 * Regras:
 * - eixo travado no primeiro movimento relevante (horizontal = carrossel,
 *   vertical = página): o mesmo gesto não muda de intenção no meio;
 * - toque válido = movimento abaixo do limite, sem cancelamento do ponteiro,
 *   no mesmo elemento e em tempo curto;
 * - nunca usamos `preventDefault` no toque, apenas no clique falso.
 */
import { useRef } from "react";

const DRAG_PX = 8;
const MAX_TAP_MS = 900;

export type TapOpenProps = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
  onClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
};

export function useTapOpen(options?: {
  /** Chamado só quando o gesto foi realmente um toque de abertura. */
  onOpen?: () => void;
  /** Aquecimento leve (foto/preview) no início do gesto — sem registrar nada. */
  onPress?: () => void;
}): TapOpenProps {
  const start = useRef({ x: 0, y: 0, t: 0, id: -1 });
  const dragging = useRef(false);
  const canceled = useRef(false);
  const axis = useRef<"none" | "x" | "y">("none");

  const reset = () => {
    dragging.current = false;
    canceled.current = false;
    axis.current = "none";
  };

  return {
    onPointerDown: (e) => {
      reset();
      start.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
      options?.onPress?.();
    },
    onPointerMove: (e) => {
      if (e.pointerId !== start.current.id || dragging.current) return;
      const dx = Math.abs(e.clientX - start.current.x);
      const dy = Math.abs(e.clientY - start.current.y);
      if (dx < DRAG_PX && dy < DRAG_PX) return;
      // Eixo travado uma única vez para este gesto.
      axis.current = dx > dy ? "x" : "y";
      dragging.current = true;
    },
    onPointerUp: (e) => {
      if (e.pointerId !== start.current.id) return;
      const slow = Date.now() - start.current.t > MAX_TAP_MS;
      if (dragging.current || canceled.current || slow) return;
      options?.onOpen?.();
    },
    onPointerCancel: () => {
      canceled.current = true;
      dragging.current = true;
    },
    onClick: (e) => {
      // Em touch o `click` chega depois do gesto: aqui ele morre.
      if (dragging.current || canceled.current) {
        e.preventDefault();
        e.stopPropagation();
        reset();
      }
    },
    onDragStart: (e) => {
      dragging.current = true;
      e.preventDefault();
    },
  };
}
