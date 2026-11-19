/**
 * Chuva de lascas douradas saindo do botão quando o frasco em promoção entra na
 * sacola. Só responde ao toque, e some sozinha. Respeita prefers-reduced-motion.
 */
import { prefersReducedMotion } from "./motion";

const FOIL = ["#FFF0D2", "#FFD599", "#E9B873", "#C9934E", "#FFFFFF"];

export function goldBurst(from: HTMLElement) {
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  const box = from.getBoundingClientRect();
  const originX = box.left + box.width / 2;
  const originY = box.top + box.height / 2;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;z-index:70;overflow:hidden;pointer-events:none";
  document.body.appendChild(layer);

  const flights = Array.from({ length: 26 }, (_, index) => {
    const flake = document.createElement("span");
    const width = 4 + Math.random() * 5;
    flake.style.cssText = [
      "position:absolute",
      `left:${originX + (Math.random() - 0.5) * box.width * 0.7}px`,
      `top:${originY}px`,
      `width:${width}px`,
      `height:${width * (0.45 + Math.random() * 0.7)}px`,
      `background:${FOIL[index % FOIL.length]}`,
      `border-radius:${index % 3 === 0 ? "50%" : "1.5px"}`,
    ].join(";");
    layer.appendChild(flake);

    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
    const reach = 110 + Math.random() * 170;
    const x = Math.cos(angle) * reach;
    const y = Math.sin(angle) * reach;
    const spin = (Math.random() - 0.5) * 900;
    return flake.animate(
      [
        { transform: "translate(0, 0) rotate(0deg) scale(0.5)", opacity: 1 },
        {
          transform: `translate(${x}px, ${y}px) rotate(${spin * 0.6}deg) scale(1)`,
          opacity: 1,
          offset: 0.48,
        },
        {
          transform: `translate(${x * 1.25}px, ${y + 150}px) rotate(${spin}deg) scale(0.8)`,
          opacity: 0,
        },
      ],
      {
        duration: 820 + Math.random() * 360,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      },
    ).finished;
  });

  void Promise.allSettled(flights).then(() => layer.remove());
}
