import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminPrimaryAction, AdminSecondaryAction } from "@/components/orium/admin/AdminUI";
import { supabase } from "@/integrations/supabase/client";
import { updateSupplierSettings } from "@/lib/supplier-hub.functions";
import { testSupplierConnection } from "@/lib/sync.functions";
import { PRIORITY_LABEL, SUPPLY_MODE_LABEL, leadText, type SupplyMode } from "@/lib/supplier-lead";
import { brl, dateBR } from "@/lib/format";
import { SupplierCatalogPanel } from "./SupplierCatalogPanel";
import { SupplierFreightPanel } from "./SupplierFreightPanel";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supplier = any;
const TABS = ["Configurações", "Produtos", "Logística", "Alterações", "Diagnóstico"] as const;

const PERMS: Array<[string, string, string]> = [
  ["use_for_purchasing", "Comprar deste fornecedor", "Entra nas sugestões da Reposição."],
  ["use_for_pricing", "Usar preços na precificação automática", "Pode alterar o preço público. Desligado = não influencia."],
  ["show_in_comparison", "Consultar preços para comparação", "Aparece como referência nas comparações."],
  ["use_for_availability", "Considerar ofertas para encomendas", "Ofertas liberadas no catálogo podem tornar um perfume disponível sob encomenda."],
  ["auto_sync", "Sincronizar automaticamente", "Leituras agendadas no intervalo configurado."],
];

const CATALOG_MODES: Array<[string, string, string]> = [
  ["all", "Todos os produtos elegíveis", "Qualquer oferta pode disponibilizar o perfume no site."],
  ["selected", "Somente produtos selecionados", "Só ofertas marcadas como “Permitir” em Produtos."],
  ["none", "Não disponibilizar no catálogo", "Continua sincronizando e comparando, mas não publica nada."],
];

export function SupplierManageSheet({ supplier, onOpenChange, onSync, syncing }: { supplier: Supplier | null; onOpenChange: (v: boolean) => void; onSync?: ((id: string) => Promise<void> | void) | undefined; syncing?: boolean | undefined }) {
  const save = useServerFn(updateSupplierSettings);
  const test = useServerFn(testSupplierConnection);
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Configurações");
  const [form, setForm] = useState<Supplier>({});
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    setForm(supplier ? { ...supplier } : {});
    setHealth(supplier?.last_health_check ?? null);
    setTab("Configurações");
  }, [supplier?.id]);

  const changes = useQuery({
    queryKey: ["supplier-changes", supplier?.id],
    enabled: !!supplier && tab === "Alterações",
    queryFn: async () => {
      const { data } = await supabase.from("supplier_sync_changes").select("*").eq("supplier_id", supplier!.id).order("created_at", { ascending: false }).limit(200);
      return data ?? [];
    },
  });

  const set = (k: string, v: unknown) => setForm((f: Supplier) => ({ ...f, [k]: v }));

  const submit = async (keys: string[]) => {
    if (!supplier) return;
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const k of keys) patch[k] = form[k] === "" ? null : form[k];
      await save({ data: { id: supplier.id, patch } });
      toast.success("Configurações salvas.");
      qc.invalidateQueries({ queryKey: ["admin-suppliers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  };

  const diagnose = async () => {
    if (!supplier) return;
    setBusy(true);
    try {
      const r = await test({ data: { supplierId: supplier.id } });
      setHealth(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no diagnóstico.");
    } finally {
      setBusy(false);
    }
  };

  const latestRun = (changes.data ?? [])[0]?.run_id;
  const lastRun = (changes.data ?? []).filter((c: any) => c.run_id === latestRun);
  const count = (k: string) => lastRun.filter((c: any) => c.kind === k).length;
  const stats = (supplier?.ingestion_stats ?? {}) as Record<string, number>;

  return (
    <Sheet open={!!supplier} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{supplier?.name}</SheetTitle>
          <SheetDescription>{[supplier?.platform === "kyte" ? "Kyte" : null, PRIORITY_LABEL[supplier?.priority ?? ""], [supplier?.city, supplier?.state].filter(Boolean).join("/")].filter(Boolean).join(" · ")}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex gap-1 overflow-x-auto rounded-full border border-border/60 p-1">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`h-9 shrink-0 rounded-full px-3 text-[11px] sm:text-xs ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{t}</button>
          ))}
        </div>

        {tab === "Configurações" ? (
          <div className="mt-5 space-y-5">
            <div className="space-y-2">
              <Label>Prioridade comercial</Label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                  <button key={k} type="button" onClick={() => set("priority", k)} className={`h-11 rounded-full border text-xs ${form["priority"] === k ? "border-primary bg-primary/15" : "border-border/60 text-muted-foreground"}`}>{v}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Catálogo público · como utilizar os produtos deste fornecedor?</Label>
              {CATALOG_MODES.map(([k, l, hint]) => (
                <button key={k} type="button" onClick={() => set("catalog_mode", k)} className={`block w-full rounded-xl border p-3 text-left ${form["catalog_mode"] === k ? "border-primary bg-primary/10" : "border-border/60"}`}>
                  <span className="block text-sm">{l}</span><span className="block text-xs text-muted-foreground">{hint}</span>
                </button>
              ))}
              <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setTab("Produtos")}>Gerenciar produtos individualmente</button>
            </div>
            <div className="space-y-3">
              <Label>Finalidade</Label>
              {PERMS.map(([k, label, hint]) => (
                <label key={k} className="flex items-start justify-between gap-3 rounded-xl border border-border/60 p-3">
                  <span className="min-w-0"><span className="block text-sm">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
                  <Switch checked={!!form[k]} onCheckedChange={(v) => set(k, v)} />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sync-int" className="text-xs">Sincronização (minutos)</Label>
                <Input id="sync-int" inputMode="numeric" value={form["sync_interval_minutes"] ?? ""} onChange={(e) => set("sync_interval_minutes", e.target.value.replace(/\D/g, ""))} />
              </div>
              <Field label="Margem mínima (%, vazio = geral)" k="min_margin_pct" form={form} set={set} numeric />
            </div>
            <AdminPrimaryAction className="w-full" loading={busy} onClick={() => submit(["priority", "catalog_mode", "sync_interval_minutes", "min_margin_pct", ...PERMS.map((p) => p[0])])}>Salvar configurações</AdminPrimaryAction>
          </div>
        ) : null}

        {tab === "Produtos" && supplier ? <SupplierCatalogPanel supplierId={supplier.id} onSync={onSync} syncing={syncing} /> : null}

        {tab === "Logística" ? (
          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label>Modalidade de abastecimento</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(SUPPLY_MODE_LABEL) as SupplyMode[]).map((k) => (
                  <button key={k} type="button" onClick={() => set("supply_mode", k)} className={`h-11 rounded-full border px-2 text-xs ${form["supply_mode"] === k ? "border-primary bg-primary/15" : "border-border/60 text-muted-foreground"}`}>{SUPPLY_MODE_LABEL[k]}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Estado" k="state" form={form} set={set} />
              <Field label="Cidade" k="city" form={form} set={set} />
            </div>
            <Field label="Endereço" k="address" form={form} set={set} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Preparação (dias úteis)" k="prep_days" form={form} set={set} numeric />
              {form["supply_mode"] !== "pickup" ? <Field label="Transporte (dias úteis)" k="transit_days" form={form} set={set} numeric /> : <Field label="Custo de deslocamento (R$)" k="travel_cost" form={form} set={set} numeric />}
              {form["supply_mode"] !== "pickup" ? <Field label="Frete (R$, vazio = a consultar)" k="shipping_cost" form={form} set={set} numeric /> : <Field label="Quando consigo retirar" k="pickup_schedule" form={form} set={set} />}
              <Field label="Pedido mínimo (R$)" k="min_order" form={form} set={set} numeric />
            </div>
            <Field label="Dias de operação" k="operating_days" form={form} set={set} />
            {form["supply_mode"] !== "pickup" ? (
              <div className="space-y-3 rounded-xl border border-border/60 p-3">
                <p className="text-sm font-medium">Dados da encomenda (informados pelo fornecedor)</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="CEP de origem" k="origin_cep" form={form} set={set} />
                  <Field label="Serviços SuperFrete (ex.: 1,2,17)" k="freight_services" form={form} set={set} />
                  <Field label="Altura caixa (cm)" k="pkg_height_cm" form={form} set={set} numeric />
                  <Field label="Largura caixa (cm)" k="pkg_width_cm" form={form} set={set} numeric />
                  <Field label="Comprimento caixa (cm)" k="pkg_length_cm" form={form} set={set} numeric />
                  <Field label="Peso por frasco (g)" k="unit_weight_g" form={form} set={set} numeric />
                  <Field label="Frascos por volume" k="units_per_package" form={form} set={set} numeric />
                  <Field label="Valor declarado (R$)" k="declared_value" form={form} set={set} numeric />
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Textarea value={form["logistics_notes"] ?? ""} onChange={(e) => set("logistics_notes", e.target.value)} />
            </div>
            <p className="rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
              {leadText(form)}. Previsão interna, não é promessa ao cliente.{form["supply_mode"] === "pickup" ? " Disponibilidade sujeita à confirmação do fornecedor; só vira pronta entrega após entrada no estoque da Orium." : ""}
            </p>
            <AdminPrimaryAction className="w-full" loading={busy} onClick={() => submit(["supply_mode", "state", "city", "address", "prep_days", "transit_days", "shipping_cost", "travel_cost", "pickup_schedule", "min_order", "operating_days", "logistics_notes", "origin_cep", "freight_services", "pkg_height_cm", "pkg_width_cm", "pkg_length_cm", "unit_weight_g", "units_per_package", "declared_value"])}>Salvar logística</AdminPrimaryAction>
            {supplier ? <SupplierFreightPanel supplier={{ ...supplier, supply_mode: form["supply_mode"], origin_cep: form["origin_cep"] }} /> : null}
          </div>
        ) : null}

        {tab === "Alterações" ? (
          <div className="mt-5 space-y-4 text-sm">
            <p className="text-xs text-muted-foreground">Última sincronização: {supplier?.last_successful_sync_at ? dateBR(supplier.last_successful_sync_at) : "nunca"}</p>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {[["price_changed", "Preços alterados"], ["new", "Novos produtos"], ["not_found", "Não encontrados"], ["review", "Em revisão"]].map(([k, l]) => (
                <div key={k} className="rounded-xl border border-border/60 p-3"><p className="text-lg font-semibold">{k === "review" ? stats["review"] ?? 0 : count(k!)}</p><p className="text-muted-foreground">{l}</p></div>
              ))}
            </div>
            <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
              {(changes.data ?? []).slice(0, 80).map((c: any) => (
                <li key={c.id} className="px-3 py-2 text-xs">
                  <p className="truncate">{c.product_name ?? "Produto"}</p>
                  <p className="text-muted-foreground">
                    {c.kind === "price_changed" ? `Preço ${brl(c.old_price)} → ${brl(c.new_price)}` : c.kind === "new" ? `Novo · ${c.new_price != null ? brl(c.new_price) : "sem preço"}` : c.kind === "not_found" ? "Não encontrado nesta sincronização" : c.kind} · {dateBR(c.created_at)}
                  </p>
                </li>
              ))}
              {changes.data && !changes.data.length ? <li className="p-4 text-xs text-muted-foreground">Nenhuma alteração registrada ainda.</li> : null}
            </ul>
          </div>
        ) : null}

        {tab === "Diagnóstico" ? (
          <div className="mt-5 space-y-3 text-xs">
            <AdminSecondaryAction className="w-full" loading={busy} icon={<Activity />} onClick={diagnose}>Diagnosticar conexão</AdminSecondaryAction>
            {health ? (
              <dl className="grid grid-cols-2 gap-2 rounded-xl border border-border/60 p-3">
                <dt className="text-muted-foreground">Fonte</dt><dd>{health.sourceAccessible ? "Acessível" : "Indisponível"}</dd>
                <dt className="text-muted-foreground">Catálogo</dt><dd>{health.catalogDetected ? "Identificado" : "Não identificado"}</dd>
                <dt className="text-muted-foreground">Produtos</dt><dd>{health.productsDetected ?? 0}</dd>
                <dt className="text-muted-foreground">Com preço</dt><dd>{health.pricesDetected ?? 0}</dd>
                <dt className="text-muted-foreground">Tempo</dt><dd>{health.durationMs ?? 0} ms</dd>
                <dd className="col-span-2 break-words">{health.code ? `${health.code}: ` : ""}{health.message}</dd>
              </dl>
            ) : null}
            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-border/60 p-3">
              <dt className="text-muted-foreground">Método</dt><dd>{supplier?.adapter ?? "—"}</dd>
              <dt className="text-muted-foreground">Lidos (último ciclo)</dt><dd>{stats["raw"] ?? 0}</dd>
              <dt className="text-muted-foreground">Processados</dt><dd>{stats["parsed"] ?? 0}</dd>
              <dt className="text-muted-foreground">Vinculados</dt><dd>{stats["matched"] ?? 0}</dd>
              <dt className="text-muted-foreground">Em revisão</dt><dd>{stats["review"] ?? 0}</dd>
              <dt className="text-muted-foreground">Erros</dt><dd>{stats["errors"] ?? 0}</dd>
              <dt className="text-muted-foreground">Status</dt><dd>{supplier?.sync_status}{supplier?.sync_error_code ? ` · ${supplier.sync_error_code}` : ""}</dd>
              {supplier?.sync_message ? <dd className="col-span-2 break-words text-muted-foreground">{supplier.sync_message}</dd> : null}
            </dl>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, k, form, set, numeric }: { label: string; k: string; form: Supplier; set: (k: string, v: unknown) => void; numeric?: boolean }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input inputMode={numeric ? "decimal" : undefined} value={form[k] ?? ""} onChange={(e) => set(k, numeric ? e.target.value.replace(/[^\d.,]/g, "").replace(",", ".") : e.target.value)} />
    </div>
  );
}
