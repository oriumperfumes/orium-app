/**
 * PAINEL DE PEDIDOS — a primeira coisa que aparece em Pedidos.
 *
 * 1. Quatro números do mês (cartão dourado = pedidos em aberto).
 * 2. "Onde estão os pedidos": o caminho de cada pedido em 5 etapas
 *    (Esperando pagamento → Comprar no fornecedor → Chegando → Pronto para
 *    entregar → Entregue). Tocar numa etapa abre só aqueles pedidos.
 * 3. Agenda da semana: entregas, pagamentos combinados e compras por dia.
 * 4. De onde vêm os pedidos · pedidos por dia · melhores clientes.
 * 5. "Precisa de você agora" (alertas com ação na linha).
 * Tudo calculado aqui a partir dos pedidos já carregados — nada novo no banco.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  HandCoins,
  PackageCheck,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { paymentInfo } from "@/components/orium/admin/OrderPayment";
import { AnimatedMetric } from "@/components/orium/AnimatedMetric";
import { fmtTime, todayBR } from "@/lib/delivery";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PurchaseItem } from "@/lib/orders-control.functions";
import { PhotoStack, initials, orderTotal, originOf } from "./model";
import { addDays, dayLabel, dueInfo } from "./controls";
import { TodayView } from "./TodayView";

/* ─────────────── o caminho do pedido ─────────────── */

export type Journey = "pagamento" | "comprar" | "chegando" | "entregar" | "entregue";

export const JOURNEY: Array<{ key: Journey; title: string; hint: string; icon: LucideIcon; tone: string }> = [
  { key: "pagamento", title: "Esperando pagamento", hint: "ainda não pagaram nada", icon: CircleDollarSign, tone: "#8C8C8C" },
  { key: "comprar", title: "Comprar no fornecedor", hint: "pagos, falta comprar", icon: ShoppingCart, tone: "#FFD599" },
  { key: "chegando", title: "Chegando", hint: "já comprados", icon: Truck, tone: "#F5C26B" },
  { key: "entregar", title: "Pronto para entregar", hint: "separar e entregar", icon: PackageCheck, tone: "#FFFFFF" },
  { key: "entregue", title: "Entregues", hint: "neste mês", icon: Sparkles, tone: "#7FCF9F" },
];

/** Em que etapa o pedido está, olhando pagamento e compras no fornecedor. */
export function journeyOf(o: any, buy: Map<string, { toBuy: number; arriving: number }>): Journey | null {
  if (o.deleted_at || o.status === "cancelado") return null;
  if (o.status === "entregue") return "entregue";
  if (o.status === "pendente" && paymentInfo(o).paid <= 0) return "pagamento";
  const b = buy.get(o.id);
  if (b?.toBuy) return "comprar";
  if (b?.arriving) return "chegando";
  return "entregar";
}

export function buyByOrder(items: PurchaseItem[] | undefined) {
  const m = new Map<string, { toBuy: number; arriving: number }>();
  (items ?? []).forEach((p) =>
    p.sources.forEach((s) => {
      const cur = m.get(s.orderId) ?? { toBuy: 0, arriving: 0 };
      if (p.status === "a comprar") cur.toBuy += s.quantity;
      else if (p.status === "pedido feito") cur.arriving += s.quantity;
      m.set(s.orderId, cur);
    }),
  );
  return m;
}

const monthOf = (iso: string) => String(iso).slice(0, 7);

export function OrdersDashboard({
  orders,
  linesOf,
  imageOf,
  purchases,
  onOpen,
  onDeliver,
  onReceived,
  onGoPurchases,
  onJourney,
  onBoard,
}: {
  orders: any[];
  linesOf: (o: any) => any[];
  imageOf: (l: any) => string | null | undefined;
  purchases: PurchaseItem[] | undefined;
  onOpen: (o: any, el?: HTMLElement | null) => void;
  onDeliver: (o: any, at?: { x: number; y: number }) => void;
  onReceived: (o: any, at?: { x: number; y: number }) => void;
  onGoPurchases: () => void;
  onJourney: (j: Journey) => void;
  onBoard: () => void;
}) {
  const t = todayBR();
  const thisMonth = t.slice(0, 7);
  const lastMonth = addDays(`${thisMonth}-01`, -1).slice(0, 7);
  const live = useMemo(() => orders.filter((o) => !o.deleted_at && o.status !== "cancelado"), [orders]);
  const buy = useMemo(() => buyByOrder(purchases), [purchases]);

  const steps = useMemo(() => {
    const by: Record<Journey, any[]> = { pagamento: [], comprar: [], chegando: [], entregar: [], entregue: [] };
    live.forEach((o) => {
      const j = journeyOf(o, buy);
      if (!j) return;
      if (j === "entregue" && monthOf(o.updated_at ?? o.created_at) !== thisMonth) return;
      by[j].push(o);
    });
    return by;
  }, [live, buy, thisMonth]);

  const month = live.filter((o) => monthOf(o.created_at) === thisMonth);
  const prev = live.filter((o) => monthOf(o.created_at) === lastMonth);
  const revenue = month.reduce((s, o) => s + orderTotal(o), 0);
  const prevRevenue = prev.reduce((s, o) => s + orderTotal(o), 0);
  const ticket = month.length ? revenue / month.length : 0;
  const openOrders = live.filter((o) => o.status !== "entregue");
  const openValue = openOrders.reduce((s, o) => s + orderTotal(o), 0);
  const due = live.reduce((s, o) => s + paymentInfo(o).due, 0);
  const received = month.reduce((s, o) => s + paymentInfo(o).paid, 0);

  // pedidos por dia (14 dias)
  const daily = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
    return days.map((d) => {
      const list = live.filter((o) => String(o.created_at).slice(0, 10) === d);
      return { d, n: list.length, v: list.reduce((s, o) => s + orderTotal(o), 0) };
    });
  }, [live, t]);

  return (
    <div className="space-y-4">
      {/* 1 · números */}
      <section className="grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4" aria-label="Resumo">
        <Kpi
          hero
          i={0}
          className="col-span-2 xl:col-span-1"
          icon={ShoppingBag}
          label="Pedidos em aberto"
          value={<AnimatedMetric value={openOrders.length} />}
          foot={<span className="text-[13px] font-semibold text-[#15130F]/65">{brl(openValue)} em andamento</span>}
          onClick={onBoard}
        />
        <Kpi
          i={1}
          icon={Receipt}
          label="Vendido no mês"
          value={brl(revenue)}
          foot={<Trend now={revenue} before={prevRevenue} />}
          chart={<MiniBars values={daily.map((x) => x.v)} />}
        />
        <Kpi i={2} icon={Wallet} label="Ticket médio" value={brl(ticket)} foot={<span className="text-[13px] text-[#8C8C8C]">{month.length} pedidos no mês</span>} />
        <Kpi
          i={3}
          className="col-span-2 xl:col-span-1"
          icon={HandCoins}
          label="Falta receber"
          value={brl(due)}
          foot={<span className="text-[13px] text-[#8C8C8C]">{brl(received)} já entrou no mês</span>}
          chart={<Split a={received} b={due} />}
        />
      </section>

      {/* 2 · onde estão os pedidos */}
      <section className="dash-card adm-rise p-4 lg:p-6" style={{ ["--i" as string]: 4 }} aria-label="Onde estão os pedidos">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <h2 className="text-[19px] font-bold tracking-[-0.015em]">Onde estão os pedidos</h2>
            <p className="text-[13.5px] text-[#8C8C8C]">Cada pedido passa por essas etapas. Toque numa para ver quais são.</p>
          </div>
          <button type="button" onClick={onBoard} className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-[#262626] px-4 text-[13.5px] font-bold hover:bg-[#2E2E2E]">
            Ver no quadro <ArrowRight className="size-4" />
          </button>
        </div>
        <ol className="grid gap-2 sm:grid-cols-5 sm:gap-0">
          {JOURNEY.map((j, i) => {
            const list = steps[j.key];
            const value = list.reduce((s, o) => s + orderTotal(o), 0);
            const hot = list.length > 0 && j.key !== "entregue";
            return (
              <li key={j.key} className="relative min-w-0">
                {i < JOURNEY.length - 1 ? (
                  <span aria-hidden className="absolute top-[34px] left-[calc(50%+34px)] hidden h-[2px] w-[calc(100%-68px)] overflow-hidden rounded-full bg-[#262626] sm:block">
                    <span className="dash-barx block h-full bg-gradient-to-r from-[#FFD599]/70 to-[#FFD599]/10" style={{ ["--i" as string]: i + 3 }} />
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onJourney(j.key)}
                  className="press group flex w-full items-center gap-3 rounded-[20px] p-2.5 text-left transition-colors hover:bg-white/[0.03] sm:flex-col sm:gap-2 sm:px-1.5 sm:py-1 sm:text-center"
                >
                  <span
                    className={cn("relative grid size-[68px] shrink-0 place-items-center rounded-full transition-transform duration-500 group-hover:scale-105", hot ? "bg-[#262626]" : "bg-[#1F1F1F]")}
                    style={{ boxShadow: hot ? `inset 0 0 0 2px ${j.tone}` : undefined }}
                  >
                    <j.icon className="size-6" style={{ color: hot ? j.tone : "#6F6F6F" }} strokeWidth={2} />
                    {list.length ? (
                      <span
                        key={list.length}
                        className="ord-bump absolute -top-1 -right-1 grid h-7 min-w-7 place-items-center rounded-full px-1.5 text-[13px] font-bold text-[#15130F] tabular-nums"
                        style={{ background: j.tone === "#8C8C8C" ? "#D4D4D4" : j.tone }}
                      >
                        {list.length}
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 sm:flex-none">
                    <span className="block text-[14.5px] leading-tight font-bold">{j.title}</span>
                    <span className="block text-[12.5px] text-[#8C8C8C]">{list.length ? brl(value) : j.hint}</span>
                  </span>
                  {list.length ? (
                    <span className="flex shrink-0 -space-x-1.5 sm:mt-1 sm:justify-center">
                      {list.slice(0, 3).map((o) => (
                        <span key={o.id} className="grid size-8 place-items-center rounded-full bg-[#2E2E2E] text-[11px] font-bold tracking-[-0.02em] ring-2 ring-[#1A1A1A]">
                          {initials(o.customer_name)}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      {/* 3 · agenda + origem */}
      <div className="grid gap-3 lg:gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Agenda orders={live} purchases={purchases} onOpen={onOpen} onGoPurchases={onGoPurchases} linesOf={linesOf} imageOf={imageOf} />
        <div className="grid gap-3 lg:gap-4">
          <Origins orders={month} />
          <DailyCard daily={daily} />
        </div>
      </div>

      {/* 4 · precisa de você agora */}
      <section className="adm-rise" style={{ ["--i" as string]: 9 }}>
        <h2 className="mb-3 flex items-center gap-2.5 px-1 text-[19px] font-bold tracking-[-0.015em]">
          <span className="relative grid size-9 place-items-center rounded-full bg-[#2A1A18] text-[#FF9A8A]">
            <HandCoins className="size-[18px]" />
          </span>
          Precisa de você agora
        </h2>
        <TodayView
          compact
          orders={orders}
          linesOf={linesOf}
          imageOf={imageOf}
          purchases={purchases}
          onOpen={onOpen}
          onDeliver={onDeliver}
          onReceived={onReceived}
          onGoPurchases={onGoPurchases}
        />
      </section>

      {/* 5 · melhores clientes do mês */}
      <TopCustomers orders={month} onOpen={onOpen} />
    </div>
  );
}

/* ─────────────── peças ─────────────── */

function Kpi({
  label,
  value,
  foot,
  icon: Icon,
  chart,
  hero,
  i,
  className,
  onClick,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  icon: LucideIcon;
  chart?: ReactNode;
  hero?: boolean;
  i: number;
  className?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn("adm-rise flex min-h-[150px] flex-col p-5 text-left lg:min-h-[168px] lg:p-6", hero ? "dash-hero" : "dash-card", onClick && "press", className)}
      style={{ ["--i" as string]: i }}
    >
      <span className="flex items-start justify-between gap-3">
        <span className={cn("text-[15px]", hero ? "font-semibold text-[#15130F]/75" : "text-[#A9A9A9]")}>{label}</span>
        <span className="dash-ico">
          <Icon className="size-[18px]" strokeWidth={2.2} />
        </span>
      </span>
      {chart ? <span className="mt-3 ml-auto block w-[60%] max-w-[180px] max-sm:hidden">{chart}</span> : null}
      <span className="mt-auto block pt-3">
        <span className={cn("block leading-none font-bold tracking-[-0.045em] whitespace-nowrap tabular-nums", hero ? "text-[clamp(2.2rem,4vw,3rem)]" : "text-[clamp(1.5rem,2.4vw,2.1rem)]")}>
          {value}
        </span>
        {foot ? <span className="mt-2 block">{foot}</span> : null}
      </span>
    </Tag>
  );
}

function Trend({ now, before }: { now: number; before: number }) {
  if (before <= 0) return <span className="text-[13px] text-[#8C8C8C]">primeiro mês com vendas</span>;
  const v = ((now - before) / before) * 100;
  const up = v >= 0;
  return (
    <span className="inline-flex items-center gap-2 text-[13px]">
      <span className={cn("rounded-full px-2 py-0.5 font-bold tabular-nums", up ? "bg-[#17251C] text-[#7FCF9F]" : "bg-[#2A1A18] text-[#FF9A8A]")}>
        {up ? "↑" : "↓"} {Math.abs(v).toFixed(0)}%
      </span>
      <span className="text-[#8C8C8C]">vs. mês passado</span>
    </span>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const v = values.slice(-10);
  const max = Math.max(...v, 1);
  return (
    <span className="flex h-12 items-end gap-[5px]" aria-hidden>
      {v.map((x, i) => (
        <span
          key={i}
          className={cn("dash-bar block flex-1 rounded-[4px]", i === v.length - 1 ? "bg-[#FFD599]" : "bg-[#2E2E2E]")}
          style={{ height: `${Math.max(10, (x / max) * 100)}%`, ["--i" as string]: i }}
        />
      ))}
    </span>
  );
}

function Split({ a, b }: { a: number; b: number }) {
  const tot = a + b;
  return (
    <span className="block pb-1" aria-hidden>
      <span className="flex h-3 overflow-hidden rounded-full bg-[#2E2E2E]">
        <span className="block h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${tot ? (a / tot) * 100 : 100}%` }} />
      </span>
    </span>
  );
}

/** Agenda: hoje + 6 dias, com atrasados num chip à parte. */
function Agenda({
  orders,
  purchases,
  onOpen,
  onGoPurchases,
  linesOf,
  imageOf,
}: {
  orders: any[];
  purchases: PurchaseItem[] | undefined;
  onOpen: (o: any, el?: HTMLElement | null) => void;
  onGoPurchases: () => void;
  linesOf: (o: any) => any[];
  imageOf: (l: any) => string | null | undefined;
}) {
  const t = todayBR();
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, i));
  type Ev = { kind: "entrega" | "pagar" | "comprar"; date: string; time?: string | null; title: string; sub: string; o?: any; late?: boolean };
  const events = useMemo(() => {
    const out: Ev[] = [];
    orders.forEach((o) => {
      if (o.status !== "entregue" && o.expected_delivery_date) {
        const d = String(o.expected_delivery_date).slice(0, 10);
        out.push({ kind: "entrega", date: d < t ? t : d, late: d < t, time: o.expected_delivery_time, title: o.customer_name || "Cliente", sub: `${o.fulfillment_type === "PICKUP" ? "Retira" : "Entrega"} · ${brl(orderTotal(o))}`, o });
      }
      const di = dueInfo(o);
      if (di.state !== "none" && di.date) {
        out.push({ kind: "pagar", date: di.date < t ? t : di.date, late: di.state === "late", title: o.customer_name || "Cliente", sub: `Paga ${brl(paymentInfo(o).due)}`, o });
      }
    });
    const bySup = new Map<string, { date: string; value: number; n: number }>();
    (purchases ?? [])
      .filter((p) => p.status === "a comprar" && p.plannedDate)
      .forEach((p) => {
        const d = p.plannedDate! < t ? t : p.plannedDate!;
        const k = `${p.supplier}|${d}`;
        const cur = bySup.get(k) ?? { date: d, value: 0, n: 0 };
        cur.value += p.unitCost * p.quantity;
        cur.n += p.quantity;
        bySup.set(k, cur);
      });
    bySup.forEach((v, k) => out.push({ kind: "comprar", date: v.date, title: k.split("|")[0]!, sub: `Comprar ${v.n} ${v.n === 1 ? "frasco" : "frascos"} · ${brl(v.value)}` }));
    return out.sort((a, b) => (a.late === b.late ? (a.time ?? "99").localeCompare(b.time ?? "99") : a.late ? -1 : 1));
  }, [orders, purchases, t]);
  const [sel, setSel] = useState(t);
  const today = events.filter((e) => e.date === sel);
  const count = (d: string) => events.filter((e) => e.date === d);

  const KIND = {
    entrega: { icon: Truck, color: "#FFD599", label: "Entrega" },
    pagar: { icon: HandCoins, color: "#7FCF9F", label: "Pagamento" },
    comprar: { icon: ShoppingCart, color: "#F5C26B", label: "Compra" },
  } as const;

  return (
    <section className="dash-card adm-rise flex min-w-0 flex-col p-4 lg:p-6" style={{ ["--i" as string]: 6 }}>
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-2 text-[19px] font-bold tracking-[-0.015em]">
          <CalendarDays className="size-5 text-[#FFD599]" /> Agenda da semana
        </h2>
        <span className="flex items-center gap-3 text-[12px] font-semibold text-[#8C8C8C]">
          {Object.values(KIND).map((k) => (
            <span key={k.label} className="hidden items-center gap-1.5 sm:inline-flex">
              <span className="size-2 rounded-full" style={{ background: k.color }} /> {k.label}
            </span>
          ))}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {days.map((d, i) => {
          const ev = count(d);
          const on = d === sel;
          const late = ev.some((e) => e.late);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => setSel(d)}
              className={cn(
                "press flex min-w-0 flex-col items-center gap-1 rounded-[18px] py-2.5 transition-colors duration-200",
                on ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] hover:bg-[#262626]",
              )}
            >
              <span className={cn("text-[11.5px] font-semibold", on ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>{i === 0 ? "Hoje" : dayLabel(d).split(" ")[0]}</span>
              <span className="text-[19px] leading-none font-bold tabular-nums">{Number(d.slice(8, 10))}</span>
              <span className="flex h-2 items-center gap-[3px]">
                {(["entrega", "pagar", "comprar"] as const).map((k) =>
                  ev.some((e) => e.kind === k) ? (
                    <span key={k} className={cn("size-[6px] rounded-full", late && k !== "comprar" && "animate-pulse")} style={{ background: late && i === 0 && ev.some((e) => e.kind === k && e.late) ? "#FF9A8A" : KIND[k].color }} />
                  ) : null,
                )}
              </span>
            </button>
          );
        })}
      </div>

      <ul key={sel} className="mt-4 flex-1 space-y-2">
        {today.length === 0 ? (
          <li className="grid min-h-[140px] place-items-center rounded-[20px] border-[1.5px] border-dashed border-white/[0.08] text-center text-[14px] text-[#6F6F6F]">
            Nada marcado {sel === t ? "para hoje" : `para ${dayLabel(sel).toLowerCase()}`}.
          </li>
        ) : (
          today.map((e, i) => {
            const k = KIND[e.kind];
            const lines = e.o ? linesOf(e.o) : [];
            return (
              <li key={`${e.kind}-${e.title}-${i}`} className="ord-in" style={{ ["--i" as string]: i }}>
                <button
                  type="button"
                  onClick={(ev) => (e.o ? onOpen(e.o, ev.currentTarget) : onGoPurchases())}
                  className="ord-card flex w-full min-w-0 items-center gap-3 p-3 text-left"
                >
                  <span className="w-12 shrink-0 text-center text-[13px] font-bold tabular-nums" style={{ color: e.late ? "#FF9A8A" : undefined }}>
                    {e.late ? "atraso" : fmtTime(e.time) || "—"}
                  </span>
                  <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: `${k.color}22`, color: e.late ? "#FF9A8A" : k.color }}>
                    <k.icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{e.title}</span>
                    <span className="block truncate text-[12.5px] text-[#8C8C8C]">{e.sub}</span>
                  </span>
                  {lines.length ? (
                    <span className="max-sm:hidden">
                      <PhotoStack images={lines.map(imageOf)} more={Math.max(0, lines.length - 3)} size={30} />
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

/** De onde vieram os pedidos do mês (App, WhatsApp, Balcão) e como saem (retira/entrega). */
function Origins({ orders }: { orders: any[] }) {
  const origins = ["App", "WhatsApp", "Balcão"].map((k) => ({ k, n: orders.filter((o) => originOf(o) === k).length }));
  const total = Math.max(1, orders.length);
  const colors = ["#FFD599", "#7FCF9F", "#FFFFFF"];
  const C = 2 * Math.PI * 44;
  let acc = 0;
  const pickup = orders.filter((o) => (o.fulfillment_type ?? "PICKUP") === "PICKUP").length;
  return (
    <section className="dash-card adm-rise p-4 lg:p-6" style={{ ["--i" as string]: 7 }}>
      <h2 className="px-1 text-[17px] font-bold tracking-[-0.01em]">De onde vêm os pedidos</h2>
      <div className="mt-3 flex items-center gap-5">
        <span className="relative grid size-[112px] shrink-0 place-items-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r="44" fill="none" stroke="#262626" strokeWidth="9" />
            {origins.map((o, i) => {
              const len = (o.n / total) * C;
              const el = o.n ? (
                <circle key={o.k} cx="50" cy="50" r="44" fill="none" stroke={colors[i]} strokeWidth="9" className="dash-ring" strokeDasharray={`${Math.max(0, len - 3)} ${C}`} strokeDashoffset={-acc} />
              ) : null;
              acc += len;
              return el;
            })}
          </svg>
          <span className="text-center">
            <span className="block text-[24px] leading-none font-bold tabular-nums">{orders.length}</span>
            <span className="text-[11px] text-[#8C8C8C]">no mês</span>
          </span>
        </span>
        <ul className="min-w-0 flex-1 space-y-2">
          {origins.map((o, i) => (
            <li key={o.k} className="flex items-center gap-2 text-[14px]">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: colors[i] }} />
              <span className="flex-1 font-semibold">{o.k}</span>
              <span className="font-bold tabular-nums">{o.n}</span>
              <span className="w-10 text-right text-[12px] text-[#8C8C8C] tabular-nums">{Math.round((o.n / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-[16px] bg-[#232323] px-3.5 py-2.5">
          <p className="text-[12px] text-[#8C8C8C]">Retiram na loja</p>
          <p className="text-[18px] font-bold tabular-nums">{pickup}</p>
        </div>
        <div className="rounded-[16px] bg-[#232323] px-3.5 py-2.5">
          <p className="text-[12px] text-[#8C8C8C]">Entrega / envio</p>
          <p className="text-[18px] font-bold tabular-nums">{orders.length - pickup}</p>
        </div>
      </div>
    </section>
  );
}

function DailyCard({ daily }: { daily: Array<{ d: string; n: number; v: number }> }) {
  const max = Math.max(...daily.map((x) => x.n), 1);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover != null ? daily[hover]! : daily[daily.length - 1]!;
  return (
    <section className="dash-card adm-rise p-4 lg:p-6" style={{ ["--i" as string]: 8 }}>
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-[17px] font-bold tracking-[-0.01em]">Pedidos por dia</h2>
        <span className="text-[12.5px] text-[#8C8C8C] tabular-nums">
          {dayLabel(shown.d)}: <b className="text-white">{shown.n}</b> · {brl(shown.v)}
        </span>
      </div>
      <div className="mt-4 flex h-[110px] items-end gap-1.5" onMouseLeave={() => setHover(null)}>
        {daily.map((x, i) => (
          <button
            key={x.d}
            type="button"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
            aria-label={`${dayLabel(x.d)}: ${x.n} pedidos`}
            className="flex h-full flex-1 flex-col justify-end"
          >
            <span
              className={cn(
                "dash-bar block w-full rounded-[6px] transition-colors duration-200",
                i === daily.length - 1 ? "bg-[#FFD599]" : hover === i ? "bg-white" : x.n ? "bg-[#3A3A3A]" : "bg-[#262626]",
              )}
              style={{ height: `${Math.max(6, (x.n / max) * 100)}%`, ["--i" as string]: i }}
            />
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-between px-0.5 text-[11px] text-[#6F6F6F]">
        <span>{dayLabel(daily[0]!.d)}</span>
        <span>Hoje</span>
      </div>
    </section>
  );
}

function TopCustomers({ orders, onOpen }: { orders: any[]; onOpen: (o: any, el?: HTMLElement | null) => void }) {
  const list = useMemo(() => {
    const m = new Map<string, { name: string; total: number; n: number; last: any }>();
    orders.forEach((o) => {
      const k = o.crm_customer_id ?? o.customer_phone ?? o.customer_name ?? o.id;
      const cur = m.get(k) ?? { name: o.customer_name || "Cliente", total: 0, n: 0, last: o };
      cur.total += orderTotal(o);
      cur.n += 1;
      if (new Date(o.created_at) > new Date(cur.last.created_at)) cur.last = o;
      m.set(k, cur);
    });
    return [...m.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [orders]);
  if (!list.length) return null;
  const max = list[0]!.total || 1;
  return (
    <section className="dash-card adm-rise p-4 lg:p-6" style={{ ["--i" as string]: 10 }}>
      <h2 className="px-1 text-[17px] font-bold tracking-[-0.01em]">Melhores clientes do mês</h2>
      <ol className="mt-3 grid gap-2 lg:grid-cols-5">
        {list.map((c, i) => (
          <li key={c.name + i}>
            <button type="button" onClick={(e) => onOpen(c.last, e.currentTarget)} className="ord-card flex w-full items-center gap-3 p-3 text-left lg:flex-col lg:items-start">
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-full text-[14px] font-bold", i === 0 ? "bg-[#FFD599] text-[#15130F]" : "bg-[#2E2E2E]")}>{initials(c.name)}</span>
              <span className="min-w-0 flex-1 lg:w-full">
                <span className="block truncate text-[14.5px] font-bold">{c.name}</span>
                <span className="block text-[12.5px] text-[#8C8C8C] tabular-nums">
                  {c.n} {c.n === 1 ? "pedido" : "pedidos"} · {brl(c.total)}
                </span>
                <span className="mt-2 block h-[5px] overflow-hidden rounded-full bg-[#2E2E2E]">
                  <span className="dash-barx block h-full rounded-full bg-[#FFD599]" style={{ width: `${(c.total / max) * 100}%`, ["--i" as string]: i }} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

