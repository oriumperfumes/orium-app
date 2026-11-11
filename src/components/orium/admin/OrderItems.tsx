import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { brl, productTitle } from "@/lib/format";

/* ------------------------------------------------------------------ *
 * Peças visuais dos itens do pedido. Objetivo: bater o olho e saber
 * qual perfume, se é frasco ou decant, o tamanho, a quantidade e o
 * valor — sem abrir o pedido. Nenhuma regra de negócio vive aqui.
 * ------------------------------------------------------------------ */

export type OrderLine = {
  id: string;
  product_id?: string | null;
  product_name_snapshot: string;
  image_snapshot?: string | null;
  variant: string;
  variant_label?: string | null;
  decant_ml?: number | null;
  quantity: number;
  subtotal?: number | string | null;
};

export const isDecant = (l: Pick<OrderLine, "variant">) => l.variant === "DECANT";

/** "Frasco · 100ml" ou "Decant · 5ml" — sempre explícito. */
export function variantText(l: OrderLine) {
  if (isDecant(l)) return `Decant · ${l.decant_ml ?? "?"}ml`;
  const ml = l.variant_label?.match(/(\d{2,4})\s*ml/i)?.[1];
  return ml ? `Frasco · ${ml}ml` : "Frasco";
}

/** Badge discreto, mas inconfundível: dourado para decant, neutro para frasco. */
export function VariantBadge({ line, className }: { line: OrderLine; className?: string }) {
  const decant = isDecant(line);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] uppercase",
        decant ? "border-gold/30 bg-gold/10 text-gold" : "border-border/60 bg-muted/40 text-muted-foreground",
        className,
      )}
    >
      {variantText(line)}
    </span>
  );
}

/** Foto real do catálogo, tamanho constante. */
export function ItemThumb({
  src,
  alt,
  size = 48,
}: {
  src?: string | null | undefined;
  alt: string;
  size?: number | undefined;
}) {
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-xl border border-border/50 bg-muted/40"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={alt} loading="lazy" className="size-full object-cover" />
      ) : (
        <ImageIcon className="size-4 text-muted-foreground/60" strokeWidth={1.75} />
      )}
    </div>
  );
}

/** Resumo visual: "3 itens · 1 frasco · 2 decants". */
export function itemsSummary(lines: OrderLine[]) {
  const total = lines.reduce((s, l) => s + Number(l.quantity ?? 0), 0);
  const bottles = lines.filter((l) => !isDecant(l)).reduce((s, l) => s + Number(l.quantity ?? 0), 0);
  const decants = total - bottles;
  const parts = [`${total} ${total === 1 ? "item" : "itens"}`];
  if (bottles) parts.push(`${bottles} ${bottles === 1 ? "frasco" : "frascos"}`);
  if (decants) parts.push(`${decants} ${decants === 1 ? "decant" : "decants"}`);
  return parts.join(" · ");
}

/** Linhas de produto direto na lista de pedidos (2–3 itens). */
export function OrderItemsPreview({
  lines,
  imageOf,
  max = 3,
}: {
  lines: OrderLine[];
  imageOf?: ((l: OrderLine) => string | null | undefined) | undefined;
  max?: number | undefined;
}) {
  const shown = lines.slice(0, max);
  const rest = lines.length - shown.length;
  return (
    <div className="mt-3 space-y-2">
      {shown.map((l) => (
        <div key={l.id} className="flex min-w-0 items-center gap-3">
          <ItemThumb src={imageOf?.(l) ?? l.image_snapshot} alt={l.product_name_snapshot} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{productTitle(l.product_name_snapshot)}</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <VariantBadge line={l} />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{l.quantity}x</span>
            </div>
          </div>
          <span className="shrink-0 text-sm tabular-nums">{brl(l.subtotal)}</span>
        </div>
      ))}
      {rest > 0 ? (
        <p className="pl-[56px] text-xs text-muted-foreground">
          +{rest} {rest === 1 ? "item" : "itens"}
        </p>
      ) : null}
    </div>
  );
}

/** Mini-card do item no detalhe do pedido. */
export function OrderItemCard({
  line,
  image,
  brand,
}: {
  line: OrderLine;
  image?: string | null | undefined;
  brand?: string | null | undefined;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-card p-3">
      <ItemThumb src={image ?? line.image_snapshot} alt={line.product_name_snapshot} size={56} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{productTitle(line.product_name_snapshot)}</p>
        {brand ? <p className="truncate text-xs text-muted-foreground">{productTitle(brand)}</p> : null}
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
          <VariantBadge line={line} />
          <span className="text-xs text-muted-foreground tabular-nums">Quantidade {line.quantity}</span>
        </div>
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums">{brl(line.subtotal)}</span>
    </li>
  );
}
