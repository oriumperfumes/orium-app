import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { relativeTime } from "@/lib/format";
import { purchaseSettingsGet, purchaseSettingsSave, supplierManualImport, supplierProfileSave } from "@/lib/purchase.functions";

export const Route = createFileRoute("/_authenticated/admin/fornecedores-rota")({
  head: () => ({
    meta: [
      { title: "Fornecedores e rota — Orium Admin" },
      { name: "description", content: "Endereços de retirada, local de saída e custo de deslocamento." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

function Page() {
  const get = useServerFn(purchaseSettingsGet);
  const { data, refetch } = useQuery({ queryKey: ["purchase-settings"], queryFn: () => get() });
  return (
    <AdminShell title="Fornecedores e rota" description="Endereços reais para calcular a rota de carro. Sem endereço, a rota não é inventada.">
      {data ? (
        <div className="space-y-5">
          <Origin s={data.settings} onSaved={refetch} />
          {data.suppliers.map((s: any) => (
            <SupplierCard key={s.id} s={s} onSaved={refetch} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
    </AdminShell>
  );
}

function Origin({ s, onSaved }: { s: any; onSaved: () => void }) {
  const save = useServerFn(purchaseSettingsSave);
  const [addr, setAddr] = useState(s?.origin_address ?? "");
  const [ret, setRet] = useState<boolean>(s?.return_to_origin ?? true);
  const [km, setKm] = useState(s?.cost_per_km?.toString() ?? "");
  const [kml, setKml] = useState(s?.fuel_km_per_liter?.toString() ?? "");
  const [fuel, setFuel] = useState(s?.fuel_price?.toString() ?? "");
  return (
    <section className="rounded-3xl border border-border/60 p-4 sm:p-5">
      <p className="font-medium">Local de saída</p>
      <p className="text-xs text-muted-foreground">Padrão: endereço da loja Orium (do frete) quando vazio.</p>
      <Input className="mt-3 text-base" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Rua, número, bairro, cidade" />
      <label className="mt-3 flex items-center gap-2 text-sm">
        <Switch checked={ret} onCheckedChange={setRet} /> Retornar à Orium no final
      </label>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input className="text-base" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="Custo por km (R$)" />
        <Input className="text-base" inputMode="decimal" value={kml} onChange={(e) => setKml(e.target.value)} placeholder="Consumo (km/l)" />
        <Input className="text-base" inputMode="decimal" value={fuel} onChange={(e) => setFuel(e.target.value)} placeholder="Combustível (R$/l)" />
      </div>
      <Button
        className="press mt-3 rounded-full"
        onClick={async () => {
          await save({ data: { origin_address: addr.trim() || null, return_to_origin: ret, cost_per_km: n(km), fuel_km_per_liter: n(kml), fuel_price: n(fuel) } });
          toast.success("Local de saída salvo.");
          onSaved();
        }}
      >
        Salvar
      </Button>
    </section>
  );
}

function SupplierCard({ s, onSaved }: { s: any; onSaved: () => void }) {
  const save = useServerFn(supplierProfileSave);
  const importFn = useServerFn(supplierManualImport);
  const qc = useQueryClient();
  const [f, setF] = useState({ pickup_address: s.pickup_address ?? "", phone: s.phone ?? "", opening_hours: s.opening_hours ?? "", notes: s.notes ?? "", allows_pickup: s.allows_pickup !== false });
  const [manual, setManual] = useState(false);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setF((x) => ({ ...x, pickup_address: s.pickup_address ?? "" })), [s.pickup_address]);
  const failed = s.sync_status === "erro" || s.sync_status === "bloqueado";
  const st = s.ingestion_stats as any;
  return (
    <section className="min-w-0 rounded-3xl border border-border/60 p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-xl">{s.name}</p>
        <p className={failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {s.update_mode === "manual" ? "Atualização manual" : "Sincronização automática"} ·{" "}
          {failed ? "última leitura falhou" : `atualizado ${relativeTime(s.last_successful_sync_at)}`} · {s.last_catalog_size ?? 0} produtos
        </p>
      </div>
      {failed && s.sync_message ? <p className="mt-1 break-words text-xs text-muted-foreground">{s.sync_message}</p> : null}
      {st ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Última importação: {st.lidos ?? st.coletados ?? 0} lidos · {st.associados ?? 0} associados · {st.revisar ?? 0} para revisar · {st.ignorados ?? 0} ignorados
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input className="text-base sm:col-span-2" value={f.pickup_address} onChange={(e) => setF({ ...f, pickup_address: e.target.value })} placeholder="Endereço de retirada" />
        <Input className="text-base" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Telefone" />
        <Input className="text-base" value={f.opening_hours} onChange={(e) => setF({ ...f, opening_hours: e.target.value })} placeholder="Horário" />
        <Input className="text-base sm:col-span-2" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Observações" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {s.latitude != null ? `Localizado no mapa (${Number(s.latitude).toFixed(4)}, ${Number(s.longitude).toFixed(4)})` : "Ainda não localizado no mapa"}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.allows_pickup} onCheckedChange={(v) => setF({ ...f, allows_pickup: v })} /> Permite retirada
        </label>
        <Button
          className="press rounded-full"
          onClick={async () => {
            const r = await save({ data: { id: s.id, pickup_address: f.pickup_address.trim() || null, phone: f.phone.trim() || null, opening_hours: f.opening_hours.trim() || null, notes: f.notes.trim() || null, allows_pickup: f.allows_pickup } });
            toast.success(r.geocoded === false ? "Salvo, mas não consegui localizar o endereço no mapa." : "Fornecedor salvo.");
            onSaved();
          }}
        >
          Salvar
        </Button>
        <Button variant="ghost" className="rounded-full" onClick={() => setManual((v) => !v)}>
          Atualização manual
        </Button>
      </div>
      {manual ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">Cole uma linha por produto: <code>Nome ; preço ; disponível</code> (ex.: Hawas Black ; 219,90 ; sim). O preço é gravado exatamente como informado.</p>
          <Textarea className="min-h-40 text-base" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <Button
            className="press rounded-full"
            disabled={busy || paste.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await importFn({ data: { supplier_id: s.id, text: paste } });
                toast.success(`${r.lidos} lidos · ${r.associados} associados · ${r.revisar} para revisar`);
                if (r.review.length) toast.info(`Sem correspondência segura: ${r.review.slice(0, 5).join(", ")}${r.review.length > 5 ? "…" : ""}`);
                setPaste("");
                qc.invalidateQueries({ queryKey: ["admin-suppliers"] });
                onSaved();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Falha na importação.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Importando…" : "Importar lista"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
