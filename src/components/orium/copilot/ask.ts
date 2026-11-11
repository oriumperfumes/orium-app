/**
 * Pergunta pronta para o Copilot (ex.: cartão do Início).
 * Se o chat já está aberto, ele recebe o evento; se ainda vai montar, lê a
 * pergunta guardada em window ao abrir. Uma pergunta = um envio.
 */
export const COPILOT_ASK = "orium:copilot-ask";

export function askCopilot(text: string, open: (v: boolean) => void) {
  (window as any).__oriumAsk = text;
  open(true);
  window.dispatchEvent(new CustomEvent(COPILOT_ASK, { detail: text }));
}

/** Lida uma vez: devolve e apaga a pergunta pendente. */
export function takePendingAsk(): string | null {
  const t = (window as any).__oriumAsk as string | undefined;
  (window as any).__oriumAsk = null;
  return t ?? null;
}
