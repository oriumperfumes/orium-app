import { useEffect, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { setOrderDelivery } from "@/lib/orders.functions";
import {
  DELIVERY_CLASS,
  DELIVERY_LABEL,
  deliveryState,
  fmtDeliveryDate,
  fmtTime,
  todayBR,
  weekdayName,
} from "@/lib/delivery";

export type DeliveryValue = { type: "PICKUP" | "LOCAL"; date: string; time: string; notes: string };
export const EMPTY_DELIVERY: DeliveryValue = { type: "PICKUP", date: "", time: "", notes: "" };

/** Campos de entrega (tipo, data, horário, observações) — usados em criar e editar. */
export function DeliveryFields({
  value,
  onChange,
  showType = true,
}: {
  value: DeliveryValue;
  onChange: (v: DeliveryValue) => void;
  showType?: boolean;
}) {
  const set = (p: Partial<DeliveryValue>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-3">
      {showType ? (
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["PICKUP", "Retirada na loja"],
              ["LOCAL", "Entrega ao cliente"],
            ] as const
          ).map(([k, l]) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={value.type === k ? "default" : "outline"}
              className="h-10 rounded-full"
              onClick={() => set({ type: k })}
            >
              {l}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">Data prevista</Label>
          <Input
            type="date"
            value={value.date}
            onChange={(e) => set({ date: e.target.value, ...(e.target.value ? {} : { time: "" }) })}
            className="h-11 rounded-xl text-base [color-scheme:dark]"
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">Horário (opcional)</Label>
          <Input
            type="time"
            value={value.time}
            disabled={!value.date}
            onChange={(e) => set({ time: e.target.value })}
            className="h-11 rounded-xl text-base [color-scheme:dark]"
          />
        </div>
      </div>
      {value.date ? (
        <p className="text-[12px] text-muted-foreground capitalize">
          {weekdayName(value.date)}, {fmtDeliveryDate(value.date)}
          {value.date === todayBR() ? " · hoje" : value.date === todayBR(1) ? " · amanhã" : ""}
        </p>
      ) : null}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Observações (opcional)</Label>
        <Textarea
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Informações sobre a entrega"
          rows={2}
          className="rounded-xl text-base"
        />
      </div>
    </div>
  );
}

/** Linha compacta para o card: "📅 Entrega prevista: 15/10/2026" + indicador. */
export function DeliveryLine({ order, className }: { order: any; className?: string }) {
  const st = deliveryState(order);
  if (st === "none") return null;
  if (st === "done")
    return order.delivered_at ? (
      <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <CalendarDays className="size-3.5" /> Entregue em {fmtDeliveryDate(toBRDate(order.delivered_at))}
      </p>
    ) : null;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2 text-xs", className)}>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <CalendarDays className="size-3.5" />
        Entrega prevista: {fmtDeliveryDate(order.expected_delivery_date)}
        {order.expected_delivery_time ? ` · ${fmtTime(order.expected_delivery_time)}` : ""}
      </span>
      <DeliveryBadge order={order} />
    </div>
  );
}

export function DeliveryBadge({ order }: { order: any }) {
  const st = deliveryState(order);
  if (st === "none") return null;
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10.5px] font-medium", DELIVERY_CLASS[st])}>
      {DELIVERY_LABEL[st]}
    </span>
  );
}

export function toBRDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

export function deliveryEventLabel(event: string, details: any): string | null {
  const f = (d?: string | null, t?: string | null) => (d ? `${fmtDeliveryDate(d)}${t ? ` ${t}` : ""}` : "sem data");
  if (event === "entrega_agendada") return `Entrega agendada para ${f(details?.after, details?.after_time)}`;
  if (event === "entrega_reagendada")
    return `Entrega reagendada: ${f(details?.before, details?.before_time)} → ${f(details?.after, details?.after_time)}`;
  if (event === "entrega_sem_data") return `Previsão de entrega removida (era ${f(details?.before, details?.before_time)})`;
  return null;
}

/** Editor no detalhe do pedido: previsão, reagendamento e data efetiva. */
export function DeliveryEditor({ order, onChanged }: { order: any; onChanged: () => void }) {
  const save = useServerFn(setOrderDelivery);
  const initial = (): DeliveryValue => ({
    type: order.fulfillment_type === "PICKUP" || !order.fulfillment_type ? "PICKUP" : "LOCAL",
    date: order.expected_delivery_date?.slice(0, 10) ?? "",
    time: fmtTime(order.expected_delivery_time),
    notes: order.delivery_notes ?? "",
  });
  const [v, setV] = useState<DeliveryValue>(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setV(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, order.expected_delivery_date, order.expected_delivery_time, order.delivery_notes, order.fulfillment_type, editing]);

  const isShipping = order.fulfillment_type === "SHIPPING";
  const submit = async () => {
    setBusy(true);
    try {
      await save({
        data: {
          orderId: order.id,
          date: v.date || null,
          time: v.time || null,
          notes: v.notes,
          ...(isShipping ? {} : { fulfillmentType: v.type }),
        },
      });
      toast.success(v.date ? "Previsão de entrega salva." : "Entrega sem data definida.");
      setEditing(false);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar a entrega.");
    } finally {
      setBusy(false);
    }
  };

  if (!editing)
    return (
      <div className="space-y-2">
        {order.expected_delivery_date ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <CalendarDays className="size-4 text-muted-foreground" />
            <span className="capitalize">
              {weekdayName(order.expected_delivery_date.slice(0, 10))}, {fmtDeliveryDate(order.expected_delivery_date)}
              {order.expected_delivery_time ? ` · ${fmtTime(order.expected_delivery_time)}` : ""}
            </span>
            <DeliveryBadge order={order} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sem data prevista.</p>
        )}
        {order.delivered_at ? (
          <p className="text-sm text-muted-foreground">
            Entregue de fato em {new Date(order.delivered_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
          </p>
        ) : null}
        {order.delivery_notes ? <p className="text-sm whitespace-pre-line text-muted-foreground">{order.delivery_notes}</p> : null}
        {order.status !== "cancelado" && !order.deleted_at ? (
          <Button size="sm" variant="outline" className="h-9 rounded-full" onClick={() => setEditing(true)}>
            <CalendarDays className="size-4" /> {order.expected_delivery_date ? "Reagendar" : "Definir data"}
          </Button>
        ) : null}
      </div>
    );

  return (
    <div className="space-y-3">
      {order.expected_delivery_date ? (
        <p className="text-xs text-muted-foreground">Data anterior: {fmtDeliveryDate(order.expected_delivery_date)}</p>
      ) : null}
      <DeliveryFields value={v} onChange={setV} showType={!isShipping} />
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" className="h-10 rounded-full" onClick={() => setEditing(false)} disabled={busy}>
          Voltar
        </Button>
        <Button size="sm" className="h-10 rounded-full" onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
