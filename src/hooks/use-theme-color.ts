import { useEffect } from "react";

/** Cor das barras do sistema (status e, no Android, a de cima do navegador). */
export const BAR_COLOR = "#0a0a0a";

/**
 * Enquanto `active`, a barra de status do celular assume `color` — para telas
 * cujo topo não é a barra preta padrão (ex.: Procurar, login). Ao sair, volta.
 */
export function useThemeColor(color: string, active = true) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const prev = meta.content;
    meta.content = color;
    return () => {
      meta.content = prev || BAR_COLOR;
    };
  }, [color, active]);
}
