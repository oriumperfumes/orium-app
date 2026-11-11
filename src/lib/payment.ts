/**
 * Pagamento (Pix x Cartão) — regra pura em `payment-rule.ts`; aqui só o acesso
 * à configuração vigente para a interface.
 */
import { normalizePaymentSettings, type PaymentSettings } from "@/lib/payment-rule";
import { usePublicPricingSettings } from "@/lib/pricing-settings";

export * from "@/lib/payment-rule";

export function usePaymentSettings(): PaymentSettings {
  const { data } = usePublicPricingSettings();
  return normalizePaymentSettings(data as never);
}
