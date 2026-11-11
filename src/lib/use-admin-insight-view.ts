import { useCallback, useEffect, useState } from "react";

/**
 * Preferência local (por dispositivo) da camada interna do catálogo.
 * Só afeta a exibição para staff — o backend continua sendo a fonte de verdade
 * de quem pode receber custo/margem.
 */
const KEY = "orium.admin-insight-visible";
const EVENT = "orium:admin-insight-visible";

const read = () => {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(KEY) !== "0";
};

export function useAdminInsightView() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(read());
    const sync = () => setVisible(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !read();
    window.localStorage.setItem(KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(EVENT));
    setVisible(next);
  }, []);

  return { visible, toggle };
}
