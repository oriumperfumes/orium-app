import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdminEmpty, AdminRowsSkeleton } from "@/components/orium/admin/AdminUI";
import { ItemThumb } from "@/components/orium/admin/OrderItems";
import { orderRestockPreview, sendOrderItemsToRestock } from "@/lib/orders.functions";

/* ------------------------------------------------------------------ *
 * Envio do pedido para a reposição, direto do pedido.
 *
 * Regras respeitadas (não mudam nada no servidor):
 * - decant sai do frasco já aberto: nada é sugerido automaticamente,
 *   apenas o consumo em ml é mostrado ("2x 5ml = 10ml do frasco");
 * - item já enviado aparece como "Já enviado" e não pode duplicar;
 * - a confirmação agrupa por fornecedor vencedor antes de concluir.
 * ------------------------------------------------------------------ */

type PreviewItem = {
  orderItemId: string;
  productId: string | null;
  name: string;
  image: string | null;
  variant: string;
  variantLabel: string | null;
  decantMl: number | null;
  quantity: number;
  mlUsed: number | null;
  supplierId: string | null;
  supplierName: string;
  unitCost: number;
  sentQuantity: number;
  suggested: number;
};

export function OrderRestockSheet({
  orderId,
  orderNumber,
  onClose,
}: {
  orderId: string | null;
  orderNumber?: string | number | null | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const preview = useServerFn(orderRestockPreview);
  const send = useServerFn(sendOrderItemsToRestock);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [saving, setSaving] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["order-restock-preview", orderId],
    enabled: !!orderId,
    queryFn: async () => (await preview({ data: { orderId: orderId! } })) as { items: PreviewItem[] },
  });

  const items = data?.items ?? [];

  useEffect(() => {
    if (!items.length) return;
    setQty(Object.fromEntries(items.map((i) => [i.orderItemId, Math.max(1, i.suggested || 1)])));
    setPicked(Object.fromEntries(items.map((i) => [i.orderItemId, i.sentQuantity === 0 && i.suggested > 0])));
    setStep("pick");
  }, [data]);

  const chosen = useMemo(
    () => items.filter((i) => i.sentQuantity === 0 && picked[i.orderItemId] && (qty[i.orderItemId] ?? 0) > 0),
    [items, picked, qty],
  );

  const bySupplier = useMemo(() => {
    const map = new Map<string, PreviewItem[]>();
    chosen.forEach((i) => map.set(i.supplierName, [...(map.get(i.supplierName) ?? []), i]));
    return [...map.entries()];
  }, [chosen]);

  const submit = async () => {
    setSaving(true);
    try {
      const res: any = await send({
        data: {
          orderId: orderId!,
          items: chosen.map((i) => ({ orderItemId: i.orderItemId, quantity: qty[i.orderItemId] ?? 1 })),
        },
      });
      if (res?.created > 0) toast.success(`${res.created} ${res.created === 1 ? "item" : "itens"} na reposição.`);
      if (res?.alreadySent > 0) toast.info("Alguns itens já estavam na reposição.");
      (res?.warnings ?? []).forEach((w: string) => toast.warning(w));
      qc.invalidateQueries({ queryKey: ["orders-central"] });
      qc.invalidateQueries({ queryKey: ["admin-restock"] });
      qc.invalidateQueries({ queryKey: ["order-restock-preview", orderId] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível enviar para a reposição.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={!!orderId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[88vh] overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
      >
        <SheetHeader className="px-0 text-left">
          <SheetTitle className="text-base">
            {step === "pick" ? "Enviar para reposição" : "Enviar para reposição?"}
          </SheetTitle>
          <SheetDescription>
            {step === "pick"
              ? `Escolha o que precisa comprar do pedido #${orderNumber ?? "—"}.`
              : "Confira o agrupamento por fornecedor antes de concluir."}
          </SheetDescription>
        </SheetHeader>

        {isPending ? (
          <div className="mt-3">
            <AdminRowsSkeleton rows={3} height={64} />
          </div>
        ) : items.length === 0 ? (
          <div className="mt-3">
            <AdminEmpty>Este pedido não tem itens.</AdminEmpty>
          </div>
        ) : step === "pick" ? (
          <div className="mt-3 space-y-2">
            {items.map((i) => {
              const sent = i.sentQuantity > 0;
              const on = !sent && !!picked[i.orderItemId];
              return (
                <div
                  key={i.orderItemId}
                  className={cn(
                    "flex min-w-0 items-center gap-3 rounded-2xl border p-3 transition-colors duration-150",
                    sent ? "border-border/50 opacity-60" : on ? "border-gold/40 bg-gold/5" : "border-border/60",
                  )}
                >
                  <button
                    type="button"
                    disabled={sent}
                    onClick={() => setPicked((p) => ({ ...p, [i.orderItemId]: !p[i.orderItemId] }))}
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-md border",
                      on ? "border-gold bg-gold text-background" : "border-border/70",
                    )}
                    aria-label={on ? "Remover item" : "Incluir item"}
                  >
                    {on ? <Check className="size-4" strokeWidth={2.5} /> : null}
                  </button>

                  <ItemThumb src={i.image} alt={i.name} size={44} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{productTitle(i.name)}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {i.variant === "DECANT"
                        ? `${i.quantity}x decant ${i.decantMl}ml = ${i.mlUsed}ml do frasco`
                        : `${i.quantity}x frasco · ${i.supplierName}`}
                    </p>
                    {sent ? <p className="mt-0.5 text-xs text-success">Já enviado ({i.sentQuantity})</p> : null}
                  </div>

                  {!sent ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="press grid size-8 place-items-center rounded-full border border-border/60"
                        onClick={() =>
                          setQty((q) => ({ ...q, [i.orderItemId]: Math.max(1, (q[i.orderItemId] ?? 1) - 1) }))
                        }
                        aria-label="Menos"
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm tabular-nums">{qty[i.orderItemId] ?? 1}</span>
                      <button
                        type="button"
                        className="press grid size-8 place-items-center rounded-full border border-border/60"
                        onClick={() => setQty((q) => ({ ...q, [i.orderItemId]: (q[i.orderItemId] ?? 1) + 1 }))}
                        aria-label="Mais"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}

            <p className="pt-1 text-xs text-muted-foreground">
              Decants saem do frasco já aberto — só marque se precisar comprar um frasco novo.
            </p>

            <Button
              className="press mt-2 h-11 w-full rounded-full"
              disabled={chosen.length === 0}
              onClick={() => setStep("confirm")}
            >
              Continuar ({chosen.length})
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {bySupplier.map(([supplier, list]) => (
              <div key={supplier} className="rounded-2xl border border-border/60 p-3">
                <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  {supplier}
                </p>
                <ul className="mt-2 space-y-1">
                  {list.map((i) => (
                    <li key={i.orderItemId} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{productTitle(i.name)}</span>
                      <span className="shrink-0 tabular-nums">
                        {qty[i.orderItemId] ?? 1} · {brl(i.unitCost * (qty[i.orderItemId] ?? 1))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="flex gap-2">
              <Button variant="outline" className="press h-11 flex-1 rounded-full" onClick={() => setStep("pick")}>
                Voltar
              </Button>
              <Button className="press h-11 flex-1 rounded-full" disabled={saving} onClick={submit}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : "Enviar"}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
