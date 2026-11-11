/**
 * Rolagem suave da Orium — a mesma curva em todo o app.
 *
 * `scrollTo({ behavior: "smooth" })` do navegador varia muito (no iOS chega a
 * pular direto). Aqui a rolagem é feita quadro a quadro com uma curva
 * ease-in-out longa: arranca macio, ganha velocidade e pousa devagar.
 * Qualquer gesto do cliente (roda, toque, tecla) interrompe na hora.
 */
import { prefersReducedMotion } from "./motion";

let running = 0;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Altura do header fixo (para o destino não ficar escondido atrás dele). */
export function headerOffset() {
  if (typeof document === "undefined") return 0;
  const h = document.querySelector<HTMLElement>("header[data-site-header]")?.getBoundingClientRect().height;
  return h && h > 0 ? h : 0;
}

export function smoothScrollTo(top: number, opts: { duration?: number; onDone?: () => void } = {}) {
  if (typeof window === "undefined") return;
  cancelAnimationFrame(running);
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const to = Math.min(Math.max(0, top), max);
  const from = window.scrollY;
  const dist = to - from;
  if (Math.abs(dist) < 2 || prefersReducedMotion()) {
    window.scrollTo({ top: to, behavior: "auto" });
    opts.onDone?.();
    return;
  }
  // curto e decidido de perto, mais longo (sem exagero) para saltos grandes
  const duration = opts.duration ?? Math.min(1150, Math.max(560, Math.abs(dist) * 0.55));
  const start = performance.now();

  const stop = () => {
    cancelAnimationFrame(running);
    cleanup();
  };
  const cleanup = () => {
    for (const ev of ["wheel", "touchstart", "keydown"]) window.removeEventListener(ev, stop);
  };
  for (const ev of ["wheel", "touchstart", "keydown"]) window.addEventListener(ev, stop, { passive: true });

  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    window.scrollTo(0, from + dist * ease(t));
    if (t < 1) running = requestAnimationFrame(step);
    else {
      cleanup();
      opts.onDone?.();
    }
  };
  running = requestAnimationFrame(step);
}

/** Rola até um elemento, descontando o header fixo e um respiro. */
export function smoothScrollToEl(
  el: Element | null | undefined,
  opts: { gap?: number; duration?: number; onDone?: () => void } = {},
) {
  if (!el || typeof window === "undefined") return;
  const y = el.getBoundingClientRect().top + window.scrollY - headerOffset() - (opts.gap ?? 12);
  smoothScrollTo(y, opts);
}
