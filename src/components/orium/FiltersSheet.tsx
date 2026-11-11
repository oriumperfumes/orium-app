import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export type { Option, Availability, SortKey } from "@/components/orium/filters-options";
export { SORT_OPTIONS } from "@/components/orium/filters-options";
import type { Option, Availability, SortKey } from "@/components/orium/filters-options";
import { SORT_OPTIONS } from "@/components/orium/filters-options";

/** Faixas rápidas de preço. */
const PRICE_PRESETS: Array<[number, string]> = [
  [100, "Até R$ 100"],
  [200, "Até R$ 200"],
  [300, "Até R$ 300"],
  [500, "Até R$ 500"],
];


/** Painel inferior de filtros — tira a poluição do topo do catálogo. */
export function FiltersSheet({
  open,
  onOpenChange,
  total,
  typeOptions,
  type,
  setType,
  genderOptions,
  gender,
  setGender,
  genderVisible,
  brandOptions,
  brand,
  setBrand,
  availability,
  setAvailability,
  sort,
  setSort,
  priceMin,
  priceMax,
  setPriceRange,

  accordOptions = [],
  accords = [],
  toggleAccord,
  onClear,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  total: number;
  typeOptions: Option[];
  type: string;
  setType: (v: string) => void;
  genderOptions: Option[];
  gender: string;
  setGender: (v: string) => void;
  genderVisible: boolean;
  brandOptions: Option[];
  brand: string;
  setBrand: (v: string) => void;
  availability: Availability;
  setAvailability: (v: Availability) => void;
  sort: SortKey;
  setSort: (v: SortKey) => void;
  priceMin: number | null;
  priceMax: number | null;
  setPriceRange: (min: number | null, max: number | null) => void;

  accordOptions?: Option[];
  accords?: string[];
  toggleAccord?: (a: string) => void;
  onClear: () => void;
}) {
  const [brandTerm, setBrandTerm] = useState("");
  const [minText, setMinText] = useState(priceMin != null ? String(priceMin) : "");
  const [maxText, setMaxText] = useState(priceMax != null ? String(priceMax) : "");

  // acompanha mudanças vindas de fora (atalhos de faixa, limpar filtros)
  useEffect(() => setMinText(priceMin != null ? String(priceMin) : ""), [priceMin]);
  useEffect(() => setMaxText(priceMax != null ? String(priceMax) : ""), [priceMax]);

  const commitRange = () => {
    const parse = (s: string) => {
      const n = Number(s.replace(/[^\d,.]/g, "").replace(",", "."));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const min = parse(minText);
    const max = parse(maxText);
    setPriceRange(min, max != null && min != null && max < min ? min : max);
  };

  const brands = brandOptions.filter((b) => b.key.toLowerCase().includes(brandTerm.trim().toLowerCase()));

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="filters-sheet max-h-[88vh] text-white">
        <div className="flex items-center justify-between px-5 pt-5">
          <DrawerTitle className="text-[24px] font-bold tracking-[-0.02em] text-white">Filtros</DrawerTitle>
          <button type="button" onClick={onClear} className="press text-[14px] font-semibold text-[#FFD599]">
            Limpar tudo
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-5 pt-6 pb-4">
          <Group title="Ordenar por">
            {SORT_OPTIONS.map(([key, label]) => (
              <Pill key={key} active={sort === key} onClick={() => setSort(key)}>
                {label}
              </Pill>
            ))}
          </Group>

          <div>
            <h3 className="mb-3 text-[16px] font-bold tracking-[-0.01em]">Faixa de preço</h3>
            <div className="flex flex-wrap gap-2">
              <Pill active={priceMin == null && priceMax == null} onClick={() => setPriceRange(null, null)}>
                Qualquer
              </Pill>
              {PRICE_PRESETS.map(([max, label]) => (
                <Pill key={max} active={priceMin == null && priceMax === max} onClick={() => setPriceRange(null, max)}>
                  {label}
                </Pill>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[13px] text-[#8C8C8C]">R$</span>
                <input
                  value={minText}
                  onChange={(e) => setMinText(e.target.value)}
                  onBlur={commitRange}
                  inputMode="decimal"
                  aria-label="Preço mínimo"
                  placeholder="Mínimo"
                  className="fs-field pl-10"
                />
              </div>
              <span className="text-[13px] text-[#8C8C8C]">até</span>
              <div className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[13px] text-[#8C8C8C]">R$</span>
                <input
                  value={maxText}
                  onChange={(e) => setMaxText(e.target.value)}
                  onBlur={commitRange}
                  inputMode="decimal"
                  aria-label="Preço máximo"
                  placeholder="Máximo"
                  className="fs-field pl-10"
                />
              </div>
              <button
                type="button"
                className="press h-11 shrink-0 rounded-full bg-white px-4 text-[14px] font-bold text-[#15130F]"
                onClick={commitRange}
              >
                Aplicar
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-[#8C8C8C]">
              Considera o preço do frasco completo, já com promoção.
            </p>
          </div>

          {typeOptions.length > 0 ? (
            <Group title="Categoria">
              <Pill active={type === "todos"} onClick={() => setType("todos")}>
                Todas
              </Pill>
              {typeOptions.map((t) => (
                <Pill key={t.key} active={type === t.key} onClick={() => setType(t.key)} count={t.count}>
                  {t.label}
                </Pill>
              ))}
            </Group>
          ) : null}

          {accordOptions.length > 0 && toggleAccord ? (
            <Group title="Perfil olfativo">
              {accordOptions.map((a) => (
                <Pill key={a.key} active={accords.includes(a.key)} onClick={() => toggleAccord(a.key)} count={a.count}>
                  {a.label}
                </Pill>
              ))}
            </Group>
          ) : null}

          {genderVisible && genderOptions.length > 0 ? (
            <Group title="Gênero">
              <Pill active={gender === "todos"} onClick={() => setGender("todos")}>
                Todos
              </Pill>
              {genderOptions.map((g) => (
                <Pill key={g.key} active={gender === g.key} onClick={() => setGender(g.key)} count={g.count}>
                  {g.label}
                </Pill>
              ))}
            </Group>
          ) : null}

          <Group title="Disponibilidade">
            {(
              [
                ["todos", "Todos"],
                ["em-estoque", "Em estoque"],
                ["sem-estoque", "Sem estoque"],
              ] as Array<[Availability, string]>
            ).map(([key, label]) => (
              <Pill key={key} active={availability === key} onClick={() => setAvailability(key)}>
                {label}
              </Pill>
            ))}
          </Group>

          {brandOptions.length > 0 ? (
            <div>
              <h3 className="mb-3 text-[16px] font-bold tracking-[-0.01em]">Marca</h3>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#8C8C8C]" strokeWidth={2.2} />
                <input
                  value={brandTerm}
                  onChange={(e) => setBrandTerm(e.target.value)}
                  placeholder="Buscar marca"
                  aria-label="Buscar marca"
                  className="fs-field pl-11"
                />
              </div>
              <div className="max-h-64 overflow-y-auto overscroll-contain rounded-[18px] bg-[#1A1A1A]">
                <SheetRow active={brand === "todas"} onClick={() => setBrand("todas")} label="Todas as marcas" />
                {brands.map((b) => (
                  <SheetRow key={b.key} active={brand === b.key} onClick={() => setBrand(b.key)} label={b.key} count={b.count} />
                ))}
                {brands.length === 0 ? (
                  <p className="px-4 py-4 text-[14px] text-[#8C8C8C]">Nenhuma marca com esse nome.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex gap-2.5 border-t border-white/[0.06] px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            className="press h-[54px] flex-1 rounded-full bg-[#1F1F1F] text-[15px] font-bold text-white"
            onClick={onClear}
          >
            Limpar
          </button>
          <button
            type="button"
            className="press h-[54px] flex-[1.7] rounded-full bg-[#FFD599] text-[16px] font-bold text-[#15130F]"
            onClick={() => onOpenChange(false)}
          >
            <span key={total} className="value-in inline-block tabular-nums">
              Ver {total} produto{total === 1 ? "" : "s"}
            </span>
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-[16px] font-bold tracking-[-0.01em]">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** Mesmo chip do catálogo: escolhido = branco, demais = cinza escuro. */
function Pill({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "fs-pill press inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold whitespace-nowrap",
        active ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-white hover:bg-[#2A2A2A]",
      )}
    >
      {children}
      {count != null ? (
        <span className={cn("text-[12px] font-medium tabular-nums", active ? "text-[#6B655D]" : "text-[#8C8C8C]")}>{count}</span>
      ) : null}
    </button>
  );
}

function SheetRow({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[52px] w-full items-center gap-3 border-b border-white/[0.05] px-4 text-left text-[15px] transition-colors last:border-b-0 hover:bg-white/[0.03]",
        active ? "font-bold text-white" : "text-[#CFCFCF]",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null ? <span className="text-[12.5px] text-[#8C8C8C] tabular-nums">{count}</span> : null}
      <span
        className={cn(
          "grid size-[22px] shrink-0 place-items-center rounded-full transition-colors duration-200",
          active ? "bg-[#FFD599] text-[#15130F]" : "border border-white/20",
        )}
      >
        {active ? <Check className="check-pop size-3.5" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}
