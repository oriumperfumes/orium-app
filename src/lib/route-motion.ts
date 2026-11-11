/**
 * ROUTE MOTION SYSTEM — uma única linguagem de transição entre páginas.
 *
 * Regras: só transform e opacity (60 FPS), nada bloqueia a navegação e a
 * direção do movimento acompanha o gesto do cliente (avançar x voltar).
 */
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

/** Tempos globais (ms). */
export const ROUTE_MOTION = {
  press: 80,
  micro: 160,
  route: 240,
  sharedImage: 280,
  reveal: 200,
  back: 200,
} as const;

export const ROUTE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export type NavDirection = "forward" | "back" | "initial";

/** Pilha de endereços visitados: descobre se a navegação foi para trás. */
const stack: string[] = [];

function classify(href: string): NavDirection {
  if (stack.length === 0) {
    stack.push(href);
    return "initial";
  }
  if (stack[stack.length - 1] === href) return "initial";
  if (stack.length > 1 && stack[stack.length - 2] === href) {
    stack.pop();
    return "back";
  }
  stack.push(href);
  if (stack.length > 30) stack.shift();
  return "forward";
}

/**
 * Classe de entrada da página atual. Muda de chave a cada endereço para a
 * animação sempre recomeçar, sem desmontar/remontar conteúdo em cache.
 */
export function useRouteMotion(): { className: string; direction: NavDirection; key: string } {
  const href = useRouterState({ select: (s) => s.location.href });
  const seen = useRef<string | null>(null);
  const [state, setState] = useState<{ dir: NavDirection; href: string }>(() => ({
    dir: "initial",
    href,
  }));

  useEffect(() => {
    if (seen.current === href) return;
    seen.current = href;
    setState({ dir: classify(href), href });
  }, [href]);

  const className =
    state.dir === "back" ? "route-in route-in-back" : state.dir === "forward" ? "route-in route-in-forward" : "route-in";

  return { className, direction: state.dir, key: state.href };
}
