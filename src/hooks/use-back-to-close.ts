/**
 * VOLTAR FECHA O QUE ESTÁ POR CIMA.
 *
 * Gavetas, janelas e telas que abrem sobre a página (filtros, ajuda, sacola,
 * conta…) ganham uma entrada no histórico ao abrir (mesma URL, marcada). O
 * gesto de voltar do celular — ou o botão do navegador — consome essa entrada
 * e só fecha a camada de cima, em vez de sair do app ou trocar de página com o
 * menu ainda aberto. Fechando pelo ✕/fundo, a entrada é removida em silêncio.
 *
 * Várias camadas empilhadas funcionam: cada voltar fecha só a de cima.
 */
import { useEffect, useRef } from "react";

const KEY = "oriumLayer";
type Layer = { id: number; close: () => void; y: number };

const stack: Layer[] = [];
let seq = 0;
/** voltas disparadas por nós mesmos (fechou pelo ✕): o popstate delas é ignorado */
let selfBacks = 0;
let listening = false;
/** saindo de uma camada para outra página: a entrada dela é substituída pela navegação */
let navigatingUntil = 0;

/**
 * Chame antes de navegar a partir de uma gaveta/tela por cima (e navegue com
 * `replace: true`): a página nova ocupa o lugar da entrada da camada, então o
 * voltar da página nova leva direto para onde o cliente estava.
 */
export function navigatingFromLayer() {
  navigatingUntil = Date.now() + 1500;
}

const currentMark = (): number | undefined => {
  const st = window.history.state as Record<string, unknown> | null;
  const v = st?.[KEY];
  return typeof v === "number" ? v : undefined;
};

/**
 * A página volta exatamente para onde estava quando a camada abriu: o roteador
 * restaura a rolagem ao "voltar" e às vezes usa um valor antigo (ou o topo).
 */
let restoreY: number | null = null;

/** camadas que saíram para outra página e reabrem quando o cliente volta (ex.: Conta) */
const parked = new Map<number, () => void>();
/** id da entrada que a próxima camada a abrir deve "assumir" (sem criar outra) */
let adoptId: number | null = null;
function keepScroll(y: number) {
  restoreY = y;
  const apply = () => {
    if (restoreY == null) return;
    if (Math.abs(window.scrollY - restoreY) > 2) window.scrollTo({ top: restoreY, behavior: "instant" as ScrollBehavior });
  };
  requestAnimationFrame(() => requestAnimationFrame(apply));
  window.setTimeout(apply, 60);
  window.setTimeout(() => {
    apply();
    restoreY = null;
  }, 180);
}

function onPop() {
  if (selfBacks > 0) {
    selfBacks -= 1;
    if (restoreY != null) keepScroll(restoreY);
    return;
  }
  const mark = currentMark();
  // fecha (de cima para baixo) toda camada cuja entrada ficou para trás
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    if (mark !== undefined && mark >= top.id) break;
    stack.pop();
    top.close();
    keepScroll(top.y);
  }
  // voltou de outra página para a entrada de uma camada que reabre (ex.: Conta)
  if (mark !== undefined && parked.has(mark) && !stack.some((l) => l.id === mark)) {
    const reopen = parked.get(mark)!;
    parked.delete(mark);
    adoptId = mark;
    reopen();
    return;
  }
  // entrada de uma camada que já não existe (ex.: voltou de outra página): pula
  if (mark !== undefined && !stack.some((l) => l.id === mark)) {
    selfBacks += 1;
    window.history.back();
  }
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", onPop);
  // Tocar num link da própria Orium com uma camada aberta é "sair da camada para
  // outra página": a camada fecha sem mexer no histórico.
  window.addEventListener(
    "click",
    (e) => {
      if (!stack.length) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== window.location.origin) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      navigatingFromLayer();
    },
    true,
  );
}

/**
 * Liga o "voltar fecha" a uma camada controlada por `open`.
 * `onClose` deve só fechar (o histórico é cuidado aqui).
 */
export function useBackToClose(
  open: boolean | undefined,
  onClose: () => void,
  opts?: {
    /**
     * A camada saiu para outra página (com `navigatingFromLayer`, sem `replace`)
     * e deve reabrir quando o cliente voltar — ex.: Conta → Favoritos → voltar.
     */
    onReopen?: () => void;
  },
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const reopenRef = useRef(opts?.onReopen);
  reopenRef.current = opts?.onReopen;

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    listen();
    let id: number;
    if (adoptId != null && currentMark() === adoptId) {
      // reabriu ao voltar: a entrada dela já está no histórico
      id = adoptId;
      adoptId = null;
    } else {
      id = ++seq;
      window.history.pushState({ ...(window.history.state ?? {}), [KEY]: id }, "");
    }
    const layer: Layer = { id, close: () => closeRef.current(), y: window.scrollY };
    stack.push(layer);

    return () => {
      const i = stack.indexOf(layer);
      if (i === -1) return; // já fechou pelo voltar
      stack.splice(i, 1);
      // fechou pelo ✕/fundo: tira a própria entrada, se ela ainda é a atual.
      // (se o cliente navegou para outra página, a entrada fica órfã e é pulada depois)
      if (Date.now() < navigatingUntil) {
        if (reopenRef.current) parked.set(layer.id, reopenRef.current);
        return;
      }
      // Espera um instante: se o cliente tocou num link/botão que NAVEGA, a página
      // nova já entrou no histórico e voltar agora desfaria a navegação (a tela
      // "voltava" e só depois ia para a nova). Só voltamos se nada mudou.
      const hrefAtClose = window.location.href;
      window.setTimeout(() => {
        if (window.location.href !== hrefAtClose) return;
        if (currentMark() === layer.id) {
          selfBacks += 1;
          restoreY = layer.y;
          window.history.back();
        }
      }, 0);
    };
  }, [open]);
}
