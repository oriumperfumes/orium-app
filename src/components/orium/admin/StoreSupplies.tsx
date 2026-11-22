/**
 * Gerenciamento → Itens da loja.
 * O que a loja física usa e não é perfume à venda (papel higiênico, fitas
 * olfativas, frascos de decant, sacolas...): quanto tem agora, quanto já se
 * gastou e o histórico de cada compra, uso e correção.
 * Visual: o mesmo kit da Precificação (PricingUI).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  Boxes,
  FlaskConical,
  Megaphone,
  Minus,
  Package,
  PenLine,
  Plus,
  Search,
  SprayCan,
  TrendingDown,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  SUPPLY_CATEGORIES,
  suppliesOverview,
  supplyArchive,
  supplyCreate,
  supplyMove,
  supplyMoves,
  supplyUpdate,
  type SupplyCategory,
  type SupplyItem,
  type SupplyMoveKind,
} from "@/lib/store-supplies.functions";
import {
  PxField,
  PxInput,
  PxKpi,
  PxKpiRow,
  PxNote,
  PxPrimary,
  PxSecondary,
  PxSection,
  PxSeg,
  PxSheet,
  PxStat,
  pxInputClass,
} from "@/components/orium/admin/PricingUI";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

const CATEGORY: Record<SupplyCategory, { label: string; icon: LucideIcon }> = {
  embalagem: { label: "Embalagem", icon: Package },
  decant: { label: "Decants", icon: FlaskConical },
  limpeza: { label: "Limpeza", icon: SprayCan },
  divulgacao: { label: "Divulgação", icon: Megaphone },
  escritorio: { label: "Escritório", icon: PenLine },
  outros: { label: "Outros", icon: Boxes },
};
const UNITS = ["un", "pacote", "caixa", "rolo", "ml"] as const;

/** Atalhos da lista vazia: já abrem o cadastro preenchido. */
const STARTERS: Array<{ name: string; category: SupplyCategory; unit: string }> = [
  { name: "Frasco de decant 10 ml", category: "decant", unit: "un" },
  { name: "Fita olfativa", category: "divulgacao", unit: "un" },
  { name: "Sacola", category: "embalagem", unit: "un" },
  { name: "Papel higiênico", category: "limpeza", unit: "rolo" },
];

const KEY = ["store-supplies"];

/** "1,5" → 1.5; vazio → null. */
function parseNum(v: string): number | null {
  const s = v
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
export const fmtQty = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const unitWord = (unit: string, n: number) =>
  unit === "un" ? (n === 1 ? "unidade" : "unidades") : n === 1 || unit === "ml" ? unit : `${unit}s`;

function levelOf(i: Pick<SupplyItem, "quantity" | "min_quantity">): "ok" | "low" | "out" {
  if (i.quantity <= 0) return "out";
  if (i.min_quantity > 0 && i.quantity <= i.min_quantity) return "low";
  return "ok";
}

export function StoreSupplies() {
  const load = useServerFn(suppliesOverview);
  const move = useServerFn(supplyMove);
  const qc = useQueryClient();
  const data = useQuery({ queryKey: KEY, queryFn: () => load() });
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<SupplyCategory | "todos" | "acabando">("todos");
  const [creating, setCreating] = useState<null | Partial<{
    name: string;
    category: SupplyCategory;
    unit: string;
  }>>(null);
  const [open, setOpen] = useState<{ id: string; mode: SupplyMoveKind } | null>(null);

  const items = useMemo(() => data.data?.items ?? [], [data.data]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of items) c.set(i.category, (c.get(i.category) ?? 0) + 1);
    return c;
  }, [items]);
  const shown = items.filter((i) => {
    if (cat === "acabando" && levelOf(i) === "ok") return false;
    if (cat !== "todos" && cat !== "acabando" && i.category !== cat) return false;
    return !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase());
  });
  const current = open ? (items.find((i) => i.id === open.id) ?? null) : null;

  const registerUse = async (item: SupplyItem) => {
    const before = item.quantity;
    try {
      await move({ data: { id: item.id, kind: "uso", quantity: 1 } });
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(`Saiu 1 ${unitWord(item.unit, 1)} de ${item.name}.`, {
        action: {
          label: "Desfazer",
          onClick: () =>
            void move({ data: { id: item.id, kind: "ajuste", quantity: before, note: "Desfeito" } })
              .then(() => qc.invalidateQueries({ queryKey: KEY }))
              .catch((e: unknown) =>
                toast.error(e instanceof Error ? e.message : "Não deu para desfazer."),
              ),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para registrar o uso.");
    }
  };

  const loading = data.isPending;
  const d = data.data;

  return (
    <div className="space-y-5 lg:space-y-6">
      <PxKpiRow>
        <PxKpi
          hero
          i={0}
          label="Gasto este mês"
          icon={<Wallet className="size-[18px]" strokeWidth={2.2} />}
          loading={loading}
          value={<Money v={d?.spent_month ?? 0} />}
          foot="Compras de itens da loja"
        />
        <PxKpi
          i={1}
          label="Gasto total"
          icon={<TrendingDown className="size-[18px]" strokeWidth={2.2} />}
          loading={loading}
          value={<Money v={d?.spent_total ?? 0} />}
          foot="Desde o primeiro cadastro"
        />
        <PxKpi
          i={2}
          label="Itens cadastrados"
          icon={<Boxes className="size-[18px]" strokeWidth={2.2} />}
          loading={loading}
          value={String(items.length)}
          foot={`${counts.size} ${counts.size === 1 ? "categoria" : "categorias"}`}
        />
        <PxKpi
          i={3}
          label="Acabando"
          icon={<Minus className="size-[18px]" strokeWidth={2.4} />}
          loading={loading}
          value={String(d?.low ?? 0)}
          foot={d?.low ? "Toque para ver quais" : "Nada para repor"}
          onClick={d?.low ? () => setCat("acabando") : undefined}
          ariaLabel="Ver itens acabando"
        />
      </PxKpiRow>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-[#8C8C8C]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Procurar item da loja"
            aria-label="Procurar item da loja"
            className={cn(pxInputClass, "pr-11 pl-11")}
          />
          {q ? (
            <button
              type="button"
              aria-label="Limpar busca"
              onClick={() => setQ("")}
              className="press absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-[#A9A9A9]"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <PxPrimary
          icon={<Plus className="size-[18px]" strokeWidth={2.6} />}
          onClick={() => setCreating({})}
          className="md:min-w-[200px]"
        >
          Novo item
        </PxPrimary>
      </div>

      {items.length > 0 ? (
        <div
          className="adm-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          role="group"
          aria-label="Filtrar por categoria"
        >
          <FilterChip
            on={cat === "todos"}
            onClick={() => setCat("todos")}
            label="Todos"
            count={items.length}
          />
          {d?.low ? (
            <FilterChip
              on={cat === "acabando"}
              onClick={() => setCat("acabando")}
              label="Acabando"
              count={d.low}
              warn
            />
          ) : null}
          {SUPPLY_CATEGORIES.filter((c) => counts.get(c)).map((c) => (
            <FilterChip
              key={c}
              on={cat === c}
              onClick={() => setCat(c)}
              label={CATEGORY[c].label}
              count={counts.get(c) ?? 0}
            />
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="admin-skeleton h-[236px] rounded-[28px]" />
          ))}
        </div>
      ) : data.isError ? (
        <PxNote tone="danger">
          Não deu para carregar os itens da loja agora. Atualize a página.
        </PxNote>
      ) : items.length === 0 ? (
        <EmptyState onStart={(s) => setCreating(s)} />
      ) : shown.length === 0 ? (
        <PxNote>Nenhum item com esse filtro.</PxNote>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
          {shown.map((item, i) => (
            <SupplyCard
              key={item.id}
              item={item}
              i={i}
              onOpen={() => setOpen({ id: item.id, mode: "compra" })}
              onUse={() => void registerUse(item)}
              onBuy={() => setOpen({ id: item.id, mode: "compra" })}
            />
          ))}
        </div>
      )}

      <NewSupplySheet seed={creating} onClose={() => setCreating(null)} />
      <SupplySheet item={current} mode={open?.mode ?? "compra"} onClose={() => setOpen(null)} />
    </div>
  );
}

function FilterChip({
  on,
  onClick,
  label,
  count,
  warn,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  count: number;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "press inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-bold transition-colors",
        on ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
      )}
    >
      {warn ? <span aria-hidden className="size-1.5 rounded-full bg-[#F5C26B]" /> : null}
      {label}
      <span className={cn("tabular-nums", on ? "text-[#15130F]/55" : "text-[#6F6F6F]")}>
        {count}
      </span>
    </button>
  );
}

function SupplyCard({
  item,
  i,
  onOpen,
  onUse,
  onBuy,
}: {
  item: SupplyItem;
  i: number;
  onOpen: () => void;
  onUse: () => void;
  onBuy: () => void;
}) {
  const c = CATEGORY[item.category];
  const level = levelOf(item);
  // régua: o aviso fica no primeiro terço; sem aviso, a régua some
  const fill =
    item.min_quantity > 0 ? Math.min(100, (item.quantity / (item.min_quantity * 3)) * 100) : null;
  return (
    <article
      className={cn(
        "dash-card adm-rise flex min-w-0 flex-col p-5 lg:p-6",
        level === "out" && "ring-1 ring-[#FF9A8A]/30 ring-inset",
        level === "low" && "ring-1 ring-[#F5C26B]/30 ring-inset",
      )}
      style={{ ["--i" as string]: Math.min(i, 8) + 4 }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="press -m-1 flex min-w-0 items-start gap-3 rounded-[20px] p-1 text-left"
      >
        <span className="dash-ico">
          <c.icon className="size-[18px]" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] leading-tight font-bold tracking-[-0.01em] text-white">
            {item.name}
          </span>
          <span className="mt-1 block truncate text-[13px] text-[#8C8C8C]">{c.label}</span>
        </span>
        {level !== "ok" ? (
          <span
            className={cn(
              "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-bold",
              level === "out" ? "bg-[#2A1A18] text-[#FF9A8A]" : "bg-[#2A2418] text-[#F5C26B]",
            )}
          >
            {level === "out" ? "Acabou" : "Acabando"}
          </span>
        ) : null}
      </button>

      <p className="mt-5 flex items-baseline gap-2">
        <span className="text-[40px] leading-none font-bold tracking-[-0.045em] text-white tabular-nums">
          {fmtQty(item.quantity)}
        </span>
        <span className="text-[15px] text-[#A9A9A9]">{unitWord(item.unit, item.quantity)}</span>
      </p>
      {fill != null ? (
        <div className="mt-3">
          <span className="block h-[5px] overflow-hidden rounded-full bg-white/[0.08]">
            <span
              className={cn(
                "block h-full rounded-full transition-[width] duration-500",
                level === "out"
                  ? "bg-[#FF9A8A]"
                  : level === "low"
                    ? "bg-[#F5C26B]"
                    : "bg-[#FFD599]",
              )}
              style={{ width: `${Math.max(level === "out" ? 0 : 6, fill)}%` }}
            />
          </span>
          <p className="mt-1.5 text-[12.5px] text-[#8C8C8C]">
            Aviso com {fmtQty(item.min_quantity)} ou menos
          </p>
        </div>
      ) : null}

      <p className="mt-4 truncate text-[13.5px] text-[#A9A9A9]">
        {item.spent > 0 ? (
          <>
            Gasto <span className="font-semibold text-white tabular-nums">{brl(item.spent)}</span>
            {item.avg_cost != null ? (
              <span className="tabular-nums">
                {" "}
                · {brl(item.avg_cost)} por {item.unit === "un" ? "unidade" : item.unit}
              </span>
            ) : null}
          </>
        ) : (
          "Sem compra com valor registrada"
        )}
      </p>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
        <button
          type="button"
          onClick={onUse}
          disabled={item.quantity <= 0}
          className="press inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-[#262626] text-[14px] font-bold text-white transition-colors hover:bg-[#2E2E2E] disabled:opacity-35"
        >
          <Minus className="size-4" strokeWidth={2.6} /> Usei 1
        </button>
        <button
          type="button"
          onClick={onBuy}
          className="press inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-white text-[14px] font-bold text-[#15130F] transition-colors hover:bg-[#EDEDED]"
        >
          <Plus className="size-4" strokeWidth={2.6} /> Comprei
        </button>
      </div>
    </article>
  );
}

function EmptyState({
  onStart,
}: {
  onStart: (s: { name: string; category: SupplyCategory; unit: string }) => void;
}) {
  return (
    <section
      className="dash-card adm-rise p-6 text-center lg:p-10"
      style={{ ["--i" as string]: 4 }}
    >
      <span className="dash-ico mx-auto">
        <Boxes className="size-[18px]" strokeWidth={2.2} />
      </span>
      <h2 className="mt-4 text-[20px] font-bold tracking-[-0.02em]">
        Comece pelo que a loja mais usa
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-[14.5px] leading-snug text-[#A9A9A9]">
        Cadastre o item, quanto tem agora e quanto pagou. Depois é só tocar em Usei ou Comprei.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {STARTERS.map((s) => (
          <PxSecondary
            key={s.name}
            icon={<Plus className="size-4" strokeWidth={2.6} />}
            onClick={() => onStart(s)}
          >
            {s.name}
          </PxSecondary>
        ))}
      </div>
    </section>
  );
}

function CategoryPicker({
  value,
  onChange,
}: {
  value: SupplyCategory;
  onChange: (c: SupplyCategory) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Categoria">
      {SUPPLY_CATEGORIES.map((c) => {
        const Icon = CATEGORY[c].icon;
        const on = value === c;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c)}
            className={cn(
              "press flex h-[64px] flex-col items-center justify-center gap-1 rounded-[18px] text-[12.5px] font-bold transition-colors",
              on ? "bg-white text-[#15130F]" : "bg-[#232323] text-[#A9A9A9] hover:text-white",
            )}
          >
            <Icon className="size-[18px]" strokeWidth={2.2} />
            {CATEGORY[c].label}
          </button>
        );
      })}
    </div>
  );
}

function UnitPicker({ value, onChange }: { value: string; onChange: (u: string) => void }) {
  const current = (UNITS as readonly string[]).includes(value) ? value : "un";
  return (
    <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Conta em">
      {UNITS.map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={current === u}
          onClick={() => onChange(u)}
          className={cn(
            "press h-11 min-w-0 truncate rounded-full px-1 text-[13.5px] font-bold transition-colors",
            current === u
              ? "bg-white text-[#15130F]"
              : "bg-[#232323] text-[#A9A9A9] hover:text-white",
          )}
        >
          {u === "un" ? "Unid." : u === "ml" ? "ml" : u[0]!.toUpperCase() + u.slice(1)}
        </button>
      ))}
    </div>
  );
}

/** Valor em reais que cabe no cartão do celular sem cortar. */
export function Money({ v }: { v: number }) {
  return <span className="max-sm:text-[23px] max-sm:tracking-[-0.04em]">{brl(v)}</span>;
}

function NewSupplySheet({
  seed,
  onClose,
}: {
  seed: null | Partial<{ name: string; category: SupplyCategory; unit: string }>;
  onClose: () => void;
}) {
  const create = useServerFn(supplyCreate);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<SupplyCategory>("outros");
  const [unit, setUnit] = useState("un");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [min, setMin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!seed) return;
    setName(seed.name ?? "");
    setCategory(seed.category ?? "outros");
    setUnit(seed.unit ?? "un");
    setQty("");
    setCost("");
    setMin("");
  }, [seed]);

  const q = parseNum(qty) ?? 0;
  const c = parseNum(cost);
  const each = q > 0 && c != null && c > 0 ? c / q : null;

  const save = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome ao item.");
      return;
    }
    setBusy(true);
    try {
      await create({
        data: {
          name: name.trim(),
          category,
          unit,
          quantity: q,
          total_cost: q > 0 ? c : null,
          min_quantity: parseNum(min) ?? 0,
        },
      });
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(`${name.trim()} cadastrado.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para cadastrar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PxSheet
      open={!!seed}
      onClose={onClose}
      title="Novo item da loja"
      description="Algo que a loja usa e não vende: embalagem, limpeza, frascos, divulgação."
      footer={
        <PxPrimary className="w-full" loading={busy} onClick={() => void save()}>
          Cadastrar item
        </PxPrimary>
      }
    >
      <div className="space-y-4">
        <PxSection>
          <PxField label="Nome" htmlFor="sup-name">
            <PxInput
              id="sup-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Fita olfativa"
            />
          </PxField>
          <PxField label="Categoria">
            <CategoryPicker value={category} onChange={setCategory} />
          </PxField>
          <PxField label="Conta em">
            <UnitPicker value={unit} onChange={setUnit} />
          </PxField>
        </PxSection>
        <PxSection title="Quanto tem e quanto custou">
          <div className="grid grid-cols-2 gap-3">
            <PxField label="Tem agora" htmlFor="sup-qty">
              <PxInput
                id="sup-qty"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
              />
            </PxField>
            <PxField label="Pagou no total" htmlFor="sup-cost">
              <MoneyInput id="sup-cost" value={cost} onChange={setCost} />
            </PxField>
          </div>
          {each != null ? (
            <PxNote tone="good">
              Sai {brl(each)} por {unit === "un" ? "unidade" : unit}.
            </PxNote>
          ) : null}
          <PxField
            label="Avisar quando ficar com"
            htmlFor="sup-min"
            hint="Opcional. O item aparece em Acabando quando chegar nesse número."
          >
            <PxInput
              id="sup-min"
              inputMode="decimal"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              placeholder="Ex.: 5"
            />
          </PxField>
        </PxSection>
      </div>
    </PxSheet>
  );
}

function MoneyInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[15px] font-semibold text-[#8C8C8C]">
        R$
      </span>
      <PxInput
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0,00"
        className="pl-11"
      />
    </div>
  );
}

const MODE_COPY: Record<SupplyMoveKind, { label: string; field: string; action: string }> = {
  compra: { label: "Comprei", field: "Quanto chegou", action: "Registrar compra" },
  uso: { label: "Usei", field: "Quanto saiu", action: "Registrar uso" },
  ajuste: { label: "Corrigir", field: "Quanto tem de verdade agora", action: "Salvar contagem" },
};

function SupplySheet({
  item,
  mode: initial,
  onClose,
}: {
  item: SupplyItem | null;
  mode: SupplyMoveKind;
  onClose: () => void;
}) {
  const move = useServerFn(supplyMove);
  const update = useServerFn(supplyUpdate);
  const archive = useServerFn(supplyArchive);
  const loadMoves = useServerFn(supplyMoves);
  const qc = useQueryClient();
  const [mode, setMode] = useState<SupplyMoveKind>(initial);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({
    name: "",
    category: "outros" as SupplyCategory,
    unit: "un",
    min: "",
  });
  const id = item?.id;

  useEffect(() => {
    if (!item) return;
    setMode(initial);
    setQty("");
    setCost("");
    setNote("");
    setEditing(false);
    setEdit({
      name: item.name,
      category: item.category,
      unit: item.unit,
      min: item.min_quantity ? fmtQty(item.min_quantity) : "",
    });
    // só ao abrir outro item
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, initial]);

  const moves = useQuery({
    queryKey: [...KEY, "moves", id],
    queryFn: () => loadMoves({ data: { id: id! } }),
    enabled: !!id,
  });

  const q = parseNum(qty);
  const c = parseNum(cost);
  const after =
    item && q != null
      ? mode === "compra"
        ? item.quantity + q
        : mode === "uso"
          ? item.quantity - q
          : q
      : null;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: KEY })]);

  const save = async () => {
    if (!item) return;
    if (q == null || (mode !== "ajuste" && q <= 0)) {
      toast.error("Informe a quantidade.");
      return;
    }
    setBusy(true);
    try {
      await move({
        data: {
          id: item.id,
          kind: mode,
          quantity: q,
          total_cost: mode === "compra" ? c : null,
          note: note.trim() || undefined,
        },
      });
      await refresh();
      toast.success(
        mode === "compra"
          ? "Compra registrada."
          : mode === "uso"
            ? "Uso registrado."
            : "Contagem salva.",
      );
      setQty("");
      setCost("");
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para salvar.");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await update({
        data: {
          id: item.id,
          name: edit.name.trim(),
          category: edit.category,
          unit: edit.unit,
          min_quantity: parseNum(edit.min) ?? 0,
        },
      });
      await refresh();
      toast.success("Item atualizado.");
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para salvar.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !item ||
      !window.confirm(`Tirar ${item.name} da lista? O histórico de gastos continua somando.`)
    )
      return;
    setBusy(true);
    try {
      await archive({ data: { id: item.id } });
      await refresh();
      toast.success(`${item.name} saiu da lista.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para tirar da lista.");
    } finally {
      setBusy(false);
    }
  };

  const copy = MODE_COPY[mode];
  const unitLabel = item ? (item.unit === "un" ? "unidade" : item.unit) : "";

  return (
    <PxSheet
      open={!!item}
      onClose={onClose}
      title={item?.name ?? ""}
      description={item ? `${CATEGORY[item.category].label} · conta em ${unitLabel}` : undefined}
      footer={
        editing ? (
          <PxPrimary className="w-full" loading={busy} onClick={() => void saveEdit()}>
            Salvar item
          </PxPrimary>
        ) : (
          <PxPrimary className="w-full" loading={busy} onClick={() => void save()}>
            {copy.action}
          </PxPrimary>
        )
      }
    >
      {item ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <PxStat
              label="Na loja"
              value={`${fmtQty(item.quantity)}`}
              note={unitWord(item.unit, item.quantity)}
              tone={
                levelOf(item) === "ok" ? undefined : levelOf(item) === "low" ? "warning" : "danger"
              }
            />
            <PxStat label="Gasto total" value={brl(item.spent)} tone="gold" />
            <PxStat
              label="Custo médio"
              value={item.avg_cost != null ? brl(item.avg_cost) : "—"}
              note={item.avg_cost != null ? `por ${unitLabel}` : undefined}
            />
          </div>

          {editing ? (
            <PxSection title="Editar item">
              <PxField label="Nome" htmlFor="sup-edit-name">
                <PxInput
                  id="sup-edit-name"
                  value={edit.name}
                  maxLength={80}
                  onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))}
                />
              </PxField>
              <PxField label="Categoria">
                <CategoryPicker
                  value={edit.category}
                  onChange={(c) => setEdit((s) => ({ ...s, category: c }))}
                />
              </PxField>
              <PxField label="Conta em">
                <UnitPicker
                  value={edit.unit}
                  onChange={(u) => setEdit((s) => ({ ...s, unit: u }))}
                />
              </PxField>
              <PxField label="Avisar quando ficar com" htmlFor="sup-edit-min">
                <PxInput
                  id="sup-edit-min"
                  inputMode="decimal"
                  value={edit.min}
                  onChange={(e) => setEdit((s) => ({ ...s, min: e.target.value }))}
                  placeholder="Sem aviso"
                />
              </PxField>
              <div className="flex flex-wrap gap-2 pt-1">
                <PxSecondary onClick={() => setEditing(false)}>Voltar</PxSecondary>
                <PxSecondary
                  icon={<Archive className="size-4" />}
                  onClick={() => void remove()}
                  className="text-[#FF9A8A]"
                >
                  Tirar da lista
                </PxSecondary>
              </div>
            </PxSection>
          ) : (
            <PxSection>
              <PxSeg
                label="O que aconteceu"
                value={mode}
                onChange={setMode}
                options={(["compra", "uso", "ajuste"] as const).map((m) => ({
                  value: m,
                  label: MODE_COPY[m].label,
                }))}
              />
              <div className={cn("grid gap-3", mode === "compra" && "grid-cols-2")}>
                <PxField label={copy.field} htmlFor="sup-move-qty">
                  <PxInput
                    id="sup-move-qty"
                    inputMode="decimal"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="0"
                    autoFocus
                  />
                </PxField>
                {mode === "compra" ? (
                  <PxField label="Pagou no total" htmlFor="sup-move-cost">
                    <MoneyInput id="sup-move-cost" value={cost} onChange={setCost} />
                  </PxField>
                ) : null}
              </div>
              {after != null && q != null && (mode === "ajuste" || q > 0) ? (
                <PxNote tone={after < 0 ? "danger" : "muted"}>
                  {after < 0
                    ? `A loja só tem ${fmtQty(item.quantity)}. Não dá para usar mais do que isso.`
                    : `Fica com ${fmtQty(after)} ${unitWord(item.unit, after)}${mode === "compra" && c != null && c > 0 && q > 0 ? `, ${brl(c / q)} por ${unitLabel}` : ""}.`}
                </PxNote>
              ) : null}
              <PxField label="Observação" htmlFor="sup-move-note">
                <PxInput
                  id="sup-move-note"
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Opcional. Ex.: comprei no atacado"
                />
              </PxField>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="press text-[13.5px] font-semibold text-[#A9A9A9] underline-offset-4 hover:text-white hover:underline"
              >
                Editar nome, categoria ou aviso
              </button>
            </PxSection>
          )}

          <PxSection title="Histórico">
            {moves.isPending ? (
              <div className="admin-skeleton h-14 rounded-[18px]" />
            ) : (moves.data?.length ?? 0) === 0 ? (
              <p className="text-[13.5px] text-[#8C8C8C]">Nenhum movimento ainda.</p>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {moves.data!.map((m) => (
                  <li key={m.id} className="flex min-w-0 items-center gap-3 py-3">
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-nums",
                        m.delta > 0
                          ? "bg-[#17251C] text-[#7FCF9F]"
                          : m.delta < 0
                            ? "bg-[#2A1A18] text-[#FF9A8A]"
                            : "bg-[#232323] text-[#A9A9A9]",
                      )}
                    >
                      {m.delta > 0 ? (
                        <Plus className="size-4" strokeWidth={2.6} />
                      ) : m.delta < 0 ? (
                        <Minus className="size-4" strokeWidth={2.6} />
                      ) : (
                        "="
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-white">
                        {MODE_COPY[m.kind].label} {fmtQty(Math.abs(m.delta))}
                        <span className="font-normal text-[#8C8C8C]">
                          {" "}
                          · {fmtQty(m.before_qty)} → {fmtQty(m.after_qty)}
                        </span>
                      </span>
                      <span className="block truncate text-[12.5px] text-[#8C8C8C]">
                        {new Date(m.created_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "America/Sao_Paulo",
                        })}
                        {m.note ? ` · ${m.note}` : ""}
                      </span>
                    </span>
                    {m.total_cost != null ? (
                      <span className="shrink-0 text-[14px] font-bold text-[#FFD599] tabular-nums">
                        {brl(m.total_cost)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </PxSection>
        </div>
      ) : null}
    </PxSheet>
  );
}
