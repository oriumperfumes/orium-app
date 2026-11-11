/**
 * A abertura do app instalado é uma tela limpa: nenhum aviso, pop-up ou oferta
 * aparece por cima dela. Quem mostra avisos espera `useAppReady()`.
 */
import { useEffect, useState } from "react";

const EVENT = "orium:splash-change";

/** A abertura (ou a cobertura do primeiro frame) está na tela? */
export function isSplashing(): boolean {
  if (typeof document === "undefined") return false;
  const html = document.documentElement;
  return html.dataset.splash === "1" || html.classList.contains("orium-booting");
}

export function setSplashing(on: boolean) {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.dataset.splash = "1";
  else delete document.documentElement.dataset.splash;
  window.dispatchEvent(new Event(EVENT));
}

/**
 * true quando o app já está à vista (sem abertura). Avisos que nascem durante
 * a abertura esperam ela terminar e entram logo depois, com um respiro.
 */
export function useAppReady(delayAfterSplash = 450): boolean {
  const [ready, setReady] = useState(() => !isSplashing());
  useEffect(() => {
    if (!isSplashing()) {
      setReady(true);
      return;
    }
    setReady(false);
    let t = 0;
    const check = () => {
      if (isSplashing()) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => setReady(true), delayAfterSplash);
    };
    window.addEventListener(EVENT, check);
    return () => {
      window.removeEventListener(EVENT, check);
      window.clearTimeout(t);
    };
  }, [delayAfterSplash]);
  return ready;
}
