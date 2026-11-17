/**
 * ORIUM COPILOT — painel.
 *
 * Sem bolinha flutuante: o Copilot abre pela pílula do topo (computador), pelo
 * orbe no centro da barra de baixo (celular; segurar = falar) ou por Ctrl/⌘ J.
 * No computador ele encaixa à direita, flutuando, e a página encolhe ao lado.
 * No celular ocupa a tela toda.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { History, Maximize2, MessageSquarePlus, Search, Trash2, X } from "lucide-react";
import type { UIMessage } from "ai";
import { copilotCreateThread, copilotDeleteThread, copilotThread, copilotThreads } from "@/lib/copilot.functions";
import { CopilotChat, type ChatActivity } from "./CopilotChat";
import { CopilotOrb } from "./CopilotOrb";
import { askCopilot } from "./ask";
import { cn } from "@/lib/utils";

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  /** abre e já começa a ouvir */
  listen: () => void;
  /** abre e envia a pergunta */
  ask: (text: string) => void;
  /** estado do orbe (para a pílula do topo e a aba do celular) */
  activity: ChatActivity;
};
const CopilotCtx = createContext<Ctx>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
  listen: () => {},
  ask: () => {},
  activity: { orb: "idle", label: null },
});
export const useCopilot = () => useContext(CopilotCtx);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState<ChatActivity>({ orb: "idle", label: null });
  // mantém montado durante a animação de recolher
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    if (open) return setRendered(true);
    const t = setTimeout(() => setRendered(false), 300);
    return () => clearTimeout(t);
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const listen = useCallback(() => {
    (window as any).__oriumListen = true;
    setOpen(true);
    setTimeout(() => window.dispatchEvent(new CustomEvent("orium:copilot-listen")), 380);
  }, []);
  const ask = useCallback((text: string) => askCopilot(text, setOpen), []);

  // Ctrl/⌘ J abre e fecha de qualquer tela do Admin
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ open, setOpen, toggle, listen, ask, activity }), [open, toggle, listen, ask, activity]);
  return (
    <CopilotCtx.Provider value={value}>
      {children}
      {rendered || open ? <CopilotPanel closing={!open} onClose={() => setOpen(false)} onActivity={setActivity} /> : null}
    </CopilotCtx.Provider>
  );
}

/** Mantidos por compatibilidade (a bolinha flutuante saiu). */
export function CopilotIsland() {
  return null;
}
export function CopilotButton() {
  return null;
}

/** Conversa carregada do servidor; o id vem da lista (ou é criado). */
export function CopilotThreadView({
  threadId,
  onActivity,
  onState,
}: {
  threadId: string;
  onActivity?: (() => void) | undefined;
  onState?: ((s: ChatActivity) => void) | undefined;
}) {
  const load = useServerFn(copilotThread);
  const { data, isLoading } = useQuery({ queryKey: ["copilot-thread", threadId], queryFn: () => load({ data: { id: threadId } }), staleTime: Infinity });
  if (isLoading)
    return (
      <div className="grid h-full place-items-center">
        <CopilotOrb state="thinking" size={56} />
      </div>
    );
  if (!data) return <div className="p-6 text-[15px] text-[#8C8C8C]">Conversa não encontrada.</div>;
  return (
    <CopilotChat
      key={threadId}
      threadId={threadId}
      initialMessages={JSON.parse(data.messagesJson || "[]") as UIMessage[]}
      onActivity={onActivity}
      onState={onState}
    />
  );
}

const IconBtn = ({ label, onClick, children, active }: { label: string; onClick?: () => void; children: ReactNode; active?: boolean }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    aria-pressed={active}
    className={cn(
      "press grid size-10 shrink-0 place-items-center rounded-full transition-colors duration-200 [&_svg]:size-[18px]",
      active ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#D4D4D4] hover:bg-[#242424] hover:text-white",
    )}
  >
    {children}
  </button>
);

function groupOf(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= start) return "Hoje";
  if (t >= start - 86_400_000) return "Ontem";
  if (t >= start - 6 * 86_400_000) return "Últimos 7 dias";
  return "Antes";
}

function CopilotPanel({ onClose, closing, onActivity }: { onClose: () => void; closing: boolean; onActivity: (a: ChatActivity) => void }) {
  const qc = useQueryClient();
  const list = useServerFn(copilotThreads);
  const create = useServerFn(copilotCreateThread);
  const remove = useServerFn(copilotDeleteThread);
  const threads = useQuery({ queryKey: ["copilot-threads"], queryFn: () => list() });
  const [active, setActive] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [q, setQ] = useState("");
  const [activity, setActivity] = useState<ChatActivity>({ orb: "idle", label: null });
  const shared = useRef("idle|");

  const onState = useCallback(
    (a: ChatActivity) => {
      setActivity(a);
      // fora do painel só importa o estado (não o volume da voz a cada quadro)
      const k = `${a.orb}|${a.label ?? ""}`;
      if (k !== shared.current) {
        shared.current = k;
        onActivity({ orb: a.orb, label: a.label });
      }
    },
    [onActivity],
  );
  useEffect(() => () => onActivity({ orb: "idle", label: null }), [onActivity]);

  const newThread = useCallback(async () => {
    const { id } = await create();
    qc.setQueryData(["copilot-thread", id], { id, title: null, messagesJson: "[]" });
    setActive(id);
    setShowList(false);
    void qc.invalidateQueries({ queryKey: ["copilot-threads"] });
  }, [create, qc]);

  // abre sempre numa conversa limpa se a última já tem mensagens antigas? Não:
  // continua a mais recente (o histórico fica a um toque).
  useEffect(() => {
    if (active || !threads.data) return;
    if (threads.data[0]) setActive(threads.data[0].id);
    else void newThread();
  }, [threads.data, active, newThread]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showList) setShowList(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, showList]);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = new Map<string, NonNullable<typeof threads.data>>();
    for (const t of threads.data ?? []) {
      if (term && !(t.title ?? "nova conversa").toLowerCase().includes(term)) continue;
      const g = groupOf(t.updated_at);
      out.set(g, [...(out.get(g) ?? []), t]);
    }
    return Array.from(out.entries());
  }, [threads.data, q]);

  const busy = activity.orb !== "idle";

  return (
    <div
      role="dialog"
      aria-label="Orium Copilot"
      data-closing={closing}
      className="cp-panel admin-theme fixed inset-0 z-[55] flex flex-col overflow-hidden bg-[#0C0C0C] text-white lg:inset-y-3 lg:right-3 lg:left-auto lg:w-[var(--copilot-w)] lg:rounded-[30px] lg:border lg:border-white/[0.07]"
    >
      <div className="cp-aurora pointer-events-none absolute inset-x-0 top-0 h-[340px]" aria-hidden />

      <header className="relative z-20 flex shrink-0 items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 lg:px-4 lg:pt-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 pl-1">
          <CopilotOrb state={activity.orb} level={activity.level ?? 0} size={34} />
          <div className="min-w-0 leading-tight">
            <p className="text-[17px] font-bold tracking-[-0.02em]">Copilot</p>
            <p key={activity.label ?? "idle"} className={cn("cp-fade truncate text-[12.5px]", busy ? "text-[#FFD599]" : "text-[#8C8C8C]")} aria-live="polite">
              {activity.label ?? "Orium Intelligence"}
            </p>
          </div>
        </div>
        <IconBtn label="Nova conversa" onClick={newThread}>
          <MessageSquarePlus />
        </IconBtn>
        <IconBtn label="Conversas" onClick={() => setShowList((v) => !v)} active={showList}>
          <History />
        </IconBtn>
        {active ? (
          <Link
            to="/admin/copilot/$threadId"
            params={{ threadId: active }}
            onClick={onClose}
            className="press hidden size-10 shrink-0 place-items-center rounded-full bg-[#1A1A1A] text-[#D4D4D4] transition-colors hover:bg-[#242424] hover:text-white sm:grid"
            aria-label="Abrir em tela cheia"
            title="Tela cheia"
          >
            <Maximize2 className="size-[17px]" />
          </Link>
        ) : null}
        <IconBtn label="Fechar Copilot (Esc)" onClick={onClose}>
          <X />
        </IconBtn>
      </header>

      <div className="cp-content relative min-h-0 flex-1">
        {/* histórico de conversas */}
        <div className={cn("cp-history absolute inset-0 z-10 flex flex-col bg-[#0C0C0C]", showList ? "is-open" : "pointer-events-none")} aria-hidden={!showList}>
          <div className="shrink-0 px-4 pt-2 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-[#6F6F6F]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar conversa"
                tabIndex={showList ? 0 : -1}
                className="pk-field h-12 w-full rounded-[16px] bg-[#1A1A1A] pr-4 pl-11 text-[16px] text-white outline-none placeholder:text-[#6F6F6F] focus:bg-[#222]"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6">
            <button
              type="button"
              tabIndex={showList ? 0 : -1}
              onClick={newThread}
              className="press mb-3 flex w-full items-center gap-3 rounded-[18px] bg-[#FFD599] px-4 py-3 text-left text-[15px] font-bold text-[#15130F]"
            >
              <MessageSquarePlus className="size-[18px]" /> Nova conversa
            </button>
            {groups.length === 0 ? <p className="px-3 py-6 text-center text-[14px] text-[#8C8C8C]">Nenhuma conversa.</p> : null}
            {groups.map(([label, items]) => (
              <div key={label} className="mb-4">
                <p className="px-3 pb-1.5 text-[12px] font-semibold text-[#6F6F6F]">{label}</p>
                {items.map((t) => (
                  <div key={t.id} className={cn("group flex items-center gap-1 rounded-[16px] transition-colors", t.id === active ? "bg-[#1F1F1F]" : "hover:bg-[#161616]")}>
                    <button
                      type="button"
                      tabIndex={showList ? 0 : -1}
                      className="min-h-[52px] min-w-0 flex-1 px-3 py-2 text-left"
                      onClick={() => {
                        setActive(t.id);
                        setShowList(false);
                      }}
                    >
                      <span className="block truncate text-[15px] font-semibold">{t.title ?? "Nova conversa"}</span>
                      <span className="block text-[12.5px] text-[#8C8C8C]">
                        {new Date(t.updated_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </button>
                    <button
                      type="button"
                      tabIndex={showList ? 0 : -1}
                      className="press mr-1 grid size-10 place-items-center rounded-full text-[#6F6F6F] transition-colors hover:bg-[#2A2A2A] hover:text-[#FF9A8A] lg:opacity-0 lg:group-hover:opacity-100"
                      aria-label="Apagar conversa"
                      onClick={async () => {
                        await remove({ data: { id: t.id } });
                        if (t.id === active) setActive(null);
                        void qc.invalidateQueries({ queryKey: ["copilot-threads"] });
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {active ? (
          <CopilotThreadView threadId={active} onState={onState} onActivity={() => void qc.invalidateQueries({ queryKey: ["copilot-threads"] })} />
        ) : (
          <div className="grid h-full place-items-center">
            <CopilotOrb state="thinking" size={56} />
          </div>
        )}
      </div>
    </div>
  );
}
