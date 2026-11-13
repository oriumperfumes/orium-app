/**
 * CONTROLES DO PEDIDO — feitos para não ter erro.
 *
 * - Datas com um toque: Hoje · Amanhã · próximos dias · outra data.
 * - Pagamento por valor: digita quanto o cliente já pagou (ou "+50" para
 *   somar), com atalhos Nada · Metade · Tudo, e o dia combinado para pagar.
 * - Entrega: retirada/entrega, dia e horário com um toque.
 * As versões "Picker" só mostram/editam um valor (Novo pedido); as versões
 * "Control" gravam direto no pedido (painel do pedido).
 */
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { setOrderDelivery, setOrderPayment } from "@/lib/orders.functions";
import { setPaymentDueDate } from "@/lib/orders-control.functions";
import { paymentInfo } from "@/components/orium/admin/OrderPayment";
import { todayBR } from "@/lib/delivery";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Collapse } from "@/components/orium/admin/motion";

/* ─────────────── datas ─────────────── */

/**
 * "Hoje" ao vivo: muda sozinho na virada do dia (aba aberta de ontem para
 * hoje) e ao voltar para a aba — o que era "Amanhã" vira "Hoje".
 */
export function useToday() {
  const [d, setD] = useState(() => todayBR());
  useEffect(() => {
    const tick = () => setD((prev) => (prev === todayBR() ? prev : todayBR()));
    const id = window.setInterval(tick, 30_000);
    const vis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return d;
}

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
  const t = useToday();
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

/**
 * Rascunho do pagamento: atalhos (nada/metade/tudo) acompanham o total do
 * pedido; "value" é o que foi digitado ("+50" soma ao que já tinha pago).
 */
export type PayDraft = { mode: "none" | "half" | "all" | "value"; text: string };

/** "1.234,50" · "150" · "99.9" → número (NaN se inválido). */
export function parseMoney(s: string) {
  let t = (s ?? "").replace(/[^\d,.]/g, "");
  if (!t) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if ((t.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(t)) t = t.replace(/\./g, "");
  return Number(t);
}
const fmtMoney = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Quanto o cliente terá pago (total acumulado), ou null se o texto for inválido. */
export function resolvePaid(d: PayDraft, total: number, base = 0, pct = 50): number | null {
  if (d.mode === "none") return 0;
  if (d.mode === "half") return r2((total * pct) / 100);
  if (d.mode === "all") return r2(total);
  const add = d.text.trim().startsWith("+");
  const n = parseMoney(d.text);
  if (!Number.isFinite(n) || n < 0) return null;
  return r2(Math.min(total, (add ? base : 0) + n));
}

/** Rascunho inicial a partir do que já foi pago. */
export function draftFrom(paid: number, total: number, pct = 50): PayDraft {
  if (paid <= 0) return { mode: "none", text: "" };
  if (total > 0 && paid >= total) return { mode: "all", text: "" };
  if (Math.abs(paid - r2((total * pct) / 100)) < 0.01) return { mode: "half", text: "" };
  return { mode: "value", text: fmtMoney(paid) };
}

/**
 * Valor livre do pagamento: o Admin digita quanto o cliente já pagou e tem
 * atalhos de um toque. Mostra a barra "pago de total" e quanto falta.
 */
export function PayAmount({
  value,
  onChange,
  total,
  base = 0,
  pct = 50,
  busy,
  items,
  paidKeys,
  onPaidKeys,
}: {
  value: PayDraft;
  onChange: (v: PayDraft) => void;
  total: number;
  /** quanto já estava pago (permite "+50") */
  base?: number;
  pct?: number;
  busy?: boolean;
  /** pagamento por perfume: cada item com o valor dele */
  items?: PayItem[];
  paidKeys?: Set<string>;
  onPaidKeys?: (keys: Set<string>) => void;
}) {
  const paid = resolvePaid(value, total, base, pct);
  const shown = paid ?? 0;
  const due = r2(Math.max(0, total - shown));
  const ratio = total > 0 ? Math.min(1, shown / total) : 0;
  const full = total > 0 && due <= 0.009;
  const text = value.mode === "value" ? value.text : value.mode === "none" ? "" : fmtMoney(shown);
  const chips: Array<{ v: PayDraft["mode"]; label: string; amount: number }> = [
    { v: "none", label: "Nada ainda", amount: 0 },
    { v: "half", label: pct === 50 ? "Metade" : `Sinal ${pct}%`, amount: r2((total * pct) / 100) },
    { v: "all", label: "Tudo", amount: total },
  ];
  return (
    <div className={cn("rounded-[22px] bg-[#1F1F1F] p-3.5", busy && "pointer-events-none opacity-70")}>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[13px] font-semibold text-[#A9A9A9]">Quanto o cliente já pagou?</p>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold",
            full ? "bg-[#1C2A21] text-[#7FCF9F]" : shown > 0 ? "bg-[#2A2418] text-[#FFD599]" : "bg-[#2A1A18] text-[#FF9A8A]",
          )}
        >
          {paid == null ? "Valor inválido" : full ? "Pago" : shown > 0 ? `Falta ${brl(due)}` : "Não pagou"}
        </span>
      </div>
      <label className="mt-1.5 flex items-baseline gap-1.5 rounded-[16px] px-0.5 focus-within:ring-0">
        <span className="text-[18px] font-bold text-[#8C8C8C]">R$</span>
        <input
          data-slot="input-group-control"
          inputMode="decimal"
          value={text}
          placeholder="0"
          aria-label="Quanto o cliente já pagou, em reais"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange({ mode: "value", text: e.target.value.replace(/[^\d,.+]/g, "") })}
          className="min-w-0 flex-1 bg-transparent text-[30px] leading-[1.15] font-bold tracking-[-0.03em] tabular-nums outline-none placeholder:text-[#4A4A4A]"
        />
        <span className="shrink-0 text-[13px] text-[#8C8C8C] tabular-nums">de {brl(total)}</span>
      </label>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#2E2E2E]" aria-hidden>
        <div
          className={cn("h-full rounded-full transition-[width,background-color] duration-500", full ? "bg-[#7FCF9F]" : "bg-[#FFD599]")}
          style={{ width: `${ratio * 100}%`, transitionTimingFunction: "var(--ease-orium)" }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Atalhos de pagamento">
        {chips.map((c) => {
          const on = value.mode === c.v;
          return (
            <button
              key={c.v}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onChange({ mode: c.v, text: "" });
                // "Tudo" marca todos os perfumes como pagos; "Nada ainda" desmarca
                if (items?.length && onPaidKeys && (c.v === "all" || c.v === "none")) {
                  onPaidKeys(new Set(c.v === "all" ? items.map((i) => i.key) : []));
                }
              }}
              className={cn(
                "press flex h-[54px] flex-col items-center justify-center rounded-[16px] leading-tight transition-colors duration-200",
                on ? "bg-white text-[#15130F]" : "bg-[#2A2A2A] text-white hover:bg-[#333]",
              )}
            >
              <span className="text-[13px] font-bold">{c.label}</span>
              <span className={cn("text-[11.5px] tabular-nums", on ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>{brl(c.amount)}</span>
            </button>
          );
        })}
      </div>
      {items && items.length > 1 && paidKeys && onPaidKeys ? (
        <PaidByItem
          items={items}
          paidKeys={paidKeys}
          onToggle={(key) => {
            const next = new Set(paidKeys);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            onPaidKeys(next);
            // o valor pago passa a ser a soma dos perfumes marcados (todos = total, com frete)
            const sum = r2(items.filter((i) => next.has(i.key)).reduce((t, i) => t + i.amount, 0));
            if (next.size === items.length) onChange({ mode: "all", text: "" });
            else if (sum <= 0) onChange({ mode: "none", text: "" });
            else onChange({ mode: "value", text: fmtMoney(sum) });
          }}
        />
      ) : null}
      {base > 0 && base < total ? (
        <p className="mt-2 px-0.5 text-[12px] text-[#8C8C8C]">
          Já tinha pago {brl(base)}. Recebeu mais? Digite <b className="text-white">+50</b> para somar.
        </p>
      ) : null}
    </div>
  );
}

export type PayItem = { key: string; name: string; detail: string; amount: number };

/** "Pagou quais?": um toque por perfume; o valor pago acompanha. */
function PaidByItem({ items, paidKeys, onToggle }: { items: PayItem[]; paidKeys: Set<string>; onToggle: (key: string) => void }) {
  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <p className="px-0.5 text-[13px] font-semibold text-[#A9A9A9]">Pagou quais perfumes?</p>
      <ul className="ui-cascade mt-1.5 space-y-1.5">
        {items.map((it, i) => {
          const on = paidKeys.has(it.key);
          return (
            <li key={it.key} style={{ ["--i" as string]: i }}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(it.key)}
                className={cn(
                  "press flex min-h-12 w-full items-center gap-3 rounded-[16px] px-3 py-2 text-left transition-colors",
                  on ? "bg-[#1C2A21]" : "bg-[#2A2A2A] hover:bg-[#333]",
                )}
              >
                <span
                  data-on={on}
                  className={cn(
                    "ui-check grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors duration-300",
                    on ? "border-[#7FCF9F] bg-[#7FCF9F] text-[#15130F]" : "border-[#5A5A5A]",
                  )}
                >
                  {on ? <Check className="size-3.5" strokeWidth={3.2} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{it.name}</span>
                  <span className="block truncate text-[12px] text-[#8C8C8C]">{it.detail}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[14px] font-bold tabular-nums">{brl(it.amount)}</span>
                  <span className={cn("block text-[11.5px] font-semibold", on ? "text-[#7FCF9F]" : "text-[#FF9A8A]")}>{on ? "Pago" : "Falta"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Pagamento do pedido, gravando direto (painel do pedido). */
export function PaymentControl({ order, onChanged, lines }: { order: any; onChanged: () => void; lines?: any[] }) {
  const set = useServerFn(setOrderPayment);
  const items: PayItem[] = (lines ?? []).map((l) => ({
    key: l.id,
    name: l.product_name_snapshot ?? "Perfume",
    detail: `${l.quantity}× ${l.variant === "DECANT" ? `decant ${l.decant_ml ?? "?"}ml` : (l.variant_label ?? "frasco")}`,
    amount: r2(Number(l.subtotal ?? Number(l.unit_sale_price ?? 0) * Number(l.quantity ?? 1))),
  }));
  const savedKeys = (lines ?? []).filter((l) => l.paid).map((l) => l.id as string).sort().join(",");
  const [paidKeys, setPaidKeys] = useState<Set<string>>(() => new Set(savedKeys ? savedKeys.split(",") : []));
  useEffect(() => setPaidKeys(new Set(savedKeys ? savedKeys.split(",") : [])), [savedKeys]);
  const keysDirty = [...paidKeys].sort().join(",") !== savedKeys;
  const setDue = useServerFn(setPaymentDueDate);
  const p = paymentInfo(order);
  const [draft, setDraft] = useState<PayDraft>(() => draftFrom(p.paid, p.total, p.pct));
  const [busy, setBusy] = useState(false);
  const [due, setDueLocal] = useState<string | null>(order.payment_due_date ?? null);
  const [savingDue, setSavingDue] = useState(false);
  useEffect(() => setDraft(draftFrom(p.paid, p.total, p.pct)), [p.paid, p.total, p.pct]);
  useEffect(() => setDueLocal(order.payment_due_date ?? null), [order.payment_due_date]);
  const info = dueInfo({ ...order, payment_due_date: due });
  const next = resolvePaid(draft, p.total, p.paid, p.pct);
  const delta = next == null ? 0 : r2(next - p.paid);
  const dirty = next != null && (Math.abs(delta) >= 0.01 || keysDirty);

  const save = async () => {
    if (busy || next == null || !dirty) return;
    setBusy(true);
    try {
      await set({ data: { orderId: order.id, mode: "amount", amount: next, ...(items.length > 1 ? { paidItemIds: [...paidKeys] } : {}) } });
      toast.success(
        next >= p.total
          ? "Pago! Pedido quitado."
          : delta > 0
            ? `Recebido ${brl(delta)}. Falta ${brl(p.total - next)}.`
            : Math.abs(delta) < 0.01
              ? "Perfumes pagos atualizados."
              : `Pagamento ajustado para ${brl(next)}.`,
      );
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível atualizar o pagamento.");
    } finally {
      setBusy(false);
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
      <PayAmount
        value={draft}
        onChange={setDraft}
        total={p.total}
        base={p.paid}
        pct={p.pct}
        busy={busy}
        items={items}
        paidKeys={paidKeys}
        onPaidKeys={setPaidKeys}
      />
      <Collapse open={dirty}>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(draftFrom(p.paid, p.total, p.pct));
              setPaidKeys(new Set(savedKeys ? savedKeys.split(",") : []));
            }}
            className="press h-12 rounded-full bg-[#1F1F1F] px-4 text-[14px] font-bold text-[#A9A9A9]"
          >
            Desfazer
          </button>
          <button type="button" onClick={save} className="press flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white px-5 text-[14.5px] font-bold text-[#15130F]">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" strokeWidth={3} />}
            {Math.abs(delta) < 0.01 ? "Salvar perfumes pagos" : delta > 0 ? `Registrar +${brl(delta)}` : `Corrigir para ${brl(next ?? 0)}`}
          </button>
        </div>
      </Collapse>

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
