/**
 * Nota de pagamento: o preço mostrado é o do Pix; o cartão vem calculado pela
 * regra central (nunca por fórmula solta em componente).
 */
import { brl } from "@/lib/format";
import { CARD_AVAILABLE } from "@/lib/checkout-rules";
import { getPaymentPricing, pixOffLabel, usePaymentSettings } from "@/lib/payment";
import { cn } from "@/lib/utils";

export function PixNote({
  amount,
  showCard = true,
  className,
}: {
  /** valor final que o cliente pagaria hoje (já com promoção/atacado) */
  amount: number;
  showCard?: boolean;
  className?: string;
}) {
  const settings = usePaymentSettings();
  const pricing = getPaymentPricing(amount, settings);
  const off = pixOffLabel(settings);
  if (!pricing.active || !off) return null;

  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs", className)}>
      <span className="font-semibold text-gold">{off}</span>
      {showCard && CARD_AVAILABLE ? (
        <span key={pricing.cardPrice} className="value-in text-muted-foreground">
          ou {brl(pricing.cardPrice)} no cartão
        </span>
      ) : null}
    </p>
  );
}

/** Selo compacto para cabeçalhos e banners. */
export function PixOffPill({ className }: { className?: string }) {
  const settings = usePaymentSettings();
  const off = pixOffLabel(settings);
  if (!off) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold",
        className,
      )}
    >
      {off}
    </span>
  );
}
