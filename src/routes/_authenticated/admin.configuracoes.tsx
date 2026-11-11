import { createFileRoute } from "@tanstack/react-router";
import { CopilotSettings } from "@/components/orium/copilot/CopilotSettings";
import { AiCenter } from "@/components/orium/admin/AiCenter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/orium/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maskCep, dateBR } from "@/lib/format";
import { SETTINGS_TABS, parseSettingsSearch, type SettingsTab, type AiSection } from "@/lib/admin-settings-tabs";
import {
  getShippingStatus,
  getShippingIntegration,
  saveShippingToken,
  removeShippingIntegration,
  testShippingConnection,
} from "@/lib/shipping.functions";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  validateSearch: parseSettingsSearch,
  head: () => ({
    meta: [{ title: "Configurações — Orium Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminSettings,
});

function AdminSettings() {
  const { aba, secao } = Route.useSearch();
  const navigate = Route.useNavigate();
  // A primeira categoria funcional é Entregas; links diretos continuam disponíveis.
  const activeTab: SettingsTab = aba ?? "entregas";
  const aiSection: AiSection = secao ?? "openai";
  const [visited, setVisited] = useState<Set<SettingsTab>>(() => new Set([activeTab]));
  const [visitedAi, setVisitedAi] = useState<Set<AiSection>>(() => new Set([aiSection]));
  const [providerDraft, setProviderDraft] = useState<string | null>(null);

  useEffect(() => {
    setVisited((previous) => previous.has(activeTab) ? previous : new Set([...previous, activeTab]));
    if (activeTab === "ia") {
      setVisitedAi((previous) => previous.has(aiSection) ? previous : new Set([...previous, aiSection]));
    }
  }, [activeTab, aiSection]);

  // Consulta leve, iniciada apenas ao abrir Integrações. Ao visitar Entregas,
  // usamos o mesmo cache já existente; o provedor editado fica em memória.
  const { data: savedShipping } = useQuery({
    queryKey: ["shipping-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shipping_settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: activeTab === "integracoes",
  });
  const provider = providerDraft ?? savedShipping?.provider ?? "none";
  const showTab = (tab: SettingsTab) => visited.has(tab) || activeTab === tab;
  const showAi = (section: AiSection) => visitedAi.has(section) || (activeTab === "ia" && aiSection === section);
  const changeTab = (tab: SettingsTab) =>
    void navigate({ search: { aba: tab, ...(tab === "ia" ? { secao: aiSection } : {}) }, replace: true });
  const changeAi = (section: AiSection) =>
    void navigate({ search: { aba: "ia", secao: section }, replace: true });

  return (
    <AdminShell title="Configurações">
      <div className="mx-auto w-full max-w-6xl min-w-0 pb-8">
        <div className="mb-5">
          <div className="w-full overflow-x-auto overscroll-x-contain pb-1" aria-label="Categorias das configurações">
            <div
              role="tablist"
              aria-label="Categorias de configurações"
              className="flex min-w-max gap-1 rounded-full border border-border/60 bg-background/60 p-1 md:min-w-0"
            >
              {SETTINGS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  id={"settings-tab-" + tab.id}
                  role="tab"
                  type="button"
                  aria-selected={activeTab === tab.id}
                  aria-controls={"settings-panel-" + tab.id}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  onClick={() => changeTab(tab.id)}
                  className={
                    "min-h-10 min-w-max shrink-0 whitespace-nowrap rounded-full px-5 text-xs font-medium transition-[background-color,color] duration-[var(--motion-fast)] ease-[var(--ease-orium)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:min-w-0 md:flex-1 md:text-sm " +
                    (activeTab === tab.id
                      ? "bg-primary text-primary-foreground shadow-soft"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground")
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            {SETTINGS_TABS.find((tab) => tab.id === activeTab)?.description}
          </p>
        </div>

        {/* As áreas visitadas permanecem montadas: rascunhos e campos não salvos
            não desaparecem ao alternar de aba, e as consultas pesadas são lazy. */}
        {showTab("entregas") && (
          <section id="settings-panel-entregas" role="tabpanel" aria-labelledby="settings-tab-entregas" hidden={activeTab !== "entregas"} className="min-w-0">
            <ShippingSettings onProviderChange={setProviderDraft} />
          </section>
        )}

        {showTab("integracoes") && (
          <section id="settings-panel-integracoes" role="tabpanel" aria-labelledby="settings-tab-integracoes" hidden={activeTab !== "integracoes"} className="min-w-0">
            <div className="w-full max-w-3xl space-y-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Frete</p>
                <h2 className="mt-1 text-base font-semibold">Conexão com serviço de entregas</h2>
                <p className="mt-1 text-sm text-muted-foreground">As chaves existentes continuam protegidas no servidor. Configure o serviço de frete na aba Entregas e gerencie a conexão aqui.</p>
              </div>
              {provider === "none" && (
                <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-6">
                  <p className="text-sm text-muted-foreground">Nenhum serviço de cálculo de frete selecionado.</p>
                  <Button type="button" variant="outline" className="mt-3 rounded-full" onClick={() => changeTab("entregas")}>Configurar em Entregas</Button>
                </div>
              )}
              {/* Mantém o editor montado ao trocar o serviço: não descarta a chave digitada. */}
              <ShippingIntegration provider={provider} />
            </div>
          </section>
        )}

        {showTab("ia") && (
          <section id="settings-panel-ia" role="tabpanel" aria-labelledby="settings-tab-ia" hidden={activeTab !== "ia"} className="min-w-0">
            <div className="mb-4 flex w-full max-w-xl gap-1 rounded-full border border-border/60 bg-background/60 p-1" role="tablist" aria-label="Seções de inteligência artificial">
              {([
                { id: "openai", label: "OpenAI e modelos" },
                { id: "copilot", label: "Orium Copilot" },
              ] as const).map((item) => (
                <button
                  key={item.id}
                  id={"settings-ai-" + item.id}
                  type="button"
                  role="tab"
                  tabIndex={aiSection === item.id ? 0 : -1}
                  aria-selected={aiSection === item.id}
                  aria-controls={"settings-ai-panel-" + item.id}
                  onClick={() => changeAi(item.id)}
                  className={"min-h-10 min-w-0 flex-1 rounded-full px-3 text-xs font-medium transition-[background-color,color] duration-[var(--motion-fast)] ease-[var(--ease-orium)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:text-sm " +
                    (aiSection === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground")}
                >{item.label}</button>
              ))}
            </div>
            {showAi("openai") && (
              <div id="settings-ai-panel-openai" role="tabpanel" aria-labelledby="settings-ai-openai" hidden={aiSection !== "openai"} className="min-w-0">
                <AiCenter />
              </div>
            )}
            {showAi("copilot") && (
              <div id="settings-ai-panel-copilot" role="tabpanel" aria-labelledby="settings-ai-copilot" hidden={aiSection !== "copilot"} className="min-w-0">
                <CopilotSettings />
              </div>
            )}
          </section>
        )}
      </div>
    </AdminShell>
  );
}

/** Chave de acesso do agregador de frete: guardada no servidor, nunca exibida. */
function ShippingIntegration({ provider }: { provider: string }) {
  const qc = useQueryClient();
  const load = useServerFn(getShippingIntegration);
  const saveToken = useServerFn(saveShippingToken);
  const removeToken = useServerFn(removeShippingIntegration);
  const testToken = useServerFn(testShippingConnection);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<null | "salvar" | "testar" | "remover">(null);

  const { data: integration } = useQuery({
    queryKey: ["shipping-integration"],
    queryFn: () => load({}),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["shipping-integration"] });
    qc.invalidateQueries({ queryKey: ["shipping-status"] });
  };

  const act = async (kind: "salvar" | "testar" | "remover") => {
    setBusy(kind);
    try {
      if (kind === "salvar") {
        await saveToken({ data: { provider, token } });
        setToken("");
        toast.success("Chave guardada com segurança.");
      } else if (kind === "testar") {
        const res = await testToken({});
        if (res.ok) toast.success(res.message ?? "Conexão funcionando.");
        else toast.error(res.message ?? "Não conseguimos conectar.");
      } else {
        if (!confirm("Remover a chave e desligar o cálculo automático de frete?")) return;
        await removeToken({ data: { provider } });
        toast.success("Integração removida.");
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(null);
    }
  };

  if (provider === "none") return null;

  return (
    <div className="w-full max-w-3xl space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-soft sm:p-6">
      <div>
        <p className="text-sm font-medium">Chave de acesso ({integration?.providerLabel ?? provider})</p>
        <p className="text-xs text-muted-foreground">
          Cole a chave do serviço. Ela fica guardada só no servidor e nunca aparece de novo aqui.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="shipping-token">Chave</Label>
        <Input
          id="shipping-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={integration?.masked ?? "cole a chave aqui"}
          className="h-11 rounded-xl"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-10 rounded-full text-xs" disabled={busy !== null || token.trim().length < 12} onClick={() => act("salvar")}>
          {integration?.hasToken ? "Atualizar chave" : "Salvar chave"}
        </Button>
        <Button type="button" variant="outline" className="h-10 rounded-full text-xs" disabled={busy !== null || !integration?.hasToken} onClick={() => act("testar")}>
          Testar conexão
        </Button>
        <Button type="button" variant="ghost" className="h-10 rounded-full text-xs" disabled={busy !== null || !integration?.hasToken} onClick={() => act("remover")}>
          Remover
        </Button>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{integration?.hasToken ? `Chave cadastrada: ${integration.masked}` : "Nenhuma chave cadastrada ainda."}</p>
        {integration?.tokenUpdatedAt ? <p>Atualizada em {dateBR(integration.tokenUpdatedAt)}.</p> : null}
        {integration?.lastTestAt ? (
          <p>
            Último teste em {dateBR(integration.lastTestAt)}: {integration.lastTestOk ? "funcionou" : "falhou"}
            {integration.lastTestMessage ? ` — ${integration.lastTestMessage}` : ""}
          </p>
        ) : null}
        {integration?.lastQuoteAt ? <p>Último frete calculado em {dateBR(integration.lastQuoteAt)}.</p> : null}
      </div>
    </div>
  );
}

/** Entregas: endereço de origem, embalagem padrão e cidades de entrega local. */
function ShippingSettings({ onProviderChange }: { onProviderChange: (provider: string) => void }) {
  const qc = useQueryClient();
  const status = useServerFn(getShippingStatus);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    store_name: "",
    origin_cep: "",
    street: "",
    number: "",
    district: "",
    city: "",
    state: "",
    provider: "none",
    local_delivery_cities: "",
    item_weight_g: "400",
    package_weight_g: "100",
    height_cm: "12",
    width_cm: "15",
    length_cm: "20",
  });

  const { data } = useQuery({
    queryKey: ["shipping-settings"],
    queryFn: async () => (await supabase.from("shipping_settings").select("*").maybeSingle()).data,
  });

  const { data: providerStatus } = useQuery({
    queryKey: ["shipping-status"],
    queryFn: () => status({}),
  });

  useEffect(() => {
    if (!data) return;
    onProviderChange(data.provider ?? "none");
    setForm({
      store_name: data.store_name ?? "",
      origin_cep: maskCep(data.origin_cep ?? ""),
      street: data.street ?? "",
      number: data.number ?? "",
      district: data.district ?? "",
      city: data.city ?? "",
      state: data.state ?? "",
      provider: data.provider ?? "none",
      local_delivery_cities: (data.local_delivery_cities ?? []).join(", "),
      item_weight_g: String(data.item_weight_g ?? 400),
      package_weight_g: String(data.package_weight_g ?? 100),
      height_cm: String(data.height_cm ?? 12),
      width_cm: String(data.width_cm ?? 15),
      length_cm: String(data.length_cm ?? 20),
    });
  }, [data, onProviderChange]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase
        .from("shipping_settings")
        .update({
          store_name: form.store_name || "Orium Perfumes",
          origin_cep: form.origin_cep.replace(/\D/g, "") || null,
          street: form.street || null,
          number: form.number || null,
          district: form.district || null,
          city: form.city || "Itaguaí",
          state: form.state || "RJ",
          provider: form.provider,
          local_delivery_cities: form.local_delivery_cities
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          item_weight_g: Number(form.item_weight_g) || 400,
          package_weight_g: Number(form.package_weight_g) || 100,
          height_cm: Number(form.height_cm) || 12,
          width_cm: Number(form.width_cm) || 15,
          length_cm: Number(form.length_cm) || 20,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
      toast.success("Entregas atualizadas.");
      qc.invalidateQueries({ queryKey: ["shipping-settings"] });
      qc.invalidateQueries({ queryKey: ["shipping-status"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="w-full max-w-3xl space-y-5 rounded-2xl border border-border/70 bg-card p-4 shadow-soft sm:p-6">
      <div>
        <h2 className="display text-lg">Entregas</h2>
        <p className="text-xs text-muted-foreground">
          De onde os pedidos saem, tamanho padrão da embalagem e cidades de entrega local.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="store">Nome da loja</Label>
        <Input id="store" value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })} className="h-11 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cep">CEP de origem</Label>
          <Input id="cep" value={form.origin_cep} onChange={(e) => setForm({ ...form, origin_cep: maskCep(e.target.value) })} className="h-11 rounded-xl" inputMode="numeric" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="numero">Número</Label>
          <Input id="numero" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className="h-11 rounded-xl" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rua">Rua</Label>
        <Input id="rua" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} className="h-11 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="bairro">Bairro</Label>
          <Input id="bairro" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} className="h-11 rounded-xl" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cidade">Cidade</Label>
          <Input id="cidade" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="h-11 rounded-xl" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="uf">Estado (UF)</Label>
        <Input id="uf" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} className="h-11 rounded-xl" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="provider">Serviço de cálculo de frete</Label>
        <select
          id="provider"
          value={form.provider}
          onChange={(e) => { setForm({ ...form, provider: e.target.value }); onProviderChange(e.target.value); }}
          className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
        >
          <option value="none">Nenhum (só retirada e entrega local)</option>
          <option value="superfrete">SuperFrete</option>
          <option value="melhorenvio">Melhor Envio</option>
          <option value="frenet">Frenet</option>
        </select>
        {providerStatus ? (
          <p className="text-xs text-muted-foreground">
            {providerStatus.provider === "none"
              ? "Sem serviço escolhido: o cliente vê apenas retirada e entrega local."
              : providerStatus.hasToken
                ? "Serviço conectado e pronto para calcular o frete."
                : "Falta a chave de acesso do serviço: cadastre abaixo."}
          </p>
        ) : null}
      </div>


      <div className="space-y-1.5">
        <Label htmlFor="local">Cidades de entrega local</Label>
        <Input
          id="local"
          value={form.local_delivery_cities}
          onChange={(e) => setForm({ ...form, local_delivery_cities: e.target.value })}
          className="h-11 rounded-xl"
          placeholder="Itaguaí, Mangaratiba, Seropédica"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="peso">Peso por perfume (g)</Label>
          <Input id="peso" type="number" value={form.item_weight_g} onChange={(e) => setForm({ ...form, item_weight_g: e.target.value })} className="h-11 rounded-xl" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pesoemb">Peso da embalagem (g)</Label>
          <Input id="pesoemb" type="number" value={form.package_weight_g} onChange={(e) => setForm({ ...form, package_weight_g: e.target.value })} className="h-11 rounded-xl" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="alt">Altura (cm)</Label>
          <Input id="alt" type="number" value={form.height_cm} onChange={(e) => setForm({ ...form, height_cm: e.target.value })} className="h-11 rounded-xl" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lar">Largura (cm)</Label>
          <Input id="lar" type="number" value={form.width_cm} onChange={(e) => setForm({ ...form, width_cm: e.target.value })} className="h-11 rounded-xl" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="comp">Comprimento (cm)</Label>
          <Input id="comp" type="number" value={form.length_cm} onChange={(e) => setForm({ ...form, length_cm: e.target.value })} className="h-11 rounded-xl" />
        </div>
      </div>

      <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl">
        {busy ? "Salvando..." : "Salvar entregas"}
      </Button>
    </form>
  );
}
