/**
 * MONTAGEM DA VENDA DA LOJA — lançamento manual e edição (a voz é do Copilot).
 *
 * A IA sugere, o Admin revisa e confirma. Nada é registrado antes de
 * "Confirmar venda", e o registro final é idempotente (dois toques = uma venda).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  Mic,
  Minus,
  Plus,
  Search,
  Trash2,
  X,
  AlertTriangle,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { decantPrice, DECANT_SIZES, type DecantMl } from "@/lib/decants";
import { useDecantSettings } from "@/lib/use-decant-settings";
import {
  storeSaleProductSearch,
  storeSaleCommit,
  storeSaleUpdate,
  storeSaleCustomerSearch,
} from "@/lib/store-sales.functions";

/** ISO → valor aceito por <input type="datetime-local"> no fuso local. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};


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

const PAYMENTS = [
  { value: "PIX", label: "Pix" },
  { value: "CARTAO", label: "Cartão" },
  { value: "DINHEIRO", label: "Dinheiro" },
];

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** comparação simples de nomes, só para saber se vale mostrar "você disse…" */
const searchish = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");


const canDecant = (c: Candidate | null) =>
  !!c && c.product_type === "PERFUME" && c.decant_available && String(c.sale_mode ?? "BOTH").toUpperCase() !== "FULL_ONLY";
const canFull = (c: Candidate | null) =>
  !!c && String(c.sale_mode ?? "BOTH").toUpperCase() !== "DECANT_ONLY" && c.retail_price != null;

function Thumb({ url, name }: { url: string | null; name: string }) {
  if (!url)
    return (
      <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-muted text-[10px] text-muted-foreground">
        sem foto
      </div>
    );
  return <img src={url} alt={name} className="size-14 shrink-0 rounded-xl object-cover" loading="lazy" />;
}

/* ------------------------------------------------------------------ itens */

function ItemCard({
  item,
  settings,
  onChange,
  onRemove,
}: {
  item: Item;
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

  // qual seleção de variante mostrar: só o necessário
  const showFull = item.variant === "FULL" || item.variant === "UNKNOWN" || switching;
  const showSizes = item.variant === "DECANT" || item.variant === "UNKNOWN" || switching;

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3">
      <div className="flex min-w-0 gap-3">
        <Thumb url={resolved || item.confidence === "medium" ? item.image_url : null} name={item.name} />
        <div className="min-w-0 flex-1">
          {resolved ? (
            <p className="truncate text-[11px] tracking-wide text-muted-foreground uppercase">{item.brand ?? "—"}</p>
          ) : null}
          <p className="line-clamp-2 text-sm font-medium">
            {resolved ? item.name : item.confidence === "medium" && suggestion ? suggestion.name : `“${item.spoken_name}”`}
          </p>
          {resolved ? (
            <p className="text-[12px] text-muted-foreground">
              {item.variant === "FULL"
                ? "Frasco"
                : item.variant === "DECANT"
                  ? item.decant_ml
                    ? `Decant ${item.decant_ml}ml`
                    : "Decant · tamanho pendente"
                  : "Frasco ou decant?"}
              {" · "}
              {item.quantity}x
            </p>
          ) : null}
          {heardDifferent ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              Você disse “{heardDifferent}” · entendi <span className="text-gold">{item.name}</span>
            </p>
          ) : null}

          {!resolved && item.confidence === "medium" && suggestion ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-muted-foreground">É este produto?</span>
              <Button size="sm" className="h-8 rounded-full px-3" onClick={() => pick(suggestion, false)}>
                Confirmar
              </Button>
              <Button size="sm" variant="outline" className="h-8 rounded-full px-3" onClick={() => setPicking(true)}>
                Trocar
              </Button>
            </div>
          ) : null}
          {!resolved && item.confidence === "low" ? (
            <button
              className="press mt-1 inline-flex items-center gap-1.5 rounded-full bg-gold/12 px-2.5 py-1 text-[11px] text-gold"
              onClick={() => setPicking((v) => !v)}
            >
              <AlertTriangle className="size-3" strokeWidth={2} />
              {item.candidates.length ? "Qual deles você vendeu?" : "Não encontrei com segurança"}
            </button>
          ) : null}
          {resolved ? (
            <button className="press mt-1 text-[11px] text-muted-foreground underline" onClick={() => setPicking((v) => !v)}>
              Trocar perfume
            </button>
          ) : null}
        </div>
        <button className="press grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground" onClick={onRemove} aria-label="Remover item">
          <Trash2 className="size-4" strokeWidth={1.75} />
        </button>
      </div>

      {picking ? (
        <div className="mt-3 space-y-1.5 rounded-xl bg-muted/40 p-2">
          {item.candidates.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              Nenhum perfume parecido no catálogo. Use a busca acima para escolher.
            </p>
          ) : (
            item.candidates.map((c) => (
              <button
                key={c.product_id}
                onClick={() => pick(c, c.product_id !== suggestion?.product_id)}
                className={cn(
                  "press flex w-full min-w-0 items-center gap-2.5 rounded-lg p-2 text-left",
                  c.product_id === item.product_id ? "bg-gold/12" : "hover:bg-card",
                )}
              >
                <Thumb url={c.image_url} name={c.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{c.brand ?? "—"}</span>
                </span>
                {c.product_id === item.product_id ? <Check className="size-4 text-gold" strokeWidth={2} /> : null}
              </button>
            ))
          )}
        </div>
      ) : null}

      {resolved ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {showFull && (canFull(chosen) || !chosen) ? (
              <button
                onClick={() => setVariant("FULL", null)}
                className={cn(
                  "press h-9 rounded-full px-3 text-[13px]",
                  item.variant === "FULL" ? "bg-foreground text-background" : "bg-muted/50 text-muted-foreground",
                )}
              >
                Frasco
              </button>
            ) : null}
            {showSizes && (canDecant(chosen) || !chosen)
              ? DECANT_SIZES.map((ml) => (
                  <button
                    key={ml}
                    onClick={() => setVariant("DECANT", ml)}
                    className={cn(
                      "press h-9 rounded-full px-3 text-[13px]",
                      item.variant === "DECANT" && item.decant_ml === ml
                        ? "bg-foreground text-background"
                        : "bg-muted/50 text-muted-foreground",
                    )}
                  >
                    {ml}ml
                  </button>
                ))
              : null}
            {!switching && item.variant !== "UNKNOWN" ? (
              <button className="press h-9 px-2 text-[12px] text-muted-foreground underline" onClick={() => setSwitching(true)}>
                {item.variant === "FULL" ? "Era decant" : "Era frasco"}
              </button>
            ) : null}
          </div>

          {item.needs_variant ? <p className="mt-2 text-[11px] text-gold">Foi frasco ou decant?</p> : null}
          {item.needs_size ? <p className="mt-2 text-[11px] text-gold">Qual tamanho do decant?</p> : null}

          <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <button
                className="press grid size-9 place-items-center rounded-full bg-muted/60"
                onClick={() => onChange({ quantity: Math.max(1, item.quantity - 1) })}
                aria-label="Menos um"
              >
                <Minus className="size-4" strokeWidth={2} />
              </button>
              <span className="w-8 text-center text-sm tabular-nums">{item.quantity}</span>
              <button
                className="press grid size-9 place-items-center rounded-full bg-muted/60"
                onClick={() => onChange({ quantity: Math.min(99, item.quantity + 1) })}
                aria-label="Mais um"
              >
                <Plus className="size-4" strokeWidth={2} />
              </button>
            </div>

            <div className="min-w-0 text-right">
              {editingPrice ? (
                <Input
                  type="number"
                  inputMode="decimal"
                  autoFocus
                  className="h-10 w-28 text-base"
                  defaultValue={item.unit_price ?? ""}
                  onBlur={(e) => {
                    const v = Number(e.target.value.replace(",", "."));
                    setEditingPrice(false);
                    onChange({ unit_price: v > 0 ? v : null, price_source: v > 0 ? "spoken" : "none" });
                  }}
                />
              ) : (
                <button
                  className="press inline-flex items-center gap-1.5 text-sm"
                  onClick={() => setEditingPrice(true)}
                  disabled={item.variant === "UNKNOWN" || (item.variant === "DECANT" && !item.decant_ml)}
                >
                  {item.unit_price != null ? `${brl(item.unit_price)} cada` : "Definir preço"}
                  <Pencil className="size-3 text-muted-foreground" strokeWidth={1.75} />
                </button>
              )}
              <p className="text-[11px] text-muted-foreground">
                {!complete
                  ? "—"
                  : item.price_source === "current"
                    ? `Preço atual · ${brl(subtotal)}`
                    : brl(subtotal)}
              </p>
            </div>
          </div>
        </>
      ) : null}
    </div>
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
  onSaved: (saleId: string) => void;
}) {
  const editing = mode === "edit" && !!initial;
  const settings = useDecantSettings();
  const [items, setItems] = useState<Item[]>(initial?.items ?? []);
  const [payment, setPayment] = useState<string | null>(initial?.payment_method ?? null);
  const [customer, setCustomer] = useState<{ id: string | null; name: string | null }>(
    initial?.customer ?? { id: null, name: null },
  );
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Array<{ id: string; name: string | null; phone: string | null }>>([]);
  const [spokenTotal, setSpokenTotal] = useState<number | null>(initial?.total ?? null);
  const [editingTotal, setEditingTotal] = useState(false);
  const [soldAt, setSoldAt] = useState<string | null>(initial?.sold_at ?? null);
  const [transcript, setTranscript] = useState<string | null>(initial?.transcript ?? null);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const entryMethod: "voice" | "manual" = initial?.entry_method ?? "manual";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const idempotency = useRef(uid());
  const seq = useRef(initial?.expected_seq ?? 0);



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
                  .map((i) => ({
                    spoken_name: i.spoken_name,
                    product_id: i.product_id!,
                    corrected: i.corrected === true,
                  }))
              : [],
        },
      }),
    onSuccess: (res) => onSaved(res.id),
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
      onSaved(res.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui salvar as alterações."),
  });




  // busca de produto (venda manual e adição rápida)
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

  useEffect(() => {
    const q = customerQuery.trim();
    if (q.length < 2) {
      setCustomerResults([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void storeSaleCustomerSearch({ data: { q } })
        .then((r) => alive && setCustomerResults(r))
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [customerQuery]);

  const addCandidate = (c: Candidate) => {
    const variant: Item["variant"] = canFull(c) ? "FULL" : canDecant(c) ? "DECANT" : "UNKNOWN";
    const ml = null;
    const price = variant === "FULL" ? c.retail_price : null;
    setItems((prev) => [
      ...prev,
      {
        key: uid(),
        spoken_name: c.name,
        product_id: c.product_id,
        name: c.name,
        brand: c.brand,
        image_url: c.image_url,
        variant,
        decant_ml: ml,
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
  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + (i.unit_price ?? 0) * i.quantity, 0),
    [items],
  );
  const discount = spokenTotal != null && spokenTotal < subtotal ? Number((subtotal - spokenTotal).toFixed(2)) : 0;
  const total = Number((subtotal - discount).toFixed(2));
  /** enquanto faltar produto ou tamanho, nada de R$ 0,00 na tela */
  const pending = items.length === 0 || incomplete;

  const blocked = items.length === 0 || !payment || incomplete;


  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-4">

        {transcript ? (
          <div className="rounded-xl bg-muted/40 p-3">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Transcrição original</p>
            <p className="mt-1 text-sm text-muted-foreground">“{transcript}”</p>
          </div>
        ) : null}


        {/* busca / adição rápida */}
        <div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar perfume ou marca"
                className="h-12 pl-9 text-base"
              />
            </div>

          </div>

          {query.trim().length >= 2 ? (
            <div className="mt-2 space-y-1.5 rounded-xl border border-border/60 bg-card p-2">
              {searching && results.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">Buscando…</p>
              ) : results.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">Nenhum perfume encontrado.</p>
              ) : (
                results.map((c) => (
                  <button
                    key={c.product_id}
                    onClick={() => addCandidate(c)}
                    className="press flex w-full min-w-0 items-center gap-2.5 rounded-lg p-2 text-left hover:bg-muted/50"
                  >
                    <Thumb url={c.image_url} name={c.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{c.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {c.brand ?? "—"}
                        {c.retail_price != null ? ` · ${brl(c.retail_price)}` : ""}
                      </span>
                    </span>
                    <Plus className="size-4 text-gold" strokeWidth={2} />
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        {/* itens */}
        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              Busque um perfume para começar. Para falar, use o Copilot.
            </p>
          ) : null}
          {items.map((item, index) => (
            <ItemCard
              key={item.key}
              item={item}
              settings={settings}
              onChange={(patch) =>
                setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
              }
              onRemove={() => setItems((prev) => prev.filter((_, i) => i !== index))}
            />
          ))}
        </div>

        {/* pagamento */}
        <div>
          <p className="mb-2 text-[11px] tracking-wide text-muted-foreground uppercase">Pagamento</p>
          <div className="flex flex-wrap gap-1.5">
            {PAYMENTS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPayment(p.value)}
                className={cn(
                  "press h-10 rounded-full px-4 text-sm",
                  payment === p.value ? "bg-foreground text-background" : "bg-muted/50 text-muted-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {!payment ? <p className="mt-2 text-[11px] text-gold">Selecione a forma de pagamento.</p> : null}
        </div>

        {/* cliente opcional */}
        <div>
          <p className="mb-2 text-[11px] tracking-wide text-muted-foreground uppercase">Cliente (opcional)</p>
          {customer.id ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 p-3 text-sm">
              <span className="truncate">{customer.name}</span>
              <button className="press text-xs text-muted-foreground" onClick={() => setCustomer({ id: null, name: null })}>
                Remover
              </button>
            </div>
          ) : (
            <>
              {customer.name ? (
                <p className="mb-2 text-sm">
                  Cliente mencionado: <span className="font-medium">{customer.name}</span>
                </p>
              ) : null}
              <Input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Buscar cliente por nome ou WhatsApp"
                className="h-11 text-base"
              />
              {customerResults.length > 0 ? (
                <div className="mt-2 space-y-1 rounded-xl border border-border/60 bg-card p-2">
                  {customerResults.map((c) => (
                    <button
                      key={c.id}
                      className="press block w-full truncate rounded-lg p-2 text-left text-sm hover:bg-muted/50"
                      onClick={() => {
                        setCustomer({ id: c.id, name: c.name });
                        setCustomerQuery("");
                        setCustomerResults([]);
                      }}
                    >
                      {c.name ?? "Sem nome"} {c.phone ? <span className="text-muted-foreground">· {c.phone}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-[11px] text-muted-foreground">Pode registrar sem cliente.</p>
            </>
          )}
        </div>

        {editing ? (
          <div>
            <p className="mb-2 text-[11px] tracking-wide text-muted-foreground uppercase">Data e hora da venda</p>
            <Input
              type="datetime-local"
              className="h-11 text-base"
              value={soldAt ? toLocalInput(soldAt) : ""}
              onChange={(e) => setSoldAt(e.target.value ? new Date(e.target.value).toISOString() : soldAt)}
            />
          </div>
        ) : soldAt ? (
          <p className="rounded-xl bg-gold/10 p-3 text-sm text-gold">
            Data desta venda: {new Date(soldAt).toLocaleDateString("pt-BR")}
          </p>
        ) : null}
      </div>

      {/* resumo fixo */}
      <div
        className="border-t border-white/[0.06] bg-[#0A0A0A] px-4 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        <div className="mx-auto w-full max-w-2xl space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{pending ? "—" : brl(subtotal)}</span>
          </div>
          {!pending && discount > 0 ? (
            <div className="flex justify-between text-muted-foreground">
              <span>Desconto</span>
              <span className="tabular-nums">− {brl(discount)}</span>
            </div>
          ) : null}
          <div className="flex min-w-0 items-center justify-between gap-3 text-base font-semibold">
            <span>Total pago</span>
            {editingTotal ? (
              <Input
                type="number"
                inputMode="decimal"
                autoFocus
                className="h-10 w-32 text-base"
                defaultValue={spokenTotal ?? (pending ? "" : total)}
                onBlur={(e) => {
                  const v = Number(e.target.value.replace(",", "."));
                  setEditingTotal(false);
                  setSpokenTotal(v > 0 ? v : null);
                }}
              />
            ) : (
              <button
                type="button"
                className="press inline-flex items-center gap-1.5 tabular-nums"
                onClick={() => setEditingTotal(true)}
                disabled={pending}
              >
                {pending ? "—" : brl(total)}
                {!pending ? <Pencil className="size-3 text-muted-foreground" strokeWidth={1.75} /> : null}
              </button>
            )}
          </div>
          {pending && items.length > 0 ? (
            <p className="text-[11px] text-muted-foreground">Aguardando informações do item.</p>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button variant="ghost" className="h-12 rounded-full" onClick={onClose}>
              <X className="size-4" strokeWidth={1.75} />
            </Button>
            <Button
              className="h-12 min-w-0 flex-1 rounded-full text-base"
              disabled={blocked || commit.isPending || update.isPending}
              onClick={() => (editing ? update.mutate() : commit.mutate())}
            >
              {commit.isPending || update.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : editing ? (
                "Salvar alterações"
              ) : (
                "Confirmar venda"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

