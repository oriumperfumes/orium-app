/**
 * PAGAMENTO DO PEDIDO — independente do status operacional (pendente/pedido feito/entregue).
 * Valores vêm do banco (amount_paid/amount_due/payment_status, recalculados por trigger);
 * aqui só exibimos e pedimos mudanças ao servidor (setOrderPayment).
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import { setOrderPayment, type PaymentMode } from "@/lib/orders.functions";

export type PayStatus = "unpaid" | "partial" | "paid";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function paymentInfo(o: any) {
  const total = r2(Number(o?.final_total ?? o?.grand_total ?? o?.sales_total ?? 0));
  const paid = r2(Number(o?.amount_paid ?? 0));
  const due = r2(Math.max(total - paid, 0));
  const status: PayStatus = paid <= 0 ? "unpaid" : paid >= total ? "paid" : "partial";
  const pct = Number(o?.deposit_percent ?? 50);
  return { total, paid, due, status, pct };
}

export const PAY_FILTERS = [
  { key: "pg_unpaid", label: "Não pagos", test: (o: any) => paymentInfo(o).status === "unpaid" },
  { key: "pg_partial", label: "Sinal pago", test: (o: any) => paymentInfo(o).status === "partial" },
  { key: "pg_paid", label: "Pagos integralmente", test: (o: any) => paymentInfo(o).status === "paid" },
  {
    key: "pg_due",
    label: "Com saldo a receber",
    test: (o: any) => {
      const p = paymentInfo(o);
      return p.paid > 0 && p.due > 0 && o.status !== "cancelado";
    },
  },
] as const;

/** Linha compacta para cards (lista e Dashboard). */
export function PaymentLine({ order, className }: { order: any; className?: string }) {
  const p = paymentInfo(order);
  if (p.status === "paid")
    return (
      <p className={cn("inline-flex items-center gap-1 text-[12.5px] font-medium text-success", className)}>
        <Check className="size-3.5" strokeWidth={2.2} /> Pago integralmente
      </p>
    );
  if (p.status === "unpaid")
    return <p className={cn("text-[12.5px] text-muted-foreground", className)}>Aguardando pagamento</p>;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-[12px] text-muted-foreground">Sinal pago · {brl(p.paid)}</p>
        <p className="text-[10.5px] font-semibold tracking-wide text-warning uppercase">Falta receber</p>
      </div>
      <p className="shrink-0 text-[15px] font-bold text-warning tabular-nums">{brl(p.due)}</p>
    </div>
  );
}

const OPTIONS: Array<{ key: PayStatus; label: string; mode: PaymentMode }> = [
  { key: "unpaid", label: "Não pago", mode: "unpaid" },
  { key: "partial", label: "50% pago", mode: "deposit" },
  { key: "paid", label: "Pago integralmente", mode: "paid" },
];

/** Escolha simples (sem valores) — usada no Novo pedido, antes do total existir. */
export function PaymentChoice({ value, onChange }: { value: PayStatus; onChange: (v: PayStatus) => void }) {
  return (
    <div role="radiogroup" aria-label="Pagamento" className="grid gap-1.5">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "press flex min-h-11 items-center gap-3 rounded-xl border px-3.5 text-left text-sm",
            value === o.key ? "border-gold/60 bg-gold-faint" : "border-border/60",
          )}
        >
          <span
            className={cn(
              "grid size-4 shrink-0 place-items-center rounded-full border",
              value === o.key ? "border-gold" : "border-muted-foreground/50",
            )}
          >
            {value === o.key ? <span className="size-2 rounded-full bg-gold" /> : null}
          </span>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PaymentSummary({ total, paid }: { total: number; paid: number }) {
  const due = r2(Math.max(total - paid, 0));
  return (
    <dl className="grid gap-1 rounded-xl border border-border/60 p-3 text-sm tabular-nums">
      <div className="flex justify-between"><dt className="text-muted-foreground">Total</dt><dd>{brl(total)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted-foreground">Pago</dt><dd>{brl(paid)}</dd></div>
      <div className={cn("flex justify-between font-semibold", due > 0 && paid > 0 && "text-warning")}>
        <dt>Restante</dt><dd>{brl(due)}</dd>
      </div>
    </dl>
  );
}

/** Editor completo — Detalhes e Editar pedido. */
export function PaymentEditor({ order, onChanged }: { order: any; onChanged: () => void }) {
  const set = useServerFn(setOrderPayment);
  const [busy, setBusy] = useState<PaymentMode | null>(null);
  const p = paymentInfo(order);

  const apply = async (mode: PaymentMode) => {
    if (busy) return;
    setBusy(mode);
    try {
      await set({ data: { orderId: order.id, mode } });
      toast.success(mode === "unpaid" ? "Pagamento zerado." : mode === "deposit" ? "Sinal registrado." : "Pagamento concluído.");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível atualizar o pagamento.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <PaymentChoice
        value={p.status}
        onChange={(v) => {
          const opt = OPTIONS.find((o) => o.key === v)!;
          if (v !== p.status) apply(opt.mode);
        }}
      />
      <PaymentSummary total={p.total} paid={p.paid} />
      {p.status === "partial" ? (
        <button
          type="button"
          disabled={!!busy}
          onClick={() => apply("paid")}
          className="press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-gold px-4 text-sm font-semibold text-gold-foreground"
        >
          {busy === "paid" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Marcar restante como pago · {brl(p.due)}
        </button>
      ) : null}
      {busy && busy !== "paid" ? <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" /> : null}
    </div>
  );
}

/** Rótulo legível do histórico de pagamento. */
export function paymentEventLabel(event: string, details: any): string | null {
  if (!event.startsWith("pagamento_")) return null;
  const amt = brl(Math.abs(Number(details?.amount ?? 0)));
  switch (event) {
    case "pagamento_sinal": return `Sinal recebido · ${amt}`;
    case "pagamento_saldo": return `Saldo recebido · ${amt} — pagamento concluído`;
    case "pagamento_integral": return `Pagamento integral recebido · ${amt}`;
    case "pagamento_estornado": return `Pagamento estornado · −${amt}`;
    default: return null;
  }
}
