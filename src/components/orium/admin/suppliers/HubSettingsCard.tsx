import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminSecondaryAction } from "@/components/orium/admin/AdminUI";
import { getHubSettings, updateHubSettings } from "@/lib/supplier-hub.functions";

/** CEP onde a Orium recebe mercadorias + margem mínima geral (aviso, nunca bloqueio automático). */
export function HubSettingsCard() {
  const get = useServerFn(getHubSettings);
  const save = useServerFn(updateHubSettings);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["hub-settings"], queryFn: () => get() });
  const [cep, setCep] = useState("");
  const [margin, setMargin] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setCep(q.data.receivingCep ?? "");
    setMargin(q.data.minMarginPct != null ? String(q.data.minMarginPct) : "");
  }, [q.data]);

  const submit = async () => {
    setBusy(true);
    try {
      await save({ data: { receivingCep: cep || null, minMarginPct: margin === "" ? null : Number(margin.replace(",", ".")) } });
      toast.success("Configurações salvas.");
      qc.invalidateQueries({ queryKey: ["hub-settings"] });
      qc.invalidateQueries({ queryKey: ["offer-compare"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl border border-border/60 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <div className="min-w-0 space-y-1.5">
        <Label className="text-xs">CEP de recebimento da Orium</Label>
        <Input inputMode="numeric" placeholder={q.data?.storeCep ? `Vazio = ${q.data.storeCep}` : "00000-000"} value={cep} onChange={(e) => setCep(e.target.value.replace(/\D/g, "").slice(0, 8))} />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label className="text-xs">Margem mínima desejada (%)</Label>
        <Input inputMode="decimal" placeholder="ex.: 25" value={margin} onChange={(e) => setMargin(e.target.value.replace(/[^\d.,]/g, ""))} />
      </div>
      <AdminSecondaryAction loading={busy} onClick={submit}>Salvar</AdminSecondaryAction>
    </div>
  );
}
