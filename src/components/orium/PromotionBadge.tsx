import { Smartphone } from "lucide-react";
import type { Promotion } from "@/lib/promotions";
import { appBadgeLabel, appExclusiveNote } from "@/lib/promotions";
import { cn } from "@/lib/utils";

/**
 * SELO GLOBAL DE PROMOÇÃO DA ORIUM — "Exclusivo no app".
 *
 * Regra única: só aparece quando existe promoção em vigor E a promoção está
 * marcada como exclusiva do aplicativo no Admin. Nenhum componente decide isso
 * por conta própria: todos passam a promoção aqui.
 * Entra com uma microanimação (opacity + scale) e depois fica estável.
 */
export function PromotionBadge({
  promotion,
  label: given,
  compact = false,
  size = "md",
  className,
}: {
  promotion?: Promotion | null;
  /** Rótulo já resolvido no servidor (popup de ofertas). */
  label?: string | null;
  /** Cards muito pequenos usam "Só no app". */
  compact?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const label = given ?? appBadgeLabel(promotion, compact);
  if (!label) return null;
  return (
    <span
      className={cn(
        "promo-badge inline-flex max-w-full items-center gap-1 truncate rounded-full border border-gold/45 bg-gold/12 font-semibold tracking-wide text-gold-foreground uppercase dark:text-gold",
        size === "sm" && "px-1.5 py-0.5 text-[9.5px]",
        size === "md" && "px-2 py-0.5 text-[10.5px]",
        size === "lg" && "px-2.5 py-1 text-[12px]",
        className,
      )}
    >
      <Smartphone className={cn("shrink-0", size === "lg" ? "size-3.5" : "size-2.5")} aria-hidden />
      {label}
    </span>
  );
}

/** Frase curta de apoio, usada onde há espaço (página do perfume, popup). */
export function PromotionNote({
  promotion,
  variant = "short",
  className,
}: {
  promotion: Promotion | null | undefined;
  variant?: "short" | "long";
  className?: string;
}) {
  const note = appExclusiveNote(promotion, variant);
  if (!note) return null;
  return <p className={cn("text-xs leading-snug text-muted-foreground", className)}>{note}</p>;
}
