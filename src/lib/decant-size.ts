/**
 * O que o cliente quer ver no catálogo: preço de decant (2ml, 5ml, 10ml) ou
 * preço do frasco completo. Uma única fonte: banner, cards, quick add e página
 * do perfume leem daqui.
 *
 * Padrão: preço do frasco completo; persiste durante a navegação (localStorage) e NUNCA altera
 * carrinho, favoritos, alertas ou histórico — é só apresentação.
 */
import { useSyncExternalStore } from "react";
import { DECANT_SIZES, type DecantMl } from "@/lib/decants";

/** "frasco" = mostrar o preço do frasco completo. */
export type PriceView = DecantMl | "frasco";

const KEY = "orium-decant-size";
const VIEW_KEY = "orium-price-view";
const DEFAULT: DecantMl = 2;
/** O catálogo abre mostrando o preço do frasco completo. */
const DEFAULT_VIEW: PriceView = "frasco";

const isMl = (v: unknown): v is DecantMl => DECANT_SIZES.includes(Number(v) as DecantMl);

let current: DecantMl = DEFAULT;
let view: PriceView = DEFAULT_VIEW;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (isMl(raw)) current = Number(raw) as DecantMl;
    // modo de preço vale só para a sessão: nova abertura volta ao frasco
    const storedView = window.sessionStorage.getItem(VIEW_KEY);
    view = storedView === "frasco" ? "frasco" : isMl(storedView) ? (Number(storedView) as DecantMl) : DEFAULT_VIEW;
  } catch {
    /* modo privado: segue com o padrão */
  }
}

function subscribe(cb: () => void) {
  hydrate();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) cb();
}

const getSize = (): DecantMl => {
  hydrate();
  return current;
};
const getView = (): PriceView => {
  hydrate();
  return view;
};

const serverSize = (): DecantMl => DEFAULT;
const serverView = (): PriceView => DEFAULT_VIEW;

const store = (key: string, value: string) => {
  try {
    (key === VIEW_KEY ? window.sessionStorage : window.localStorage).setItem(key, value);
  } catch {
    /* ignora */
  }
};

/** Escolheu um tamanho de decant: passa a ver os preços desse tamanho. */
export function setGlobalDecantSize(ml: DecantMl) {
  if (!isMl(ml)) return;
  if (ml === current && view === ml) return;
  current = ml;
  view = ml;
  store(KEY, String(ml));
  store(VIEW_KEY, String(ml));
  emit();
}

/** Escolheu "Frasco": passa a ver o preço do frasco completo. */
export function setPriceView(next: PriceView) {
  if (next === "frasco") {
    if (view === "frasco") return;
    view = "frasco";
    store(VIEW_KEY, "frasco");
    emit();
    return;
  }
  setGlobalDecantSize(next);
}

export function useGlobalDecantSize(): DecantMl {
  return useSyncExternalStore(subscribe, getSize, serverSize);
}

/** Qual preço o catálogo deve exibir agora. */
export function usePriceView(): PriceView {
  return useSyncExternalStore(subscribe, getView, serverView);
}
