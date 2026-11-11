import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { shipmentFreight } from "@/lib/supplier-hub.functions";
import { brl } from "@/lib/format";

const METHODS = [["units", "Unidades"], ["value", "Valor"], ["weight", "Peso"]] as const;

/** Frete da remessa de um fornecedor na Reposição: uma cotação para o grupo, rateada entre os itens. */
export function ShipmentFreight({ supplierId, lines }: { supplierId: string; lines: Array<{ key: string; qty: number; unit: number }> }) {
  const fn = useServerFn(shipmentFreight);
  const [method, setMethod] = useState<"units" | "value" | "weight">("units");
  const [live, setLive] = useState(false);
  const sig = lines.map((l) => `${l.key}:${l.qty}:${l.unit}`).join("|");
  const q = useQuery({
    queryKey: ["shipment-freight", supplierId, sig, method, live],
    queryFn: () => fn({ data: { supplierId, lines, method, live } }),
    staleTime: 60_000,
  });
  const d = q.data;
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit, 0);
  return (
    <div className="space-y-1.5 border-t border-border/50 px-4 py-3 text-xs">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-muted-foreground">{q.isLoading ? "Calculando frete…" : d?.label ?? "Frete a consultar"}</p>
        <button type="button" disabled={q.isFetching} onClick={() => (live ? q.refetch() : setLive(true))} className="inline-flex h-9 items-center gap-1 rounded-full border border-border/60 px-3">
          <Truck className="size-3.5" /> Calcular frete da remessa
        </button>
      </div>
      {d?.liveError ? <p className="text-destructive">{d.liveError}</p> : null}
      {d?.amount != null ? (
        <>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Rateio:</span>
            {METHODS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setMethod(k)} className={`h-7 rounded-full border px-2 ${method === k ? "border-primary bg-primary/15" : "border-border/60 text-muted-foreground"}`}>{l}</button>
            ))}
          </div>
          <p className="tabular-nums">
            Produtos {brl(subtotal)} + frete {brl(d.amount)} = <b>{brl(subtotal + d.amount)}</b> · rateado {d.methodLabel}
            {d.method !== method ? " (peso indisponível em algum item)" : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
