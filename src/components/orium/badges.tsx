import { Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReadyToDeliverStatus } from "@/lib/ready-to-deliver";

/** Público: nunca mostra a quantidade física de estoque. */
export function StockBadge({ inStock, productId }: { inStock: boolean; productId?: string; quantity?: number | null }) {
  const { ready } = useReadyToDeliverStatus(productId);
  const on = inStock || ready;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        ready ? "text-gold" : on ? "text-success" : "text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-gold" : on ? "bg-success" : "bg-muted-foreground/50")} />
      {ready ? "Pronta entrega" : on ? "Disponível" : "Indisponível"}
    </span>
  );
}

/** Card: só destaca a pronta entrega; o resto do catálogo não leva etiqueta. */
export function ReadyTag({ productId, className }: { productId: string; inStock?: boolean; className?: string }) {
  const { ready } = useReadyToDeliverStatus(productId);
  if (!ready) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10.5px] font-semibold text-gold", className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-gold" />
      Pronta entrega
    </span>
  );
}

/** Prazo da Orium até disponibilizar o produto; não substitui prazo de frete. */
export function DeliveryEstimate({
  productId,
  inStock,
  className,
}: {
  productId: string;
  inStock: boolean;
  className?: string;
}) {
  const { ready, resolved } = useReadyToDeliverStatus(productId);
  if (!resolved || ready || !inStock) return null;
  return (
    <p className={cn("flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground", className)}>
      <Store aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
      <span><strong className="font-semibold text-foreground">Retirada grátis na loja em cerca de 4 dias.</strong> Na entrega, você só paga depois de confirmar o valor e o prazo pelo WhatsApp.</span>
    </p>
  );
}

const STATUS_STYLES: Record<string, string> = {
  pendente: "bg-accent text-accent-foreground",
  "pedido feito": "bg-gold/20 text-gold-foreground dark:text-gold",
  entregue: "bg-success/15 text-success",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize", STATUS_STYLES[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}
