/**
 * PAGAMENTO — PIX x CARTÃO (regra única da Orium).
 *
 * O preço cadastrado (varejo, atacado, decant, promoção, cupom) É o preço no Pix.
 * Nada é alterado no banco de preços: o valor do cartão é derivado na hora, de
 * forma que "X% OFF no Pix" seja matematicamente verdadeiro:
 *
 *   cardPrice = pixPrice / (1 - desconto)
 *   pixPrice  = cardPrice - desconto% de cardPrice
 *
 * Exemplo com 5%: R$ 300,00 no Pix → R$ 315,79 no cartão (5% de 315,79 = 15,79).
 *
 * Este módulo é puro e serve cliente e servidor. Nenhum componente deve
 * recalcular a fórmula por conta própria.
 */
export type PaymentMethod = "PIX" | "CARD";

export const DEFAULT_PIX_DISCOUNT = 5;

export type PaymentSettings = {
  /** desconto do Pix em porcentagem (5 = 5%) */
  pixDiscountPercent: number;
  active: boolean;
};

export type PaymentPricing = {
  /** exatamente o valor já praticado hoje */
  pixPrice: number;
  /** valor maior, calculado por /(1 - desconto) */
  cardPrice: number;
  /** 5 quando a regra está ligada; 0 quando desligada */
  pixDiscountPercent: number;
  /** quanto o cliente economiza pagando no Pix */
  pixSavings: number;
  active: boolean;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Normaliza o que vem do Admin: 0 < desconto < 100, senão a regra fica desligada. */
export function normalizePaymentSettings(raw?: {
  pix_discount_percent?: number | null;
  pix_discount_active?: boolean | null;
} | null): PaymentSettings {
  const percent = Number(raw?.pix_discount_percent ?? DEFAULT_PIX_DISCOUNT);
  const valid = Number.isFinite(percent) && percent > 0 && percent < 100;
  return {
    pixDiscountPercent: valid ? percent : 0,
    active: raw?.pix_discount_active !== false && valid,
  };
}

/**
 * Regra central. Recebe o valor final que o cliente pagaria HOJE (já com
 * promoção, atacado e cupom aplicados) e devolve as duas condições.
 */
export function getPaymentPricing(finalPixAmount: number, settings?: PaymentSettings | null): PaymentPricing {
  const pixPrice = round2(Math.max(0, Number(finalPixAmount) || 0));
  const percent = settings?.active ? Number(settings.pixDiscountPercent) : 0;
  if (!(percent > 0 && percent < 100)) {
    return { pixPrice, cardPrice: pixPrice, pixDiscountPercent: 0, pixSavings: 0, active: false };
  }
  const cardPrice = round2(pixPrice / (1 - percent / 100));
  return {
    pixPrice,
    cardPrice,
    pixDiscountPercent: percent,
    pixSavings: round2(cardPrice - pixPrice),
    active: true,
  };
}

/** Valor a cobrar na forma escolhida — usado no carrinho, pedido e Admin. */
export function amountFor(method: PaymentMethod, finalPixAmount: number, settings?: PaymentSettings | null): number {
  const p = getPaymentPricing(finalPixAmount, settings);
  return method === "CARD" ? p.cardPrice : p.pixPrice;
}

/** "5% OFF no Pix" — texto único de comunicação. */
export function pixOffLabel(settings?: PaymentSettings | null): string | null {
  const percent = settings?.active ? Number(settings.pixDiscountPercent) : 0;
  if (!(percent > 0)) return null;
  const shown = Number.isInteger(percent) ? String(percent) : String(percent).replace(".", ",");
  return `${shown}% OFF no Pix`;
}

export const paymentLabel = (method: PaymentMethod) => (method === "CARD" ? "Cartão" : "PIX");

/**
 * Configuração vigente (Admin → Precificação). Compartilha o cache com o
 * carrinho, então trocar 5% por 3% vale em toda a loja sem mexer no código.
 */
