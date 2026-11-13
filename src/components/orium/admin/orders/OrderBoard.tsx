/**
 * QUADRO DE PEDIDOS — Novos · Pagos · Entregues.
 * No computador dá para arrastar o cartão de uma coluna para outra;
 * no celular as colunas viram abas. Cada cartão mostra o essencial sem abrir.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Loader2, MessageCircle } from "lucide-react";
import { OrderMenuButton } from "./OrderMenu";
import { brl, whatsappLink } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DeliveryChip,
  PayBar,
  PhotoStack,
  STAGES,
  initials,
  orderTotal,
  originOf,
  stageOf,
  timeAgo,
  type Stage,
} from "./model";

export type Quick = { label: string; run: (at?: { x: number; y: number }) => void } | null;

import { PhaseBar, PhaseChip, type PhaseInfo } from "./phase";

export type CardDeps = {
  linesOf: (o: any) => any[];
  imageOf: (line: any) => string | null | undefined;
  quickOf: (o: any) => Quick;
  onOpen: (o: any, from?: HTMLElement | null) => void;
  busyId: string | null;
  /** fase do pedido (pagamento → fornecedor → a caminho → pronto → entregue) */
  phaseOf?: (o: any) => PhaseInfo | null;
};

export function OrderCard({ o, i = 0, draggable, onDragState, deps }: { o: any; i?: number; draggable?: boolean; onDragState?: (id: string | null) => void; deps: CardDeps }) {
  const lines = deps.linesOf(o);
  const quick = deps.quickOf(o);
  const wa = whatsappLink(o.customer_phone);
  const [dragging, setDragging] = useState(false);
  const closed = o.deleted_at || o.status === "cancelado";
  const phase = deps.phaseOf?.(o) ?? null;
  const first = lines[0];
  const firstName = first?.product_name_snapshot ?? "Pedido sem itens";
  const variant = first ? (first.variant === "DECANT" ? `Decant ${first.decant_ml ?? ""}ml` : first.variant_label ?? "Frasco") : "";

  return (
    <article
      role="button"
      tabIndex={0}
      data-order-id={o.id}
      draggable={draggable}
      data-dragging={dragging}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/orium-order", o.id);
        e.dataTransfer.effectAllowed = "move";
        // "fantasma" inclinado, como um cartão levantado da mesa
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        const ghost = el.cloneNode(true) as HTMLElement;
        ghost.style.cssText = `position:fixed;top:-2000px;left:-2000px;width:${r.width}px;transform:rotate(-3deg) scale(1.02);background:#262626;border-radius:22px;box-shadow:0 24px 48px -12px rgba(0,0,0,.8);pointer-events:none`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, e.clientX - r.left, e.clientY - r.top);
        setTimeout(() => ghost.remove(), 0);
        setDragging(true);
        onDragState?.(o.id);
      }}
      onDragEnd={() => {
        setDragging(false);
        onDragState?.(null);
      }}
      onClick={(e) => deps.onOpen(o, e.currentTarget)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          deps.onOpen(o, e.currentTarget);
        }
      }}
      className={cn("ord-card ord-in group relative p-4", closed && "opacity-60")}
      style={{ ["--i" as string]: i }}
      aria-label={`Pedido de ${o.customer_name ?? "cliente"}, ${brl(orderTotal(o))}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#2E2E2E] text-[14px] font-bold">{initials(o.customer_name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] leading-tight font-bold">{o.customer_name || "Cliente sem nome"}</p>
          <p className="mt-0.5 truncate text-[12.5px] text-[#8C8C8C]">
            {timeAgo(o.created_at)} · {originOf(o)}
            {o.status === "cancelado" ? " · cancelado" : o.deleted_at ? " · na lixeira" : ""}
          </p>
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0 items-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noreferrer"
              aria-label="Abrir WhatsApp"
              className="press grid size-9 place-items-center rounded-full text-[#A9A9A9] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/[0.06] hover:text-white focus-visible:opacity-100 max-lg:opacity-100"
            >
              <MessageCircle className="size-[17px]" strokeWidth={2} />
            </a>
          ) : null}
          <OrderMenuButton o={o} />
        </div>
      </div>

      <div className="mt-3.5 flex min-w-0 items-center gap-3">
        <PhotoStack images={lines.map(deps.imageOf)} more={Math.max(0, lines.length - 3)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold">{firstName}</p>
          <p className="truncate text-[12px] text-[#8C8C8C]">
            {variant}
            {lines.length > 1 ? ` · +${lines.length - 1} ${lines.length - 1 === 1 ? "item" : "itens"}` : ""}
          </p>
        </div>
      </div>

      {phase && !closed ? (
        <div className="mt-3.5 rounded-[16px] bg-[#161616] p-2.5">
          <PhaseChip phase={phase.key} />
          <PhaseBar info={phase} className="mt-2.5 px-0.5" />
        </div>
      ) : null}

      {!closed ? <PayBar order={o} className="mt-3.5" /> : null}

      <div className="mt-3.5 flex items-center gap-2">
        <p className="text-[19px] leading-none font-bold tracking-[-0.02em] tabular-nums">{brl(orderTotal(o))}</p>
        {!closed ? <DeliveryChip order={o} /> : null}
        {quick ? (
          <button
            type="button"
            disabled={deps.busyId === o.id}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              quick.run({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }}
            className="press ml-auto inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-white pr-3 pl-3.5 text-[13px] font-bold text-[#15130F] transition-colors hover:bg-[#FFD599] disabled:opacity-60"
          >
            {deps.busyId === o.id ? <Loader2 className="size-4 animate-spin" /> : quick.label}
            {deps.busyId === o.id ? null : <ArrowRight className="size-3.5" strokeWidth={2.6} />}
          </button>
        ) : null}
      </div>
    </article>
  );
}

const LIMIT_DONE = 12;

export function OrderBoard({
  orders,
  deps,
  onMove,
  onShowAllDone,
}: {
  orders: any[];
  deps: CardDeps;
  onMove: (o: any, to: Stage, at?: { x: number; y: number }) => void;
  onShowAllDone: () => void;
}) {
  const [mobileStage, setMobileStage] = useState<Stage>("pago");
  const [over, setOver] = useState<Stage | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const cols = useMemo(() => {
    const by: Record<Stage, any[]> = { novo: [], pago: [], entregue: [] };
    orders.forEach((o) => {
      const s = stageOf(o);
      if (s) by[s].push(o);
    });
    by.entregue.sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime());
    return by;
  }, [orders]);

  const drop = (to: Stage, id: string, at: { x: number; y: number }) => {
    const o = orders.find((x) => x.id === id);
    if (o && stageOf(o) !== to) onMove(o, to, at);
  };

  // FLIP: quando um cartão muda de lugar (outra coluna, outra ordem), ele
  // desliza da posição antiga até a nova em vez de pular.
  const rootRef = useRef<HTMLDivElement>(null);
  const prev = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const next = new Map<string, { x: number; y: number }>();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // posições relativas ao quadro: rolagem e barra de rolagem não contam
    const base = root.getBoundingClientRect();
    root.querySelectorAll<HTMLElement>("[data-order-id]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const pos = { x: r.left - base.left, y: r.top - base.top };
      next.set(el.dataset.orderId!, pos);
      const old = prev.current.get(el.dataset.orderId!);
      if (!old || still || r.width === 0) return;
      const dx = old.x - pos.x;
      const dy = old.y - pos.y;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      el.classList.remove("ord-in");
      const far = Math.abs(dx) > 40;
      el.animate(
        far
          ? [
              { transform: `translate(${dx}px, ${dy}px) rotate(${dx > 0 ? -2.5 : 2.5}deg) scale(1.03)`, zIndex: 5 },
              { transform: `translate(${dx * 0.35}px, ${dy * 0.35}px) rotate(${dx > 0 ? -1 : 1}deg) scale(1.02)`, offset: 0.55, zIndex: 5 },
              { transform: "none", zIndex: 5 },
            ]
          : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: far ? 640 : 460, easing: "cubic-bezier(0.2, 0.9, 0.1, 1)" },
      );
    });
    prev.current = next;
  });

  return (
    <>
      {/* celular: abas */}
      {/* .adm-seg define display; o wrapper é quem some no computador */}
      <div className="mb-3 lg:hidden">
      <div className="adm-seg w-full [&>button]:flex-1" role="tablist" aria-label="Etapa">
        {STAGES.map((s) => (
          <button key={s.key} type="button" role="tab" aria-pressed={mobileStage === s.key} onClick={() => setMobileStage(s.key)} className="press">
            {s.title}
            <span className="ml-1.5 tabular-nums opacity-60">{cols[s.key].length}</span>
          </button>
        ))}
      </div>
      </div>

      <div ref={rootRef} className="grid min-w-0 gap-4 lg:grid-cols-3">
        {STAGES.map((s) => {
          const list = cols[s.key];
          const shown = s.key === "entregue" ? list.slice(0, LIMIT_DONE) : list;
          const sum = list.reduce((acc, o) => acc + orderTotal(o), 0);
          return (
            <section
              key={s.key}
              aria-label={s.title}
              data-over={over === s.key && !!dragId}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("text/orium-order")) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== s.key) setOver(s.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/orium-order");
                if (id) drop(s.key, id, { x: e.clientX, y: e.clientY });
              }}
              className={cn("ord-col min-w-0 p-3 lg:p-3.5", mobileStage !== s.key && "max-lg:hidden")}
            >
              <header className="flex items-center gap-2.5 px-2 pt-1.5 pb-3.5">
                <span
                  className={cn(
                    "size-2.5 rounded-full",
                    s.key === "novo" ? "bg-[#8C8C8C]" : s.key === "pago" ? "bg-[#FFD599]" : "bg-[#7FCF9F]",
                  )}
                />
                <h2 className="text-[17px] font-bold tracking-[-0.01em]">{s.title}</h2>
                <span key={list.length} className="ord-bump grid h-6 min-w-6 place-items-center rounded-full bg-[#262626] px-2 text-[12px] font-bold tabular-nums">{list.length}</span>
                <span className="ml-auto truncate text-[12.5px] font-semibold text-[#8C8C8C] tabular-nums">
                  {list.length ? brl(sum) : s.hint}
                </span>
              </header>
              <div className="space-y-2.5">
                {shown.map((o, i) => (
                  <OrderCard key={o.id} o={o} i={i} deps={deps} draggable onDragState={setDragId} />
                ))}
                {list.length === 0 ? (
                  <div className="grid min-h-[120px] place-items-center rounded-[22px] border-[1.5px] border-dashed border-white/[0.08] px-6 text-center text-[13.5px] text-[#6F6F6F]">
                    {dragId ? "Solte aqui" : s.key === "novo" ? "Nenhum pedido novo." : s.key === "pago" ? "Nada para entregar." : "Nenhuma entrega ainda."}
                  </div>
                ) : null}
                {s.key === "entregue" && list.length > LIMIT_DONE ? (
                  <button
                    type="button"
                    onClick={onShowAllDone}
                    className="press flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-[#1F1F1F] text-[13.5px] font-bold text-[#A9A9A9] transition-colors hover:text-white"
                  >
                    Ver os {list.length} entregues <ArrowRight className="size-4" strokeWidth={2.4} />
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-3 hidden text-center text-[12.5px] text-[#6F6F6F] lg:block">Arraste um cartão para outra coluna para mudar a etapa.</p>
    </>
  );
}
