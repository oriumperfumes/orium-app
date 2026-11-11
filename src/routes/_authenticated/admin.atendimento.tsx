import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ArrowLeft, ArrowUpRight, Check, CircleAlert, Clock3, Inbox, MessageCircle,
  MessageSquareText, Search, Send, Sparkles, Star, Users, WifiOff, BookOpen,
  Settings2, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import {
  omniInbox, omniThread, omniSetConversation, omniSendReply, omniSuggestReply,
  omniKnowledge, omniSaveKnowledge, omniSetChannelMode,
  type OmniConversation,
} from "@/lib/atendimento.functions";

export const Route = createFileRoute("/_authenticated/admin/atendimento")({
  head: () => ({ meta: [
    { title: "Atendimento — Orium Admin" },
    { name: "robots", content: "noindex" },
  ] }),
  component: AtendimentoPage,
});

const FILTERS = [
  { id: "all", label: "Todas" }, { id: "unread", label: "Não lidas" },
  { id: "ai", label: "IA atendendo" }, { id: "help", label: "Precisa de ajuda" },
  { id: "important", label: "Importantes" }, { id: "closed", label: "Finalizadas" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];
const CHANNEL_NAMES: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", tiktok: "TikTok", site: "Site" };
const STATUS_NAMES: Record<string, string> = { open: "Aberta", needs_help: "Precisa de ajuda", closed: "Finalizada" };
const MODE_NAMES: Record<string, string> = { assistant: "Assistente", supervised: "Supervisionado", controlled: "Automático controlado" };
const fmtTime = (date: string) => {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function AtendimentoPage() {
  const qc = useQueryClient();
  const { role } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"inbox" | "channels" | "knowledge">("inbox");
  const [reply, setReply] = useState("");
  const [suggested, setSuggested] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [knowledgeDialog, setKnowledgeDialog] = useState(false);
  const [knowledgeId, setKnowledgeId] = useState<string | undefined>();
  const [topic, setTopic] = useState("");
  const [guidance, setGuidance] = useState("");
  const [knowledgeActive, setKnowledgeActive] = useState(true);

  const inboxFn = useServerFn(omniInbox);
  const threadFn = useServerFn(omniThread);
  const updateFn = useServerFn(omniSetConversation);
  const sendFn = useServerFn(omniSendReply);
  const suggestFn = useServerFn(omniSuggestReply);
  const knowledgeFn = useServerFn(omniKnowledge);
  const saveKnowledgeFn = useServerFn(omniSaveKnowledge);
  const setModeFn = useServerFn(omniSetChannelMode);

  const list = useQuery({
    queryKey: ["omni-inbox", filter, search.trim()],
    queryFn: () => inboxFn({ data: { filter, q: search.trim() } }),
    staleTime: 4_000, refetchInterval: 10_000,
  });
  const detail = useQuery({
    queryKey: ["omni-thread", id],
    queryFn: () => threadFn({ data: { id: id! } }),
    enabled: !!id && panel === "inbox",
    staleTime: 3_000, refetchInterval: 7_000,
  });
  const knowledge = useQuery({
    queryKey: ["omni-knowledge"],
    queryFn: () => knowledgeFn(),
    enabled: panel === "knowledge", staleTime: 30_000,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["omni-inbox"] });
    void qc.invalidateQueries({ queryKey: ["omni-thread"] });
  };
  const change = async (patch: {
    id: string; status?: "open" | "needs_help" | "closed"; important?: boolean;
    priority?: "normal" | "high"; assigned_to?: string | null;
    ai_active?: boolean; read?: boolean; crm_customer_id?: string | null;
  }) => {
    try { await updateFn({ data: patch }); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao atualizar."); }
  };
  const select = (conv: OmniConversation) => {
    setId(conv.id); setReply(""); setSuggested(false);
    if (conv.unread_count) void change({ id: conv.id, read: true });
  };
  const handleSend = async () => {
    if (!id || !reply.trim() || sending) return;
    setSending(true);
    try {
      await sendFn({ data: { conversationId: id, body: reply.trim(), operationId: crypto.randomUUID() } });
      setReply(""); setSuggested(false); refresh(); toast.success("Mensagem enviada pelo WhatsApp.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "O envio não foi confirmado.");
    } finally { setSending(false); }
  };
  const suggest = async () => {
    if (!id || suggesting) return;
    setSuggesting(true);
    try {
      const result = await suggestFn({ data: { conversationId: id } });
      setReply(result.reply); setSuggested(true);
      if (result.needs_human) toast.message("Conversa encaminhada para atenção humana.");
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "A IA não conseguiu sugerir uma resposta."); }
    finally { setSuggesting(false); }
  };
  const startKnowledge = (row?: any) => {
    setKnowledgeId(row?.id);
    setTopic(row?.topic ?? "");
    setGuidance(row?.guidance ?? (suggested ? reply : ""));
    setKnowledgeActive(row?.active ?? true);
    setKnowledgeDialog(true);
  };
  const saveKnowledge = async () => {
    setSaving(true);
    try {
      await saveKnowledgeFn({ data: { id: knowledgeId, topic, guidance, active: knowledgeActive } });
      setKnowledgeDialog(false); toast.success("Orientação aprovada e salva.");
      void qc.invalidateQueries({ queryKey: ["omni-knowledge"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  };

  const conv = detail.data?.conversation;
  const unread = (list.data?.conversations ?? []).filter(c => c.unread_count > 0).length;
  const help = (list.data?.conversations ?? []).filter(c => c.status === "needs_help").length;

  return (
    <AdminShell title="Atendimento">
      <div className="mx-auto flex w-full max-w-[1480px] min-w-0 flex-col gap-4 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-primary/90">Orium · atendimento</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Converse de onde estiverem.</h2>
            <p className="mt-1 text-xs text-muted-foreground">Uma fila para sua equipe. IA como apoio, atendimento humano no controle.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant={panel === "inbox" ? "default" : "outline"} className="rounded-full" onClick={() => setPanel("inbox")}><Inbox className="mr-2 size-4" /> Conversas</Button>
            <Button type="button" variant={panel === "channels" ? "default" : "outline"} className="rounded-full" onClick={() => setPanel("channels")}><Settings2 className="mr-2 size-4" /> Canais</Button>
            <Button type="button" variant={panel === "knowledge" ? "default" : "outline"} className="rounded-full" onClick={() => setPanel("knowledge")}><BookOpen className="mr-2 size-4" /> Orientações</Button>
          </div>
        </div>

        {panel === "channels" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(list.data?.channels ?? []).map((ch: any) => (
              <article key={ch.id} className="rounded-3xl border border-border/70 bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div><h3 className="font-semibold">{ch.name}</h3><p className="mt-1 text-xs text-muted-foreground">{ch.id === "whatsapp" ? "Meta Cloud API · webhook oficial" : ch.id === "instagram" ? "Requer conta profissional e permissões Meta" : ch.id === "tiktok" ? "Disponibilidade dependente das APIs e permissões TikTok" : "Conector futuro"}</p></div>
                  <span className={'rounded-full border px-3 py-1 text-xs ' + (ch.connection_status === "connected" ? "border-emerald-600/30 text-emerald-400" : "border-border text-muted-foreground")}>{ch.connection_status === "connected" ? "Conectado" : "Não conectado"}</span>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <label className="text-xs text-muted-foreground" htmlFor={"mode-" + ch.id}>Comportamento da IA</label>
                  <select id={"mode-" + ch.id} className="max-w-[200px] min-w-0 rounded-xl border border-border bg-background p-2 text-xs" value={ch.ai_mode} disabled={role !== "owner"} onChange={async e => {
                    try { await setModeFn({ data: { channel: ch.id, mode: e.target.value as "assistant" | "supervised" | "controlled" } }); refresh(); toast.success("Preferência salva."); }
                    catch (error) { toast.error(error instanceof Error ? error.message : "Falha."); }
                  }}>
                    {Object.entries(MODE_NAMES).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Envio automático permanece desativado até integração e políticas de cada canal serem validadas. Selecionar um modo não ativa robôs.</p>
              </article>
            ))}
            {list.isError && <p className="text-sm text-destructive">Não foi possível consultar os canais. Verifique a migração do banco.</p>}
            <p className="text-xs text-muted-foreground sm:col-span-2">WhatsApp: configure os segredos do servidor e o webhook na Meta. Instagram e TikTok não são simulados nem conectados sem aprovação oficial.</p>
          </div>
        ) : panel === "knowledge" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Conhecimento aprovado</h3><p className="text-xs text-muted-foreground">Orientações verificadas pela equipe responsável; nenhuma mensagem treina modelos automaticamente.</p></div>
              {role === "owner" && <Button className="rounded-full" onClick={() => startKnowledge()}><BookOpen className="mr-2 size-4"/> Nova orientação</Button>}
            </div>
            {knowledge.isError && <p className="text-sm text-destructive">Não foi possível carregar as orientações.</p>}
            {knowledge.isLoading && <p className="text-sm text-muted-foreground">Carregando orientações…</p>}
            {!knowledge.isLoading && !(knowledge.data?.length) && <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Nenhuma orientação aprovada ainda.</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {(knowledge.data ?? []).map((row: any) => <div key={row.id} className="min-w-0 rounded-2xl border border-border/70 bg-card p-4">
                <div className="flex items-center justify-between gap-2"><h4 className="font-medium">{row.topic}</h4><span className="text-xs text-muted-foreground">{row.active ? "Ativa" : "Revogada"} · v{row.revision}</span></div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{row.guidance}</p>
                {role === "owner" && <button type="button" className="mt-3 min-h-10 text-sm text-primary" onClick={() => startKnowledge(row)}>Editar / revogar</button>}
              </div>)}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 sm:max-w-lg">
              <Stat label="Na lista" value={list.data?.conversations.length} icon={MessageCircle} />
              <Stat label="Não lidas*" value={filter === "all" ? unread : undefined} icon={Clock3} />
              <Stat label="Precisa de ajuda*" value={filter === "all" ? help : undefined} icon={CircleAlert} />
            </div>
            <p className="-mt-2 text-[11px] text-muted-foreground">* Contagens da lista carregada; até 100 conversas recentes, não são totais históricos.</p>

            <div className="grid min-h-[min(70vh,780px)] min-w-0 overflow-hidden rounded-[24px] border border-border/70 bg-card lg:grid-cols-[minmax(290px,350px)_minmax(0,1fr)]">
              <div className={(id ? "hidden lg:flex " : "flex ") + "min-w-0 flex-col border-border/70 lg:border-r"}>
                <div className="space-y-3 border-b border-border/50 p-3 sm:p-4">
                  <div className="relative"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Buscar conversas" className="h-11 rounded-xl bg-background pl-10" placeholder="Cliente, mensagem ou perfume..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                  <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filtrar atendimentos">
                    {FILTERS.map(t => <button type="button" role="tab" aria-selected={filter === t.id} key={t.id} onClick={() => setFilter(t.id)} className={"min-h-9 shrink-0 rounded-full border px-3 text-xs " + (filter === t.id ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground")}>{t.label}</button>)}
                  </div>
                </div>
                <div className="max-h-[68vh] flex-1 overflow-y-auto overscroll-contain">
                  {list.isLoading && <p className="p-5 text-sm text-muted-foreground">Carregando conversas…</p>}
                  {list.isError && <div className="p-5 text-sm text-destructive">Não foi possível carregar as conversas. Verifique a conexão e a migração do banco. <button type="button" className="underline" onClick={() => void list.refetch()}>Tentar novamente</button></div>}
                  {!list.isLoading && !list.isError && !list.data?.conversations.length &&
                    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center text-muted-foreground"><WifiOff className="size-7 opacity-60"/><p className="text-sm">Nenhuma conversa encontrada. Conecte um canal oficial para começar a receber mensagens.</p></div>}
                  {(list.data?.conversations ?? []).map(c => (
                    <button key={c.id} type="button" onClick={() => select(c)} className={"w-full border-b border-border/40 px-4 py-4 text-left transition-colors hover:bg-accent/30 " + (id === c.id ? "bg-primary/10" : "")}>
                      <div className="flex items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-border bg-background text-primary"><MessageCircle className="size-4"/></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2"><span className="min-w-0 truncate text-sm font-semibold">{c.customer_name || c.contact_phone || "Cliente"}</span><time className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(c.last_message_at)}</time></div>
                          <p className="mt-0.5 text-[11px] text-primary/85">{CHANNEL_NAMES[c.channel_id]} · {STATUS_NAMES[c.status]}{c.ai_active ? " · IA" : " · Humano"}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.last_preview || "Conversa iniciada"}</p>
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                            {c.important && <Star className="size-3 fill-primary text-primary" />}
                            {c.priority === "high" && <span className="text-amber-400">Prioridade</span>}
                            {c.unread_count > 0 && <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">{c.unread_count}</span>}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className={(id ? "flex " : "hidden lg:flex ") + "min-w-0 flex-col"}>
                {!id ? <div className="hidden flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground lg:flex"><MessageSquareText className="size-8"/><p className="text-sm">Selecione uma conversa para atender.</p></div> : (
                  <>
                    <div className="flex min-w-0 items-center gap-3 border-b border-border/60 p-3 sm:p-4">
                      <button className="grid size-10 shrink-0 place-items-center rounded-full border border-border lg:hidden" aria-label="Voltar à lista" onClick={() => setId(null)}><ArrowLeft className="size-4"/></button>
                      <div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{conv?.customer_name || conv?.contact_phone || "Cliente"}</h3><p className="text-xs text-muted-foreground">{conv ? CHANNEL_NAMES[conv.channel_id] : "Carregando"} · {conv ? STATUS_NAMES[conv.status] : ""}</p></div>
                      <button title="Marcar importante" aria-label={conv?.important ? "Remover importante" : "Marcar importante"} onClick={() => conv && void change({ id: conv.id, important: !conv.important })} className="grid size-10 shrink-0 place-items-center rounded-full border border-border"><Star className={"size-4 " + (conv?.important ? "fill-primary text-primary" : "text-muted-foreground")}/></button>
                    </div>
                    {conv && <div className="flex flex-wrap items-center gap-2 border-b border-border/50 p-3 text-xs">
                      <label className="flex min-w-0 items-center gap-1.5 text-muted-foreground"><Users className="size-3.5"/> Responsável
                        <select aria-label="Responsável" className="max-w-[135px] rounded-lg border border-border bg-background p-2 text-foreground" value={conv.assigned_to ?? ""} onChange={e => void change({ id: conv.id, assigned_to: e.target.value || null })}>
                          <option value="">Não atribuído</option>
                          {(list.data?.team ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </label>
                      <select aria-label="Status da conversa" className="rounded-lg border border-border bg-background p-2" value={conv.status} onChange={e => void change({ id: conv.id, status: e.target.value as "open" | "closed" | "needs_help" })}>
                        {Object.entries(STATUS_NAMES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <select aria-label="Prioridade" className="rounded-lg border border-border bg-background p-2" value={conv.priority} onChange={e => void change({ id: conv.id, priority: e.target.value as "normal" | "high" })}>
                        <option value="normal">Normal</option><option value="high">Alta prioridade</option>
                      </select>
                    </div>}
                    <div className="min-h-[260px] max-h-[52vh] flex-1 space-y-3 overflow-y-auto overscroll-contain bg-background/20 p-3 sm:p-5" role="log" aria-label="Mensagens da conversa" aria-live="polite">
                      {detail.isLoading && <p className="text-xs text-muted-foreground">Carregando mensagens…</p>}
                      {detail.isError && <p className="text-xs text-destructive">Não foi possível carregar o histórico.</p>}
                      {(detail.data?.messages ?? []).map(m => (
                        <div key={m.id} className={"flex " + (m.direction === "outbound" ? "justify-end" : "justify-start")}>
                          <div className={"max-w-[92%] rounded-2xl px-4 py-3 text-sm sm:max-w-[78%] " + (m.direction === "outbound" ? "rounded-br-md border border-primary/25 bg-primary/10" : "rounded-bl-md border border-border bg-card")}>
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <p className="mt-1 flex items-center justify-end gap-2 text-[10px] text-muted-foreground"><time>{fmtTime(m.created_at)}</time>{m.direction === "outbound" && m.delivery_status}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-3 border-t border-border/70 p-3 sm:p-4">
                      {suggested && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-primary"><span><Sparkles className="mr-1 inline size-3.5"/> Rascunho da IA: revise antes de enviar.</span>{role === "owner" && <button className="underline" onClick={() => startKnowledge()}>Salvar orientação para o futuro?</button>}</div>}
                      <Textarea aria-label="Resposta ao cliente" value={reply} onChange={e => { setReply(e.target.value); }} className="min-h-20 resize-y rounded-2xl bg-background" placeholder="Escreva uma resposta humana e objetiva…" maxLength={4096}/>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button variant="outline" className="min-h-11 rounded-full" onClick={suggest} disabled={suggesting || !conv}><Sparkles className="mr-2 size-4"/>{suggesting ? "Consultando…" : "Sugerir com IA"}</Button>
                        <Button className="min-h-11 rounded-full" onClick={handleSend} disabled={!reply.trim() || sending || !conv || conv.channel_id !== "whatsapp"}><Send className="mr-2 size-4"/>{sending ? "Enviando…" : "Enviar mensagem"}</Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Envio oficial disponível somente para WhatsApp conectado, dentro da janela de atendimento de 24h. Respostas da IA nunca são enviadas automaticamente nesta etapa.</p>
                      {detail.data?.customer && <a href={"/admin/clientes?cliente=" + detail.data.customer.id} className="inline-flex items-center gap-1 text-xs text-primary underline">Ver histórico no CRM <ArrowUpRight className="size-3"/></a>}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      <Dialog open={knowledgeDialog} onOpenChange={setKnowledgeDialog}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl">
          <DialogHeader><DialogTitle>Orientação aprovada</DialogTitle><DialogDescription>Somente o proprietário pode publicar e revogar instruções comerciais. Guardar a orientação não treina o modelo.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <label className="block text-sm">Assunto<Input value={topic} onChange={e => setTopic(e.target.value)} className="mt-1" maxLength={80} /></label>
            <label className="block text-sm">Orientação<Textarea className="mt-1 min-h-28" value={guidance} onChange={e => setGuidance(e.target.value)} maxLength={1500} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={knowledgeActive} onChange={e => setKnowledgeActive(e.target.checked)} /> Orientação ativa</label>
            <Button className="w-full rounded-full" disabled={saving || topic.trim().length < 2 || guidance.trim().length < 4} onClick={saveKnowledge}>{saving ? <Loader2 className="mr-2 size-4 animate-spin"/> : <Check className="mr-2 size-4"/>} Salvar orientação</Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value?: number | undefined; icon: typeof Inbox }) {
  return <div className="rounded-2xl border border-border/70 bg-card p-3"><div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="size-3.5" />{label}</div><p className="mt-2 text-xl font-semibold tabular-nums">{value ?? "—"}</p></div>;
}
