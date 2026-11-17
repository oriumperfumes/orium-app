/**
 * MONTAGEM DA VENDA DA LOJA — lançamento manual e edição (a voz é do Copilot).
 *
 * A IA sugere, o Admin revisa e confirma. Nada é registrado antes de
 * "Confirmar venda", e o registro final é idempotente (dois toques = uma venda).
 *
 * Visual: corpo da janela lateral (SidePanel + PanelHeader ficam com quem abre),
 * cartões #1A1A1A, controles #232323, branco = escolhido, dourado na ação final.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Check, Minus, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { GoldButton, SoftButton } from "@/components/orium/admin/PanelKit";
import { AnimatedNumber, Collapse } from "@/components/orium/admin/motion";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { decantPrice, DECANT_SIZES, type DecantMl } from "@/lib/decants";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { storeSaleProductSearch, storeSaleCommit, storeSaleUpdate } from "@/lib/store-sales.functions";
import { CustomerField, PaymentPicker, SaleThumb, SectionLabel, parseMoney, saleUid, toLocalInput } from "./parts";

type Candidate = {
  product_id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  retail_price: number | null;
  decant_available: boolean;
  decant_price_2ml: number | null;
  decant_price_5ml: number | null;
  decant_price_10ml: number | null;
  in_stock: boolean;
  sale_mode: string | null;
  product_type: string | null;
  score: number;
};

type Item = {
  key: string;
  spoken_name: string;
  product_id: string | null;
  name: string;
  brand: string | null;
  image_url: string | null;
  variant: "FULL" | "DECANT" | "UNKNOWN";
  decant_ml: DecantMl | null;
  quantity: number;
  unit_price: number | null;
  price_source: "spoken" | "current" | "none";
  confidence: "high" | "medium" | "low";
  candidates: Candidate[];
  needs_variant: boolean;
  needs_size: boolean;
  /** o Admin trocou o perfume sugerido (usado só para aprender melhor) */
  corrected?: boolean;
};

/** comparação simples de nomes, só para saber se vale mostrar "você disse…" */
const searchish = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const canDecant = (c: Candidate | null) =>
  !!c && c.product_type === "PERFUME" && c.decant_available && String(c.sale_mode ?? "BOTH").toUpperCase() !== "FULL_ONLY";
const canFull = (c: Candidate | null) =>
  !!c && String(c.sale_mode ?? "BOTH").toUpperCase() !== "DECANT_ONLY" && c.retail_price != null;

/** pílula pequena de escolha (frasco / tamanhos) */
function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "press h-9 rounded-full px-3.5 text-[13.5px] font-semibold transition-colors duration-200",
        on ? "bg-white text-[#15130F]" : "bg-[#2A2A2A] text-[#D4D4D4] hover:bg-[#333]",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ itens */

function ItemCard({
  item,
  index,
  settings,
  onChange,
  onRemove,
}: {
  item: Item;
  index: number;
  settings: ReturnType<typeof useDecantSettings>;
  onChange: (patch: Partial<Item>) => void;
  onRemove: () => void;
}) {
  const chosen = item.candidates.find((c) => c.product_id === item.product_id) ?? null;
  const suggestion = item.candidates[0] ?? null;
  const [picking, setPicking] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [switching, setSwitching] = useState(false);

  const priceFor = (variant: "FULL" | "DECANT", ml: DecantMl | null, candidate: Candidate | null) => {
    if (!candidate) return null;
    if (variant === "DECANT") return ml ? decantPrice(candidate, settings, ml) : null;
    return candidate.retail_price ?? null;
  };

  const pick = (candidate: Candidate, corrected: boolean) => {
    const variant: Item["variant"] =
      item.variant !== "UNKNOWN" ? item.variant : canFull(candidate) && !canDecant(candidate) ? "FULL" : "UNKNOWN";
    const ml = variant === "DECANT" ? item.decant_ml : null;
    const price =
      item.price_source === "spoken" ? item.unit_price : priceFor(variant === "UNKNOWN" ? "FULL" : variant, ml, candidate);
    onChange({
      product_id: candidate.product_id,
      name: candidate.name,
      brand: candidate.brand,
      image_url: candidate.image_url,
      variant,
      decant_ml: ml,
      confidence: "high",
      corrected: item.corrected || corrected,
      unit_price: variant === "DECANT" && !ml ? null : price,
      price_source: item.price_source === "spoken" ? "spoken" : price != null ? "current" : "none",
      needs_variant: variant === "UNKNOWN",
      needs_size: variant === "DECANT" && !ml,
    });
    setPicking(false);
  };

  const setVariant = (variant: "FULL" | "DECANT", ml: DecantMl | null) => {
    const price = item.price_source === "spoken" ? item.unit_price : priceFor(variant, ml, chosen);
    onChange({
      variant,
      decant_ml: ml,
      unit_price: variant === "DECANT" && !ml ? null : price,
      price_source: item.price_source === "spoken" ? "spoken" : price != null ? "current" : "none",
      needs_variant: false,
      needs_size: variant === "DECANT" && !ml,
    });
    setSwitching(false);
  };

  const resolved = !!item.product_id;
  const complete = resolved && item.variant !== "UNKNOWN" && !(item.variant === "DECANT" && !item.decant_ml) && item.unit_price != null;
  const subtotal = (item.unit_price ?? 0) * item.quantity;
  const heardDifferent =
    resolved && item.spoken_name && searchish(item.spoken_name) !== searchish(item.name) ? item.spoken_name : null;

  const showFull = item.variant === "FULL" || item.variant === "UNKNOWN" || switching;
  const showSizes = item.variant === "DECANT" || item.variant === "UNKNOWN" || switching;
  const needs = !resolved || item.needs_variant || item.needs_size;

  return (
    <article
      className={cn("sale-item pk-in min-w-0 rounded-[24px] bg-[#1A1A1A] p-3.5 transition-shadow duration-300", needs && "shadow-[inset_0_0_0_1.5px_rgba(255,213,153,0.45)]")}
      style={{ ["--i" as string]: index }}
    >
      <div className="flex min-w-0 gap-3">
        <SaleThumb url={resolved || item.confidence === "medium" ? item.image_url : null} name={item.name} size={64} />
        <div className="min-w-0 flex-1 pt-0.5">
          {resolved ? <p className="truncate text-[12.5px] font-medium text-[#8C8C8C]">{item.brand ?? "—"}</p> : null}
          <p className="line-clamp-2 text-[15.5px] leading-snug font-bold tracking-[-0.01em]">
            {resolved ? item.name : item.confidence === "medium" && suggestion ? suggestion.name : `“${item.spoken_name}”`}
          </p>
          {heardDifferent ? (
            <p className="mt-0.5 truncate text-[12px] text-[#8C8C8C]">
              Você disse “{heardDifferent}” · entendi <span className="text-[#FFD599]">{item.name}</span>
            </p>
          ) : null}

          {!resolved && item.confidence === "medium" && suggestion ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] text-[#A9A9A9]">É este?</span>
              <button type="button" className="press h-8 rounded-full bg-white px-3 text-[13px] font-bold text-[#15130F]" onClick={() => pick(suggestion, false)}>
                Sim, é esse
              </button>
              <button type="button" className="press h-8 rounded-full bg-[#2A2A2A] px-3 text-[13px] font-semibold" onClick={() => setPicking(true)}>
                Trocar
              </button>
            </div>
          ) : null}
          {!resolved && item.confidence === "low" ? (
            <button
              type="button"
              className="press mt-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-[#FFD599]/12 px-3 text-[12.5px] font-semibold text-[#FFD599]"
              onClick={() => setPicking((v) => !v)}
            >
              <AlertTriangle className="size-3.5" strokeWidth={2.2} />
              {item.candidates.length ? "Qual deles você vendeu?" : "Não encontrei com segurança"}
            </button>
          ) : null}
          {resolved ? (
            <button type="button" className="press mt-1 text-[12.5px] font-medium text-[#8C8C8C] hover:text-white" onClick={() => setPicking((v) => !v)}>
              {picking ? "Fechar opções" : "Trocar perfume"}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="press grid size-9 shrink-0 place-items-center rounded-full bg-[#232323] text-[#8C8C8C] transition-colors hover:bg-[#2E2E2E] hover:text-[#FF9A8A]"
          onClick={onRemove}
          aria-label="Remover item"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <Collapse open={picking}>
        <div className="mt-3 space-y-1 rounded-[18px] bg-[#232323] p-1.5">
          {item.candidates.length === 0 ? (
            <p className="px-2 py-2.5 text-[13px] text-[#8C8C8C]">Nenhum perfume parecido no catálogo. Use a busca acima.</p>
          ) : (
            item.candidates.map((c) => (
              <button
                type="button"
                key={c.product_id}
                onClick={() => pick(c, c.product_id !== suggestion?.product_id)}
                className={cn(
                  "press flex w-full min-w-0 items-center gap-3 rounded-[14px] p-2 text-left transition-colors",
                  c.product_id === item.product_id ? "bg-white text-[#15130F]" : "hover:bg-[#2E2E2E]",
                )}
              >
                <SaleThumb url={c.image_url} name={c.name} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{c.name}</span>
                  <span className={cn("block truncate text-[12px]", c.product_id === item.product_id ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>{c.brand ?? "—"}</span>
                </span>
                {c.product_id === item.product_id ? <Check className="size-4" strokeWidth={2.6} /> : null}
              </button>
            ))
          )}
        </div>
      </Collapse>

      {resolved ? (
        <>
          <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
            {showFull && (canFull(chosen) || !chosen) ? (
              <Chip on={item.variant === "FULL"} onClick={() => setVariant("FULL", null)}>
                Frasco
              </Chip>
            ) : null}
            {showSizes && (canDecant(chosen) || !chosen)
              ? DECANT_SIZES.map((ml) => (
                  <Chip key={ml} on={item.variant === "DECANT" && item.decant_ml === ml} onClick={() => setVariant("DECANT", ml)}>
                    Decant {ml}ml
                  </Chip>
                ))
              : null}
            {!switching && item.variant !== "UNKNOWN" ? (
              <button type="button" className="press h-9 px-2 text-[12.5px] font-medium text-[#8C8C8C] hover:text-white" onClick={() => setSwitching(true)}>
                {item.variant === "FULL" ? "Era decant?" : "Era frasco?"}
              </button>
            ) : null}
          </div>

          {item.needs_variant ? <p className="mt-2 text-[12.5px] font-semibold text-[#FFD599]">Foi frasco ou decant?</p> : null}
          {item.needs_size ? <p className="mt-2 text-[12.5px] font-semibold text-[#FFD599]">Qual o tamanho do decant?</p> : null}

          <div className="mt-3.5 flex min-w-0 items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
            <div className="flex items-center gap-1 rounded-full bg-[#232323] p-1">
              <button
                type="button"
                className="press grid size-8 place-items-center rounded-full text-[#D4D4D4] hover:bg-[#2E2E2E] disabled:opacity-30"
                onClick={() => onChange({ quantity: Math.max(1, item.quantity - 1) })}
                disabled={item.quantity <= 1}
                aria-label="Menos um"
              >
                <Minus className="size-4" strokeWidth={2.2} />
              </button>
              <span className="w-7 text-center text-[15px] font-bold tabular-nums">{item.quantity}</span>
              <button
                type="button"
                className="press grid size-8 place-items-center rounded-full text-[#D4D4D4] hover:bg-[#2E2E2E]"
                onClick={() => onChange({ quantity: Math.min(99, item.quantity + 1) })}
                aria-label="Mais um"
              >
                <Plus className="size-4" strokeWidth={2.2} />
              </button>
            </div>

            <div className="min-w-0 text-right">
              {editingPrice ? (
                <input
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  className="pk-field h-10 w-32 rounded-[14px] bg-[#2A2A2A] px-3 text-right text-[16px] font-bold text-white tabular-nums outline-none"
                  defaultValue={item.unit_price != null ? String(item.unit_price).replace(".", ",") : ""}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  onBlur={(e) => {
                    const v = parseMoney(e.target.value) ?? 0;
                    setEditingPrice(false);
                    onChange({ unit_price: v > 0 ? v : null, price_source: v > 0 ? "spoken" : "none" });
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="press inline-flex items-center gap-1.5 rounded-full px-1 text-[16px] font-bold tabular-nums disabled:opacity-40"
                  onClick={() => setEditingPrice(true)}
                  disabled={item.variant === "UNKNOWN" || (item.variant === "DECANT" && !item.decant_ml)}
                >
                  {item.unit_price != null ? brl(item.unit_price) : "Definir preço"}
                  <Pencil className="size-3.5 text-[#8C8C8C]" />
                </button>
              )}
              <p className="text-[12px] text-[#8C8C8C]">
                {!complete ? "cada" : item.quantity > 1 ? `cada · ${brl(subtotal)} no total` : item.price_source === "current" ? "preço do catálogo" : "preço combinado"}
              </p>
            </div>
          </div>
        </>
      ) : null}
    </article>
  );
}

/* --------------------------------------------------------------- composer */

/** Venda já registrada, aberta para edição (nada é salvo antes de confirmar). */
export type SaleComposerInitial = {
  sale_id: string;
  expected_seq: number;
  entry_method: "voice" | "manual";
  items: Item[];
  payment_method: string | null;
  customer: { id: string | null; name: string | null };
  /** total pago já praticado (mantém o desconto da venda) */
  total: number | null;
  sold_at: string | null;
  transcript: string | null;
};

export function SaleComposer({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: "manual" | "edit";
  initial?: SaleComposerInitial;
  onClose: () => void;
  onSaved: (saleId: string, total: number) => void;
}) {
  const editing = mode === "edit" && !!initial;
  const settings = useDecantSettings();
  const [items, setItems] = useState<Item[]>(initial?.items ?? []);
  const [payment, setPayment] = useState<string | null>(initial?.payment_method ?? null);
  const [customer, setCustomer] = useState<{ id: string | null; name: string | null }>(initial?.customer ?? { id: null, name: null });
  const [spokenTotal, setSpokenTotal] = useState<number | null>(initial?.total ?? null);
  const [editingTotal, setEditingTotal] = useState(false);
  const [soldAt, setSoldAt] = useState<string | null>(initial?.sold_at ?? null);
  const [showDate, setShowDate] = useState(editing);
  const transcript = initial?.transcript ?? null;
  const entryMethod: "voice" | "manual" = initial?.entry_method ?? "manual";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const idempotency = useRef(saleUid());
  const seq = useRef(initial?.expected_seq ?? 0);
  const searchRef = useRef<HTMLInputElement>(null);

  const commit = useMutation({
    mutationFn: () =>
      storeSaleCommit({
        data: {
          idempotency_key: idempotency.current,
          entry_method: entryMethod,
          payment_method: payment!,
          customer_id: customer.id,
          customer_name: customer.name,
          sold_at: soldAt,
          transcript,
          total: spokenTotal,
          items: items.map((i) => ({
            product_id: i.product_id!,
            variant: i.variant as "FULL" | "DECANT",
            decant_ml: i.decant_ml,
            quantity: i.quantity,
            unit_price: i.unit_price!,
          })),
          // aprendizado de voz: só o que veio da fala e foi confirmado aqui
          learn:
            entryMethod === "voice"
              ? items
                  .filter((i) => i.product_id && i.spoken_name && searchish(i.spoken_name) !== searchish(i.name))
                  .map((i) => ({ spoken_name: i.spoken_name, product_id: i.product_id!, corrected: i.corrected === true }))
              : [],
        },
      }),
    onSuccess: (res) => onSaved(res.id, total),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui registrar a venda."),
  });

  /** Edição: o banco estorna o impacto antigo e aplica o novo na mesma transação. */
  const update = useMutation({
    mutationFn: () =>
      storeSaleUpdate({
        data: {
          id: initial!.sale_id,
          expected_seq: seq.current,
          payment_method: payment!,
          customer_id: customer.id,
          customer_name: customer.name,
          sold_at: soldAt,
          total: spokenTotal,
          items: items.map((i) => ({
            product_id: i.product_id!,
            variant: i.variant as "FULL" | "DECANT",
            decant_ml: i.decant_ml,
            quantity: i.quantity,
            unit_price: i.unit_price!,
          })),
        },
      }),
    onSuccess: (res) => {
      seq.current = res.edit_seq;
      onSaved(res.id, total);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui salvar as alterações."),
  });

  // busca de produto
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void storeSaleProductSearch({ data: { q } })
        .then((r) => {
          if (alive) setResults(r.results as unknown as Candidate[]);
        })
        .catch(() => undefined)
        .finally(() => alive && setSearching(false));
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const addCandidate = (c: Candidate) => {
    const variant: Item["variant"] = canFull(c) ? "FULL" : canDecant(c) ? "DECANT" : "UNKNOWN";
    const price = variant === "FULL" ? c.retail_price : null;
    setItems((prev) => [
      ...prev,
      {
        key: saleUid(),
        spoken_name: c.name,
        product_id: c.product_id,
        name: c.name,
        brand: c.brand,
        image_url: c.image_url,
        variant,
        decant_ml: null,
        quantity: 1,
        unit_price: price ?? null,
        price_source: price != null ? "current" : "none",
        confidence: "high",
        candidates: [c],
        needs_variant: variant === "UNKNOWN",
        needs_size: variant === "DECANT",
      },
    ]);
    setQuery("");
    setResults([]);
  };

  const incomplete = items.some(
    (i) => !i.product_id || i.variant === "UNKNOWN" || (i.variant === "DECANT" && !i.decant_ml) || i.unit_price == null,
  );
  const subtotal = useMemo(() => items.reduce((sum, i) => sum + (i.unit_price ?? 0) * i.quantity, 0), [items]);
  const discount = spokenTotal != null && spokenTotal < subtotal ? Number((subtotal - spokenTotal).toFixed(2)) : 0;
  const total = Number((subtotal - discount).toFixed(2));
  /** enquanto faltar produto ou tamanho, nada de R$ 0,00 na tela */
  const pending = items.length === 0 || incomplete;
  const blocked = items.length === 0 || !payment || incomplete;
  const missing = items.length === 0 ? "Adicione um perfume" : incomplete ? "Complete os itens marcados" : !payment ? "Escolha o pagamento" : null;
  const units = items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pt-1 pb-6 lg:px-6">
        {transcript ? (
          <div className="flex min-w-0 gap-3 rounded-[20px] bg-[#1A1A1A] p-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#FFD599]/12 text-[#FFD599]">
              <Sparkles className="size-4" />
            </span>
            <p className="min-w-0 text-[14px] leading-relaxed text-[#BABABA]">“{transcript}”</p>
          </div>
        ) : null}

        {/* 1 · perfumes */}
        <section>
          <SectionLabel right={items.length ? <span className="text-[12.5px] font-semibold text-[#8C8C8C] tabular-nums">{units} {units === 1 ? "item" : "itens"}</span> : null}>
            Perfumes vendidos
          </SectionLabel>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-[#6F6F6F]" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar perfume ou marca"
              autoFocus={!editing && items.length === 0}
              className="pk-field h-[52px] w-full min-w-0 rounded-[18px] bg-[#232323] pr-11 pl-11 text-[16px] text-white outline-none transition-colors duration-200 placeholder:text-[#6F6F6F] hover:bg-[#262626] focus:bg-[#2A2A2A]"
            />
            {query ? (
              <button type="button" aria-label="Limpar busca" onClick={() => setQuery("")} className="press absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-[#8C8C8C] hover:text-white">
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          {query.trim().length >= 2 ? (
            <div className="ui-pop mt-2 max-h-[320px] overflow-y-auto rounded-[20px] bg-[#1A1A1A] p-1.5">
              {searching && results.length === 0 ? (
                <div className="space-y-1.5 p-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="admin-skeleton h-14 rounded-[14px]" />
                  ))}
                </div>
              ) : results.length === 0 ? (
                <p className="px-3 py-4 text-[14px] text-[#8C8C8C]">Nenhum perfume com “{query.trim()}”.</p>
              ) : (
                results.map((c, i) => (
                  <button
                    type="button"
                    key={c.product_id}
                    onClick={() => addCandidate(c)}
                    className="pk-in press flex w-full min-w-0 items-center gap-3 rounded-[16px] p-2 text-left transition-colors hover:bg-[#232323]"
                    style={{ ["--i" as string]: i }}
                  >
                    <SaleThumb url={c.image_url} name={c.name} size={48} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold">{c.name}</span>
                      <span className="block truncate text-[12.5px] text-[#8C8C8C]">
                        {c.brand ?? "—"}
                        {c.retail_price != null ? ` · ${brl(c.retail_price)}` : ""}
                      </span>
                    </span>
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[#15130F]">
                      <Plus className="size-4" strokeWidth={2.6} />
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}

          <div className="mt-3 space-y-2.5">
            {items.length === 0 && query.trim().length < 2 ? (
              <button
                type="button"
                onClick={() => searchRef.current?.focus()}
                className="press flex w-full flex-col items-center gap-2 rounded-[24px] border-2 border-dashed border-white/[0.08] px-6 py-9 text-center text-[#8C8C8C] hover:border-white/[0.14] hover:text-white"
              >
                <span className="grid size-12 place-items-center rounded-full bg-[#1F1F1F] text-white">
                  <Search className="size-5" />
                </span>
                <span className="text-[15px] font-semibold">Busque o perfume vendido</span>
                <span className="text-[13px]">Frasco ou decant, quantos quiser.</span>
              </button>
            ) : null}
            {items.map((item, index) => (
              <ItemCard
                key={item.key}
                item={item}
                index={index}
                settings={settings}
                onChange={(patch) => setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))}
                onRemove={() => setItems((prev) => prev.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        </section>

        {/* 2 · pagamento */}
        <section>
          <SectionLabel right={!payment && items.length ? <span className="text-[12.5px] font-semibold text-[#FFD599]">Obrigatório</span> : null}>Pagamento</SectionLabel>
          <PaymentPicker value={payment} onChange={setPayment} />
        </section>

        {/* 3 · cliente */}
        <section>
          <SectionLabel>Cliente</SectionLabel>
          <CustomerField value={customer} onChange={setCustomer} />
        </section>

        {/* 4 · data */}
        <section>
          {showDate ? (
            <>
              <SectionLabel>Data e hora da venda</SectionLabel>
              <input
                type="datetime-local"
                className="pk-field h-12 w-full min-w-0 rounded-[16px] bg-[#232323] px-4 text-[16px] text-white outline-none [color-scheme:dark] focus:bg-[#2A2A2A]"
                value={soldAt ? toLocalInput(soldAt) : toLocalInput(new Date().toISOString())}
                onChange={(e) => setSoldAt(e.target.value ? new Date(e.target.value).toISOString() : soldAt)}
              />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowDate(true)}
              className="press inline-flex h-10 items-center gap-2 rounded-full bg-[#1A1A1A] px-4 text-[13.5px] font-semibold text-[#BABABA] hover:bg-[#202020] hover:text-white"
            >
              <CalendarClock className="size-4" />
              {soldAt ? `Venda de ${new Date(soldAt).toLocaleDateString("pt-BR")}` : "Agora · mudar data"}
            </button>
          )}
        </section>
      </div>

      {/* resumo fixo */}
      <footer className="pk-footer shrink-0 border-t border-white/[0.06] bg-[#121212] px-5 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] lg:px-6 lg:pb-5">
        <div className="flex min-w-0 items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-[#8C8C8C]">
              {!pending && discount > 0 ? (
                <>
                  <s className="tabular-nums">{brl(subtotal)}</s> · desconto {brl(discount)}
                </>
              ) : (
                "Total da venda"
              )}
            </p>
            {editingTotal ? (
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                className="pk-field mt-1 h-11 w-40 rounded-[14px] bg-[#2A2A2A] px-3 text-[22px] font-bold text-white tabular-nums outline-none"
                defaultValue={spokenTotal ?? (pending ? "" : String(total).replace(".", ","))}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                onBlur={(e) => {
                  const v = parseMoney(e.target.value) ?? 0;
                  setEditingTotal(false);
                  setSpokenTotal(v > 0 ? v : null);
                }}
              />
            ) : (
              <button
                type="button"
                className="press mt-0.5 inline-flex items-baseline gap-2 text-left disabled:opacity-60"
                onClick={() => setEditingTotal(true)}
                disabled={pending}
                title="Dar desconto / mudar total"
              >
                <span className="text-[30px] leading-none font-bold tracking-[-0.04em] tabular-nums">
                  {pending ? "—" : <AnimatedNumber value={total} format={(n) => brl(n)} duration={450} />}
                </span>
                {!pending ? <Pencil className="size-3.5 text-[#8C8C8C]" /> : null}
              </button>
            )}
          </div>
          <p className={cn("pb-1 text-right text-[12.5px] font-semibold transition-colors", missing ? "text-[#FFD599]" : "text-[#7FCF9F]")}>
            {missing ?? (
              <span className="inline-flex items-center gap-1">
                <Check className="size-3.5" strokeWidth={3} /> Pronto
              </span>
            )}
          </p>
        </div>
        <div className="mt-3 flex gap-2">
          <SoftButton aria-label="Cancelar" onClick={onClose} className="w-[52px] px-0" icon={<X />} />
          <GoldButton
            className="flex-1"
            disabled={blocked}
            loading={commit.isPending || update.isPending}
            icon={<Check className="size-[18px]" strokeWidth={2.6} />}
            onClick={() => (editing ? update.mutate() : commit.mutate())}
          >
            {editing ? "Salvar alterações" : "Confirmar venda"}
          </GoldButton>
        </div>
      </footer>
    </div>
  );
}
