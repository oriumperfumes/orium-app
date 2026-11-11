import { copilotMessageContentClass } from "./CopilotUI";
import { COPILOT_ASK, takePendingAsk } from "@/components/orium/copilot/ask";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ArrowDown, Check, Mic, Plus, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { startVoiceRecording, type VoiceRecording } from "@/lib/voice/recorder";
import { copilotConfirmLatest } from "@/lib/copilot.functions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { ActionCard, type ActionOutcome, type ActionProposal } from "./ActionCard";
import { CopilotOrb, type OrbState } from "./CopilotOrb";
import { cn } from "@/lib/utils";

export type ChatActivity = { orb: OrbState; label: string | null; level?: number };

type Suggestion = { label: string; text: string };

const ALL_ACTIONS: Suggestion[] = [
  { label: "Registrar uma venda", text: "Quero registrar uma venda da loja" },
  { label: "Ver resumo de hoje", text: "Como foi o dia hoje?" },
  { label: "Ajustar estoque", text: "Quero ajustar o estoque de um perfume" },
  { label: "Criar cupom", text: "Quero criar um cupom" },
  { label: "Alterar preço", text: "Quero alterar o preço de um perfume" },
  { label: "Comparar fornecedores", text: "Quero comparar fornecedores para uma lista" },
  { label: "Criar um comando", text: "Quero criar um comando personalizado" },
  { label: "Meus comandos", text: "Quais comandos eu tenho?" },
  { label: "Pedidos pendentes", text: "Quais pedidos estão pendentes?" },
  { label: "Reposição aberta", text: "Como está a reposição?" },
];

function contextSuggestions(route: string): Suggestion[] {
  if (/^\/admin\/produtos\/[0-9a-f-]{36}/i.test(route))
    return [
      { label: "Alterar o preço deste perfume", text: "Quero alterar o preço deste perfume" },
      { label: "Ajustar o estoque deste perfume", text: "Quero ajustar o estoque deste perfume" },
      { label: "Ver fornecedores deste perfume", text: "Mostra os fornecedores deste perfume" },
      { label: "Colocar como pronta entrega", text: "Coloca esse como pronta entrega" },
    ];
  if (route.startsWith("/admin/pedidos"))
    return [
      { label: "Ver pedidos pendentes", text: "Quais pedidos estão pendentes?" },
      { label: "Resumo de pedidos", text: "Resumo dos pedidos de hoje" },
      { label: "Enviar pedido à reposição", text: "Quero enviar um pedido para a reposição" },
      { label: "Ver resumo de hoje", text: "Como foi o dia hoje?" },
    ];
  if (route.startsWith("/admin/reposicao") || route.startsWith("/admin/fornecedores"))
    return [
      { label: "Comparar fornecedores", text: "Quero comparar fornecedores para uma lista" },
      { label: "Resumo da reposição", text: "Como está a reposição?" },
      { label: "Adicionar à reposição", text: "Quero adicionar um perfume à reposição" },
      { label: "Ver resumo de hoje", text: "Como foi o dia hoje?" },
    ];
  if (route.startsWith("/admin/produtos"))
    return [
      { label: "Ajustar estoque", text: "Quero ajustar o estoque de um perfume" },
      { label: "Alterar preço", text: "Quero alterar o preço de um perfume" },
      { label: "Criar promoção", text: "Quero criar uma promoção" },
      { label: "Ver resumo de hoje", text: "Como foi o dia hoje?" },
    ];
  return ALL_ACTIONS.slice(0, 4);
}

/** Texto contextual por ferramenta: [em andamento, concluído]. */
const TOOL_LABEL: Record<string, [string, string]> = {
  search_products: ["Buscando no catálogo", "Catálogo consultado"],
  get_product: ["Buscando o perfume", "Perfume encontrado"],
  simulate_price: ["Simulando preço", "Simulação pronta"],
  sales_summary: ["Consultando vendas", "Vendas consultadas"],
  list_orders: ["Consultando pedidos", "Pedidos consultados"],
  get_order: ["Abrindo pedido", "Pedido encontrado"],
  find_customer: ["Buscando cliente", "Cliente encontrado"],
  list_coupons: ["Consultando cupons", "Cupons consultados"],
  list_promotions: ["Consultando promoções", "Promoções consultadas"],
  list_commands: ["Consultando comandos", "Comandos consultados"],
  restock_summary: ["Consultando reposição", "Reposição consultada"],
  compare_suppliers: ["Comparando fornecedores", "Fornecedores comparados"],
  advice_data: ["Analisando dados", "Dados analisados"],
  navigate: ["Abrindo tela", "Tela aberta"],
};
const toolLabel = (name: string, done: boolean) => {
  const l = TOOL_LABEL[name];
  if (l) return done ? l[1] : `${l[0]}…`;
  return name.startsWith("propose_") ? (done ? "Ação preparada" : "Preparando a ação…") : done ? "Consultado" : "Consultando…";
};

const YES = /^\s*(sim|confirm(a|ar|o)|pode( confirmar)?|ok|isso|manda)\s*[.!]?\s*$/i;

function pageContext(pathname: string, search: Record<string, unknown>) {
  const product = pathname.match(/^\/admin\/produtos\/([0-9a-f-]{36})/i)?.[1] ?? null;
  const order = typeof search["pedido"] === "string" ? search["pedido"] : null;
  return { route: pathname, product_id: product, order_id: order, filters: typeof search["tab"] === "string" ? `tab=${search["tab"]}` : null };
}

type Part = any;

type ItemProps = {
  m: UIMessage;
  outcomes: Record<string, ActionOutcome | "canceled">;
  setOutcome: (id: string, o: ActionOutcome | "canceled") => void;
  submit: (t: string) => void;
  onCorrect?: (() => void) | undefined;
};

/** Uma mensagem. Memoizada: durante o streaming só a última re-renderiza. */
const MessageItem = memo(function MessageItem({ m, outcomes, setOutcome, submit, onCorrect }: ItemProps) {
  const renderPart = (p: Part, i: number) => {
    if (p.type === "text")
      return m.role === "user" ? (
        <p key={i} className="whitespace-pre-wrap">{p.text}</p>
      ) : (
        <MessageResponse key={i}>{p.text}</MessageResponse>
      );
    if (typeof p.type !== "string" || !p.type.startsWith("tool-")) return null;
    const name = p.type.slice(5);
    const done = p.state === "output-available" || p.state === "output-error";
    const o = p.output;
    const step = (
      <p key={`s${i}`} className="copilot-msg-in flex items-center gap-2 text-xs text-muted-foreground">
        {done ? <Check className="size-3.5 text-gold" strokeWidth={2} /> : <span className="size-3 rounded-full border border-gold/60 border-t-transparent animate-spin" />}
        {done ? toolLabel(name, true) : <Shimmer className="text-xs">{toolLabel(name, false)}</Shimmer>}
      </p>
    );
    if (!done) return step;
    if (p.state === "output-error" || o?.error)
      return (
        <p key={i} className="copilot-msg-in rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Não consegui: {o?.error ?? p.errorText}
        </p>
      );
    if (name.startsWith("propose_")) {
      if (o?.kind === "action") {
        const oc = outcomes[o.action_id];
        return (
          <ActionCard
            key={o.action_id}
            proposal={o}
            outcome={oc && oc !== "canceled" ? oc : undefined}
            onOutcome={(r) => setOutcome(o.action_id, r)}
            onCorrect={onCorrect}
          />
        );
      }
      if (o?.kind === "needs" && o.candidates?.length)
        return (
          <div key={i} className="copilot-msg-in grid gap-1.5">
            {o.candidates.map((c: any) => (
              <button
                key={c.id}
                onClick={() => submit(`O ${c.name}${c.brand ? ` (${c.brand})` : ""}`)}
                className="press flex min-h-12 items-center gap-3 rounded-xl px-2 text-left text-sm transition-colors hover:bg-muted/50"
              >
                {c.image_url ? <img src={c.image_url} alt="" className="size-10 shrink-0 rounded-lg object-cover" /> : <span className="size-10 shrink-0 rounded-lg bg-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  {c.brand ? <span className="block truncate text-xs text-muted-foreground">{c.brand}</span> : null}
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.6} />
              </button>
            ))}
          </div>
        );
      if (o?.kind === "needs" && o.options?.length)
        return (
          <div key={i} className="copilot-msg-in flex flex-wrap gap-2">
            {o.options.map((op: string) => (
              <button key={op} onClick={() => submit(op)} className="press copilot-glass min-h-10 max-w-full rounded-full px-4 text-left text-sm break-words">
                {op}
              </button>
            ))}
          </div>
        );
      return null;
    }
    if (name === "get_product" && o?.name)
      return (
        <div key={i} className="copilot-card copilot-msg-in flex w-full min-w-0 max-w-md gap-3 rounded-2xl p-3">
          {o.image_url ? <img src={o.image_url} alt={o.name} className="size-16 shrink-0 rounded-xl object-cover" loading="lazy" /> : null}
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-medium">{o.name}</p>
            {o.brand ? <p className="truncate text-xs text-muted-foreground">{o.brand}</p> : null}
            {o.orium_stock != null ? <p className="mt-1 text-xs text-muted-foreground">Estoque local · <span className="text-foreground">{o.orium_stock}</span></p> : null}
          </div>
        </div>
      );
    if (name === "search_products" && o?.candidates?.length)
      return (
        <div key={i} className="copilot-msg-in flex flex-wrap gap-1.5">
          {o.candidates.slice(0, 5).map((c: any) => (
            <span key={c.id} className="flex min-w-0 max-w-full items-center gap-2 rounded-full bg-muted/50 py-1 pr-3 pl-1 text-xs">
              {c.image_url ? <img src={c.image_url} alt="" className="size-6 rounded-full object-cover" /> : null}
              {c.name}
            </span>
          ))}
        </div>
      );
    return step;
  };
  return (
    <Message from={m.role} className="copilot-msg-in min-w-0">
      <MessageContent
        className={cn(
          m.role === "assistant" ? cn("w-full max-w-full space-y-3 bg-transparent px-0 text-[15px] leading-relaxed", copilotMessageContentClass) : "copilot-user-bubble rounded-2xl rounded-br-md text-[15px] break-words [overflow-wrap:anywhere]",
        )}
      >
        {m.parts.map((p, i) => renderPart(p, i))}
      </MessageContent>
    </Message>
  );
});

export function CopilotChat({
  threadId,
  initialMessages,
  onActivity,
  onState,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  onActivity?: (() => void) | undefined;
  onState?: ((s: ChatActivity) => void) | undefined;
}) {
  const navigate = useNavigate();
  const loc = useRouterState({ select: (s) => ({ pathname: s.location.pathname, search: s.location.search as Record<string, unknown> }) });
  const pageRef = useRef(pageContext(loc.pathname, loc.search));
  pageRef.current = pageContext(loc.pathname, loc.search);
  const confirmLatest = useServerFn(copilotConfirmLatest);
  const vv = useVisualViewport(true);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/copilot",
        headers: async () => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token ? { Authorization: `Bearer ${token}` } : ({} as Record<string, string>);
        },
        body: () => ({ threadId, page: pageRef.current }),
      }),
    [threadId],
  );

  const [error, setError] = useState<string | null>(null);
  const { messages, sendMessage, setMessages, status, stop } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (e) => setError(e.message || "Não consegui responder agora."),
    onFinish: () => onActivity?.(),
  });

  const [outcomes, setOutcomes] = useState<Record<string, ActionOutcome | "canceled">>({});
  const setOutcome = useCallback((id: string, o: ActionOutcome | "canceled") => setOutcomes((s) => ({ ...s, [id]: o })), []);
  const [text, setText] = useState("");
  const [heard, setHeard] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = status === "submitted" || status === "streaming";

  const seen = useRef<Set<string>>(new Set(initialMessages.flatMap((m) => m.parts.map((p: Part) => p.toolCallId).filter(Boolean))));
  useEffect(() => {
    for (const m of messages)
      for (const p of m.parts as Part[]) {
        if (p.type === "tool-navigate" && p.state === "output-available" && !seen.current.has(p.toolCallId)) {
          seen.current.add(p.toolCallId);
          const to = p.output?.navigate as string | null;
          if (to) {
            const [path, qs] = to.split("?");
            navigate({ to: path as never, search: (qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined) as never });
          }
        }
      }
  }, [messages, navigate]);

  useEffect(() => {
    if (!busy) textareaRef.current?.focus();
  }, [busy, threadId]);

  const latestPending = (): ActionProposal | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role !== "assistant") continue;
      for (const p of [...(m.parts as Part[])].reverse()) {
        const o = p.output;
        if (p.type?.startsWith("tool-propose_") && o?.kind === "action" && !outcomes[o.action_id]) return o as ActionProposal;
      }
      return null;
    }
    return null;
  };

  const submitRef = useRef<(raw: string, fromVoice?: boolean) => Promise<void>>(async () => {});
  submitRef.current = async (raw: string, fromVoice = false) => {
    const value = raw.trim();
    if (!value || busy) return;
    setError(null);
    setText("");
    setMore(false);
    const pending = latestPending();
    if (YES.test(value) && pending) {
      try {
        const r = (await confirmLatest({ data: { threadId, actionId: pending.action_id } })) as ActionOutcome;
        setOutcome(pending.action_id, r);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não consegui confirmar.");
      }
      return;
    }
    setHeard(fromVoice ? value : null);
    await sendMessage({ text: value });
  };
  const submit = useCallback((t: string) => void submitRef.current(t), []);
  // perguntas prontas vindas de fora do chat (cartão do Copilot no Início)
  useEffect(() => {
    const on = () => {
      const t = takePendingAsk();
      if (t) void submitRef.current(t);
    };
    const pending = setTimeout(on, 250);
    window.addEventListener(COPILOT_ASK, on);
    return () => {
      clearTimeout(pending);
      window.removeEventListener(COPILOT_ASK, on);
    };
  }, []);

  // ---------------- voz (entrada única: /api/copilot-voice)
  const [voice, setVoice] = useState<"idle" | "listening" | "transcribing">("idle");
  const rec = useRef<VoiceRecording | null>(null);
  const pressAt = useRef(0);
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (voice !== "listening") return;
    let raf = 0;
    const tick = () => {
      setLevel(rec.current?.level() ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voice]);
  useEffect(() => () => rec.current?.cancel(), []);

  const finishRef = useRef<() => Promise<void>>(async () => {});
  const begin = async () => {
    if (rec.current || busy) return;
    setError(null);
    try {
      rec.current = await startVoiceRecording({ onAutoStop: () => void finishRef.current() });
      setVoice("listening");
    } catch {
      setError("Não consegui acessar o microfone. Libere o microfone nas configurações do navegador.");
    }
  };
  const cancelVoice = () => {
    rec.current?.cancel();
    rec.current = null;
    setVoice("idle");
  };
  finishRef.current = async () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setVoice("transcribing");
    try {
      const { file, speechMs } = await r.stop();
      if (speechMs < 200) {
        setVoice("idle");
        setError("Não ouvi nada. Toque e fale de novo.");
        return;
      }
      const { data } = await supabase.auth.getSession();
      const form = new FormData();
      form.append("file", file);
      form.append("speech_ms", String(speechMs));
      form.append("context", JSON.stringify({ threadId, page: pageRef.current }));
      const res = await fetch("/api/copilot-voice", {
        method: "POST",
        body: form,
        headers: data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {},
      });
      const out = await res.json().catch(() => ({}));
      setVoice("idle");
      if (!res.ok) throw new Error(out.error ?? "Não entendi. Tente de novo.");
      const pending = latestPending();
      if (out.control === "confirm" && pending) return void (await submitRef.current("sim", true));
      if (out.control === "cancel" && pending) {
        setOutcome(pending.action_id, "canceled");
        setHeard(out.transcript);
        return;
      }
      if (out.messages?.length) {
        setHeard(out.transcript);
        setMessages((prev) => [...prev, ...(out.messages as UIMessage[])]);
        onActivity?.();
        return;
      }
      await submitRef.current(out.transcript, true);
    } catch (e) {
      setVoice("idle");
      setError(e instanceof Error ? e.message : "Não entendi. Tente de novo.");
    }
  };
  const finish = () => void finishRef.current();
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    const on = () => {
      (window as any).__oriumListen = false;
      void beginRef.current();
    };
    if ((window as any).__oriumListen) setTimeout(on, 250);
    window.addEventListener("orium:copilot-listen", on);
    return () => window.removeEventListener("orium:copilot-listen", on);
  }, []);
  const correctBySpeaking = useCallback(() => void begin(), [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- estado para o orb/header
  const activity: ChatActivity = useMemo(() => {
    if (voice === "listening") return { orb: "listening", label: "Ouvindo…", level };
    if (voice === "transcribing") return { orb: "thinking", label: "Entendendo…" };
    if (status === "submitted") return { orb: "thinking", label: "Pensando…" };
    if (status === "streaming") {
      const last = messages[messages.length - 1];
      const running = [...((last?.parts as Part[] | undefined) ?? [])].reverse().find((p: Part) => p.type?.startsWith("tool-") && p.state !== "output-available" && p.state !== "output-error");
      if (running) return { orb: "working", label: toolLabel(running.type.slice(5), false) };
      return { orb: "thinking", label: "Respondendo…" };
    }
    return { orb: "idle", label: null };
  }, [voice, level, status, messages]);
  const lastLabel = useRef<string | null>(null);
  useEffect(() => {
    onState?.(activity);
    if (activity.orb === "idle" && lastLabel.current) {
      onState?.({ orb: "done", label: "Concluído" });
      const t = setTimeout(() => onState?.({ orb: "idle", label: null }), 1400);
      lastLabel.current = null;
      return () => clearTimeout(t);
    }
    if (activity.orb !== "idle" && activity.orb !== "listening") lastLabel.current = activity.label;
    return undefined;
  }, [activity, onState]);

  const suggestions = contextSuggestions(loc.pathname);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ paddingBottom: vv.keyboardOffset || undefined }}>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="min-w-0 gap-6 overflow-x-hidden px-4 pt-4 pb-8 sm:px-5">
          {messages.length === 0 ? (
            <div className="copilot-msg-in mx-auto mt-[8vh] w-full max-w-sm">
              <CopilotOrb state={activity.orb} level={level} size={44} />
              <h2 className="mt-6 font-display text-[28px] leading-tight">O que você precisa?</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">Você pode falar ou escrever.</p>
              <p className="mt-9 mb-2 text-[11px] tracking-[0.14em] text-muted-foreground/80 uppercase">Sugestões</p>
              <ul className="divide-y divide-border/40">
                {(more ? ALL_ACTIONS : suggestions).map((q, i) => (
                  <li key={q.label} className="copilot-msg-in" style={{ animationDelay: `${i * 35}ms` }}>
                    <button
                      onClick={() => submit(q.text)}
                      className="group flex min-h-12 w-full items-center gap-3 text-left text-[15px] transition-colors hover:text-gold"
                    >
                      <ArrowRight className="size-4 text-gold/70 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.6} />
                      {q.label}
                    </button>
                  </li>
                ))}
              </ul>
              {!more ? (
                <button onClick={() => setMore(true)} className="mt-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  Mais ações
                </button>
              ) : null}
            </div>
          ) : null}
          {messages.map((m) => (
            <MessageItem key={m.id} m={m} outcomes={outcomes} setOutcome={setOutcome} submit={submit} onCorrect={correctBySpeaking} />
          ))}
          {status === "submitted" ? (
            <div className="copilot-msg-in flex items-center gap-2.5 text-sm text-muted-foreground">
              <CopilotOrb state="thinking" size={20} />
              <Shimmer className="text-sm">{heard ? "Entendendo…" : "Analisando…"}</Shimmer>
            </div>
          ) : null}
          {error ? <p className="copilot-msg-in rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        </ConversationContent>
        <ConversationScrollButton className="copilot-glass bottom-3 h-9 w-auto gap-1.5 px-4 text-xs">
          Nova mensagem <ArrowDown className="size-3.5" />
        </ConversationScrollButton>
      </Conversation>

      <div className="relative px-3 pt-1" style={{ paddingBottom: vv.isKeyboardOpen ? 8 : "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
        {heard && voice === "idle" ? (
          <p className="copilot-msg-in mb-2 truncate px-2 text-xs text-muted-foreground">
            Você disse: <span className="text-foreground">“{heard}”</span>
          </p>
        ) : null}
        {more && messages.length > 0 ? (
          <div className="copilot-glass copilot-msg-in absolute right-3 bottom-full left-3 mb-2 max-h-72 overflow-y-auto rounded-2xl p-1.5">
            {ALL_ACTIONS.map((q) => (
              <button key={q.label} onClick={() => submit(q.text)} className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm hover:bg-muted/50">
                <ArrowRight className="size-3.5 text-gold/70" strokeWidth={1.6} /> {q.label}
              </button>
            ))}
          </div>
        ) : null}

        {voice !== "idle" ? (
          <div className="copilot-glass copilot-msg-in flex min-h-14 items-center gap-3 rounded-[26px] px-3" aria-live="polite">
            <CopilotOrb state={voice === "listening" ? "listening" : "thinking"} level={level} size={28} />
            <span className="copilot-wave flex h-6 flex-1 items-center gap-[3px]" aria-hidden>
              {Array.from({ length: 22 }).map((_, i) => {
                const k = 0.45 + Math.abs(Math.sin(i * 1.7)) * 0.9;
                return <span key={i} className="w-[3px] rounded-full bg-gold/80" style={{ height: `${voice === "listening" ? Math.max(3, Math.min(24, level * 90 * k)) : 3}px` }} />;
              })}
            </span>
            <span className="hidden text-xs text-muted-foreground sm:inline">{voice === "listening" ? "Estou ouvindo…" : "Entendendo…"}</span>
            {voice === "listening" ? (
              <>
                <button onClick={cancelVoice} aria-label="Cancelar" className="press grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-muted/60">
                  <X className="size-4" />
                </button>
                <button onClick={finish} aria-label="Concluir" className="press grid size-10 place-items-center rounded-full bg-gold text-background">
                  <Check className="size-4" strokeWidth={2.2} />
                </button>
              </>
            ) : (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : (
          <PromptInput onSubmit={(msg) => submit(msg.text ?? "")} className="copilot-glass copilot-composer rounded-[26px] border-0 [&_[data-slot=input-group]]:rounded-[26px] [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none">
            <PromptInputTextarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              placeholder="Digite ou fale com o Copilot…"
              className="min-h-11 bg-transparent text-base"
            />
            <PromptInputFooter className="justify-between pt-0">
              <button
                type="button"
                aria-label="Mais ações"
                onClick={() => setMore((v) => !v)}
                className={cn("press grid size-9 place-items-center rounded-full text-muted-foreground transition-transform hover:bg-muted/60", more && "rotate-45 text-foreground")}
              >
                <Plus className="size-[18px]" strokeWidth={1.6} />
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Falar (toque, ou segure e solte)"
                  onPointerDown={() => {
                    pressAt.current = Date.now();
                    void begin();
                  }}
                  onPointerUp={() => {
                    if (Date.now() - pressAt.current > 350) finish(); // segurar = soltar encerra
                  }}
                  disabled={busy}
                  className="press grid size-9 place-items-center rounded-full text-gold transition-colors hover:bg-gold/10 disabled:opacity-40"
                >
                  <Mic className="size-[18px]" strokeWidth={1.7} />
                </button>
                <PromptInputSubmit status={status} onStop={stop} disabled={!busy && !text.trim()} className="rounded-full" />
              </div>
            </PromptInputFooter>
          </PromptInput>
        )}
      </div>
    </div>
  );
}
