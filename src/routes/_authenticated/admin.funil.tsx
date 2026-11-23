/**
 * CRM → FUNIL.
 * A jornada de venda: Novo → Interessado → Negociando → Comprou (e Perdido).
 * Arraste qualquer cliente para qualquer coluna, para frente ou para trás
 * (mouse, ou segurando o dedo no celular). A etapa fica salva na conversa do
 * WhatsApp; sem conversa, é deduzida pelo comportamento no app.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { LeadPanel } from "@/components/orium/crm/LeadPanel";
import { Avatar, TEMP, TempPill, ago } from "@/components/orium/crm/shared";
import { SEGMENTS, enrich, type Lead, type SegmentKey } from "@/lib/crm-intel";
import {
  crmLeads,
  waInbox,
  waOpenForCustomer,
  waUpdateContact,
  type WaContact,
} from "@/lib/crm-wa.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/funil")({
  head: () => ({ meta: [{ title: "Funil — Orium CRM" }, { name: "robots", content: "noindex" }] }),
  component: FunilPage,
});

type Stage = WaContact["stage"];
const COLS: Array<{ v: Stage; label: string; hint: string; dot: string }> = [
  { v: "novo", label: "Novo", hint: "Chegou agora", dot: "#A9A9A9" },
  { v: "interessado", label: "Interessado", hint: "Olhando perfumes", dot: "#F2C46D" },
  { v: "negociando", label: "Negociando", hint: "Falando de preço", dot: "#FFD599" },
  { v: "comprou", label: "Comprou", hint: "Venda feita", dot: "#7FCF9F" },
  { v: "perdido", label: "Perdido", hint: "Não fechou", dot: "#FF9A8A" },
];

type Item = {
  key: string;
  name: string;
  sub: string;
  stage: Stage;
  lead: Lead | null;
  jid: string | null;
  hot: boolean;
  score: number;
};
type Drag = {
  item: Item;
  x: number;
  y: number;
  dx: number;
  dy: number;
  w: number;
  over: Stage | null;
};
type Pending = {
  item: Item;
  el: HTMLElement;
  x: number;
  y: number;
  t: number;
  touch: boolean;
  timer?: number;
};

function FunilPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState<{ id: string; el: HTMLElement | null } | null>(null);
  const [moved, setMoved] = useState<Record<string, Stage>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const leadsQ = useQuery({
    queryKey: ["crm-leads"],
    queryFn: () => crmLeads(),
    staleTime: 30_000,
  });
  const inboxQ = useQuery({ queryKey: ["wa-inbox"], queryFn: () => waInbox(), staleTime: 15_000 });
  const leads = useMemo(() => enrich(leadsQ.data ?? []), [leadsQ.data]);

  const items = useMemo<Item[]>(() => {
    const contacts = inboxQ.data?.contacts ?? [];
    const byCustomer = new Map(
      contacts.filter((c) => c.customer_id).map((c) => [c.customer_id!, c]),
    );
    const out: Item[] = leads.map((l) => {
      const c = byCustomer.get(l.id);
      const derived: Stage =
        l.orders_count > 0
          ? "comprou"
          : l.cart || (l.views?.d7 ?? 0) > 0 || (l.favorites?.length ?? 0) > 0
            ? "interessado"
            : "novo";
      return {
        key: l.id,
        name: l.name ?? "Sem nome",
        sub: l.action.title,
        stage: c?.stage ?? derived,
        lead: l,
        jid: c?.jid ?? null,
        hot: l.temp === "quente",
        score: l.score,
      };
    });
    for (const c of contacts)
      if (!c.customer_id && !c.archived)
        out.push({
          key: c.jid,
          name: c.push_name || c.phone_normalized || "Contato",
          sub: c.last_message_preview ?? "Sem ficha",
          stage: c.stage,
          lead: null,
          jid: c.jid,
          hot: c.last_from_me === false,
          score: c.last_from_me === false ? 40 : 0,
        });
    return out
      .map((i) => (moved[i.key] ? { ...i, stage: moved[i.key] } : i))
      .sort((a, b) => b.score - a.score);
  }, [leads, inboxQ.data, moved]);

  const byStage = (s: Stage) => items.filter((i) => i.stage === s);
  const queue = items
    .filter((i) => i.score > 0 && i.stage !== "comprou" && i.stage !== "perdido")
    .slice(0, 10);

  const move = useMutation({
    mutationFn: async ({ it, to }: { it: Item; to: Stage }) => {
      let jid = it.jid;
      if (!jid && it.lead)
        jid = (await waOpenForCustomer({ data: { customerId: it.lead.id } })).jid;
      if (!jid) throw new Error("Esse cliente não tem celular para acompanhar a etapa.");
      await waUpdateContact({ data: { jid, stage: to } });
    },
    onMutate: ({ it, to }) => {
      setMoved((m) => ({ ...m, [it.key]: to }));
      return { prev: it.stage };
    },
    onSuccess: (_d, { it, to }) => {
      toast.success(`${it.name.split(" ")[0]} → ${COLS.find((c) => c.v === to)?.label}`);
      void qc.invalidateQueries({ queryKey: ["wa-inbox"] });
    },
    onError: (e, { it }, ctx) => {
      setMoved((m) => ({ ...m, [it.key]: ctx?.prev ?? it.stage }));
      toast.error(e instanceof Error ? e.message : "Não foi possível mover");
    },
  });

  const openItem = (it: Item, el: HTMLElement | null) => {
    if (it.lead) setOpen({ id: it.lead.id, el });
    else if (it.jid) void navigate({ to: "/admin/conversas", search: { jid: it.jid } as never });
  };
  const openRef = useRef(openItem);
  openRef.current = openItem;
  const moveRef = useRef(move.mutate);
  moveRef.current = move.mutate;

  // ---------- arrasto livre (mouse e toque) ----------
  const pending = useRef<Pending | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const stageAt = (x: number, y: number): Stage | null => {
    const el = document.elementFromPoint(x, y)?.closest("[data-stage]") as HTMLElement | null;
    return (el?.dataset.stage as Stage | undefined) ?? null;
  };
  const begin = useCallback((p: Pending, x: number, y: number) => {
    const r = p.el.getBoundingClientRect();
    const d: Drag = {
      item: p.item,
      x,
      y,
      dx: p.x - r.left,
      dy: p.y - r.top,
      w: r.width,
      over: p.item.stage,
    };
    dragRef.current = d;
    setDrag(d);
    if (p.touch && navigator.vibrate) navigator.vibrate(12);
  }, []);

  const onRowDown = (e: RPointerEvent<HTMLElement>, item: Item) => {
    if (e.button !== 0) return;
    const p: Pending = {
      item,
      el: e.currentTarget,
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      touch: e.pointerType !== "mouse",
    };
    pending.current = p;
    if (p.touch)
      p.timer = window.setTimeout(() => pending.current === p && begin(p, p.x, p.y), 260);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = pending.current;
      const d = dragRef.current;
      if (d) {
        const next = { ...d, x: e.clientX, y: e.clientY, over: stageAt(e.clientX, e.clientY) };
        dragRef.current = next;
        setDrag(next);
        // rola o quadro quando o cliente chega perto da borda
        const b = boardRef.current;
        if (b) {
          const r = b.getBoundingClientRect();
          if (e.clientX > r.right - 70) b.scrollLeft += 14;
          else if (e.clientX < r.left + 70) b.scrollLeft -= 14;
        }
        return;
      }
      if (!p) return;
      const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (p.touch) {
        if (dist > 10) {
          window.clearTimeout(p.timer);
          pending.current = null; // virou rolagem
        }
      } else if (dist > 5) begin(p, e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      const p = pending.current;
      const d = dragRef.current;
      if (p?.timer) window.clearTimeout(p.timer);
      pending.current = null;
      if (d) {
        dragRef.current = null;
        setDrag(null);
        const to = stageAt(e.clientX, e.clientY);
        if (to && to !== d.item.stage) moveRef.current({ it: d.item, to });
        return;
      }
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6 && Date.now() - p.t < 600)
        openRef.current(p.item, p.el);
    };
    const noScroll = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", noScroll, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", noScroll);
    };
  }, [begin]);

  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging]);

  const segCount = (k: SegmentKey) => leads.filter((l) => l.segments.includes(k)).length;
  const tiles: SegmentKey[] = [
    "responder",
    "carrinho",
    "esperando",
    "upgrade",
    "promo",
    "recompra",
  ];
  const temps = (["quente", "morno", "frio"] as const).map((t) => ({
    t,
    n: leads.filter((l) => l.temp === t).length,
  }));
  const loading = leadsQ.isPending || inboxQ.isPending;
  const lead = open ? (leads.find((l) => l.id === open.id) ?? null) : null;

  return (
    <AdminShell title="Funil de vendas">
      <div className="space-y-4">
        {/* atender agora */}
        <section className="flex flex-col gap-4 rounded-[30px] bg-[#1A1A1A] p-4 lg:flex-row lg:items-center lg:p-5">
          <div className="shrink-0 lg:w-[180px]">
            <p className="text-[17px] font-bold tracking-[-0.02em]">Atender agora</p>
            <p className="text-[13px] text-[#8C8C8C]">Por ordem de calor</p>
          </div>
          <div className="adm-scroll -mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-1">
            {loading
              ? [0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="admin-skeleton size-[64px] shrink-0 rounded-full" />
                ))
              : queue.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={(e) => openItem(it, e.currentTarget)}
                    title={`${it.name} · ${it.sub}`}
                    className="press flex w-[68px] shrink-0 flex-col items-center gap-1"
                  >
                    <Avatar
                      name={it.name}
                      score={it.lead?.score}
                      temp={it.lead?.temp}
                      size={56}
                      gold={(it.lead?.orders_count ?? 0) > 0}
                    />
                    <span className="w-full truncate text-center text-[11.5px] font-semibold text-[#A9A9A9]">
                      {it.name.split(" ")[0]}
                    </span>
                  </button>
                ))}
          </div>
        </section>

        {/* quadro */}
        <section className="rounded-[30px] bg-[#171717] p-3 lg:p-4">
          <p className="mb-3 px-1 text-[13px] text-[#8C8C8C]">
            <span className="font-bold text-[#D4D4D4]">Arraste</span> o cliente para qualquer etapa,
            para frente ou para trás. No celular, segure o dedo e arraste.
          </p>
          <div ref={boardRef} className="adm-scroll -mx-1 overflow-x-auto px-1 pb-1">
            <div className="flex min-w-[1120px] items-stretch">
              {COLS.map((col, ci) => {
                const all = byStage(col.v);
                const isOver = !!drag && drag.over === col.v && drag.item.stage !== col.v;
                return (
                  <div key={col.v} className="flex min-w-0 flex-1 items-stretch">
                    <div
                      data-stage={col.v}
                      className={cn(
                        "flex min-w-0 flex-1 flex-col rounded-[24px] border-2 transition-colors",
                        isOver
                          ? "border-[#FFD599] bg-[#FFD599]/[0.07]"
                          : "border-transparent bg-[#1F1F1F]",
                      )}
                    >
                      <div className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: col.dot }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-bold">{col.label}</p>
                          <p className="truncate text-[12px] text-[#8C8C8C]">{col.hint}</p>
                        </div>
                        <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white/[0.08] px-2 text-[12.5px] font-bold tabular-nums">
                          {all.length}
                        </span>
                      </div>
                      <div className="adm-scroll max-h-[min(62dvh,560px)] min-h-[180px] flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
                        {loading ? (
                          [0, 1, 2].map((i) => (
                            <div key={i} className="admin-skeleton h-[60px] rounded-[18px]" />
                          ))
                        ) : all.length === 0 ? (
                          <div
                            className={cn(
                              "grid h-[120px] place-items-center rounded-[18px] border border-dashed text-[12.5px]",
                              isOver
                                ? "border-[#FFD599]/60 text-[#FFD599]"
                                : "border-white/[0.08] text-[#6F6F6F]",
                            )}
                          >
                            {isOver ? "Solte aqui" : "Ninguém aqui"}
                          </div>
                        ) : (
                          all.map((it) => (
                            <div
                              key={it.key}
                              onPointerDown={(e) => onRowDown(e, it)}
                              onContextMenu={(e) => e.preventDefault()}
                              className={cn(
                                "group flex cursor-grab items-center gap-2.5 rounded-[18px] bg-[#262626] p-2.5 transition-[opacity,background] select-none hover:bg-[#2C2C2C] active:cursor-grabbing",
                                drag?.item.key === it.key && "opacity-30",
                              )}
                            >
                              <Avatar
                                name={it.name}
                                score={it.lead?.score}
                                temp={it.lead?.temp}
                                size={38}
                                gold={(it.lead?.orders_count ?? 0) > 0}
                              />
                              <span className="min-w-0 flex-1">
                                <span
                                  className={cn(
                                    "block truncate text-[13.5px]",
                                    it.hot
                                      ? "font-bold text-white"
                                      : "font-semibold text-[#D4D4D4]",
                                  )}
                                >
                                  {it.name}
                                </span>
                                <span className="block truncate text-[12px] text-[#8C8C8C]">
                                  {it.sub}
                                </span>
                              </span>
                              {col.v === "comprou" ? (
                                <Check className="size-4 shrink-0 text-[#7FCF9F]" />
                              ) : null}
                              <GripVertical className="size-4 shrink-0 text-[#4A4A4A] group-hover:text-[#8C8C8C]" />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    {ci < COLS.length - 1 ? (
                      <span className="grid w-5 shrink-0 place-items-center text-[#3A3A3A]">
                        <ChevronRight className="size-4" />
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* listas inteligentes */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {tiles.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => void navigate({ to: "/admin/leads", search: { lista: k } })}
              className="press flex min-h-[96px] min-w-0 flex-col justify-between gap-2 rounded-[22px] bg-[#1A1A1A] p-4 text-left transition-colors hover:bg-[#222]"
            >
              <span className="text-[13.5px] leading-tight font-bold text-[#D4D4D4]">
                {SEGMENTS[k].title}
              </span>
              <span className="flex items-end justify-between">
                <span className="text-[28px] leading-none font-bold tracking-[-0.04em] tabular-nums">
                  {loading ? "–" : segCount(k)}
                </span>
                <ChevronRight className="size-4 text-[#6F6F6F]" />
              </span>
            </button>
          ))}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="rounded-[30px] bg-[#1A1A1A] p-4 lg:p-5">
            <h2 className="text-[17px] font-bold tracking-[-0.02em]">Próximas ações</h2>
            <div className="mt-3 hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_96px_80px] gap-3 px-2 pb-2 text-[12px] font-semibold text-[#6F6F6F] md:grid">
              <span>Cliente</span>
              <span>Ação</span>
              <span>Calor</span>
              <span className="text-right">Atividade</span>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {leads.slice(0, 8).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={(e) => setOpen({ id: l.id, el: e.currentTarget })}
                  className="press grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-2 py-2.5 text-left hover:bg-white/[0.03] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_96px_80px]"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={l.name} size={32} gold={l.orders_count > 0} />
                    <span className="truncate text-[13.5px] font-semibold">
                      {l.name ?? "Sem nome"}
                    </span>
                  </span>
                  <span className="hidden truncate text-[13px] text-[#D4D4D4] md:block">
                    {l.action.title}
                  </span>
                  <span>
                    <TempPill temp={l.temp} score={l.score} className="h-6 px-2 text-[11.5px]" />
                  </span>
                  <span className="hidden text-right text-[12.5px] text-[#8C8C8C] tabular-nums md:block">
                    {ago(
                      l.live?.at ?? l.wa?.last_inbound_at ?? l.views?.last_at ?? l.last_order_at,
                    ) || "—"}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-[30px] bg-[#1A1A1A] p-4 lg:p-5">
            <h2 className="text-[17px] font-bold tracking-[-0.02em]">Calor da base</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {temps.map(({ t, n }) => (
                <Ring
                  key={t}
                  label={TEMP[t].label}
                  n={n}
                  total={Math.max(1, leads.length)}
                  color={TEMP[t].ring}
                />
              ))}
            </div>
            <p className="mt-4 flex items-center gap-2 text-[13px] text-[#8C8C8C]">
              <Check className="size-4 text-[#7FCF9F]" />
              {leads.filter((l) => l.orders_count > 0).length} de {leads.length} já compraram
            </p>
          </section>
        </div>
      </div>

      {/* cliente sendo arrastado (no <body>, fora da moldura que corta) */}
      {drag && typeof document !== "undefined"
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[90]"
              style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}
            >
              <div className="flex rotate-[2deg] items-center gap-2.5 rounded-[18px] bg-[#FFD599] p-2.5 text-[#15130F] shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
                <Avatar name={drag.item.name} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold">{drag.item.name}</span>
                  <span className="block truncate text-[12px] text-[#15130F]/65">
                    {drag.over && drag.over !== drag.item.stage
                      ? `Soltar em ${COLS.find((c) => c.v === drag.over)?.label}`
                      : drag.item.sub}
                  </span>
                </span>
              </div>
            </div>,
            document.body,
          )
        : null}

      <LeadPanel lead={lead} originEl={open?.el ?? null} onClose={() => setOpen(null)} />
    </AdminShell>
  );
}

function Ring({
  label,
  n,
  total,
  color,
}: {
  label: string;
  n: number;
  total: number;
  color: string;
}) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const pct = n / total;
  return (
    <div className="flex flex-col items-center" title={`${label}: ${n} clientes`}>
      <span className="relative grid size-[104px] place-items-center">
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#262626" strokeWidth="12" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0.001, pct * c)} ${c}`}
          />
        </svg>
        <span className="text-[22px] font-bold tracking-[-0.03em] tabular-nums">{n}</span>
      </span>
      <p className="mt-2 text-[13px] font-semibold text-[#A9A9A9]">{label}</p>
    </div>
  );
}
