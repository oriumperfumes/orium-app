import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copilotDeleteCommand, copilotHistory, copilotSaveAlias, copilotSaveCommand, copilotSettings } from "@/lib/copilot.functions";
import { cn } from "@/lib/utils";

const TOOL: Record<string, string> = {
  price_change: "Preço",
  stock_change: "Estoque",
  availability: "Disponibilidade",
  coupon_create: "Cupom criado",
  coupon_toggle: "Cupom",
  promotion_create: "Promoção criada",
  promotion_end: "Promoção encerrada",
  promotion_reactivate: "Promoção reativada",
  order_status: "Pedido",
  restock_add: "Reposição",
  order_to_restock: "Pedido → reposição",
};
const STATUS: Record<string, string> = { pending: "Aguardando", done: "Concluída", partial: "Parcial", failed: "Falhou", canceled: "Cancelada", expired: "Expirada", undone: "Desfeita", running: "Executando" };

function summary(a: any) {
  const p = a.preview ?? {};
  if (a.tool === "stock_change") return (p.lines ?? []).map((l: any) => `${l.product?.name}: ${l.before} → ${l.after}`).join(" · ");
  if (a.tool === "price_change") return `${p.product?.name ?? ""} ${p.kind_label ?? ""}: ${p.from ?? "—"} → ${p.to ?? "—"}`;
  if (p.product?.name) return `${p.product.name} ${p.from ? `${p.from} → ${p.to}` : ""}`;
  if (p.code) return `${p.code}${p.percent ? ` ${p.percent}%` : ""}`;
  if (p.order_number) return `${p.order_number}${p.from ? `: ${p.from} → ${p.to}` : ""}`;
  return "";
}

/** Admin → Configurações → Copilot: comandos, apelidos, confirmações e histórico. */
export function CopilotSettings() {
  const qc = useQueryClient();
  const loadSettings = useServerFn(copilotSettings);
  const loadHistory = useServerFn(copilotHistory);
  const saveCommand = useServerFn(copilotSaveCommand);
  const saveAlias = useServerFn(copilotSaveAlias);
  const del = useServerFn(copilotDeleteCommand);
  const [tab, setTab] = useState<"comandos" | "apelidos" | "confirmacoes" | "historico">("comandos");
  const settings = useQuery({ queryKey: ["copilot-settings"], queryFn: () => loadSettings() });
  const history = useQuery({ queryKey: ["copilot-history"], queryFn: () => loadHistory(), enabled: tab === "historico" });
  const [form, setForm] = useState({ name: "", phrases: "", instructions: "" });
  const [alias, setAlias] = useState({ phrase: "", meaning: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["copilot-settings"] });

  return (
    <section id="copilot" className="mb-6 rounded-2xl border bg-card p-5 shadow-soft">
      <h2 className="text-base font-semibold">Orium Copilot</h2>
      <p className="mt-1 text-sm text-muted-foreground">Atalhos de fala, apelidos e o histórico de tudo que o Copilot fez.</p>
      <div className="mt-4 flex gap-1 overflow-x-auto">
        {(["comandos", "apelidos", "confirmacoes", "historico"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("min-h-10 shrink-0 rounded-full px-4 text-sm", tab === t ? "bg-primary text-primary-foreground" : "bg-muted")}>
            {t === "comandos" ? "Comandos" : t === "apelidos" ? "Apelidos" : t === "confirmacoes" ? "Confirmações" : "Histórico"}
          </button>
        ))}
      </div>

      {tab === "comandos" ? (
        <div className="mt-4 space-y-3">
          {(settings.data?.commands ?? []).map((c: any) => (
            <div key={c.id} className="flex items-start gap-2 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">Quando eu disser: {c.phrases.join(" · ")}</p>
                <p className="mt-1 text-sm">{c.instructions}</p>
              </div>
              <button aria-label="Apagar comando" className="grid size-10 place-items-center text-muted-foreground" onClick={async () => { await del({ data: { id: c.id, kind: "command" } }); refresh(); }}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <div className="space-y-2 rounded-xl border border-dashed p-3">
            <p className="text-sm font-medium">Novo comando</p>
            <input className="h-11 w-full rounded-xl border bg-background px-3 text-base" placeholder="Nome (ex.: Fechamento)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="h-11 w-full rounded-xl border bg-background px-3 text-base" placeholder="Frases, separadas por vírgula (ex.: fazer fechamento, fechar o dia)" value={form.phrases} onChange={(e) => setForm({ ...form, phrases: e.target.value })} />
            <textarea className="min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-base" placeholder="O que fazer (ex.: mostrar vendas de hoje, lucro bruto e pedidos pendentes). Pode usar {produto} e {quantidade}." value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
            <p className="text-xs text-muted-foreground">Se o comando alterar preço, estoque, pedido, cupom ou promoção, o Copilot continua pedindo confirmação.</p>
            <Button
              className="rounded-full"
              disabled={!form.name.trim() || !form.phrases.trim() || form.instructions.trim().length < 3}
              onClick={async () => {
                try {
                  await saveCommand({ data: { id: null, name: form.name, phrases: form.phrases.split(",").map((s) => s.trim()).filter(Boolean), instructions: form.instructions, active: true } });
                  setForm({ name: "", phrases: "", instructions: "" });
                  refresh();
                  toast.success("Comando salvo.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Não consegui salvar.");
                }
              }}
            >
              Salvar comando
            </Button>
          </div>
        </div>
      ) : null}

      {tab === "apelidos" ? (
        <div className="mt-4 space-y-2">
          {(settings.data?.aliases ?? []).map((a: any) => (
            <div key={a.id} className="flex items-center gap-2 rounded-xl border p-3 text-sm">
              <span className="font-medium">“{a.phrase}”</span>
              <span className="min-w-0 flex-1 text-muted-foreground">= {a.meaning}</span>
              <button aria-label="Apagar apelido" className="grid size-10 place-items-center text-muted-foreground" onClick={async () => { await del({ data: { id: a.id, kind: "alias" } }); refresh(); }}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className="h-11 flex-1 rounded-xl border bg-background px-3 text-base" placeholder="Frase (ex.: dar entrada)" value={alias.phrase} onChange={(e) => setAlias({ ...alias, phrase: e.target.value })} />
            <input className="h-11 flex-[2] rounded-xl border bg-background px-3 text-base" placeholder="Significa (ex.: adicionar ao estoque local)" value={alias.meaning} onChange={(e) => setAlias({ ...alias, meaning: e.target.value })} />
            <Button className="h-11 rounded-full" disabled={alias.phrase.trim().length < 2 || alias.meaning.trim().length < 3} onClick={async () => { await saveAlias({ data: alias }); setAlias({ phrase: "", meaning: "" }); refresh(); }}>
              Adicionar
            </Button>
          </div>
        </div>
      ) : null}

      {tab === "confirmacoes" ? (
        <div className="mt-4 space-y-2 text-sm">
          <p><span className="font-medium">Sem confirmação:</span> consultas, simulações e abrir telas.</p>
          <p><span className="font-medium">Confirmação simples:</span> adicionar à reposição, enviar pedido à reposição.</p>
          <p><span className="font-medium">Prévia + confirmar:</span> preço, estoque, disponibilidade, cupom, promoção, situação do pedido.</p>
          <p><span className="font-medium">Confirmação por voz:</span> “sim” vale só para a ação pendente mais recente, por até 90 segundos.</p>
          <p><span className="font-medium">Permissões:</span> o Copilot só faz o que sua conta pode fazer no painel ({(settings.data?.roles ?? []).join(", ") || "sem papel"}).</p>
          <p><span className="font-medium">Voz:</span> toque para começar e toque para parar, ou segure para falar e solte para enviar. O microfone nunca fica ouvindo sozinho.</p>
        </div>
      ) : null}

      {tab === "historico" ? (
        <div className="mt-4 space-y-2">
          {history.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
          {(history.data ?? []).map((a) => (
            <div key={a.id} className="rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{TOOL[a.tool] ?? a.tool}{a.intent === "UNDO" ? " (desfazer)" : ""}</span>
                <span className={cn("text-xs", a.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                  {STATUS[a.status] ?? a.status} · {new Date(a.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              {a.utterance ? <p className="mt-1 text-muted-foreground">“{a.utterance}”</p> : null}
              <p className="mt-1">{summary(a)}</p>
              {a.error ? <p className="mt-1 text-destructive">{a.error}</p> : null}
              {a.user_name ? <p className="mt-1 text-xs text-muted-foreground">{a.user_name}</p> : null}
            </div>
          ))}
          {history.data && !history.data.length ? <p className="text-sm text-muted-foreground">Nenhuma ação ainda.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
