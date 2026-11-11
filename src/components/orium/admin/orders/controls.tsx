/**
 * CONTROLES DO PEDIDO — feitos para não ter erro.
 *
 * - Datas com um toque: Hoje · Amanhã · próximos dias · outra data.
 * - Pagamento em 3 botões grandes: Não pagou · Pagou metade · Pagou tudo
 *   (+ "outro valor"), e o dia combinado para pagar.
 * - Entrega: retirada/entrega, dia e horário com um toque.
 * As versões "Picker" só mostram/editam um valor (Novo pedido); as versões
 * "Control" gravam direto no pedido (painel do pedido).
 */
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { setOrderDelivery, setOrderPayment, type PaymentMode } from "@/lib/orders.functions";
import { setPaymentDueDate } from "@/lib/orders-control.functions";
import { paymentInfo } from "@/components/orium/admin/OrderPayment";
import { todayBR } from "@/lib/delivery";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ─────────────── datas ─────────────── */

export const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
const wd = (ymd: string, style: "short" | "long" = "short") =>
  new Intl.DateTimeFormat("pt-BR", { weekday: style, timeZone: "UTC" })
    .format(new Date(`${ymd}T12:00:00Z`))
    .replace(".", "")
    .replace("-feira", "")
    .replace(/^./, (c) => c.toUpperCase());

/** "Hoje", "Amanhã", "Ontem", "Sex 14/11". */
export function dayLabel(ymd: string | null | undefined) {
  if (!ymd) return "";
  const t = todayBR();
  const diff = daysBetween(t, ymd.slice(0, 10));
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  return `${wd(ymd)} ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

/** Situação do dia combinado para pagar. */
export function dueInfo(o: any): { state: "none" | "late" | "today" | "tomorrow" | "later"; days: number; date: string | null } {
  const p = paymentInfo(o);
  const date = o?.payment_due_date ? String(o.payment_due_date).slice(0, 10) : null;
  if (!date || p.due <= 0 || o?.status === "cancelado" || o?.deleted_at) return { state: "none", days: 0, date };
  const diff = daysBetween(todayBR(), date);
  return { state: diff < 0 ? "late" : diff === 0 ? "today" : diff === 1 ? "tomorrow" : "later", days: Math.abs(diff), date };
}

/** Chips de data: Hoje · Amanhã · próximos 5 dias · outra data · (sem data). */
export function DateChips({
  value,
  onChange,
  clearLabel = "Sem data",
  days = 6,
  busy,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  clearLabel?: string | null;
  days?: number;
  busy?: boolean;
}) {
  const t = todayBR();
  const quick = Array.from({ length: days }, (_, i) => addDays(t, i));
  const custom = value && !quick.includes(value) ? value : null;
  const inputRef = useRef<HTMLInputElement>(null);
  const chip = (on: boolean) =>
    cn(
      "press flex h-[54px] shrink-0 flex-col items-center justify-center rounded-[16px] px-3 leading-tight transition-colors duration-200",
      on ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-white hover:bg-[#262626]",
      busy && "pointer-events-none opacity-60",
    );
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {quick.map((d, i) => (
        <button key={d} type="button" aria-pressed={value === d} onClick={() => onChange(value === d ? null : d)} className={chip(value === d)}>
          <span className="text-[12.5px] font-bold">{i === 0 ? "Hoje" : i === 1 ? "Amanhã" : wd(d)}</span>
          <span className={cn("text-[11.5px] tabular-nums", value === d ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>
            {d.slice(8, 10)}/{d.slice(5, 7)}
          </span>
        </button>
      ))}
      <label className={cn(chip(!!custom), "relative cursor-pointer gap-0.5")}>
        <CalendarDays className="size-4" strokeWidth={2.2} />
        <span className="text-[11.5px] font-bold">{custom ? dayLabel(custom) : "Outra data"}</span>
        <input
          ref={inputRef}
          data-slot="input-group-control"
          type="date"
          min={addDays(t, -60)}
          value={custom ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          onClick={(e) => (e.currentTarget as any).showPicker?.()}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Escolher outra data"
        />
      </label>
      {clearLabel && value ? (
        <button type="button" onClick={() => onChange(null)} className={cn(chip(false), "text-[#A9A9A9]")}>
          <X className="size-4" />
          <span className="text-[11.5px] font-bold">{clearLabel}</span>
        </button>
      ) : null}
    </div>
  );
}

const TIMES = [
  { v: "10:00", label: "Manhã", hint: "10h" },
  { v: "14:00", label: "Tarde", hint: "14h" },
  { v: "18:00", label: "Fim da tarde", hint: "18h" },
  { v: "20:00", label: "Noite", hint: "20h" },
];

export function TimeChips({ value, onChange, busy }: { value: string | null; onChange: (v: string | null) => void; busy?: boolean }) {
  const custom = value && !TIMES.some((t) => t.v === value) ? value : null;
  const chip = (on: boolean) =>
    cn(
      "press flex h-12 min-w-0 flex-1 flex-col items-center justify-center rounded-[14px] px-2 leading-tight transition-colors duration-200",
      on ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-white hover:bg-[#262626]",
      busy && "pointer-events-none opacity-60",
    );
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {TIMES.map((t) => (
        <button key={t.v} type="button" aria-pressed={value === t.v} onClick={() => onChange(value === t.v ? null : t.v)} className={chip(value === t.v)}>
          <span className="truncate text-[12px] font-bold">{t.label}</span>
          <span className={cn("text-[11px]", value === t.v ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>{t.hint}</span>
        </button>
      ))}
      <label className={cn(chip(!!custom), "relative cursor-pointer")}>
        <span className="text-[12px] font-bold">{custom ?? "Outro"}</span>
        <span className={cn("text-[11px]", custom ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>horário</span>
        <input
          data-slot="input-group-control"
          type="time"
          value={custom ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          onClick={(e) => (e.currentTarget as any).showPicker?.()}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Outro horário"
        />
      </label>
    </div>
  );
}

/* ─────────────── pagamento ─────────────── */

export type PayMode = "unpaid" | "deposit" | "paid";

/** Três botões grandes. `amounts` mostra quanto cada opção representa. */
export function PayButtons({
  value,
  onChange,
  total,
  busy,
  depositPct = 50,
}: {
  value: PayMode | "other";
  onChange: (v: PayMode) => void;
  total: number;
  busy?: PayMode | null;
  depositPct?: number;
}) {
  const opts: Array<{ v: PayMode; title: string; amount: number; tone: string }> = [
    { v: "unpaid", title: "Não pagou", amount: 0, tone: "bg-[#2E2E2E]" },
    { v: "deposit", title: "Pagou metade", amount: Math.round(total * depositPct) / 100, tone: "bg-[#FFD599]" },
    { v: "paid", title: "Pagou tudo", amount: total, tone: "bg-[#7FCF9F]" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Pagamento">
      {opts.map((o) => {
        const on = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={cn(
              "press relative flex min-h-[92px] flex-col justify-between overflow-hidden rounded-[20px] p-3 text-left transition-[background-color,box-shadow] duration-300",
              on ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-white hover:bg-[#262626]",
            )}
          >
            <span className="flex items-center justify-between">
              <span className={cn("grid size-6 place-items-center rounded-full", o.tone, o.v === "unpaid" ? "text-white" : "text-[#15130F]")}>
                {busy === o.v ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : o.v === "unpaid" ? (
                  <X className="size-3.5" strokeWidth={3} />
                ) : o.v === "deposit" ? (
                  <span className="block size-2.5 rounded-full bg-[#15130F]" style={{ clipPath: "inset(0 50% 0 0)" }} />
                ) : (
                  <Check className="size-3.5" strokeWidth={3} />
                )}
              </span>
              {on ? <Check className="size-4" strokeWidth={3} /> : null}
            </span>
            <span>
              <span className="block text-[14px] leading-tight font-bold">{o.title}</span>
              <span className={cn("block text-[12px] tabular-nums", on ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>{brl(o.amount)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Pagamento do pedido, gravando direto (painel do pedido). */
export function PaymentControl({ order, onChanged }: { order: any; onChanged: () => void }) {
  const set = useServerFn(setOrderPayment);
  const setDue = useServerFn(setPaymentDueDate);
  const p = paymentInfo(order);
  const exactHalf = Math.abs(p.paid - Math.round(p.total * p.pct) / 100) < 0.01;
  const current: PayMode | "other" = p.status === "unpaid" ? "unpaid" : p.status === "paid" ? "paid" : exactHalf ? "deposit" : "other";
  const [busy, setBusy] = useState<PayMode | null>(null);
  const [other, setOther] = useState(false);
  const [amount, setAmount] = useState("");
  const [due, setDueLocal] = useState<string | null>(order.payment_due_date ?? null);
  const [savingDue, setSavingDue] = useState(false);
  useEffect(() => setDueLocal(order.payment_due_date ?? null), [order.payment_due_date]);
  const info = dueInfo({ ...order, payment_due_date: due });

  const apply = async (mode: PaymentMode, value?: number) => {
    if (busy) return;
    setBusy(mode === "amount" ? "deposit" : mode);
    try {
      await set({ data: { orderId: order.id, mode, ...(value != null ? { amount: value } : {}) } });
      toast.success(mode === "unpaid" ? "Marcado como não pago." : mode === "paid" ? "Pagamento completo registrado." : "Pagamento registrado.");
      setOther(false);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível atualizar o pagamento.");
    } finally {
      setBusy(null);
    }
  };
  const saveDue = async (v: string | null) => {
    setDueLocal(v);
    setSavingDue(true);
    try {
      await setDue({ data: { orderId: order.id, date: v } });
      toast.success(v ? `Pagamento combinado para ${dayLabel(v).toLowerCase()}.` : "Data de pagamento removida.");
      onChanged();
    } catch (e: any) {
      setDueLocal(order.payment_due_date ?? null);
      toast.error(e?.message ?? "Não foi possível salvar a data.");
    } finally {
      setSavingDue(false);
    }
  };

  return (
    <div>
      <PayButtons value={current} total={p.total} busy={busy} depositPct={p.pct} onChange={(v) => v !== current && apply(v)} />
      {current === "other" ? (
        <p className="mt-2 rounded-[14px] bg-[#2A2418] px-3 py-2 text-[13px] font-semibold text-[#FFD599]">
          Pagou {brl(p.paid)} · falta {brl(p.due)}
        </p>
      ) : null}
      {other ? (
        <form
          className="adm-pop mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(amount.replace(/\./g, "").replace(",", "."));
            if (!Number.isFinite(n) || n < 0) return void toast.warning("Valor inválido.");
            if (n > p.total) return void toast.warning(`O valor passa do total do pedido (${brl(p.total)}).`);
            void apply("amount", n);
          }}
        >
          <label className="flex h-12 min-w-0 flex-1 items-center gap-1 rounded-full bg-[#1F1F1F] px-4 focus-within:ring-2 focus-within:ring-[#FFD599]/50">
            <span className="text-[13px] text-[#8C8C8C]">R$</span>
            <input
              data-slot="input-group-control"
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d,.]/g, ""))}
              placeholder="Quanto já pagou no total"
              className="min-w-0 flex-1 bg-transparent text-[15px] font-bold outline-none placeholder:font-normal placeholder:text-[#6F6F6F]"
            />
          </label>
          <button type="submit" className="press h-12 rounded-full bg-white px-5 text-[14px] font-bold text-[#15130F]">
            Salvar
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOther(true)} className="press mt-2 px-1 text-[13px] font-semibold text-[#A9A9A9] hover:text-white">
          Pagou outro valor?
        </button>
      )}

      {p.due > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[14px] font-bold">Combinado para pagar</p>
            {info.state === "late" ? (
              <span className="rounded-full bg-[#2A1A18] px-2.5 py-0.5 text-[12px] font-bold text-[#FF9A8A]">
                Atrasado {info.days} {info.days === 1 ? "dia" : "dias"}
              </span>
            ) : info.state === "today" ? (
              <span className="rounded-full bg-[#FFD599] px-2.5 py-0.5 text-[12px] font-bold text-[#15130F]">Vence hoje</span>
            ) : null}
          </div>
          <DateChips value={due} onChange={saveDue} busy={savingDue} clearLabel="Sem data" />
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────── entrega ─────────────── */

export type DeliveryDraft = { type: "PICKUP" | "LOCAL" | "SHIPPING"; date: string | null; time: string | null; notes: string };

/** Entrega (Novo pedido): tipo, dia e horário. */
export function DeliveryPicker({ value, onChange, allowShipping, busy }: { value: DeliveryDraft; onChange: (v: DeliveryDraft) => void; allowShipping?: boolean; busy?: boolean }) {
  const types: Array<{ v: DeliveryDraft["type"]; label: string }> = [
    { v: "PICKUP", label: "Retira na loja" },
    { v: "LOCAL", label: "Entrega local" },
    ...(allowShipping ? [{ v: "SHIPPING" as const, label: "Envio" }] : []),
  ];
  return (
    <div className="space-y-3">
      <div className="grid gap-1 rounded-full bg-[#1F1F1F] p-1" style={{ gridTemplateColumns: `repeat(${types.length}, minmax(0,1fr))` }}>
        {types.map((t) => (
          <button
            key={t.v}
            type="button"
            aria-pressed={value.type === t.v}
            onClick={() => onChange({ ...value, type: t.v })}
            className={cn("press h-10 rounded-full text-[13.5px] font-bold transition-colors", value.type === t.v ? "bg-white text-[#15130F]" : "text-[#A9A9A9] hover:text-white")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>
        <p className="mb-2 px-1 text-[13px] font-semibold text-[#A9A9A9]">{value.type === "PICKUP" ? "Dia que vai retirar" : "Dia da entrega"}</p>
        <DateChips value={value.date} busy={busy} onChange={(d) => onChange({ ...value, date: d, time: d ? value.time : null })} />
      </div>
      {value.date ? (
        <div className="adm-pop">
          <p className="mb-2 px-1 text-[13px] font-semibold text-[#A9A9A9]">Horário (opcional)</p>
          <TimeChips value={value.time} busy={busy} onChange={(t) => onChange({ ...value, time: t })} />
        </div>
      ) : null}
    </div>
  );
}

/** Entrega do pedido, gravando a cada toque (painel do pedido). */
export function DeliveryControl({ order, onChanged }: { order: any; onChanged: () => void }) {
  const save = useServerFn(setOrderDelivery);
  const from = (o: any): DeliveryDraft => ({
    type: (o.fulfillment_type ?? "PICKUP") as DeliveryDraft["type"],
    date: o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : null,
    time: o.expected_delivery_time ? String(o.expected_delivery_time).slice(0, 5) : null,
    notes: o.delivery_notes ?? "",
  });
  const [v, setV] = useState<DeliveryDraft>(() => from(order));
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(from(order)), [order.expected_delivery_date, order.expected_delivery_time, order.fulfillment_type]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = async (next: DeliveryDraft) => {
    const prev = v;
    setV(next);
    setBusy(true);
    try {
      await save({ data: { orderId: order.id, date: next.date, time: next.time, notes: next.notes, fulfillmentType: next.type } });
      toast.success(
        next.date
          ? `${next.type === "PICKUP" ? "Retirada" : "Entrega"} marcada: ${dayLabel(next.date).toLowerCase()}${next.time ? ` às ${next.time}` : ""}.`
          : "Data de entrega removida.",
      );
      onChanged();
    } catch (e: any) {
      setV(prev);
      toast.error(e?.message ?? "Não foi possível salvar a entrega.");
    } finally {
      setBusy(false);
    }
  };
  return <DeliveryPicker value={v} onChange={change} allowShipping={v.type === "SHIPPING"} busy={busy} />;
}
