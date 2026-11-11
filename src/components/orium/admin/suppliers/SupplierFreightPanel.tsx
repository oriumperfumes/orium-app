import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminSecondaryAction } from "@/components/orium/admin/AdminUI";
import { listFreightQuotes, quoteSupplierFreight, saveFreightQuote } from "@/lib/supplier-hub.functions";
import { brl, dateBR } from "@/lib/format";

const fmtCep = (c?: string | null) => (c && c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : "—");
const fmtDate = (iso: string) => iso.split("-").reverse().join("/");

/** Cotação SuperFrete fornecedor → Orium e registro de cotação do fornecedor. Nada é simulado. */
export function SupplierFreightPanel({ supplier }: { supplier: any }) {
  const quote = useServerFn(quoteSupplierFreight);
  const save = useServerFn(saveFreightQuote);
  const listQ = useServerFn(listFreightQuotes);
  const qc = useQueryClient();
  const [units, setUnits] = useState("1");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [manual, setManual] = useState({ price: "", days: "", units: "", note: "" });

  const quotes = useQuery({ queryKey: ["freight-quotes", supplier.id], queryFn: () => listQ({ data: { supplierId: supplier.id } }) });

  if (supplier.supply_mode === "pickup") {
    return <p className="rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">Retirada própria: sem frete de transportadora. O custo de deslocamento informado entra no custo total.</p>;
  }

  const calc = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await quote({ data: { supplierId: supplier.id, units: Number(units) || 1 } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na cotação.");
    } finally {
      setBusy(false);
    }
  };

  const keep = async (payload: Parameters<typeof save>[0]["data"]) => {
    try {
      await save({ data: payload });
      toast.success("Cotação registrada.");
      qc.invalidateQueries({ queryKey: ["freight-quotes", supplier.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/60 p-3">
      <p className="text-sm font-medium">Frete de abastecimento</p>
      <p className="text-xs text-muted-foreground">Origem {fmtCep(supplier.origin_cep)} → Orium {fmtCep(quotes.data?.destinationCep)}. Independente do frete para clientes.</p>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <div className="space-y-1.5"><Label className="text-xs">Frascos na remessa</Label><Input inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, "").slice(0, 3))} /></div>
        <AdminSecondaryAction loading={busy} icon={<Truck />} onClick={calc}>Calcular frete com SuperFrete</AdminSecondaryAction>
      </div>
      {result && !result.ok ? <p className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{result.message}</p> : null}
      {result?.ok ? (
        <ul className="space-y-1.5">
          <li className="text-[11px] text-muted-foreground">{result.units} frasco(s) · {result.volumes} volume(s) · {result.weightKg} kg</li>
          {result.options.map((o: any) => (
            <li key={o.service} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/60 p-2 text-xs">
              <span className="min-w-0"><span className="block truncate">{o.carrier} · {o.service}</span><span className="text-muted-foreground">{o.days != null ? `${o.days} dia(s) útil(eis) · chegada ~${fmtDate(o.arrival)}` : "prazo não informado"}</span></span>
              <span className="flex shrink-0 items-center gap-2"><b>{brl(o.price)}</b>
                <button type="button" className="rounded-full border border-border/60 px-2 py-1" onClick={() => keep({ supplierId: supplier.id, source: "superfrete", price: o.price, days: o.days, service: o.service, carrier: o.carrier, units: result.units, weightKg: result.weightKg, originCep: result.originCep, destinationCep: result.destinationCep })}>Usar</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Registrar cotação enviada pelo fornecedor</summary>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Input placeholder="R$" inputMode="decimal" value={manual.price} onChange={(e) => setManual({ ...manual, price: e.target.value.replace(",", ".") })} />
          <Input placeholder="Dias úteis" inputMode="numeric" value={manual.days} onChange={(e) => setManual({ ...manual, days: e.target.value.replace(/\D/g, "") })} />
          <Input placeholder="Frascos" inputMode="numeric" value={manual.units} onChange={(e) => setManual({ ...manual, units: e.target.value.replace(/\D/g, "") })} />
          <Input className="col-span-3" placeholder="Observação (opcional)" value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} />
          <AdminSecondaryAction className="col-span-3" disabled={!manual.price} onClick={() => keep({ supplierId: supplier.id, source: "supplier", status: "confirmed", price: Number(manual.price), days: manual.days ? Number(manual.days) : null, units: manual.units ? Number(manual.units) : null, note: manual.note || null })}>Salvar cotação do fornecedor</AdminSecondaryAction>
        </div>
      </details>
      {quotes.data?.quotes.length ? (
        <ul className="divide-y divide-border/60 text-xs">
          {quotes.data.quotes.slice(0, 5).map((q: any) => (
            <li key={q.id} className="py-1.5">{brl(q.price)} · {q.source === "superfrete" ? "SuperFrete" : "Fornecedor"} · {q.status === "confirmed" ? "confirmado" : "estimado"}{q.units ? ` · ${q.units} un.` : ""} · {dateBR(q.created_at)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
