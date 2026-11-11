/** Regras determinísticas de segurança e janela de atendimento. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function canSendWhatsappFreeform(lastInboundAt: string | null, now = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const received = Date.parse(lastInboundAt);
  return Number.isFinite(received) && received <= now && now - received < WHATSAPP_WINDOW_MS;
}

export function redactCustomerContext(input: string): string {
  return input
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/\+?\d[\d ()-]{8,}\d/g, "[telefone]")
    .slice(0, 900);
}
