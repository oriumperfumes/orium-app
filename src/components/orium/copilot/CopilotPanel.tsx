import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { History, Plus, X, Trash2, Maximize2 } from "lucide-react";
import type { UIMessage } from "ai";
import { copilotCreateThread, copilotDeleteThread, copilotThread, copilotThreads } from "@/lib/copilot.functions";
import { CopilotChat, type ChatActivity } from "./CopilotChat";
import { CopilotOrb } from "./CopilotOrb";
import { cn } from "@/lib/utils";

type Ctx = { open: boolean; setOpen: (v: boolean) => void };
const CopilotCtx = createContext<Ctx>({ open: false, setOpen: () => {} });
export const useCopilot = () => useContext(CopilotCtx);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // mantém montado durante a animação de recolher
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    if (open) return setRendered(true);
    const t = setTimeout(() => setRendered(false), 230);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <CopilotCtx.Provider value={{ open, setOpen }}>
      {children}
      <CopilotIsland />
      {rendered || open ? <CopilotPanel closing={!open} onClose={() => setOpen(false)} /> : null}
    </CopilotCtx.Provider>
  );
}

/** Ilha flutuante liquid glass — o acesso ao Copilot fica fora do header. */
export function CopilotIsland({ pending = false }: { pending?: boolean }) {
  const { open, setOpen } = useCopilot();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  const clamp = useCallback((x: number, y: number) => {
    const w = ref.current?.offsetWidth ?? 52;
    const h = ref.current?.offsetHeight ?? 52;
    return {
      x: Math.min(Math.max(8, x), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, y), window.innerHeight - h - 8),
    };
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("orium-copilot-pos") || "null");
      if (saved && typeof saved.x === "number") setPos(clamp(saved.x, saved.y));
    } catch {}
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  return (
    <button
      ref={ref}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        drag.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) < 6) return;
        d.moved = true;
        setPos(clamp(d.ox + dx, d.oy + dy));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) {
          setPos((p) => {
            if (p) localStorage.setItem("orium-copilot-pos", JSON.stringify(p));
            return p;
          });
        } else setOpen(true);
      }}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(true)}
      data-open={open}
      data-dragging={drag.current?.moved ? "true" : undefined}
      className="copilot-island"
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto", touchAction: "none" } : { touchAction: "none" }}
      aria-label="Abrir Orium Copilot (arraste para mover)"
      aria-expanded={open}
    >
      <span className="copilot-orb">
        <CopilotOrb size={30} />
        {pending ? <span className="copilot-badge" /> : null}
      </span>
      <span className="copilot-island-label font-display">Copilot</span>
    </button>
  );
}

/** Mantido por compatibilidade; o header não usa mais. */
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
        <CopilotOrb state="thinking" size={32} />
      </div>
    );
  if (!data) return <div className="p-6 text-sm text-muted-foreground">Conversa não encontrada.</div>;
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

const IconBtn = ({ label, onClick, children, className }: { label: string; onClick?: () => void; children: ReactNode; className?: string }) => (
  <button
    onClick={onClick}
    aria-label={label}
    title={label}
    className={cn("press grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground", className)}
  >
    {children}
  </button>
);

function CopilotPanel({ onClose, closing }: { onClose: () => void; closing: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(copilotThreads);
  const create = useServerFn(copilotCreateThread);
  const remove = useServerFn(copilotDeleteThread);
  const threads = useQuery({ queryKey: ["copilot-threads"], queryFn: () => list() });
  const [active, setActive] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [activity, setActivity] = useState<ChatActivity>({ orb: "idle", label: null });

  const newThread = useCallback(async () => {
    const { id } = await create();
    qc.setQueryData(["copilot-thread", id], { id, title: null, messagesJson: "[]" });
    setActive(id);
    setShowList(false);
    void qc.invalidateQueries({ queryKey: ["copilot-threads"] });
  }, [create, qc]);

  useEffect(() => {
    if (active || !threads.data) return;
    if (threads.data[0]) setActive(threads.data[0].id);
    else void newThread();
  }, [threads.data, active, newThread]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Orium Copilot"
      data-closing={closing}
      className="copilot-panel copilot-surface fixed inset-0 z-[55] flex flex-col overflow-hidden lg:left-auto lg:w-[var(--copilot-w)] lg:border lg:border-border/40 lg:shadow-lift"
    >
      <header className="header-safe relative z-20 flex min-h-14 items-center gap-1 px-2 lg:pt-0">
        <IconBtn label="Fechar Copilot" onClick={onClose}>
          <X className="size-[18px]" strokeWidth={1.6} />
        </IconBtn>
        <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
          <CopilotOrb state={activity.orb} level={activity.level ?? 0} size={26} />
          <div className="min-w-0 leading-tight">
            <p className="font-display text-[17px]">Copilot</p>
            <p
              key={activity.label ?? "idle"}
              className={cn("copilot-msg-in truncate text-[11px] text-muted-foreground", !activity.label && "opacity-70")}
              aria-live="polite"
            >
              {activity.label ?? "Orium Intelligence"}
            </p>
          </div>
        </div>
        <IconBtn label="Nova conversa" onClick={newThread}>
          <Plus className="size-[18px]" strokeWidth={1.6} />
        </IconBtn>
        <IconBtn label="Conversas" onClick={() => setShowList((v) => !v)} className={cn(showList && "bg-muted/60 text-foreground")}>
          <History className="size-[17px]" strokeWidth={1.6} />
        </IconBtn>
        {active ? (
          <Link
            to="/admin/copilot/$threadId"
            params={{ threadId: active }}
            onClick={onClose}
            className="press hidden size-10 place-items-center rounded-full text-muted-foreground hover:text-foreground sm:grid"
            aria-label="Abrir em tela cheia"
          >
            <Maximize2 className="size-4" strokeWidth={1.6} />
          </Link>
        ) : null}
      </header>

      <div className="copilot-panel-content relative min-h-0 flex-1">
        {showList ? (
          <div className="copilot-msg-in absolute inset-0 z-10 overflow-y-auto bg-[#101010] p-2">
            <p className="px-3 pt-2 pb-1 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Conversas</p>
            {(threads.data ?? []).map((t) => (
              <div key={t.id} className={cn("flex items-center gap-1 rounded-xl", t.id === active && "bg-muted/60")}>
                <button
                  className="min-h-12 min-w-0 flex-1 truncate px-3 text-left text-sm"
                  onClick={() => {
                    setActive(t.id);
                    setShowList(false);
                  }}
                >
                  {t.title ?? "Nova conversa"}
                  <span className="block text-xs text-muted-foreground">
                    {new Date(t.updated_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
                <button
                  className="grid size-11 place-items-center text-muted-foreground"
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
        ) : null}
        {active ? (
          <CopilotThreadView threadId={active} onState={setActivity} onActivity={() => void qc.invalidateQueries({ queryKey: ["copilot-threads"] })} />
        ) : null}
      </div>
    </div>
  );
}
