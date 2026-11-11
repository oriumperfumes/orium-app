/**
 * "Fly to cart": ao adicionar, uma miniatura do produto viaja até o carrinho
 * flutuante e o carrinho responde com um pequeno salto.
 * Respeita prefers-reduced-motion (mantém só o pulso do badge).
 */
import { DURATION, prefersReducedMotion } from "./motion";

const PULSE_EVENT = "orium:cart-pulse";

let target: HTMLElement | null = null;

export const registerCartTarget = (el: HTMLElement | null) => {
  target = el;
};

export const onCartPulse = (fn: () => void) => {
  if (typeof window === "undefined") return () => {};
  const handler = () => fn();
  window.addEventListener(PULSE_EVENT, handler);
  return () => window.removeEventListener(PULSE_EVENT, handler);
};

const pulse = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PULSE_EVENT));
};

/** Um toque curtíssimo de vibração (Android) quando algo entra na sacola. */
function haptic() {
  try {
    if (prefersReducedMotion()) return;
    (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(8);
  } catch {
    /* sem vibração */
  }
}

export function flyToCart(from: HTMLElement | null, image?: string | null) {
  if (typeof document === "undefined") return;
  haptic();
  if (!from || !target || prefersReducedMotion()) return pulse();

  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (!a.width || !b.width) return pulse();

  const size = Math.min(76, Math.max(46, a.width * 0.42));
  /*
   * Arco de verdade: o eixo X anda em ritmo constante e o Y sobe um pouco e
   * cai acelerando (como um objeto lançado). Dois elementos, duas curvas.
   */
  const outer = document.createElement("div");
  outer.setAttribute("aria-hidden", "true");
  outer.style.cssText = [
    "position:fixed",
    "z-index:80",
    "pointer-events:none",
    `left:${a.left + a.width / 2 - size / 2}px`,
    `top:${a.top + a.height / 2 - size / 2}px`,
    `width:${size}px`,
    `height:${size}px`,
    "will-change:transform",
  ].join(";");
  const inner = document.createElement("div");
  inner.style.cssText = [
    "width:100%",
    "height:100%",
    "border-radius:18px",
    "background-color:#fff",
    "box-shadow:0 18px 40px -16px rgba(0,0,0,.55)",
    "will-change:transform,opacity",
  ].join(";");
  if (image) {
    inner.style.backgroundImage = `url("${image}")`;
    inner.style.backgroundSize = "contain";
    inner.style.backgroundRepeat = "no-repeat";
    inner.style.backgroundPosition = "center";
  }
  outer.appendChild(inner);
  document.body.appendChild(outer);

  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const duration = DURATION.fly + 220;

  const x = outer.animate(
    [{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(${dx}px,0,0)` }],
    { duration, easing: "cubic-bezier(0.25, 0.1, 0.4, 1)", fill: "forwards" },
  );
  inner.animate(
    [
      { transform: "translate3d(0,0,0) scale(1)", opacity: 1, borderRadius: "18px" },
      { transform: `translate3d(0,${dy}px,0) scale(0.2)`, opacity: 0.35, borderRadius: "50%" },
    ],
    { duration, easing: "cubic-bezier(0.45, -0.45, 0.75, 0.55)", fill: "forwards" },
  );
  // a sacola reage quando o produto chega, não quando sai
  const done = () => {
    outer.remove();
    pulse();
  };
  x.onfinish = done;
  x.oncancel = done;
}
