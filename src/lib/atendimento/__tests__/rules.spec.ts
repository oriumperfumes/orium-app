import { describe, expect, it } from "vitest";
import { canSendWhatsappFreeform, redactCustomerContext, WHATSAPP_WINDOW_MS } from "../rules";

describe("Atendimento — regras críticas", () => {
  const now = Date.parse("2026-10-12T15:00:00.000Z");

  it("libera texto apenas dentro da janela de 24h", () => {
    expect(canSendWhatsappFreeform(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(canSendWhatsappFreeform(new Date(now - WHATSAPP_WINDOW_MS + 1).toISOString(), now)).toBe(true);
    expect(canSendWhatsappFreeform(new Date(now - WHATSAPP_WINDOW_MS).toISOString(), now)).toBe(false);
  });

  it("recusa datas futuras, nulas e inválidas", () => {
    expect(canSendWhatsappFreeform(null, now)).toBe(false);
    expect(canSendWhatsappFreeform("texto inválido", now)).toBe(false);
    expect(canSendWhatsappFreeform(new Date(now + 1000).toISOString(), now)).toBe(false);
  });

  it("oculta dados de contato antes da sugestão por IA", () => {
    const text = redactCustomerContext("Contato teste@exemplo.com e +55 21 99999-9999");
    expect(text).not.toContain("teste@exemplo.com");
    expect(text).not.toContain("99999-9999");
    expect(text).toContain("[email]");
    expect(text).toContain("[telefone]");
  });
});
