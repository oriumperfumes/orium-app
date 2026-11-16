import { memo } from "react";
import { AlertTriangle, Check, ImageOff } from "lucide-react";
import { ItemMenuButton, type MenuPos } from "@/components/orium/admin/ItemMenu";
import type { ProductIssueLite, ProductRowData } from "@/components/orium/admin/ProductBits";
import { brl } from "@/lib/format";
import { imgVariant } from "@/lib/product-img";
import { GENDER_LABEL, TYPE_LABEL, type Gender, type ProductType } from "@/lib/catalog/classify";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Cartões da central de Produtos — grade (foto grande) e lista (uma
 * linha). Tocar abre o perfume; "⋯", botão direito ou segurar abre o menu.
 * Só apresentação: as regras (problemas, preço, disponibilidade) vêm prontas.
 * ------------------------------------------------------------------ */

export type Ops = { source: string; localStock: number; manual: boolean };

/** Situação de venda em poucas palavras + tom (mesma regra em grade e lista). */
export function stockState(p: ProductRowData, ops?: Ops) {
  const hidden = !(p.active && p.catalog_eligible);
  if (hidden) return { tone: "off" as const, label: "Oculto" };
  if (!p.in_stock) return { tone: "coral" as const, label: ops?.source === "blocked" ? "Indisponível · manual" : "Indisponível" };
  if (ops?.source === "local" || ops?.source === "manual")
    return { tone: "ok" as const, label: `Pronta entrega${ops.localStock > 0 ? ` · ${ops.localStock}` : ""}` };
  if (ops?.source === "supplier") return { tone: "gold" as const, label: "Sob encomenda" };
  return { tone: "ok" as const, label: "Disponível" };
}

export const TONE_DOT = { ok: "#7FCF9F", gold: "#FFD599", coral: "#FF9A8A", off: "#6F6F6F", warn: "#F2C46D" } as const;

type CardProps = {
  product: ProductRowData;
  issues: ProductIssueLite[];
  /** preço final que o cliente vê hoje, no Pix */
  price: number | null;
  /** preço antes da promoção, quando houver campanha ativa */
  promoFrom?: number | null;
  customPrice?: boolean;
  ops?: Ops;
  checked: boolean;
  busy?: boolean;
  i?: number;
  onCheck: (id: string, v: boolean) => void;
  /** abre o perfume (recebe o cartão, de onde a janela nasce) */
  onOpen: (id: string, el: HTMLElement) => void;
  onMenu: (id: string, pos: MenuPos) => void;
};

/** Bolinha de seleção (aparece ao passar o mouse; sempre no celular). */
function SelectDot({ checked, onCheck, className }: { checked: boolean; onCheck: (v: boolean) => void; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "Remover da seleção" : "Selecionar"}
      onClick={(e) => {
        e.stopPropagation();
        onCheck(!checked);
      }}
      className={cn(
        "press grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-200",
        checked ? "bg-white text-[#15130F]" : "bg-black/55 text-transparent ring-1 ring-white/50 hover:bg-black/75",
        className,
      )}
    >
      <Check className={cn("size-4", checked && "pk-check-on")} strokeWidth={3} />
    </button>
  );
}

function PriceLine({ price, promoFrom }: { price: number | null; promoFrom?: number | null | undefined }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 tabular-nums">
      {price != null ? (
        <>
          <span className="text-[16px] font-bold tracking-[-0.02em] whitespace-nowrap">{brl(price)}</span>
          {promoFrom != null ? (
            <span className="truncate text-[12px] text-[#6F6F6F] line-through">{brl(promoFrom)}</span>
          ) : (
            <span className="text-[11.5px] text-[#6F6F6F]">Pix</span>
          )}
        </>
      ) : (
        <span className="text-[14px] font-semibold whitespace-nowrap text-[#FF9A8A]">Sem preço</span>
      )}
    </span>
  );
}

export const productMeta = (p: ProductRowData) =>
  [
    p.volume_ml ? `${p.volume_ml} ml` : null,
    p.product_type && p.product_type !== "PERFUME" ? TYPE_LABEL[(p.product_type as ProductType) ?? "UNKNOWN"] : null,
    p.product_type === "PERFUME" && p.gender_norm && p.gender_norm !== "UNKNOWN" ? GENDER_LABEL[p.gender_norm as Gender] : null,
  ]
    .filter(Boolean)
    .join(" · ");

const keyOpen = (fn: (el: HTMLElement) => void) => (e: React.KeyboardEvent<HTMLElement>) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn(e.currentTarget);
  }
};

/** Cartão da grade: foto grande, nome, preço e situação. */
export const ProductTile = memo(function ProductTile({ product: p, issues, price, promoFrom, customPrice, ops, checked, busy, i = 0, onCheck, onOpen, onMenu }: CardProps) {
  const st = stockState(p, ops);
  const review = issues.filter((x) => x.severity <= 2);
  const img = imgVariant(p.image_url, "card");
  return (
    <article
      data-item-id={p.id}
      data-selected={checked}
      role="button"
      tabIndex={0}
      aria-label={`Abrir ${p.canonical_name}`}
      onClick={(e) => onOpen(p.id, e.currentTarget)}
      onKeyDown={keyOpen((el) => onOpen(p.id, el))}
      className={cn("pk-tile pk-in flex flex-col p-2", busy && "pointer-events-none opacity-60")}
      style={{ ["--i" as string]: i }}
    >
      <div className="relative aspect-square overflow-hidden rounded-[20px] bg-[#232323]">
        {img ? (
          <img src={img} alt={p.canonical_name} loading="lazy" className={cn("pk-tile-img size-full object-cover", st.tone === "off" && "opacity-40 grayscale")} />
        ) : (
          <div className="grid size-full place-items-center text-[#6F6F6F]">
            <ImageOff className="size-6" strokeWidth={1.6} />
          </div>
        )}
        <SelectDot checked={checked} onCheck={(v) => onCheck(p.id, v)} className="pk-reveal absolute top-2.5 left-2.5" />
        <ItemMenuButton
          size="sm"
          label={`Opções de ${p.canonical_name}`}
          onOpen={(pos) => onMenu(p.id, pos)}
          className="pk-reveal absolute top-2 right-2 !bg-black/65 hover:!bg-black/85"
        />
        <span className="absolute bottom-2.5 left-2.5 inline-flex h-7 max-w-[calc(100%-56px)] items-center gap-1.5 rounded-full bg-black/70 px-2.5 text-[12px] font-semibold text-white">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: TONE_DOT[st.tone] }} />
          <span className="truncate">{st.label}</span>
        </span>
        {review.length ? (
          <span
            title={review.map((x) => x.label).join(" · ")}
            aria-label={`${review.length} ponto${review.length === 1 ? "" : "s"} para revisar`}
            className="absolute right-2.5 bottom-2.5 grid size-7 place-items-center rounded-full bg-[#F2C46D] text-[#15130F]"
          >
            <AlertTriangle className="size-3.5" strokeWidth={2.4} />
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col px-2 pt-3 pb-2">
        <p className="truncate text-[11px] font-semibold tracking-[0.06em] text-[#8C8C8C] uppercase">{p.brand ?? "Sem marca"}</p>
        <p className="mt-0.5 line-clamp-2 text-[15px] leading-[1.2] font-bold tracking-[-0.01em]">{p.canonical_name}</p>
        <p className="mt-1 truncate text-[12px] text-[#8C8C8C]">{productMeta(p) || " "}</p>
        <div className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-2.5">
          <PriceLine price={price} promoFrom={promoFrom} />
          {customPrice || p.source === "manual" ? (
            <span className="shrink-0 rounded-full bg-[#232323] px-2 py-0.5 text-[10.5px] font-bold text-[#FFD599]">{customPrice ? "preço fixo" : "manual"}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
});

/** Linha da lista: tudo numa linha, para varrer muitos produtos rápido. */
export const ProductRow = memo(function ProductRow({ product: p, issues, price, promoFrom, customPrice, ops, checked, busy, i = 0, onCheck, onOpen, onMenu }: CardProps) {
  const st = stockState(p, ops);
  const review = issues.filter((x) => x.severity <= 2);
  const img = imgVariant(p.image_url, "thumb");
  const status = (
    <>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: TONE_DOT[st.tone] }} />
      <span className="truncate">{st.label}</span>
    </>
  );
  return (
    <article
      data-item-id={p.id}
      data-selected={checked}
      role="button"
      tabIndex={0}
      aria-label={`Abrir ${p.canonical_name}`}
      onClick={(e) => onOpen(p.id, e.currentTarget)}
      onKeyDown={keyOpen((el) => onOpen(p.id, el))}
      className={cn("pk-row pk-in flex min-w-0 items-center gap-3 p-2.5 pr-3", busy && "pointer-events-none opacity-60")}
      style={{ ["--i" as string]: i }}
    >
      <div className="relative shrink-0">
        <span className="block size-14 overflow-hidden rounded-[16px] bg-[#232323]">
          {img ? (
            <img src={img} alt="" loading="lazy" className={cn("size-full object-cover", st.tone === "off" && "opacity-40 grayscale")} />
          ) : (
            <span className="grid size-full place-items-center text-[#6F6F6F]">
              <ImageOff className="size-4" />
            </span>
          )}
        </span>
        <SelectDot checked={checked} onCheck={(v) => onCheck(p.id, v)} className="pk-reveal absolute -top-1.5 -left-1.5 !size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] leading-tight font-bold">{p.canonical_name}</p>
        <p className="mt-0.5 truncate text-[12.5px] text-[#8C8C8C]">{[p.brand ?? "Sem marca", productMeta(p)].filter(Boolean).join(" · ")}</p>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-[#D4D4D4] md:hidden">{status}</p>
      </div>
      <span className="hidden w-44 min-w-0 items-center gap-1.5 text-[13px] font-semibold text-[#D4D4D4] md:flex">{status}</span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 sm:w-32">
        <PriceLine price={price} promoFrom={promoFrom} />
        {customPrice || p.source === "manual" ? <span className="text-[10.5px] font-bold text-[#FFD599]">{customPrice ? "preço fixo" : "manual"}</span> : null}
      </span>
      <span className="hidden w-7 shrink-0 sm:block">
        {review.length ? (
          <span title={review.map((x) => x.label).join(" · ")} className="grid size-7 place-items-center rounded-full bg-[#2A2414] text-[#F2C46D]">
            <AlertTriangle className="size-3.5" strokeWidth={2.4} />
          </span>
        ) : null}
      </span>
      <ItemMenuButton size="sm" label={`Opções de ${p.canonical_name}`} onOpen={(pos) => onMenu(p.id, pos)} />
    </article>
  );
});
