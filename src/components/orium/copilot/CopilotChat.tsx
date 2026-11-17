import { copilotMessageContentClass } from "./CopilotUI";
import { COPILOT_ASK, takePendingAsk } from "@/components/orium/copilot/ask";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ArrowDown, Boxes, Camera, Image as ImageIcon, ScanSearch, ChartNoAxesColumn, Check, Command, Eye, Loader2, Mic, Percent, Plus, Receipt, RefreshCw, ShoppingBag, Sparkles, Tag, Ticket, Truck, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, usePromptInputAttachments } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { startVoiceRecording, type VoiceRecording } from "@/lib/voice/recorder";
import { copilotConfirmLatest } from "@/lib/copilot.functions";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { ResearchCard } from "./PowerCards";
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
  research_perfume: ["Pesquisando o perfume na internet", "Ficha encontrada"],
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

/** Foto do celular → JPEG leve (até 1280px), boa para a IA ler o rótulo. */
async function shrinkImage(url: string, max = 1280): Promise<string> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k);
  const h = Math.round(img.naturalHeight * k);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.84);
}

/** Miniaturas das fotos escolhidas, dentro do campo (tira com o ✕). */
function PhotoTray({ onCount }: { onCount: (n: number) => void }) {
  const { files, remove } = usePromptInputAttachments();
  const imgs = files.filter((f) => /^image\//.test(f.mediaType));
  useEffect(() => onCount(imgs.length), [imgs.length, onCount]);
  if (!imgs.length) return null;
  return (
    <div className="flex w-full gap-2 overflow-x-auto px-3 pt-3 [scrollbar-width:none]">
      {imgs.map((f) => (
        <span key={f.id} className="cp-pop relative size-16 shrink-0 overflow-hidden rounded-[14px] bg-[#232323] ring-1 ring-white/10">
          <img src={f.url} alt="" className="size-full object-cover" />
          <button
            type="button"
            aria-label="Tirar foto"
            onClick={() => remove(f.id)}
            className="press absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/70 text-white backdrop-blur"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * Câmera direta (abre a câmera traseira do celular) e galeria.
 * O campo escondido com capture="environment" vai direto para a câmera;
 * no computador ele abre a escolha de arquivo normal.
 */
function PhotoButtons({ registerCamera }: { registerCamera: (fn: () => void) => void }) {
  const { add, openFileDialog } = usePromptInputAttachments();
  const cam = useRef<HTMLInputElement>(null);
  const openCamera = useCallback(() => cam.current?.click(), []);
  useEffect(() => registerCamera(openCamera), [openCamera, registerCamera]);
  const btn =
    "press grid size-9 shrink-0 place-items-center rounded-full bg-[#232323] text-[#D4D4D4] transition-colors hover:bg-[#2E2E2E] hover:text-white";
  return (
    <>
      <input
        ref={cam}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.currentTarget.files?.length) add(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
      <button type="button" aria-label="Tirar foto com a câmera" title="Câmera" onClick={openCamera} className={btn}>
        <Camera className="size-[18px]" />
      </button>
      <button type="button" aria-label="Escolher foto da galeria" title="Galeria" onClick={openFileDialog} className={btn}>
        <ImageIcon className="size-[18px]" />
      </button>
    </>
  );
}

/** Ícone de cada sugestão, pelo assunto. */
function SuggestionIcon({ text }: { text: string }) {
  const t = text.toLowerCase();
  const I =
    /venda/.test(t) ? Receipt
    : /dia|resumo/.test(t) ? ChartNoAxesColumn
    : /estoque|pronta/.test(t) ? Boxes
    : /cupom/.test(t) ? Ticket
    : /promo/.test(t) ? Percent
    : /pre[cç]o/.test(t) ? Tag
    : /fornecedor/.test(t) ? Truck
    : /reposi/.test(t) ? RefreshCw
    : /pedido/.test(t) ? ShoppingBag
    : /comando/.test(t) ? Command
    : Sparkles;
  return <I className="size-[18px]" strokeWidth={2} />;
}

/** Uma mensagem. Memoizada: durante o streaming só a última re-renderiza. */
const MessageItem = memo(function MessageItem({ m, outcomes, setOutcome, submit, onCorrect }: ItemProps) {
  const renderPart = (p: Part, i: number) => {
    if (p.type === "text")
      return m.role === "user" ? (
        <p key={i} className="whitespace-pre-wrap">{p.text}</p>
      ) : (
        <MessageResponse key={i}>{p.text}</MessageResponse>
      );
    if (p.type === "file" && /^image\//.test(p.mediaType ?? ""))
      return (
        <a key={i} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[16px]">
          <img src={p.url} alt="Foto enviada" className="max-h-56 w-auto max-w-full object-cover" loading="lazy" />
        </a>
      );
    if (typeof p.type !== "string" || !p.type.startsWith("tool-")) return null;
    const name = p.type.slice(5);
    const done = p.state === "output-available" || p.state === "output-error";
    const o = p.output;
    const step = (
      <p key={`s${i}`} className={cn("cp-step copilot-msg-in", done && "is-done")}>
        <span className="cp-step-dot">{done ? <Check className="size-3" strokeWidth={3} /> : null}</span>
        {done ? toolLabel(name, true) : <Shimmer className="text-[13px]">{toolLabel(name, false)}</Shimmer>}
      </p>
    );
    if (!done) return step;
    if (p.state === "output-error" || o?.error)
      return (
        <p key={i} className="copilot-msg-in rounded-[16px] bg-[#FF9A8A]/10 px-4 py-3 text-[14px] text-[#FF9A8A]">
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
          <div key={i} className="copilot-msg-in grid gap-1.5 rounded-[22px] bg-[#161616] p-1.5">
            {o.candidates.map((c: any, k: number) => (
              <button
                key={c.id}
                onClick={() => submit(`O ${c.name}${c.brand ? ` (${c.brand})` : ""}`)}
                className="cp-rise press flex min-h-14 items-center gap-3 rounded-[16px] p-2 text-left transition-colors hover:bg-[#222]"
                style={{ ["--i" as string]: k }}
              >
                {c.image_url ? (
                  <img src={c.image_url} alt="" className="size-11 shrink-0 rounded-[12px] bg-white object-contain p-0.5" />
                ) : (
                  <span className="size-11 shrink-0 rounded-[12px] bg-[#232323]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold">{c.name}</span>
                  {c.brand ? <span className="block truncate text-[12.5px] text-[#8C8C8C]">{c.brand}</span> : null}
                </span>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#232323] text-[#D4D4D4]">
                  <ArrowRight className="size-4" />
                </span>
              </button>
            ))}
          </div>
        );
      if (o?.kind === "needs" && o.options?.length)
        return (
          <div key={i} className="copilot-msg-in flex flex-wrap gap-2">
            {o.options.map((op: string, k: number) => (
              <button
                key={op}
                onClick={() => submit(op)}
                className="cp-rise press min-h-10 max-w-full rounded-full bg-[#1F1F1F] px-4 text-left text-[14px] font-semibold break-words transition-colors hover:bg-white hover:text-[#15130F]"
                style={{ ["--i" as string]: k }}
              >
                {op}
              </button>
            ))}
          </div>
        );
      return null;
    }
    if (name === "research_perfume" && o?.found) return <ResearchCard key={i} o={o} />;
    if (name === "get_product" && o?.name)
      return (
        <div key={i} className="copilot-card copilot-msg-in flex w-full min-w-0 max-w-md gap-3 rounded-[22px] p-3">
          {o.image_url ? <img src={o.image_url} alt={o.name} className="size-16 shrink-0 rounded-[14px] bg-white object-contain p-1" loading="lazy" /> : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] text-[#8C8C8C]">{o.brand ?? ""}</p>
            <p className="truncate text-[15px] font-bold">{o.name}</p>
            {o.orium_stock != null ? (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#232323] px-2.5 py-0.5 text-[12.5px] font-semibold">
                Estoque <span className="text-[#FFD599] tabular-nums">{o.orium_stock}</span>
              </p>
            ) : null}
          </div>
        </div>
      );
    if (name === "search_products" && o?.candidates?.length)
      return (
        <div key={i} className="copilot-msg-in flex flex-wrap gap-1.5">
          {o.candidates.slice(0, 5).map((c: any) => (
            <span key={c.id} className="flex min-w-0 max-w-full items-center gap-2 rounded-full bg-[#1A1A1A] py-1 pr-3 pl-1 text-[12.5px] font-medium">
              {c.image_url ? <img src={c.image_url} alt="" className="size-6 rounded-full bg-white object-contain" /> : null}
              <span className="truncate">{c.name}</span>
            </span>
          ))}
        </div>
      );
    return step;
  };
  if (m.role === "user")
    return (
      <div className="copilot-msg-in flex min-w-0 justify-end">
        <div className="cp-user max-w-[85%] space-y-2 rounded-[22px] rounded-br-[8px] px-4 py-2.5 text-[15px] leading-relaxed break-words [overflow-wrap:anywhere] has-[img]:p-1.5 has-[img]:pb-2.5 [&>p]:px-2.5">
          {m.parts.map((p, i) => renderPart(p, i))}
        </div>
      </div>
    );
  return (
    <div className="copilot-msg-in flex min-w-0 gap-3">
      <CopilotOrb size={26} className="mt-0.5" />
      <div className={cn("min-w-0 flex-1 space-y-3 text-[15px] leading-relaxed text-[#E6E6E6] [&>.size-full]:h-auto", copilotMessageContentClass)}>
        {m.parts.map((p, i) => renderPart(p, i))}
      </div>
    </div>
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
  const { session } = useAuth();

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
  const [photoCount, setPhotoCount] = useState(0);
  const openPhotos = useRef<() => void>(() => {});
  const registerOpen = useCallback((fn: () => void) => {
    openPhotos.current = fn;
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const busy = status === "submitted" || status === "streaming" || sending;

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

  const submitRef = useRef<(raw: string, fromVoice?: boolean, files?: FileUIPart[]) => Promise<void>>(async () => {});
  submitRef.current = async (raw: string, fromVoice = false, files: FileUIPart[] = []) => {
    const value = raw.trim();
    const images = files.filter((f) => /^image\//.test(f.mediaType));
    // um envio por vez: preparar a foto leva um instante e um segundo toque mandava tudo de novo
    if ((!value && !images.length) || busy || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await sendNow(value, images, fromVoice);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const sendNow = async (value: string, images: FileUIPart[], fromVoice: boolean) => {
    setError(null);
    setText("");
    setMore(false);
    const pending = latestPending();
    if (YES.test(value) && pending && !images.length) {
      try {
        const r = (await confirmLatest({ data: { threadId, actionId: pending.action_id } })) as ActionOutcome;
        setOutcome(pending.action_id, r);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não consegui confirmar.");
      }
      return;
    }
    setHeard(fromVoice ? value : null);
    if (images.length) {
      const small = await Promise.all(images.map((f) => shrinkImage(f.url).catch(() => f.url)));
      // não espera a resposta inteira: o campo (e as fotos) limpam na hora
      void sendMessage({
        text: value || "Que perfume é esse?",
        files: small.map((url, k) => ({ type: "file" as const, mediaType: "image/jpeg", url, filename: `foto-${k + 1}.jpg` })),
      });
      return;
    }
    void sendMessage({ text: value });
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
  const lastKey = useRef("");
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (doneTimer.current) clearTimeout(doneTimer.current);
  }, []);
  useEffect(() => {
    // durante a resposta a lista de mensagens muda a cada pedacinho: só avisa quando o estado muda de verdade
    const key = `${activity.orb}|${activity.label ?? ""}|${Math.round((activity.level ?? 0) * 50)}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (doneTimer.current) clearTimeout(doneTimer.current);
    onState?.(activity);
    if (activity.orb === "idle" && lastLabel.current) {
      onState?.({ orb: "done", label: "Concluído" });
      doneTimer.current = setTimeout(() => onState?.({ orb: "idle", label: null }), 1400);
      lastLabel.current = null;
      return;
    }
    if (activity.orb !== "idle" && activity.orb !== "listening") lastLabel.current = activity.label;
  }, [activity, onState]);

  const suggestions = contextSuggestions(loc.pathname);
  const page = pageName(loc.pathname);
  const hourNow = new Date().getHours();
  const greeting = hourNow < 5 ? "Boa noite" : hourNow < 12 ? "Bom dia" : hourNow < 18 ? "Boa tarde" : "Boa noite";
  const first = firstName(session);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ paddingBottom: vv.keyboardOffset || undefined }}>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="min-w-0 gap-7 overflow-x-hidden px-4 pt-3 pb-8 sm:px-5">
          {messages.length === 0 ? (
            <div className="mx-auto flex w-full max-w-[440px] flex-col items-center pt-[4vh] text-center">
              <div className="cp-hero-orb">
                <CopilotOrb state={activity.orb} level={level} size={112} />
              </div>
              <p className="cp-rise mt-8 text-[15px] font-semibold text-[#8C8C8C]" style={{ ["--i" as string]: 1 }}>
                {greeting}
                {first ? `, ${first}` : ""}
              </p>
              <h2 className="cp-rise mt-1 text-[30px] leading-[1.08] font-bold tracking-[-0.04em]" style={{ ["--i" as string]: 2 }}>
                Como posso ajudar <span className="cp-gold-text">hoje?</span>
              </h2>
              <p className="cp-rise mt-2 max-w-[320px] text-[14.5px] leading-snug text-[#8C8C8C]" style={{ ["--i" as string]: 3 }}>
                Fale ou escreva. Eu consulto, preparo e você só confirma.
              </p>
              <button
                type="button"
                onClick={() => openPhotos.current()}
                className="cp-suggest cp-photo-card cp-rise press group mt-8 flex w-full items-center gap-4 rounded-[22px] p-4 text-left"
                style={{ ["--i" as string]: 4 }}
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[#15130F] transition-transform duration-300 group-hover:scale-110">
                  <ScanSearch className="size-[22px]" strokeWidth={2.1} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold">Reconhecer pela foto</span>
                  <span className="block text-[13px] leading-snug text-[#8C8C8C]">Abre a câmera: tire a foto de um perfume e eu identifico, pesquiso e cadastro.</span>
                </span>
              </button>
              <div className="mt-2.5 grid w-full grid-cols-2 gap-2.5">
                {suggestions.map((q, i) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => submit(q.text)}
                    className="cp-suggest cp-rise press group flex min-h-[104px] flex-col items-start justify-between gap-3 rounded-[22px] p-4 text-left"
                    style={{ ["--i" as string]: i + 4 }}
                  >
                    <span className="grid size-9 place-items-center rounded-full bg-[#232323] text-[#FFD599] transition-colors duration-300 group-hover:bg-[#FFD599] group-hover:text-[#15130F]">
                      <SuggestionIcon text={q.text} />
                    </span>
                    <span className="text-[14.5px] leading-snug font-semibold">{q.label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setMore((v) => !v)}
                className="cp-rise press mt-4 inline-flex h-10 items-center gap-1.5 rounded-full bg-[#161616] px-4 text-[13.5px] font-semibold text-[#BABABA] hover:bg-[#1F1F1F] hover:text-white"
                style={{ ["--i" as string]: 9 }}
              >
                <Plus className={cn("size-4 transition-transform duration-300", more && "rotate-45")} />
                {more ? "Menos" : "Mais ações"}
              </button>
              {more ? (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {ALL_ACTIONS.filter((a) => !suggestions.some((s) => s.label === a.label)).map((q, i) => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => submit(q.text)}
                      className="cp-rise press inline-flex h-10 items-center gap-2 rounded-full bg-[#1A1A1A] pr-4 pl-3 text-[13.5px] font-semibold hover:bg-white hover:text-[#15130F]"
                      style={{ ["--i" as string]: i }}
                    >
                      <SuggestionIcon text={q.text} />
                      {q.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {messages.map((m) => (
            <MessageItem key={m.id} m={m} outcomes={outcomes} setOutcome={setOutcome} submit={submit} onCorrect={correctBySpeaking} />
          ))}
          {status === "submitted" ? (
            <div className="copilot-msg-in flex items-center gap-3">
              <CopilotOrb state="thinking" size={26} />
              <Shimmer className="text-[14px]">{heard ? "Entendendo…" : "Pensando…"}</Shimmer>
            </div>
          ) : null}
          {error ? <p className="copilot-msg-in rounded-[16px] bg-[#FF9A8A]/10 px-4 py-3 text-[14px] text-[#FF9A8A]">{error}</p> : null}
        </ConversationContent>
        <ConversationScrollButton className="bottom-3 h-9 w-auto gap-1.5 rounded-full border-0 bg-[#232323] px-4 text-[12.5px] font-semibold text-white hover:bg-[#2E2E2E]">
          Nova mensagem <ArrowDown className="size-3.5" />
        </ConversationScrollButton>
      </Conversation>

      <div className="relative px-3 pt-1 lg:px-4" style={{ paddingBottom: vv.isKeyboardOpen ? 8 : "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}>
        {heard && voice === "idle" ? (
          <p className="copilot-msg-in mb-2 truncate px-2 text-[12.5px] text-[#8C8C8C]">
            Você disse: <span className="text-white">“{heard}”</span>
          </p>
        ) : null}
        {more && messages.length > 0 ? (
          <div className="cp-pop absolute right-3 bottom-full left-3 mb-2 max-h-72 overflow-y-auto rounded-[22px] bg-[#1A1A1A] p-1.5 ring-1 ring-white/[0.06] lg:right-4 lg:left-4">
            {ALL_ACTIONS.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => submit(q.text)}
                className="flex min-h-11 w-full items-center gap-3 rounded-[14px] px-3 text-left text-[14px] font-medium hover:bg-[#242424]"
              >
                <span className="text-[#FFD599]">
                  <SuggestionIcon text={q.text} />
                </span>
                {q.label}
              </button>
            ))}
          </div>
        ) : null}

        {voice !== "idle" ? (
          <div className="cp-voice copilot-msg-in rounded-[28px] p-4" aria-live="polite">
            <div className="flex items-center gap-3.5">
              <CopilotOrb state={voice === "listening" ? "listening" : "thinking"} level={level} size={48} halo />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold">{voice === "listening" ? "Estou ouvindo" : "Entendendo…"}</p>
                <p className="truncate text-[12.5px] text-[#8C8C8C]">{voice === "listening" ? "Fale naturalmente. Toque em Pronto ao terminar." : "Só um instante."}</p>
              </div>
            </div>
            <span className="copilot-wave mt-4 flex h-9 items-center justify-center gap-[3px]" aria-hidden>
              {Array.from({ length: 36 }).map((_, i) => {
                const k = 0.4 + Math.abs(Math.sin(i * 1.7)) * 0.95;
                return (
                  <span
                    key={i}
                    className="w-[3px] rounded-full bg-[#FFD599]"
                    style={{ height: `${voice === "listening" ? Math.max(4, Math.min(36, level * 140 * k)) : 4}px`, opacity: 0.35 + k * 0.5 }}
                  />
                );
              })}
            </span>
            <div className="mt-4 flex gap-2">
              {voice === "listening" ? (
                <>
                  <button type="button" onClick={cancelVoice} className="press inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#232323] text-[15px] font-semibold hover:bg-[#2E2E2E]">
                    <X className="size-[18px]" /> Cancelar
                  </button>
                  <button type="button" onClick={finish} className="press inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F]">
                    <Check className="size-[18px]" strokeWidth={2.6} /> Pronto
                  </button>
                </>
              ) : (
                <span className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#1F1F1F] text-[14px] text-[#A9A9A9]">
                  <Loader2 className="size-4 animate-spin" /> Transcrevendo
                </span>
              )}
            </div>
          </div>
        ) : (
          <PromptInput
            accept="image/*"
            multiple
            maxFiles={4}
            onError={(e) => setError(e.code === "max_files" ? "Mande até 4 fotos por vez." : "Use uma foto (JPG, PNG ou WEBP).")}
            onSubmit={(msg) => submitRef.current(msg.text ?? "", false, msg.files ?? [])}
            className="cp-composer rounded-[28px] border-0 [&_[data-slot=input-group]]:rounded-[28px] [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none"
          >
            <PhotoTray onCount={setPhotoCount} />
            <PromptInputTextarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              placeholder={photoCount ? "O que fazer com a foto? (ou só envie)" : "Pergunte, peça ou mande uma foto…"}
              className="min-h-12 bg-transparent px-4 pt-3.5 text-[16px] placeholder:text-[#6F6F6F]"
            />
            <PromptInputFooter className="items-center justify-between gap-2 px-2.5 pt-0 pb-2.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Mais ações"
                  onClick={() => setMore((v) => !v)}
                  className={cn(
                    "press grid size-9 shrink-0 place-items-center rounded-full bg-[#232323] text-[#D4D4D4] transition-[transform,background-color] duration-300 hover:bg-[#2E2E2E]",
                    more && "rotate-45 bg-white text-[#15130F]",
                  )}
                >
                  <Plus className="size-[18px]" />
                </button>
                <PhotoButtons registerCamera={registerOpen} />
                {page ? (
                  <span className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-full bg-[#1F1F1F] px-3 text-[12.5px] font-semibold text-[#A9A9A9]" title="O Copilot sabe em que tela você está">
                    <Eye className="size-3.5 shrink-0" />
                    <span className="truncate">{page}</span>
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Falar (toque, ou segure e solte)"
                  title="Falar"
                  onPointerDown={() => {
                    pressAt.current = Date.now();
                    void begin();
                  }}
                  onPointerUp={() => {
                    if (Date.now() - pressAt.current > 350) finish(); // segurar = soltar encerra
                  }}
                  disabled={busy}
                  className="press grid size-10 place-items-center rounded-full bg-[#232323] text-[#FFD599] transition-colors hover:bg-[#2E2E2E] disabled:opacity-40"
                >
                  <Mic className="size-[18px]" strokeWidth={2.1} />
                </button>
                <PromptInputSubmit
                  status={status}
                  onStop={stop}
                  disabled={!busy && !text.trim() && !photoCount}
                  className="size-10 rounded-full bg-[#FFD599] text-[#15130F] hover:bg-[#FFDDAA] disabled:bg-[#232323] disabled:text-[#6F6F6F] disabled:opacity-100"
                />
              </div>
            </PromptInputFooter>
          </PromptInput>
        )}
        <p className="mt-2 hidden text-center text-[11.5px] text-[#5A5A5A] lg:block">Ctrl J abre e fecha · nada é feito sem você confirmar</p>
      </div>
    </div>
  );
}

const PAGE_NAMES: Array<[RegExp, string]> = [
  [/^\/admin\/?$/, "Início"],
  [/^\/admin\/pedidos/, "Pedidos"],
  [/^\/admin\/produtos\/[0-9a-f-]{36}/i, "Este perfume"],
  [/^\/admin\/produtos/, "Produtos"],
  [/^\/admin\/estoque/, "Estoque"],
  [/^\/admin\/vendas-loja/, "Vendas da loja"],
  [/^\/admin\/negociacao/, "Negociação"],
  [/^\/admin\/reposicao/, "Reposição"],
  [/^\/admin\/fornecedores/, "Fornecedores"],
  [/^\/admin\/clientes/, "Clientes"],
  [/^\/admin\/precificacao/, "Preços"],
];
const pageName = (path: string) => PAGE_NAMES.find(([re]) => re.test(path))?.[1] ?? null;

function firstName(session: ReturnType<typeof useAuth>["session"]) {
  const meta = (session?.user.user_metadata ?? {}) as Record<string, unknown>;
  const name = String(meta["name"] ?? meta["full_name"] ?? "").trim();
  return name.split(/\s+/)[0] ?? "";
}
