import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ImageOff, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { AdminMore, type AdminAction } from "@/components/orium/admin/AdminUI";
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
          className="press inline-flex h-9 max-w-full items-center gap-1.5 rounded-full bg-white pr-2.5 pl-3.5 text-[13px] font-semibold text-[#15130F] transition-colors hover:bg-[#EDEDED]"
        >
          <span className="truncate">{c.label}</span>
          <X className="size-3.5 shrink-0" strokeWidth={2.6} />
        </button>
      ))}
      <button type="button" onClick={onClear} className="press h-9 rounded-full px-3 text-[13px] font-semibold text-[#A9A9A9] hover:text-white">
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
      <DrawerContent className="max-h-[88vh] border-0 bg-[#121212] text-white">
        <DrawerTitle className="flex items-center gap-2.5 px-5 pt-4 text-[22px] font-bold tracking-[-0.02em]"><SlidersHorizontal className="size-5 text-[#A9A9A9]" /> Filtros</DrawerTitle>
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
            <p className="mb-2.5 text-[13px] font-semibold text-[#A9A9A9]">Marca</p>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#8C8C8C]" />
              <input
                value={brandTerm}
                onChange={(e) => setBrandTerm(e.target.value)}
                placeholder="Pesquisar marca..."
                aria-label="Pesquisar marca"
                className="pk-field h-12 w-full rounded-full bg-[#232323] pl-10 text-base text-white outline-none transition-colors placeholder:text-[#6F6F6F] focus:bg-[#2A2A2A]"
              />
            </div>
            <div className="max-h-56 min-w-0 overflow-y-auto overscroll-contain rounded-[20px] bg-[#1A1A1A] p-1.5">
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
                <p className="px-4 py-3 text-sm text-[#8C8C8C]">Nenhuma marca com esse nome.</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex gap-2 border-t border-white/[0.06] px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
          <Button variant="ghost" className="press h-[52px] flex-1 rounded-full bg-[#1F1F1F] text-[15px] font-semibold hover:bg-[#2A2A2A]" onClick={onClear}>
            Limpar
          </Button>
          <Button className="press h-[52px] flex-[1.6] rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F] hover:bg-[#FFDDAA]" onClick={() => onOpenChange(false)}>
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
      <p className="mb-2.5 text-[13px] font-semibold text-[#A9A9A9]">{title}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press h-10 max-w-full rounded-full px-4 text-[13.5px] font-semibold transition-colors duration-200",
        active ? "bg-white text-[#15130F]" : "bg-[#232323] text-[#A9A9A9] hover:bg-[#2A2A2A] hover:text-white",
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
        "press flex h-11 w-full items-center justify-between gap-2 rounded-[12px] px-3 text-left text-[14.5px] transition-colors hover:bg-white/[0.05]",
        active ? "font-bold text-white" : "text-[#D4D4D4]",
      )}
    >
      <span className="truncate">{label}</span>
      {active ? <span className="size-2 shrink-0 rounded-full bg-[#FFD599]" /> : null}
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
      <div className="adm-pop pointer-events-auto mx-auto w-full max-w-xl min-w-0 space-y-2.5 rounded-[28px] bg-[#1A1A1A] p-3 shadow-[0_24px_70px_-12px_rgb(0_0_0/0.8)] ring-1 ring-white/[0.08]">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate pl-1 text-[15px] font-bold tabular-nums">
            {count} selecionado{count === 1 ? "" : "s"}
          </span>
          <button type="button" className="press h-8 shrink-0 rounded-full bg-[#232323] px-3 text-[12.5px] font-semibold text-[#D4D4D4] hover:bg-[#2C2C2C]" onClick={onClear}>
            Limpar
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" className="press h-11 min-w-0 flex-1 rounded-full bg-[#232323] text-[13.5px] font-semibold hover:bg-[#2C2C2C]" onClick={onBrand}>
            <span className="truncate">Alterar marca</span>
          </Button>
          <Button variant="ghost" className="press h-11 min-w-0 flex-1 rounded-full bg-[#232323] text-[13.5px] font-semibold hover:bg-[#2C2C2C]" onClick={onHide}>
            <span className="truncate">Ocultar</span>
          </Button>
          {onDelete ? (
            <Button variant="ghost" className="press h-11 min-w-0 flex-1 rounded-full bg-[#2A1A18] text-[13.5px] font-semibold text-[#FF9A8A] hover:bg-[#341F1C]" onClick={onDelete}>
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
