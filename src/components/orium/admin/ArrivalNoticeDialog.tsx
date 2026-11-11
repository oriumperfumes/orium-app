import { useEffect, useMemo, useState } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { productTitle } from "@/lib/format";
import { buildArrivalMessage } from "@/lib/arrival-message";
import { fmtDeliveryDate } from "@/lib/delivery";

type Line = { id: string; product_name_snapshot: string };

/** Avisar o cliente que a encomenda chegou — texto editável antes de abrir o WhatsApp. */
export function ArrivalNoticeDialog({
  open,
  onOpenChange,
  order,
  lines,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: any;
  lines: Line[];
}) {
  const [arrivedIds, setArrivedIds] = useState<string[]>([]);
  const [delivery, setDelivery] = useState(false);
  const [variation, setVariation] = useState(0);
  const [text, setText] = useState("");
  const [withDate, setWithDate] = useState(false);
  const hasDate = !!order?.expected_delivery_date;

  useEffect(() => {
    if (!open) return;
    setArrivedIds(lines.map((l) => l.id));
    setDelivery(!!order?.fulfillment_type && order.fulfillment_type !== "PICKUP");
    setVariation(0);
    setWithDate(!!order?.expected_delivery_date);
  }, [open, lines, order?.fulfillment_type]);

  const generated = useMemo(() => {
    const arrived = lines.filter((l) => arrivedIds.includes(l.id)).map((l) => l.product_name_snapshot);
    return buildArrivalMessage(
      {
        customerName: order?.customer_name,
        arrived,
        pendingCount: lines.length - arrived.length,
        delivery,
        seed: order?.id,
        scheduledDate: withDate ? order?.expected_delivery_date : null,
        scheduledTime: withDate ? order?.expected_delivery_time : null,
      },
      variation,
    );
  }, [lines, arrivedIds, delivery, variation, order?.customer_name, order?.id, withDate, order?.expected_delivery_date, order?.expected_delivery_time]);

  useEffect(() => setText(generated), [generated]);

  const digits = (order?.customer_phone ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const canSend = digits.length >= 10 && arrivedIds.length > 0 && text.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-32px)] max-w-lg overflow-y-auto rounded-[24px] p-5">
        <DialogHeader className="text-left">
          <DialogTitle>Avisar que chegou</DialogTitle>
          <DialogDescription>Revise a mensagem antes de abrir o WhatsApp.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            {[
              { v: false, l: "Retirada" },
              { v: true, l: "Entrega" },
            ].map((o) => (
              <Button
                key={o.l}
                type="button"
                size="sm"
                variant={delivery === o.v ? "default" : "outline"}
                className="flex-1 rounded-full"
                onClick={() => setDelivery(o.v)}
              >
                {o.l}
              </Button>
            ))}
          </div>

          {lines.length > 1 ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">O que chegou?</p>
              {lines.map((l) => (
                <label key={l.id} className="flex items-center gap-3 text-sm">
                  <Checkbox
                    checked={arrivedIds.includes(l.id)}
                    onCheckedChange={(v) =>
                      setArrivedIds((ids) => (v ? [...ids, l.id] : ids.filter((i) => i !== l.id)))
                    }
                  />
                  <span className="truncate">{productTitle(l.product_name_snapshot)}</span>
                </label>
              ))}
            </div>
          ) : null}

          {hasDate ? (
            <label className="flex items-center gap-3 text-sm">
              <Checkbox checked={withDate} onCheckedChange={(v) => setWithDate(!!v)} />
              <span>Incluir a data combinada ({fmtDeliveryDate(order.expected_delivery_date)})</span>
            </label>
          ) : null}

          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="text-base" />

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setVariation((v) => v + 1)}>
              <RefreshCw className="size-4" /> Outra versão
            </Button>
            <Button
              type="button"
              className="flex-1 rounded-full"
              disabled={!canSend}
              onClick={() => {
                window.open(`https://wa.me/55${digits}?text=${encodeURIComponent(text.trim())}`, "_blank", "noreferrer");
                onOpenChange(false);
              }}
            >
              <MessageCircle className="size-4" /> Abrir WhatsApp
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
