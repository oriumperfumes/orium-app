import { useEffect, useRef, useState } from "react";

type Options = {
  /** largura do painel em px */
  width: number;
  /** painel está aberto */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** só ativa o gesto de abrir quando o toque começa nessa faixa da borda */
  edge?: number;
};

/**
 * Gesto nativo de drawer: arrastar da borda esquerda abre, arrastar o painel
 * aberto para a esquerda fecha. Axis-lock: se o movimento for predominantemente
 * vertical, soltamos o gesto e a página rola normalmente.
 */
export function useEdgeSwipeDrawer({ width, open, onOpen, onClose, edge = 64 }: Options) {
  // deslocamento em px durante o arraste (null = sem arraste, usa CSS)
  const [drag, setDrag] = useState<number | null>(null);
  const state = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    decided: boolean;
    mode: "open" | "close" | null;
    lastX: number;
    lastT: number;
    velocity: number;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      if (!open && t.clientX > edge) return;
      state.current = {
        startX: t.clientX,
        startY: t.clientY,
        active: true,
        decided: false,
        mode: open ? "close" : "open",
        lastX: t.clientX,
        lastT: e.timeStamp,
        velocity: 0,
      };
    };

    const onMove = (e: TouchEvent) => {
      const s = state.current;
      if (!s?.active) return;
      const t = e.touches[0]!;
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;

      const dt = e.timeStamp - s.lastT;
      if (dt > 0) s.velocity = (t.clientX - s.lastX) / dt; // px/ms
      s.lastX = t.clientX;
      s.lastT = e.timeStamp;

      if (!s.decided) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        // só desiste se o gesto for claramente vertical
        if (Math.abs(dy) > Math.abs(dx) * 1.5) {
          s.active = false;
          return;
        }
        s.decided = true;
      }

      if (e.cancelable) e.preventDefault();
      const offset =
        s.mode === "open"
          ? Math.min(width, Math.max(0, dx))
          : Math.min(width, Math.max(0, width + dx));
      setDrag(offset);
    };

    const finish = () => {
      const s = state.current;
      state.current = null;
      if (!s?.decided) {
        setDrag(null);
        return;
      }
      setDrag((current) => {
        const offset = current ?? (s.mode === "open" ? 0 : width);
        const flick = Math.abs(s.velocity) > 0.35;
        if (flick) {
          if (s.velocity > 0) onOpen();
          else onClose();
        } else if (s.mode === "open" ? offset > width * 0.22 : offset > width * 0.72) {
          onOpen();
        } else {
          onClose();
        }
        return null;
      });
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", finish, { passive: true });
    window.addEventListener("touchcancel", finish, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", finish);
      window.removeEventListener("touchcancel", finish);
    };
  }, [open, width, edge, onOpen, onClose]);

  return { drag, dragging: drag !== null };
}
