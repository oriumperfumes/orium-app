/**
 * Sistema de movimento da Orium — os mesmos tempos e curvas em todo o app.
 * fast: reação ao toque · default: transições de estado · emphasis: entradas
 * spring: carrinho, painéis inferiores.
 */
export const DURATION = {
  fast: 150,
  default: 250,
  emphasis: 400,
  fly: 400,
} as const;

export const EASE = {
  standard: "cubic-bezier(0.16, 1, 0.3, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/** Tokens de motion do Admin — uma única linguagem de animação no painel. */
export const MOTION = {
  tap: 120,
  micro: 160,
  transition: 220,
  reveal: 320,
  countUpShort: 480,
  countUp: 620,
  countUpLong: 780,

  stagger: 45,
} as const;

export const EASE_OUT = EASE.standard;

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
