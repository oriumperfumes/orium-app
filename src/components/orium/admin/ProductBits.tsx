import { memo, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronDown, ImageOff, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { AdminMore, type AdminAction } from "@/components/orium/admin/AdminUI";
import { brl } from "@/lib/format";
import { TYPE_LABEL, GENDER_LABEL, ALLOWED_TYPES, type ProductType, type Gender } from "@/lib/catalog/classify";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Peças visuais da central de Produtos. Nada de regra de negócio:
 * só apresentação, hierarquia e progressive disclosure.
 * ------------------------------------------------------------------ */

export type ProductRowData = {
  id: string;
  canonical_name: string;
  brand: string | null;
  brand_id: string | null;
  image_url: string | null;
  product_type: string | null;
  gender_norm: string | null;
  volume_ml: number | null;
  in_stock: boolean;
  stock_quantity: number | null;
  retail_price: number | null;
  active: boolean;
  catalog_eligible: boolean;
  source: string | null;
};

export type ProductIssueLite = {
  key: string;
  severity: 1 | 2 | 3;
  label: string;
  reason?: string;
  olfactory?: boolean;
};

/** Etiqueta pequena e discreta — nunca pinta o card inteiro. */
export function Tag({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "ok" | "warn" | "danger" | "gold";
}) {
  const cls =
    tone === "ok"
      ? "border-success/25 bg-success/10 text-success"
      : tone === "warn"
        ? "border-warning/30 bg-warning/10 text-warning"
        : tone === "danger"
          ? "border-destructive/25 bg-destructive/10 text-destructive"
          : tone === "gold"
            ? "border-gold/30 bg-gold/10 text-gold"
            : "border-border/60 bg-muted/40 text-muted-foreground";
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] leading-5", cls)}>
      {children}
    </span>
  );
}

export function ProductThumb({ src, alt, size = 56 }: { src: string | null; alt: string; size?: number }) {
  return (
    <div className="shrink-0 overflow-hidden rounded-xl bg-muted/60" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center text-muted-foreground">
          <ImageOff className="size-4" strokeWidth={1.75} />
        </div>
      )}
    </div>
  );
}

/** Linha “Que produto é esse?” em duas segundos: foto, nome, marca, preço, estado. */
export const ProductListCard = memo(function ProductListCard({
  product: p,
  issues,
  price,
  promoFrom,
  customPrice,
  ops,
  checked,
  busy,
  onCheck,
  onEdit,
  actions,
}: {
  product: ProductRowData;
  issues: ProductIssueLite[];
  /** preço final que o cliente vê hoje, no Pix */
  price: number | null;
  /** preço antes da promoção, quando houver campanha ativa */
  promoFrom?: number | null;
  customPrice?: boolean;
  /** estado interno de disponibilidade (somente Admin) */
  ops?: { source: string; localStock: number; manual: boolean };
  checked: boolean;
  busy?: boolean;
  onCheck: (v: boolean) => void;
  onEdit: () => void;
  actions: AdminAction[];
}) {
  const [showIssues, setShowIssues] = useState(false);
  const hidden = !(p.active && p.catalog_eligible);
  const needsReview = issues.some((i) => i.severity <= 2);

  return (
    <article
      className={cn(
        "min-w-0 rounded-2xl border border-border/60 bg-card p-3 transition-colors",
        checked && "border-foreground/50 bg-foreground/[0.04]",
        busy && "opacity-60",
      )}
    >
      <div className="flex min-w-0 gap-3">
        <div className="-m-1 grid size-11 shrink-0 place-items-center rounded-xl">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => onCheck(v === true)}
            aria-label={checked ? "Remover da seleção" : "Selecionar produto"}
            className="size-5"
          />
        </div>


        <ProductThumb src={p.image_url} alt={p.canonical_name} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{p.canonical_name}</p>
          <p className="truncate text-xs text-muted-foreground">{p.brand ?? "Marca não identificada"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[
              TYPE_LABEL[(p.product_type as ProductType) ?? "UNKNOWN"],
              p.product_type === "PERFUME" ? GENDER_LABEL[(p.gender_norm as Gender) ?? "UNKNOWN"] : null,
              p.volume_ml ? `${p.volume_ml} ml` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <p className="min-w-0 text-sm font-semibold tabular-nums">
              {promoFrom != null ? (
                <span className="mr-1.5 text-xs font-normal text-muted-foreground line-through">{brl(promoFrom)}</span>
              ) : null}
              {price != null ? brl(price) : "Sem preço"}
              {price != null ? <span className="ml-1 text-[11px] font-normal text-muted-foreground"> no Pix</span> : null}

            </p>
            {hidden ? (
              <Tag>Oculto</Tag>
            ) : !p.in_stock ? (
              <Tag>{ops?.source === "blocked" ? "Indisponível · manual" : "Indisponível"}</Tag>
            ) : ops?.source === "local" || ops?.source === "manual" ? (
              <Tag tone="ok">Pronta entrega{ops.localStock > 0 ? ` · ${ops.localStock} un.` : ""}</Tag>
            ) : ops?.source === "supplier" ? (
              <Tag tone="ok">Sob encomenda</Tag>
            ) : (
              <Tag tone="ok">Disponível</Tag>
            )}
            {ops?.manual ? <Tag tone="warn">Manual</Tag> : null}
            {customPrice ? <Tag tone="gold">Preço personalizado</Tag> : null}
            {p.source === "manual" ? <Tag>Manual</Tag> : null}
          </div>

          {needsReview ? (
            <button
              type="button"
              onClick={() => setShowIssues((v) => !v)}
              className="press mt-2 inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning"
            >
              <AlertTriangle className="size-3" strokeWidth={2} /> Precisa de revisão
              <ChevronDown className={cn("size-3 transition-transform", showIssues && "rotate-180")} />
            </button>
          ) : null}

          {showIssues ? (
            <ul className="mt-2 space-y-1">
              {issues.map((i) => (
                <li key={i.key} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{i.label}</span>
                  {i.reason ? ` · ${i.reason}` : ""}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="press h-10 rounded-full px-5 text-xs"
              disabled={busy}
              onClick={onEdit}
            >
              Editar
            </Button>
            <AdminMore actions={actions} label={p.canonical_name} />
          </div>
        </div>
      </div>
    </article>
  );
});

/** Chips do que está filtrado agora — sempre removíveis. */
export function ActiveFilterChips({
  chips,
  onClear,
}: {
  chips: Array<{ label: string; onRemove: () => void }>;
  onClear: () => void;
}) {
  if (!chips.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={c.onRemove}
          className="press inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs"
        >
          <span className="truncate">{c.label}</span>
          <X className="size-3 shrink-0" />
        </button>
      ))}
      <button type="button" onClick={onClear} className="text-xs text-muted-foreground underline">
        Limpar
      </button>
    </div>
  );
}

export type ProductFilterState = {
  brandId: string | undefined;
  type: string | undefined;
  gender: string | undefined;
  supplierId: string | undefined;
  stock: "em" | "sem" | undefined;
  manualOnly: boolean;
  customPriceOnly: boolean;
  ops?: "pronta" | "sem-local" | "encomenda" | "manual" | "preco-manual" | undefined;
  hiddenOnly: boolean;
  reviewOnly: boolean;
  order: ProductOrder;
};

export type ProductOrder = "nome" | "recentes" | "preco-asc" | "preco-desc" | "estoque";

const ORDER_LABEL: Record<ProductOrder, string> = {
  nome: "Nome",
  recentes: "Mais recentes",
  "preco-asc": "Menor preço",
  "preco-desc": "Maior preço",
  estoque: "Estoque",
};

export const ORDER_OPTIONS = Object.entries(ORDER_LABEL) as Array<[ProductOrder, string]>;

const GENDERS: Array<[string, string]> = [
  ["MALE", "Masculino"],
  ["FEMALE", "Feminino"],
  ["UNISEX", "Unissex"],
];

/** Todos os filtros avançados moram aqui — a tela fica limpa. */
export function ProductFiltersSheet({
  open,
  onOpenChange,
  state,
  set,
  brands,
  suppliers,
  total,
  onClear,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  state: ProductFilterState;
  set: (patch: Partial<ProductFilterState>) => void;
  brands: Array<{ id: string; canonical_name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  total: number;
  onClear: () => void;
}) {
  const [brandTerm, setBrandTerm] = useState("");
  const list = brands.filter((b) => b.canonical_name.toLowerCase().includes(brandTerm.trim().toLowerCase()));

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[88vh] border-border/60">
        <DrawerTitle className="px-5 pt-3 text-lg">Filtros</DrawerTitle>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 pt-4 pb-3">
          <Group title="Disponibilidade">
            <Pill active={!state.stock} onClick={() => set({ stock: undefined })}>
              Todas
            </Pill>
            <Pill active={state.stock === "em"} onClick={() => set({ stock: "em" })}>
              Disponíveis
            </Pill>
            <Pill active={state.stock === "sem"} onClick={() => set({ stock: "sem" })}>
              Indisponíveis
            </Pill>
          </Group>

          <Group title="Operação da loja">
            {(
              [
                ["pronta", "Pronta entrega"],
                ["sem-local", "Sem estoque local"],
                ["encomenda", "Sob encomenda"],
                ["manual", "Disponibilidade manual"],
                ["preco-manual", "Preço manual"],
              ] as const
            ).map(([k, l]) => (
              <Pill key={k} active={state.ops === k} onClick={() => set({ ops: state.ops === k ? undefined : k })}>
                {l}
              </Pill>
            ))}
          </Group>

          <Group title="Categoria">
            <Pill active={!state.type} onClick={() => set({ type: undefined })}>
              Todas
            </Pill>
            {ALLOWED_TYPES.map((t) => (
              <Pill key={t} active={state.type === t} onClick={() => set({ type: t })}>
                {TYPE_LABEL[t]}
              </Pill>
            ))}
          </Group>

          <Group title="Gênero">
            <Pill active={!state.gender} onClick={() => set({ gender: undefined })}>
              Todos
            </Pill>
            {GENDERS.map(([key, label]) => (
              <Pill key={key} active={state.gender === key} onClick={() => set({ gender: key })}>
                {label}
              </Pill>
            ))}
          </Group>

          <Group title="Situação">
            <Pill active={state.reviewOnly} onClick={() => set({ reviewOnly: !state.reviewOnly })}>
              Para revisar
            </Pill>
            <Pill active={state.manualOnly} onClick={() => set({ manualOnly: !state.manualOnly })}>
              Produto manual
            </Pill>
            <Pill active={state.customPriceOnly} onClick={() => set({ customPriceOnly: !state.customPriceOnly })}>
              Preço personalizado
            </Pill>
            <Pill active={state.hiddenOnly} onClick={() => set({ hiddenOnly: !state.hiddenOnly })}>
              Oculto
            </Pill>
          </Group>

          <Group title="Ordenar por">
            {ORDER_OPTIONS.map(([key, label]) => (
              <Pill key={key} active={state.order === key} onClick={() => set({ order: key })}>
                {label}
              </Pill>
            ))}
          </Group>

          {suppliers.length ? (
            <Group title="Fornecedor">
              <Pill active={!state.supplierId} onClick={() => set({ supplierId: undefined })}>
                Todos
              </Pill>
              {suppliers.map((s) => (
                <Pill key={s.id} active={state.supplierId === s.id} onClick={() => set({ supplierId: s.id })}>
                  {s.name}
                </Pill>
              ))}
            </Group>
          ) : null}

          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Marca</p>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={brandTerm}
                onChange={(e) => setBrandTerm(e.target.value)}
                placeholder="Pesquisar marca..."
                aria-label="Pesquisar marca"
                className="h-11 w-full rounded-full border border-border/60 bg-background pl-9 text-base outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="max-h-56 min-w-0 overflow-y-auto overscroll-contain rounded-2xl border border-border/60">
              <Row active={!state.brandId} onClick={() => set({ brandId: undefined })} label="Todas as marcas" />
              {list.map((b) => (
                <Row
                  key={b.id}
                  active={state.brandId === b.id}
                  onClick={() => set({ brandId: b.id })}
                  label={b.canonical_name}
                />
              ))}
              {list.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Nenhuma marca com esse nome.</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex gap-2 border-t border-border/60 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
          <Button variant="outline" className="press h-12 flex-1 rounded-full" onClick={onClear}>
            Limpar
          </Button>
          <Button className="press h-12 flex-[1.6] rounded-full text-base" onClick={() => onOpenChange(false)}>
            Ver {total} produto{total === 1 ? "" : "s"}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press min-h-10 max-w-full rounded-full border px-4 text-xs transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground",
      )}
    >
      <span className="block truncate">{children}</span>
    </button>
  );
}

function Row({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-12 w-full items-center justify-between gap-2 border-b border-border/50 px-4 text-left text-sm last:border-b-0",
        active ? "font-semibold" : "text-muted-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      {active ? <span className="shrink-0 text-gold">•</span> : null}
    </button>
  );
}

/** Barra contextual: aparece só com produtos selecionados. */
export function BulkBar({
  count,
  onClear,
  onBrand,
  onHide,
  onDelete,
  more,
}: {
  count: number;
  onClear: () => void;
  onBrand: () => void;
  onHide: () => void;
  onDelete?: () => void;
  more: AdminAction[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="orium-island pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+76px)] lg:pb-6 lg:pl-[276px] wide:pl-[300px]">
      <div className="pointer-events-auto mx-auto w-full max-w-xl min-w-0 space-y-2 rounded-[28px] border border-white/[0.07] bg-[#161616] p-3 shadow-[0_24px_48px_-20px_rgb(0_0_0/0.9)]">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-semibold tabular-nums">
            {count} selecionado{count === 1 ? "" : "s"}
          </span>
          <button type="button" className="shrink-0 text-xs text-muted-foreground underline" onClick={onClear}>
            Limpar
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" className="press h-11 min-w-0 flex-1 rounded-full text-xs sm:text-sm" onClick={onBrand}>
            <span className="truncate">Alterar marca</span>
          </Button>
          <Button variant="outline" className="press h-11 min-w-0 flex-1 rounded-full text-xs sm:text-sm" onClick={onHide}>
            <span className="truncate">Ocultar</span>
          </Button>
          {onDelete ? (
            <Button variant="destructive" className="press h-11 min-w-0 flex-1 rounded-full text-xs sm:text-sm" onClick={onDelete}>
              <span className="truncate">Excluir</span>
            </Button>
          ) : null}
          <AdminMore label="Mais ações" actions={more} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
