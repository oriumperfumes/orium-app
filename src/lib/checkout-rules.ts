/**
 * Regras do checkout PÚBLICO (loja), usadas pela tela e pelo servidor.
 *
 * No lançamento a loja oferece só:
 *  - pagamento: Pix;
 *  - retirada na loja (grátis, Itaguaí);
 *  - entrega com valor e prazo combinados pelo WhatsApp ANTES do pagamento.
 * Cartão e cotação automática de frete (SuperFrete/Correios) ficam para depois:
 * basta ampliar as listas abaixo (e ligar CARD_AVAILABLE) para reabrir.
 *
 * Isto vale só para pedidos novos feitos pela loja. Pedidos antigos e as
 * opções internas do Admin (venda na loja, edição de pedido, Copiloto) não passam por aqui.
 */
export const PUBLIC_FULFILLMENTS = ["PICKUP", "LOCAL"] as const;
export type PublicFulfillment = (typeof PUBLIC_FULFILLMENTS)[number];

export const PUBLIC_PAYMENT_METHODS = ["PIX"] as const;
export type PublicPaymentMethod = (typeof PUBLIC_PAYMENT_METHODS)[number];

/** Enquanto for false, a loja não mostra o preço no cartão. */
export const CARD_AVAILABLE = false;

/** Texto gravado em `delivery_notes` para a equipe ver no Admin. */
export const LOCAL_DELIVERY_NOTE =
  "Entrega: valor e prazo ainda não definidos. Confirmar com o cliente pelo WhatsApp antes do pagamento.";

export type PublicCheckoutOptions = {
  fulfillment: PublicFulfillment;
  paymentMethod: PublicPaymentMethod;
};

/**
 * Valida as opções recebidas do checkout público. Sem opção informada vale o
 * padrão (retirada e Pix). Qualquer outra recusa o pedido com uma mensagem clara.
 */
export function assertPublicCheckoutOptions(input: {
  fulfillment?: string | null;
  paymentMethod?: string | null;
}): PublicCheckoutOptions {
  const fulfillment = input.fulfillment ?? "PICKUP";
  if (!(PUBLIC_FULFILLMENTS as readonly string[]).includes(fulfillment)) {
    throw new Error(
      "Esta forma de receber não está disponível agora. Escolha retirar na loja ou entrega combinada pelo WhatsApp.",
    );
  }
  const paymentMethod = input.paymentMethod ?? "PIX";
  if (!(PUBLIC_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    throw new Error("O pagamento no momento é só por Pix.");
  }
  return {
    fulfillment: fulfillment as PublicFulfillment,
    paymentMethod: paymentMethod as PublicPaymentMethod,
  };
}
