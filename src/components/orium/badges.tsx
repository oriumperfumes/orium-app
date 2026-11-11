import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReadyToDeliverStatus } from "@/lib/ready-to-deliver";

/** Público: nunca mostra a quantidade física de estoque. */
export function StockBadge({ inStock, productId }: { inStock: boolean; productId?: string; quantity?: number | null }) {
  const { ready, resolved } = useReadyToDeliverStatus(productId);
  const on = inStock || ready;
  const specialOrder = inStock && resolved && !ready;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        ready ? "text-gold" : on ? "text-success" : "text-muted-foreground",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-gold" : on ? "bg-success" : "bg-muted-foreground/50")} />
      {ready ? "Pronta entrega" : specialOrder ? "Sob encomenda" : on ? "Disponível" : "Indisponível"}
    </span>
  );
}

/** Card: pronta entrega ou, somente se disponível, a previsão de encomenda. */
export function ReadyTag({ productId, inStock, className }: { productId: string; inStock?: boolean; className?: string }) {
  const { ready, resolved } = useReadyToDeliverStatus(productId);
  if (!ready && !(resolved && inStock)) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10.5px] font-semibold", ready ? "text-gold" : "text-muted-foreground", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-gold" : "bg-muted-foreground")} />
      {ready ? "Pronta entrega" : "Sob encomenda"}
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
      <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
      <span><strong className="font-semibold text-foreground">Sob encomenda.</strong> Para retirada na loja ou entrega local, previsão de cerca de 4 dias. Para envio pelos Correios/SEDEX, confira o prazo da transportadora no checkout; a postagem depende da chegada do produto à Orium.</span>
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
