/**
 * Telas sob demanda (sacola, conta, busca, filtros, folhas de compra).
 *
 * O código dessas telas não entra no carregamento inicial: é baixado em
 * segundo plano quando o navegador fica ocioso e montado na primeira vez que
 * o cliente abre a tela. Depois disso continua montado, então abrir de novo é
 * instantâneo e as animações de saída funcionam normalmente.
 */
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";

type Loader<T> = () => Promise<{ default: T }>;

/** `lazy()` com um `prefetch()` para aquecer o código antes do primeiro toque. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyUI<T extends ComponentType<any>>(load: Loader<T>) {
  let promise: Promise<{ default: T }> | null = null;
  const once = () => (promise ??= load().catch((e) => {
    promise = null;
    throw e;
  }));
  return Object.assign(lazy(once), { prefetch: () => void once().catch(() => {}) });
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/** Roda `fn` quando o navegador estiver ocioso (depois do carregamento da página). */
export function whenIdle(fn: () => void, timeout = 2500): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as IdleWindow;
  let id: number | null = null;
  let t: number | null = null;
  const schedule = () => {
    if (w.requestIdleCallback) id = w.requestIdleCallback(fn, { timeout });
    else t = window.setTimeout(fn, 600);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
  return () => {
    window.removeEventListener("load", schedule);
    if (id != null) w.cancelIdleCallback?.(id);
    if (t != null) window.clearTimeout(t);
  };
}

/** Aquece o código das telas quando o navegador estiver ocioso. */
export function useIdlePrefetch(prefetch: Array<() => void>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    return whenIdle(() => prefetch.forEach((p) => p()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

/** Vira `true` na primeira vez que `when` for verdadeiro e fica assim. */
export function useLatch(when: boolean): boolean {
  const [on, setOn] = useState(when);
  useEffect(() => {
    if (when) setOn(true);
  }, [when]);
  return on || when;
}

/** Monta `children` (com Suspense silencioso) só depois do primeiro uso. */
export function MountWhen({ when, children }: { when: boolean; children: ReactNode }) {
  const on = useLatch(when);
  if (!on) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}
