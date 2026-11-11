/**
 * Zona de segurança do carrinho flutuante.
 * Quando uma ação importante (ex.: "Ver mais produtos") entra na tela,
 * o carrinho sobe suavemente para nunca cobrir o botão.
 */
let guards = 0;
const listeners = new Set<(lifted: boolean) => void>();

const emit = () => listeners.forEach((l) => l(guards > 0));

export function onCartLift(cb: (lifted: boolean) => void) {
  listeners.add(cb);
  cb(guards > 0);
  return () => {
    listeners.delete(cb);
  };
}

/** true = há um CTA visível embaixo; false = liberou. */
export function setCartLift(active: boolean) {
  guards = Math.max(0, guards + (active ? 1 : -1));
  emit();
}
