import { describe, expect, it } from "vitest";
import {
  assertPublicCheckoutOptions,
  CARD_AVAILABLE,
  LOCAL_DELIVERY_NOTE,
} from "../checkout-rules";

describe("checkout público: Pix ou cartão, retirada e entrega pelo WhatsApp", () => {
  it("sem opções informadas vale retirada e Pix", () => {
    expect(assertPublicCheckoutOptions({})).toEqual({
      fulfillment: "PICKUP",
      paymentMethod: "PIX",
    });
  });

  it("aceita retirada e entrega local com Pix", () => {
    expect(
      assertPublicCheckoutOptions({ fulfillment: "PICKUP", paymentMethod: "PIX" }).fulfillment,
    ).toBe("PICKUP");
    expect(
      assertPublicCheckoutOptions({ fulfillment: "LOCAL", paymentMethod: "PIX" }).fulfillment,
    ).toBe("LOCAL");
  });

  it("recusa envio pelos Correios", () => {
    expect(() => assertPublicCheckoutOptions({ fulfillment: "SHIPPING" })).toThrow(
      /não está disponível/,
    );
  });

  it("aceita cartão", () => {
    expect(assertPublicCheckoutOptions({ paymentMethod: "CARD" }).paymentMethod).toBe("CARD");
  });

  it("recusa forma de pagamento desconhecida", () => {
    expect(() => assertPublicCheckoutOptions({ paymentMethod: "BOLETO" })).toThrow(/Pix ou no cartão/);
    expect(() => assertPublicCheckoutOptions({ fulfillment: "DRONE" })).toThrow();
  });

  it("cartão ligado e a entrega tem aviso para a equipe", () => {
    expect(CARD_AVAILABLE).toBe(true);
    expect(LOCAL_DELIVERY_NOTE).toMatch(/WhatsApp antes do pagamento/);
  });
});
