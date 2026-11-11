import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BrainCircuit, CheckCircle2, CircleAlert, Loader2, PlugZap, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aiQuickTest, aiSaveSettings, aiStatus, aiTestConnection } from "@/lib/ai.functions";
import { cn } from "@/lib/utils";

const FEATURE: Record<string, string> = {
  copilot: "Copilot",
  voice_stt: "Voz (transcrição)",
  purchase_intent: "Compras / fornecedores",
  catalog_identity: "Identificação de perfumes",
  catalog_research: "Pesquisa de perfumes",
  fragrance: "Ficha olfativa",
  test: "Teste",
};
const TASK: Record<string, string> = {
  navigation: "navegação",
  price_lookup: "consulta rápida",
  operation: "operação",
  conversation: "conversa",
  analysis: "análise",
  strategy: "estratégia",
};
const STATUS: Record<string, string> = {
  connected: "Conectado",
  invalid_key: "Chave inválida",
  no_quota: "Sem saldo na OpenAI",
  rate_limited: "Limite de pedidos",
  unavailable: "OpenAI indisponível",
  not_configured: "Chave não cadastrada",
};
const usd = (n: number) => `US$ ${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;

export function AiCenter() {
  const qc = useQueryClient();
  const load = useServerFn(aiStatus);
  const testConn = useServerFn(aiTestConnection);
  const save = useServerFn(aiSaveSettings);
  const quick = useServerFn(aiQuickTest);
  const { data } = useQuery({ queryKey: ["ai-status"], queryFn: () => load(), staleTime: 15_000 });
  const [models, setModels] = useState<string[]>([]);
  const [form, setForm] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm({ ...data.config });
  }, [data]);

  const owner = data?.owner ?? false;
  const status = !data?.keyConfigured ? "not_configured" : data?.config.enabled === false ? "disabled" : data?.lastCheck ?? "unchecked";
  const statusLabel = status === "disabled" ? "Desligada" : status === "unchecked" ? "Chave cadastrada · não testada" : STATUS[status] ?? status;
  const ok = status === "connected";

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falhou.");
    } finally {
      setBusy(null);
    }
  };

  const doTest = () =>
    run("test", async () => {
      const r = await testConn();
      setModels(r.models);
      r.status === "connected" ? toast.success(`${r.message} ${r.models.length} modelos disponíveis.`) : toast.error(r.message);
      await qc.invalidateQueries({ queryKey: ["ai-status"] });
    });

  const doSave = (patch?: Record<string, unknown>) =>
    run("save", async () => {
      const body = patch ?? {
        model_economy: form["model_economy"],
        model_advanced: form["model_advanced"],
        model_voice: form["model_voice"],
        model_copilot: form["model_copilot"],
        model_vision: form["model_vision"],
        prices: form["prices"],
        daily_limit_usd: form["daily_limit_usd"] === "" ? null : form["daily_limit_usd"],
        monthly_limit_usd: form["monthly_limit_usd"] === "" ? null : form["monthly_limit_usd"],
        alert_pct: Number(form["alert_pct"]),
        limit_policy: form["limit_policy"],
      };
      await save({ data: body as never });
      toast.success("Central de IA atualizada.");
      await qc.invalidateQueries({ queryKey: ["ai-status"] });
    });

  const u = data?.usage;
  const cfg = data?.config;
  const alert =
    cfg && u && ((cfg.daily_limit_usd && u.costToday >= (cfg.daily_limit_usd * cfg.alert_pct) / 100) || (cfg.monthly_limit_usd && u.costMonth >= (cfg.monthly_limit_usd * cfg.alert_pct) / 100));

  const modelField = (k: string, label: string, hint: string) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        list="ai-models"
        disabled={!owner}
        value={form[k] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value.trim() }))}
        className="mt-1 h-11 rounded-xl"
      />
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <div className="mb-6 rounded-2xl border bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <BrainCircuit className="size-5 text-primary" />
          <h2 className="text-base font-semibold">Inteligência Artificial</h2>
        </div>
        <span className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", ok ? "border-primary/50 text-primary" : "border-border text-muted-foreground")}>
          {ok ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />}
          {statusLabel}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Provedor: <span className="text-foreground">OpenAI</span> · todos os recursos de IA da Orium usam a sua chave.</p>

      {!data?.keyConfigured ? (
        <div className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          A chave da OpenAI ainda não foi cadastrada. Por segurança ela é guardada só no servidor — peça no chat do Lovable para "cadastrar a chave da OpenAI" e um formulário seguro será aberto. Sem a chave, a IA fica pausada (nada é enviado a outro provedor).
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-10 rounded-full" disabled={busy === "test" || !data?.keyConfigured} onClick={doTest}>
          {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />} Testar conexão
        </Button>
        {owner ? (
          <Button type="button" variant="ghost" className="h-10 rounded-full" disabled={busy === "save"} onClick={() => doSave({ enabled: !cfg?.enabled })}>
            <Power className="size-4" /> {cfg?.enabled ? "Desligar IA" : "Ligar IA"}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Para substituir a chave, peça no chat do Lovable para "trocar a chave da OpenAI".</p>

      <datalist id="ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
      <div className="mt-5 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Modelos da Orium</h3>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-4 accent-[var(--orium-primary-gold)]"
            disabled={!owner || busy === "save"}
            checked={cfg?.auto_route ?? true}
            onChange={(e) => doSave({ auto_route: e.target.checked })}
          />
          Seleção automática inteligente
        </label>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {cfg?.auto_route ?? true
          ? "Ligada: o roteador escolhe o modelo pela tarefa (consulta rápida, operação, análise ou estratégia)."
          : "Desligada: todas as conversas do Copilot usam o Copilot principal."}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modelField("model_copilot", "Copilot principal", "Conversas, pedidos, vendas e ferramentas.")}
        {modelField("model_advanced", "Raciocínio avançado", "Estratégia, análises e diagnósticos.")}
        {modelField("model_economy", "Comandos rápidos", "Preço, estoque, navegação e extração simples.")}
        {modelField("model_voice", "Reconhecimento de voz", "Transcrição em português.")}
        {modelField("model_vision", "Visão / imagens", "Reservado para recursos com imagem.")}
      </div>
      {u?.unpricedModels?.length ? (
        <div className="mt-3 rounded-xl border border-dashed p-3">
          <p className="text-xs text-muted-foreground">Sem preço de tabela para estimar custo (US$ por 1 milhão de tokens). Confira na sua conta OpenAI e preencha:</p>
          {[...new Set(u.unpricedModels)].map((m) => (
            <div key={m} className="mt-2 grid grid-cols-[1fr_6rem_6rem] items-center gap-2 text-xs">
              <span className="truncate">{m}</span>
              {(["in", "out"] as const).map((k) => (
                <Input
                  key={k}
                  type="number"
                  inputMode="decimal"
                  disabled={!owner}
                  placeholder={k === "in" ? "entrada" : "saída"}
                  value={form["prices"]?.[m]?.[k] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, prices: { ...f["prices"], [m]: { ...f["prices"]?.[m], [k]: e.target.value === "" ? undefined : Number(e.target.value) } } }))}
                  className="h-9 rounded-lg"
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {!models.length && data?.keyConfigured ? <p className="mt-2 text-[11px] text-muted-foreground">Toque em "Testar conexão" para ver os modelos da sua conta.</p> : null}

      <h3 className="mt-6 text-sm font-semibold">Consumo OpenAI <span className="font-normal text-muted-foreground">(custos estimados)</span></h3>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          ["Requisições hoje", String(u?.requestsToday ?? 0)],
          ["Tokens hoje", (u?.tokensToday ?? 0).toLocaleString("pt-BR")],
          ["Custo hoje", usd(u?.costToday ?? 0)],
          ["Custo no mês", usd(u?.costMonth ?? 0)],
          ["Latência média", u?.avgLatency ? `${(u.avgLatency / 1000).toFixed(1)}s` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-surface-2 p-3">
            <p className="text-[11px] text-muted-foreground">{k}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      {alert ? <p className="mt-2 text-xs text-primary">Atenção: o consumo passou de {cfg?.alert_pct}% do limite.</p> : null}
      {u?.byFeature.length ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([["Por funcionalidade (mês)", u.byFeature, true], ["Por modelo (mês)", u.byModel, false]] as const).map(([t, list, isF]) => (
            <div key={t} className="rounded-xl border p-3">
              <p className="mb-2 text-xs font-medium">{t}</p>
              {list.map((r) => (
                <div key={r.name} className="flex justify-between gap-2 py-0.5 text-xs">
                  <span className="truncate text-muted-foreground">{isF ? FEATURE[r.name] ?? r.name : r.name}</span>
                  <span className="shrink-0 tabular-nums">{r.requests}× · {usd(r.cost)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {u?.recent?.length ? (
        <div className="mt-3 rounded-xl border p-3">
          <p className="mb-2 text-xs font-medium">Últimas requisições</p>
          <div className="space-y-1">
            {u.recent.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 text-[11px]">
                <span className="truncate text-muted-foreground">
                  {new Date(r.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · {FEATURE[r.feature] ?? r.feature}
                  {r.task ? ` · ${TASK[r.task] ?? r.task}` : ""} · <span className="text-foreground">{r.model}</span>
                </span>
                <span className={cn("shrink-0 tabular-nums", !r.ok && "text-destructive")}>
                  {r.ok ? `${r.tokens.toLocaleString("pt-BR")} tok · ${usd(r.cost)} · ${r.ms ? (r.ms / 1000).toFixed(1) + "s" : "—"}` : `falhou${r.error ? ` (${r.error})` : ""}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <h3 className="mt-6 text-sm font-semibold">Limites de gasto</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-4">
        {([
          ["daily_limit_usd", "Limite diário (US$)"],
          ["monthly_limit_usd", "Limite mensal (US$)"],
          ["alert_pct", "Alerta em (%)"],
        ] as const).map(([k, l]) => (
          <div key={k}>
            <Label className="text-xs">{l}</Label>
            <Input type="number" inputMode="decimal" disabled={!owner} value={form[k] ?? ""} placeholder="sem limite" onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className="mt-1 h-11 rounded-xl" />
          </div>
        ))}
        <div>
          <Label className="text-xs">Ao atingir o limite</Label>
          <select
            disabled={!owner}
            value={form["limit_policy"] ?? "block"}
            onChange={(e) => setForm((f) => ({ ...f, limit_policy: e.target.value }))}
            className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm"
          >
            <option value="block">Pausar a IA</option>
            <option value="economy_only">Usar só o econômico</option>
          </select>
        </div>
      </div>
      {owner ? (
        <Button type="button" className="mt-4 h-11 rounded-full" disabled={busy === "save"} onClick={() => doSave()}>
          {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null} Salvar configurações
        </Button>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Só o dono da loja pode alterar estas configurações.</p>
      )}

      <h3 className="mt-6 text-sm font-semibold">Testar a IA</h3>
      <div className="mt-2 flex gap-2">
        <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex.: Sugira um nome para um kit de decants" className="h-11 rounded-xl" />
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full"
          disabled={busy === "quick" || !data?.keyConfigured}
          onClick={() =>
            run("quick", async () => {
              const r = await quick({ data: { prompt, profile: "copilot" } });
              setAnswer(r.ok ? `${r.answer}\n\n${r.model} · ${r.tokens} tokens · ${usd(r.cost)} (estimado) · ${(r.ms / 1000).toFixed(1)}s` : r.error);
              await qc.invalidateQueries({ queryKey: ["ai-status"] });
            })
          }
        >
          {busy === "quick" ? <Loader2 className="size-4 animate-spin" /> : "Enviar"}
        </Button>
      </div>
      {answer ? <p className="mt-2 whitespace-pre-line rounded-xl border bg-surface-2 p-3 text-sm">{answer}</p> : null}

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        O consumo de IA do app é cobrado pela OpenAI na sua conta. Os créditos do Lovable para editar o app e a hospedagem continuam existindo à parte. Custos acima são estimativas pelos preços de tabela configurados.
      </p>
    </div>
  );
}
