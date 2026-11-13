/**
 * LINHA DO PEDIDO — o "quadro" da Orium.
 *
 * Em vez de colunas genéricas, cada pedido é uma linha com o seu trajeto:
 *   Pagamento → Fornecedor → A caminho → Pronto → Entregue
 * As estações já feitas ficam douradas, a atual acende, e na ponta direita há
 * UM botão com o próximo passo (Receber pagamento · Pedir no fornecedor ·
 * Chegou · Entregar). Os pedidos vêm agrupados pelo dia da entrega
 * (Atrasados, Hoje, Amanhã, Próximos dias, Sem dia), então o mais urgente
 * está sempre no topo.
 *
 * `buildRows` é a regra única de urgência — o Painel usa a mesma.
 */
import { useMemo, useState } from "react";
import { ArrowRight, Check, CircleDollarSign, Loader2, PackageCheck, Search, ShoppingCart, Sparkles, Truck, X, type LucideIcon } from "lucide-react";
import { paymentInfo } from "@/components/orium/admin/OrderPayment";
import { deliveryState, fmtTime, todayBR } from "@/lib/delivery";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ExpandButton, ItemsExpand, OrderPhotos, TierBadge, WhenPill, itemsText } from "./ident";
import { Collapse } from "@/components/orium/admin/motion";
import type { PurchaseItem } from "@/lib/orders-control.functions";
import { orderTotal } from "./model";
import { dayLabel, daysBetween, dueInfo, useToday } from "./controls";
import { PHASE, phaseOf, supplyByOrder, type PhaseInfo } from "./phase";
import type { Journey } from "./OrdersDashboard";

/* ─────────────── regra de urgência ─────────────── */

export { useToday };

export type Group = "late" | "today" | "tomorrow" | "week" | "later" | "none" | "owing";
export const GROUPS: Array<{ key: Group; title: string; hint: string }> = [
  { key: "late", title: "Atrasados", hint: "era para já ter entregue" },
  { key: "today", title: "Hoje", hint: "entregar hoje" },
  { key: "tomorrow", title: "Amanhã", hint: "deixe pronto hoje" },
  { key: "week", title: "Próximos dias", hint: "até 7 dias" },
  { key: "later", title: "Mais pra frente", hint: "" },
  { key: "none", title: "Sem dia marcado", hint: "combine o dia com o cliente" },
  { key: "owing", title: "Entregues, falta receber", hint: "cobrar" },
];

export type Filter = "todos" | "entregar" | "fornecedor" | "caminho" | "pagamento";

export type Row = {
  o: any;
  phase: PhaseInfo;
  group: Group;
  rank: number;
  when: { text: string; tone: "red" | "gold" | "plain" | "muted"; /** hora combinada (HH:MM) quando é hoje */ at?: string | null };
  pay: ReturnType<typeof paymentInfo>;
  tags: Set<Filter>;
  /** pronto para entregar agora (perfume com você) */
  ready: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Pedidos em andamento (+ entregues que ainda devem), do mais urgente ao menos. */
export function buildRows(orders: any[], purchases: PurchaseItem[] | undefined): Row[] {
  const t = todayBR();
  const supply = supplyByOrder(purchases);
  const out: Row[] = [];
  orders.forEach((o) => {
    if (o.deleted_at || o.status === "cancelado") return;
    const pay = paymentInfo(o);
    const delivered = o.status === "entregue";
    if (delivered && pay.due <= 0.009) return;
    const phase = phaseOf(o, purchases, supply);
    if (!phase) return;
    const st = deliveryState(o);
    const d = o.expected_delivery_date ? String(o.expected_delivery_date).slice(0, 10) : null;
    const time = fmtTime(o.expected_delivery_time);
    const group: Group = delivered
      ? "owing"
      : st === "late"
        ? "late"
        : st === "today"
          ? "today"
          : st === "tomorrow"
            ? "tomorrow"
            : d
              ? daysBetween(t, d) <= 7
                ? "week"
                : "later"
              : "none";
    const when: Row["when"] = delivered
      ? { text: "Já entregue", tone: "muted" }
      : group === "late"
        ? { text: `Atrasado ${plural(daysBetween(d!, t), "dia", "dias")}`, tone: "red" }
        : group === "today"
          ? { text: `Hoje${time ? ` · ${time}` : ""}`, tone: "gold", at: time || null }
          : group === "tomorrow"
            ? { text: `Amanhã${time ? ` · ${time}` : ""}`, tone: "plain" }
            : d
              ? { text: `${dayLabel(d)}${time ? ` · ${time}` : ""}`, tone: "plain" }
              : { text: "Sem dia", tone: "muted" };
    const tags = new Set<Filter>(["todos"]);
    const sup = phase.supply;
    const ready = !delivered && !sup.some((x) => x.status !== "chegou");
    if (!delivered && (phase.key === "entregar" || group === "late" || group === "today" || group === "tomorrow")) tags.add("entregar");
    if (sup.some((x) => x.status === "comprar")) tags.add("fornecedor");
    if (sup.some((x) => x.status === "chegando")) tags.add("caminho");
    if (pay.due > 0.009) tags.add("pagamento");
    const order = ["late", "today", "owing", "tomorrow", "week", "later", "none"].indexOf(group);
    const rank =
      order * 1e8 +
      (dueInfo(o).state === "late" ? 0 : 1e7) +
      (d && !delivered ? daysBetween(t, d) * 1e4 : 0) +
      (time ? Number(time.replace(/\D/g, "").slice(0, 4)) : 9999);
    out.push({ o, phase, group, rank, when, pay, tags, ready });
  });
  return out.sort((a, b) => a.rank - b.rank);
}

/* ─────────────── próximo passo ─────────────── */

export type TrackActions = {
  onOpen: (o: any, el?: HTMLElement | null) => void;
  onDeliver: (o: any, at?: { x: number; y: number }) => void;
  onGoPurchases: () => void;
  /** perfume(s) do fornecedor chegaram (itens da lista de compras) */
  onArrived: (o: any, itemIds: string[], at?: { x: number; y: number }) => Promise<void> | void;
};

type Step = { label: string; icon: LucideIcon; run: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>; strong: boolean };

function nextStep(r: Row, a: TrackActions): Step {
  const at = (e: React.MouseEvent<HTMLElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  };
  if (r.o.status === "entregue") return { label: `Receber ${brl(r.pay.due)}`, icon: CircleDollarSign, run: (e) => a.onOpen(r.o, e.currentTarget), strong: true };
  switch (r.phase.key) {
    case "pagamento":
      return { label: "Receber pagamento", icon: CircleDollarSign, run: (e) => a.onOpen(r.o, e.currentTarget), strong: false };
    case "comprar":
      return { label: "Pedir no fornecedor", icon: ShoppingCart, run: () => a.onGoPurchases(), strong: false };
    case "chegando": {
      const ids = r.phase.supply.filter((x) => x.status === "chegando").map((x) => x.itemId);
      return { label: "Chegou", icon: PackageCheck, run: (e) => a.onArrived(r.o, ids, at(e)), strong: false };
    }
    default:
      return { label: "Entregar", icon: Sparkles, run: (e) => a.onDeliver(r.o, at(e)), strong: true };
  }
}

/* ─────────────── a linha ─────────────── */

const STATION_ICON: Record<Journey, LucideIcon> = { pagamento: CircleDollarSign, comprar: ShoppingCart, chegando: Truck, entregar: PackageCheck, entregue: Sparkles };
const WHEN_TONE = { red: "text-[#FF9A8A] font-semibold", gold: "text-[#FFD599] font-semibold", plain: "text-white", muted: "text-[#8C8C8C]" };

function Track({ r, compact }: { r: Row; compact?: boolean }) {
  const steps = r.phase.steps;
  return (
    <ol className="flex w-full min-w-0 items-start" aria-label={`Fase: ${PHASE[r.phase.key].title}`}>
      {steps.map((s, i) => {
        const Icon = STATION_ICON[s.key];
        const next = steps[i + 1];
        const filled = s.state !== "todo" && next && next.state !== "todo";
        return (
          <li key={s.key} className="relative flex min-w-0 flex-1 flex-col items-center" aria-current={s.state === "now" ? "step" : undefined}>
            {next ? (
              <span aria-hidden className="absolute top-[15px] left-1/2 h-[2px] w-full overflow-hidden rounded-full bg-[#2E2E2E]">
                <span className={cn("block h-full origin-left rounded-full bg-[#FFD599]/70 transition-transform duration-700", filled ? "scale-x-100" : "scale-x-0")} style={{ transitionDelay: `${i * 80}ms` }} />
              </span>
            ) : null}
            <span
              className={cn(
                "relative z-[1] grid size-8 place-items-center rounded-full transition-colors duration-500",
                s.state === "done" && "bg-[#FFD599] text-[#15130F]",
                s.state === "todo" && "bg-[#262626] text-[#5E5E5E]",
                s.state === "now" && "bg-white text-[#15130F] shadow-[0_0_0_4px_rgba(255,255,255,0.12)]",
              )}
            >
              {s.state === "done" ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-[15px]" strokeWidth={2.3} />}
            </span>
            <span
              className={cn(
                "mt-1.5 max-w-full truncate px-0.5 text-[11px] leading-tight",
                s.state === "now" ? "font-bold text-white" : s.state === "done" ? "text-[#A9A9A9]" : "text-[#5E5E5E]",
                compact && s.state !== "now" && "max-sm:invisible",
              )}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function TrackItem({
  r,
  i = 0,
  lines,
  imageOf,
  actions,
  busy,
}: {
  r: Row;
  i?: number;
  lines: any[];
  imageOf: (l: any) => string | null | undefined;
  actions: TrackActions;
  busy?: boolean;
}) {
  const o = r.o;
  const [open, setOpen] = useState(false);
  const step = nextStep(r, actions);
  const [running, setRunning] = useState(false);
  const total = orderTotal(o);

  const money = (
    <span className={cn("text-[12.5px] whitespace-nowrap tabular-nums", r.pay.due <= 0.009 ? "text-[#7FCF9F]" : r.pay.paid > 0 ? "text-[#FFD599]" : "text-[#FF9A8A]")}>
      {r.pay.due <= 0.009 ? `${brl(total)} · pago` : r.pay.paid > 0 ? `falta ${brl(r.pay.due)}` : `${brl(total)} · não pagou`}
    </span>
  );

  return (
    <li className="ord-in" style={{ ["--i" as string]: Math.min(i, 12) }}>
      <div
        role="button"
        tabIndex={0}
        data-order-id={o.id}
        onClick={(e) => actions.onOpen(o, e.currentTarget)}
        onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && actions.onOpen(o, e.currentTarget)}
        className={cn(
          "grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-[22px] bg-[#202020] p-3 transition-colors hover:bg-[#252525] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)_auto] lg:gap-6 lg:px-4 lg:py-3.5",
        )}
      >
        {/* cliente */}
        <span className="flex min-w-0 items-center gap-3 max-lg:order-1 max-lg:col-span-2">
          <OrderPhotos lines={lines} imageOf={imageOf} size={48} radius={14} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[15px] font-semibold">{o.customer_name || "Cliente"}</span>
              <TierBadge o={o} />
              <WhenPill when={r.when} className="shrink-0 lg:hidden" />
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-[12.5px] text-[#8C8C8C]">{itemsText(lines)}</span>
              {lines.length ? <ExpandButton open={open} count={lines.length} onToggle={() => setOpen((v) => !v)} /> : null}
            </span>
            <span className="mt-0.5 flex items-center gap-2 max-lg:hidden">
              <WhenPill when={r.when} />
              <span className="text-[#3A3A3A]">·</span>
              {money}
            </span>
          </span>
        </span>

        {/* trilho */}
        <span className="min-w-0 max-lg:order-2 max-lg:col-span-2 lg:col-start-2 lg:row-start-1">
          <Track r={r} compact />
        </span>

        {/* celular: valor à esquerda do botão */}
        <span className="min-w-0 self-center max-lg:order-3 lg:hidden">{money}</span>

        {/* próximo passo */}
        <StepButton step={step} running={running || !!busy} setRunning={setRunning} className="max-lg:order-4 lg:col-start-3 lg:row-start-1" />
      </div>
      <Collapse open={open}>
        <ItemsExpand lines={lines} imageOf={imageOf} o={o} />
      </Collapse>
    </li>
  );
}

function StepButton({ step, running, setRunning, className }: { step: Step; running: boolean; setRunning: (v: boolean) => void; className?: string }) {
  return (
    <button
      type="button"
      disabled={running}
      onClick={async (e) => {
        e.stopPropagation();
        setRunning(true);
        try {
          await step.run(e);
        } finally {
          setRunning(false);
        }
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn(
        "press inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold whitespace-nowrap transition-colors disabled:opacity-60 lg:h-11 lg:w-[212px] lg:px-4",
        step.strong ? "bg-white text-[#15130F] hover:bg-[#FFD599]" : "bg-[#2E2E2E] text-white hover:bg-[#383838]",
        className,
      )}
    >
      {running ? <Loader2 className="size-4 animate-spin" /> : <step.icon className="size-4" strokeWidth={2.3} />}
      {step.label}
      <ArrowRight className="size-3.5 max-sm:hidden" strokeWidth={2.6} />
    </button>
  );
}

/* ─────────────── o quadro ─────────────── */

export function TrackBoard({
  orders,
  purchases,
  linesOf,
  imageOf,
  actions,
  busyId,
}: {
  orders: any[];
  purchases: PurchaseItem[] | undefined;
  linesOf: (o: any) => any[];
  imageOf: (l: any) => string | null | undefined;
  actions: TrackActions;
  busyId?: string | null;
}) {
  const today = useToday();
  const rows = useMemo(() => buildRows(orders, purchases), [orders, purchases, today]);
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState<Journey | "todas">("todas");
  const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const needle = norm(q.trim());
  const shown = rows.filter((r) => {
    if (phase !== "todas" && (r.o.status === "entregue" ? "entregue" : r.phase.key) !== phase) return false;
    if (!needle) return true;
    return norm(`${r.o.customer_name ?? ""} ${linesOf(r.o).map((l) => l.product_name_snapshot).join(" ")} ${r.o.order_number ?? ""}`).includes(needle);
  });
  const counts = (k: Journey) => rows.filter((r) => (r.o.status === "entregue" ? "entregue" : r.phase.key) === k).length;
  const PH: Array<{ k: Journey | "todas"; label: string }> = [
    { k: "todas", label: "Todas as fases" },
    { k: "pagamento", label: "Pagamento" },
    { k: "comprar", label: "Fornecedor" },
    { k: "chegando", label: "A caminho" },
    { k: "entregar", label: "Pronto" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#1A1A1A] px-4 focus-within:ring-2 focus-within:ring-[#FFD599]/40 sm:max-w-[320px]">
          <Search className="size-4 shrink-0 text-[#8C8C8C]" />
          <input
            data-slot="input-group-control"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente ou perfume"
            aria-label="Buscar cliente ou perfume"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[#6F6F6F]"
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Limpar busca" className="press grid size-6 place-items-center rounded-full bg-[#2E2E2E]">
              <X className="size-3.5" />
            </button>
          ) : null}
        </label>
        <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 max-sm:w-full" role="group" aria-label="Filtrar por fase">
          {PH.map((p) => {
            const on = phase === p.k;
            const n = p.k === "todas" ? rows.length : counts(p.k);
            return (
              <button
                key={p.k}
                type="button"
                aria-pressed={on}
                onClick={() => setPhase(p.k)}
                className={cn(
                  "press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                  on ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
                )}
              >
                {p.k !== "todas" ? <span className="size-2 rounded-full" style={{ background: PHASE[p.k].dot }} /> : null}
                {p.label}
                {n ? <span className={cn("text-[12px] tabular-nums", on ? "text-[#15130F]/50" : "text-[#6F6F6F]")}>{n}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {GROUPS.map((g, gi) => {
        const list = shown.filter((r) => r.group === g.key);
        if (!list.length) return null;
        const ready = list.filter((r) => r.ready).length;
        const urgent = g.key === "late" || g.key === "today";
        return (
          <section key={g.key} className="adm-rise" style={{ ["--i" as string]: gi }} aria-label={g.title}>
            <header className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
              <h2 className={cn("flex items-center gap-2 text-[19px] font-bold tracking-[-0.02em]", g.key === "late" && "text-[#FF9A8A]")}>
                {urgent ? <span className={cn("size-2.5 rounded-full", g.key === "late" ? "bg-[#FF8A75]" : "bg-[#FFD599]")} /> : null}
                {g.title}
                <span className="text-[15px] font-semibold text-[#6F6F6F] tabular-nums">{list.length}</span>
              </h2>
              <p className="text-[13px] text-[#8C8C8C]">
                {g.key === "owing"
                  ? `${brl(list.reduce((s, r) => s + r.pay.due, 0))} para receber`
                  : g.key === "none" || g.key === "later"
                    ? g.hint
                    : `${ready} de ${list.length} ${list.length === 1 ? "pronto" : "prontos"} para entregar`}
              </p>
            </header>
            <ul className="space-y-1.5">
              {list.map((r, i) => (
                <TrackItem key={r.o.id} r={r} i={i} lines={linesOf(r.o)} imageOf={imageOf} actions={actions} busy={busyId === r.o.id} />
              ))}
            </ul>
          </section>
        );
      })}

      {!shown.length ? (
        <div className="dash-card flex flex-col items-center px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-[#1C2A21] text-[#7FCF9F]">
            <Check className="size-7" strokeWidth={2.6} />
          </span>
          <p className="mt-4 text-[18px] font-bold">{needle || phase !== "todas" ? "Nada encontrado" : "Nenhum pedido em andamento"}</p>
          <p className="mt-1 text-[13.5px] text-[#8C8C8C]">{needle || phase !== "todas" ? "Tente outra busca ou fase." : "Os pedidos novos aparecem aqui."}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────── foco de hoje (Painel) ─────────────── */

export function TodayFocus({
  rows,
  linesOf,
  imageOf,
  actions,
  busyId,
}: {
  rows: Row[];
  linesOf: (o: any) => any[];
  imageOf: (l: any) => string | null | undefined;
  actions: TrackActions;
  busyId?: string | null;
}) {
  const list = rows.filter((r) => r.group === "late" || r.group === "today");
  const late = list.filter((r) => r.group === "late").length;
  const ready = list.filter((r) => r.ready && r.pay.due <= 0.009).length;
  const need = list.length - ready;

  if (!list.length) {
    // nada para hoje: já avisa o que vem (amanhã, depois os próximos dias)
    const next = rows.filter((r) => r.group === "tomorrow").length ? rows.filter((r) => r.group === "tomorrow") : rows.filter((r) => r.group === "week");
    const noDay = rows.filter((r) => r.group === "none").length;
    const nextReady = next.filter((r) => r.ready && r.pay.due <= 0.009).length;
    const isTomorrow = next[0]?.group === "tomorrow";
    return (
      <section className="dash-card adm-rise p-3 lg:p-5" style={{ ["--i" as string]: 0 }} aria-label="Próximas entregas">
        <div className="flex items-start gap-3.5 px-1 pb-1 lg:px-0.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#1C2A21] text-[#7FCF9F]">
            <Check className="size-6" strokeWidth={2.6} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-[#7FCF9F]">Nada urgente para hoje</p>
            <h2 className="text-[clamp(1.3rem,2.6vw,1.75rem)] leading-tight font-bold tracking-[-0.03em]">
              {next.length
                ? `${isTomorrow ? "Amanhã" : "Nos próximos dias"}: ${plural(next.length, "entrega", "entregas")}`
                : "Nenhuma entrega marcada para os próximos dias"}
            </h2>
            <p className="mt-0.5 text-[14px] text-[#A9A9A9]">
              {next.length
                ? nextReady === next.length
                  ? "Já está tudo pronto. 👌"
                  : `${next.length - nextReady} ainda ${next.length - nextReady === 1 ? "precisa" : "precisam"} de você — dá para adiantar hoje.`
                : noDay
                  ? `${plural(noDay, "pedido está", "pedidos estão")} sem dia de entrega — combine com ${noDay === 1 ? "o cliente" : "os clientes"}.`
                  : "Aproveite para conferir as compras e os pagamentos."}
            </p>
          </div>
        </div>
        {next.length ? (
          <ul className="mt-3 space-y-1.5">
            {next.slice(0, 5).map((r, i) => (
              <TrackItem key={r.o.id} r={r} i={i} lines={linesOf(r.o)} imageOf={imageOf} actions={actions} busy={busyId === r.o.id} />
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  return (
    <section className="dash-card adm-rise p-3 lg:p-5" style={{ ["--i" as string]: 0 }} aria-label="Urgente hoje">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-1 pb-4 lg:px-0.5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13.5px] font-semibold text-[#FFD599]">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#FFD599] opacity-50" />
              <span className="relative inline-flex size-2.5 rounded-full bg-[#FFD599]" />
            </span>
            Urgente · {dayLabel(todayBR()).toLowerCase()}
          </p>
          <h2 className="mt-1 text-[clamp(1.5rem,3vw,2.1rem)] leading-tight font-bold tracking-[-0.035em]">
            {plural(list.length, "pedido para entregar", "pedidos para entregar")}
            {late ? <span className="text-[#FF9A8A]"> · {late} {late === 1 ? "atrasado" : "atrasados"}</span> : null}
          </h2>
          <p className="mt-0.5 text-[14px] text-[#A9A9A9]">
            {ready ? <b className="font-semibold text-[#7FCF9F]">{plural(ready, "pronto", "prontos")}</b> : null}
            {ready && need ? " · " : null}
            {need ? <b className="font-semibold text-white">{need} {need === 1 ? "precisa" : "precisam"} de você</b> : null}
            {need ? " — o botão de cada um diz o próximo passo." : " — é só entregar."}
          </p>
        </div>
        {/* um pedaço por pedido: verde = pronto, branco = falta algo */}
        <div className="flex w-full max-w-[260px] gap-1" aria-hidden>
          {list.map((r) => (
            <span key={r.o.id} className={cn("h-2 flex-1 rounded-full", r.ready && r.pay.due <= 0.009 ? "bg-[#7FCF9F]" : r.group === "late" ? "bg-[#FF8A75]" : "bg-[#3A3A3A]")} />
          ))}
        </div>
      </div>
      <ul className="space-y-1.5">
        {list.map((r, i) => (
          <TrackItem key={r.o.id} r={r} i={i} lines={linesOf(r.o)} imageOf={imageOf} actions={actions} busy={busyId === r.o.id} />
        ))}
      </ul>
    </section>
  );
}

