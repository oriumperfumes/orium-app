import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  HandCoins,
  PackagePlus,
  Plus,
  Receipt,
  SendHorizontal,
  Sparkles,
  Store,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { AdminShell } from "@/components/orium/AdminShell";
import { useCopilot } from "@/components/orium/copilot/CopilotPanel";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Calendar } from "@/components/ui/calendar";
import {
  activeOrders,
  adminDashboard,
  adminPaymentSummary,
  type ActiveOrder,
  type DashboardChannel,
  type DashboardReport,
} from "@/lib/dashboard.functions";
import { StockAlerts } from "@/components/orium/admin/StockAlerts";
import { SupplierQuoteButton } from "@/components/orium/admin/SupplierQuoteSheet";
import { storeStock } from "@/lib/store-stock.functions";
import { AnimatedMetric } from "@/components/orium/AnimatedMetric";
import { paymentInfo } from "@/components/orium/admin/OrderPayment";
import { askCopilot } from "@/components/orium/copilot/ask";
import { brl } from "@/lib/format";
import { imgVariant } from "@/lib/product-img";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import symbolDark from "@/assets/orium-symbol-dark.png.asset.json";
import { deliveryRank, deliveryState, fmtTime, todayBR } from "@/lib/delivery";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Início — Orium Admin" }, { name: "robots", content: "noindex" }] }),
  component: Dashboard,
});

/* ------------------------------------------------------------------ *
 * INÍCIO DO ADMIN — o dia em cartões.
 *  1. Saudação, data e a ação principal (novo pedido).
 *  2. Quatro números: vendas (cartão dourado), lucro, pedidos e a receber.
 *  3. Pedidos abertos · a semana (dia a dia + frascos x decants) · Copilot.
 *  4. Próximas entregas · mais vendidos · estoque.
 * Nenhuma regra de cálculo aqui — os números vêm prontos do banco.
 * ------------------------------------------------------------------ */

type PeriodKey = "today" | "7d" | "30d" | "custom";
const PERIODS: Array<{ key: Exclude<PeriodKey, "custom">; label: string }> = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
];
const CHANNELS: Array<{ key: DashboardChannel; label: string }> = [
  { key: "all", label: "Tudo" },
  { key: "app", label: "App" },
  { key: "store", label: "Loja" },
];

const TZ = "America/Sao_Paulo";
function spYmd(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** São Paulo não tem horário de verão desde 2019: offset fixo −03:00. */
const spStart = (ymd: string) => new Date(`${ymd}T00:00:00-03:00`);
const spEnd = (ymd: string) => new Date(`${ymd}T23:59:59.999-03:00`);

function rangeFor(key: PeriodKey, custom: { from?: Date; to?: Date }) {
  const now = new Date();
  const today = spYmd(now);
  if (key === "custom" && custom.from) {
    return { from: spStart(spYmd(custom.from)).toISOString(), to: spEnd(spYmd(custom.to ?? custom.from)).toISOString() };
  }
  const days = key === "7d" ? 6 : key === "30d" ? 29 : 0;
  const start = spYmd(new Date(spStart(today).getTime() - days * 86_400_000 + 3_600_000));
  return { from: spStart(start).toISOString(), to: now.toISOString() };
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short", timeZone: TZ }).replace(".", "").replace(" de ", " ");
const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function greeting() {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: TZ }).format(new Date()));
  return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}
function todayParts() {
  const d = new Date();
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { ...o, timeZone: TZ }).format(d);
  return { day: f({ day: "numeric" }), weekday: cap(f({ weekday: "long" }).replace("-feira", "")), month: cap(f({ month: "long" })) };
}

function Dashboard() {
  const { session } = useAuth();
  const first = ((session?.user.user_metadata?.["name"] as string | undefined) ?? "").trim().split(/\s+/)[0];
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [channel, setChannel] = useState<DashboardChannel>("all");
  const [custom, setCustom] = useState<{ from?: Date; to?: Date }>({});
  const [draft, setDraft] = useState<{ from?: Date; to?: Date } | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);

  const range = useMemo(() => rangeFor(period, custom), [period, custom]);
  const week = useMemo(() => rangeFor("7d", {}), []);
  const loadDashboard = useServerFn(adminDashboard);
  const loadStock = useServerFn(storeStock);
  const loadActive = useServerFn(activeOrders);
  const loadPay = useServerFn(adminPaymentSummary);

  const dash = useQuery({
    queryKey: ["admin-dashboard", range.from, range.to, channel],
    queryFn: () => loadDashboard({ data: { ...range, channel } }) as Promise<DashboardReport>,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  // a semana do cartão "Semana" é sempre os últimos 7 dias, independente do filtro
  const weekDash = useQuery({
    queryKey: ["admin-dashboard", week.from.slice(0, 10), "week", channel],
    queryFn: () => loadDashboard({ data: { ...week, channel } }) as Promise<DashboardReport>,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const stock = useQuery({ queryKey: ["store-stock"], queryFn: () => loadStock(), staleTime: 30_000 });
  const paySum = useQuery({
    queryKey: ["payment-summary", range.from, range.to],
    queryFn: () => loadPay({ data: { from: range.from, to: range.to } }),
    staleTime: 30_000,
  });
  const active = useQuery({ queryKey: ["active-orders"], queryFn: () => loadActive(), staleTime: 15_000, refetchInterval: 60_000 });

  const openPicker = () => {
    setDraft(custom.from ? custom : undefined);
    setPickerOpen(true);
  };
  const rangeLabel = period === "today" ? "hoje" : `${shortDate(range.from)} – ${shortDate(range.to)}`;
  const today = todayParts();
  const r = dash.data;
  const p = r?.period;

  return (
    <AdminShell title={first ? `${greeting()}, ${first}` : greeting()} bare>
      {/* 1 · saudação + data + ação principal */}
      <header className="adm-rise flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p className="text-[15px] text-[#A9A9A9] lg:text-[17px]">Bora vender hoje.</p>
          <h1 className="mt-1 text-[34px] leading-[1.05] font-bold tracking-[-0.04em] text-balance lg:text-[46px]">
            {greeting()}
            {first ? `, ${first}` : ""}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex shrink-0 items-center gap-3">
            <span className="grid size-[60px] place-items-center rounded-full border border-white/10 text-[22px] font-bold tabular-nums lg:size-[72px] lg:text-[26px]">
              {today.day}
            </span>
            <span className="text-[14px] leading-tight text-[#A9A9A9] lg:text-[15px]">
              {today.weekday},
              <br />
              <span className="font-semibold text-white">{today.month}</span>
            </span>
          </div>
          <span aria-hidden className="mx-2 hidden h-10 w-px bg-white/15 sm:block" />
          <Link
            to="/admin/pedidos"
            search={{ novo: true } as never}
            preload="intent"
            className="press ml-auto inline-flex h-[54px] items-center justify-center gap-2 rounded-full bg-[#FFD599] pr-7 pl-6 text-[15px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA] max-sm:flex-1 sm:ml-0 lg:h-[60px] lg:min-w-[220px]"
          >
            <Plus className="size-[18px]" strokeWidth={2.6} /> Novo pedido
          </Link>
          <button
            type="button"
            onClick={openPicker}
            aria-label="Escolher datas"
            className={cn(
              "press hidden size-[54px] place-items-center rounded-full border transition-colors sm:grid lg:size-[60px]",
              period === "custom" ? "border-white bg-white text-[#15130F]" : "border-white/10 text-white hover:bg-white/[0.05]",
            )}
          >
            <CalendarDays className="size-5" strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* filtros */}
      <div className="adm-rise mt-6 flex flex-wrap items-center gap-2" style={{ ["--i" as string]: 1 }}>
        <div className="adm-seg max-sm:flex-1 max-sm:[&>button]:flex-1" role="group" aria-label="Período">
          {PERIODS.map((x) => (
            <button key={x.key} type="button" aria-pressed={period === x.key} onClick={() => setPeriod(x.key)} className="press">
              {x.label}
            </button>
          ))}
          {period === "custom" ? (
            <button type="button" aria-pressed onClick={openPicker} className="press">
              {rangeLabel}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={openPicker}
          aria-label="Escolher datas"
          className={cn(
            "press grid size-11 shrink-0 place-items-center rounded-full transition-colors sm:hidden",
            period === "custom" ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-white",
          )}
        >
          <CalendarDays className="size-[18px]" strokeWidth={2} />
        </button>
        <div className="adm-seg ml-auto max-sm:w-full max-sm:[&>button]:flex-1" role="group" aria-label="Origem das vendas">
          {CHANNELS.map((x) => (
            <button key={x.key} type="button" aria-pressed={channel === x.key} onClick={() => setChannel(x.key)} className="press">
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {dash.isError && !r ? (
        <div className="dash-card mt-4 flex flex-wrap items-center gap-3 p-5">
          <p className="text-[15px] text-[#A9A9A9]">Os números não carregaram. Nada foi zerado.</p>
          <button type="button" onClick={() => dash.refetch()} className="press h-10 rounded-full bg-[#262626] px-4 text-[14px] font-bold">
            Tentar de novo
          </button>
        </div>
      ) : null}

      {/* 2 · os quatro números */}
      <section
        className={cn("mt-4 grid grid-cols-2 gap-3 transition-opacity duration-300 lg:gap-4 xl:grid-cols-4", dash.isFetching && r && "opacity-75")}
        aria-label="Resumo do período"
      >
        <Kpi
          hero
          i={2}
          className="col-span-2 xl:col-span-1"
          label="Vendas"
          icon={<TrendingUp className="size-[18px]" strokeWidth={2.2} />}
          loading={dash.isPending}
          value={<AnimatedMetric value={p?.revenue ?? null} format="BRL" />}
          foot={<Delta current={p?.revenue} previous={p?.previous.revenue} hero />}
          chart={r ? <Wave values={r.series.map((x) => Number(x.revenue))} /> : null}
        />
        <Kpi
          i={3}
          label="Lucro bruto"
          icon={<Wallet className="size-[18px]" strokeWidth={2.2} />}
          loading={dash.isPending}
          value={p ? brl(p.profit) : "—"}
          foot={p?.margin != null ? <span className="text-[13px] text-[#8C8C8C]">margem {String(p.margin).replace(".", ",")}%</span> : null}
          chart={r ? <Bars values={r.series.map((x) => Number(x.profit))} /> : null}
        />
        <Kpi
          i={4}
          label={p && p.orders === 1 ? "Venda" : "Vendas feitas"}
          icon={<Receipt className="size-[18px]" strokeWidth={2.2} />}
          loading={dash.isPending}
          value={p ? String(p.orders) : "—"}
          foot={p?.ticket != null ? <span className="text-[13px] text-[#8C8C8C]">{brl(p.ticket)} cada</span> : null}
          chart={r ? <Ticks values={r.series.map((x) => Number(x.orders))} /> : null}
        />
        <Kpi
          i={5}
          label="A receber"
          icon={<HandCoins className="size-[18px]" strokeWidth={2.2} />}
          loading={paySum.isPending}
          value={brl(paySum.data?.receivable ?? 0)}
          foot={
            <span className="text-[13px] text-[#8C8C8C]">
              {paySum.data?.receivable_orders
                ? `${paySum.data.receivable_orders} ${paySum.data.receivable_orders === 1 ? "pedido" : "pedidos"}`
                : "nada pendente"}
            </span>
          }
          chart={<Split received={paySum.data?.received ?? 0} due={paySum.data?.receivable ?? 0} />}
        />
      </section>

      {/* 3 · pedidos · semana · copilot */}
      <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
        <OpenOrdersCard orders={active.data} loading={active.isPending} failed={active.isError} />
        <WeekCard report={weekDash.data} period={r} loading={weekDash.isPending} />
        <CopilotCard name={first} />
      </div>

      {/* 4 · entregas · mais vendidos · estoque */}
      <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
        <DeliveriesCard orders={active.data} loading={active.isPending} />
        <TopProducts items={r?.top_products} loading={dash.isPending} rangeLabel={rangeLabel} />
        <div className="min-w-0 space-y-3 lg:space-y-4">
          <StockCard data={stock.data} loading={stock.isPending} failed={stock.isError} />
          <Shortcuts />
        </div>
      </div>
      {stock.data?.alerts?.length ? (
        <div className="mt-4">
          <StockAlerts alerts={stock.data.alerts} />
        </div>
      ) : null}

      <Drawer open={pickerOpen} onOpenChange={setPickerOpen}>
        <DrawerContent className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white">
          <DrawerTitle className="pt-4 text-[22px] font-bold tracking-[-0.02em]">Escolher datas</DrawerTitle>
          <p className="mt-1 text-[14px] text-[#A9A9A9]">Toque no primeiro e no último dia.</p>
          <div className="mt-3 flex justify-center rounded-[22px] bg-[#1A1A1A]">
            <Calendar
              mode="range"
              selected={draft as never}
              onSelect={(v: any) => setDraft(v)}
              disabled={{ after: new Date() }}
              numberOfMonths={1}
              className="pointer-events-auto p-3"
            />
          </div>
          <button
            type="button"
            disabled={!draft?.from}
            onClick={() => {
              setCustom(draft ?? {});
              setPeriod("custom");
              setPickerOpen(false);
            }}
            className="press mt-4 flex h-[54px] w-full items-center justify-center rounded-full bg-[#FFD599] text-[16px] font-bold text-[#15130F] transition-opacity disabled:opacity-40"
          >
            Ver esse período
          </button>
        </DrawerContent>
      </Drawer>
    </AdminShell>
  );
}

/* ─────────────── cartões de número ─────────────── */

function Kpi({
  label,
  icon,
  value,
  foot,
  chart,
  hero,
  loading,
  className,
  i = 0,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  foot?: ReactNode;
  chart?: ReactNode;
  hero?: boolean;
  loading?: boolean;
  className?: string;
  i?: number;
}) {
  return (
    <article
      className={cn("adm-rise flex min-h-[156px] flex-col p-5 lg:min-h-[176px] lg:p-6", hero ? "dash-hero" : "dash-card", className)}
      style={{ ["--i" as string]: i }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-[15px] lg:text-[16px]", hero ? "font-semibold text-[#15130F]/75" : "text-[#A9A9A9]")}>{label}</p>
        <span className="dash-ico">{icon}</span>
      </div>
      {chart && !loading ? <div className={cn("mt-4 ml-auto w-[58%] max-w-[200px]", !hero && "max-sm:hidden")}>{chart}</div> : null}
      <div className="mt-auto min-w-0 pt-3">
        {loading ? (
          <div className={cn("admin-skeleton h-9 w-28 rounded-[12px]", hero && "opacity-40")} />
        ) : (
          <p className={cn("leading-none font-bold tracking-[-0.045em] whitespace-nowrap tabular-nums", hero ? "text-[clamp(2rem,3.1vw,2.75rem)]" : "text-[clamp(1.5rem,2.4vw,2.1rem)]")}>
            {value}
          </p>
        )}
        {foot ? <div className="mt-2 min-h-5">{foot}</div> : null}
      </div>
    </article>
  );
}

function Delta({ current, previous, hero }: { current?: number; previous?: number; hero?: boolean }) {
  if (current == null || previous == null || previous <= 0) return <span className="text-[13px] font-semibold opacity-60">no período</span>;
  const v = ((current - previous) / previous) * 100;
  if (!Number.isFinite(v) || Math.abs(v) < 0.1) return <span className="text-[13px] font-semibold opacity-60">igual ao anterior</span>;
  const up = v >= 0;
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
      <span
        className={cn(
          "inline-flex h-6 items-center gap-0.5 rounded-full px-2 font-bold tabular-nums",
          hero ? "bg-[#15130F] text-[#FFD599]" : up ? "bg-[#17251C] text-[#7FCF9F]" : "bg-[#2A1A18] text-[#FF9A8A]",
        )}
      >
        {up ? <ArrowUp className="size-3.5" strokeWidth={2.6} /> : <ArrowDown className="size-3.5" strokeWidth={2.6} />}
        {pct(Math.abs(v))}
      </span>
      <span className={hero ? "text-[#15130F]/60" : "text-[#8C8C8C]"}>vs. anterior</span>
    </span>
  );
}

/** Onda suave (linha) — cartão dourado de vendas. */
function Wave({ values }: { values: number[] }) {
  const step = Math.max(1, Math.ceil(values.length / 9));
  const grouped: number[] = [];
  for (let i = 0; i < values.length; i += step) grouped.push(values.slice(i, i + step).reduce((a, b) => a + b, 0));
  const v = grouped.length > 1 ? grouped : [0, 0];
  const W = 170;
  const H = 64;
  const max = Math.max(...v, 1);
  const pts = v.map((y, i) => [(i / (v.length - 1)) * W, H - 6 - (y / max) * (H - 14)] as const);
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke="#15130F" strokeOpacity={0.85} strokeWidth={2.4} strokeLinecap="round" className="dash-draw" style={{ strokeDasharray: 600, ["--len" as string]: 600 }} />
      <circle cx={last[0]} cy={last[1]} r={4.5} fill="#15130F" className="dash-tick" style={{ ["--i" as string]: 20 }} />
    </svg>
  );
}

/** Barras curtas — lucro. As últimas 8 colunas; a maior fica clara. */
function Bars({ values }: { values: number[] }) {
  const v = values.slice(-8);
  while (v.length < 8) v.unshift(0);
  const max = Math.max(...v, 1);
  const top = v.indexOf(Math.max(...v));
  return (
    <div className="flex h-14 items-end gap-[5px]" aria-hidden>
      {v.map((x, i) => (
        <span
          key={i}
          className={cn("dash-bar block flex-1 rounded-[5px]", i === top && x > 0 ? "bg-[#FFD599]" : "bg-[#2E2E2E]")}
          style={{ height: `${Math.max(10, (x / max) * 100)}%`, ["--i" as string]: i }}
        />
      ))}
    </div>
  );
}

/** Tracinhos (como o "sono" da referência) — quantas vendas por dia. */
function Ticks({ values }: { values: number[] }) {
  const v = values.slice(-14);
  while (v.length < 14) v.unshift(0);
  const max = Math.max(...v, 1);
  return (
    <div className="flex h-14 items-center justify-between" aria-hidden>
      {v.map((x, i) => (
        <span key={i} className="dash-tick flex h-full flex-col items-center justify-center gap-[3px]" style={{ ["--i" as string]: i }}>
          <span className={cn("block w-[3px] rounded-full", x > 0 ? "bg-white" : "bg-[#333]")} style={{ height: `${x > 0 ? 30 + (x / max) * 70 : 18}%` }} />
          {x > 0 ? <span className="block size-[3px] rounded-full bg-white/50" /> : null}
        </span>
      ))}
    </div>
  );
}

/** Recebido x a receber numa barra só. */
function Split({ received, due }: { received: number; due: number }) {
  const total = received + due;
  const part = total > 0 ? (received / total) * 100 : 100;
  return (
    <div className="pb-1" aria-hidden>
      <div className="flex h-3 overflow-hidden rounded-full bg-[#2E2E2E]">
        <span className="block h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${part}%` }} />
      </div>
      <p className="mt-2 text-right text-[11.5px] font-semibold text-[#8C8C8C] tabular-nums">{brl(received)} recebido</p>
    </div>
  );
}

/* ─────────────── cartões grandes ─────────────── */

function Card({ children, className, i = 0 }: { children: ReactNode; className?: string; i?: number }) {
  return (
    <section className={cn("dash-card adm-rise flex min-w-0 flex-col", className)} style={{ ["--i" as string]: i }}>
      {children}
    </section>
  );
}

function CardHead({ title, icon, children }: { title: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-5 pt-5 pb-4 lg:px-6 lg:pt-6">
      {icon}
      <h2 className="min-w-0 truncate text-[18px] font-bold tracking-[-0.015em]">{title}</h2>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

function GoLink({ to, search, label }: { to: string; search?: Record<string, unknown>; label: string }) {
  return (
    <Link to={to} search={search as never} preload="intent" aria-label={label} title={label} className="dash-dots press">
      <ArrowUpRight className="size-[18px]" strokeWidth={2.2} />
    </Link>
  );
}

const initials = (name: string | null) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** Pedidos abertos: atalho de novo pedido, os dois números que importam e a fila. */
function OpenOrdersCard({ orders, loading, failed }: { orders: ActiveOrder[] | undefined; loading: boolean; failed: boolean }) {
  const list = orders ?? [];
  const paid = list.filter((o) => o.stage !== "pendente");
  const unpaid = list.length - paid.length;
  const tile = "flex min-h-[112px] flex-col justify-between rounded-[22px] bg-[#232323] p-4";

  return (
    <Card i={6}>
      <CardHead title="Pedidos abertos">
        {list.length ? <SupplierQuoteButton orders={list} /> : null}
        <GoLink to="/admin/pedidos" label="Abrir pedidos" />
      </CardHead>
      <div className="grid grid-cols-3 gap-2.5 px-5 lg:px-6">
        <Link
          to="/admin/pedidos"
          search={{ novo: true } as never}
          preload="intent"
          aria-label="Novo pedido"
          className="press grid min-h-[112px] place-items-center rounded-[22px] border-[1.5px] border-dashed border-white/15 text-[#A9A9A9] transition-colors hover:border-[#FFD599] hover:text-[#FFD599]"
        >
          <Plus className="size-7" strokeWidth={1.8} />
        </Link>
        <Link to="/admin/pedidos" search={{ tab: "pedido feito" } as never} preload="intent" className={cn(tile, "press transition-colors hover:bg-[#2A2A2A]")}>
          <span className="grid size-8 place-items-center rounded-full bg-[#FFD599] text-[#15130F]">
            <Check className="size-4" strokeWidth={2.8} />
          </span>
          <span>
            <span className="block text-[12.5px] text-[#A9A9A9]">Pagos</span>
            <span className="block text-[26px] leading-none font-bold tabular-nums">{loading ? "–" : paid.length}</span>
            <span className="mt-1 block text-[11.5px] text-[#8C8C8C]">para entregar</span>
          </span>
        </Link>
        <Link to="/admin/pedidos" search={{ tab: "pendente" } as never} preload="intent" className={cn(tile, "press transition-colors hover:bg-[#2A2A2A]")}>
          <span className="grid size-8 place-items-center rounded-full bg-[#333] text-white">
            <Clock3 className="size-4" strokeWidth={2.4} />
          </span>
          <span>
            <span className="block text-[12.5px] text-[#A9A9A9]">Não pagos</span>
            <span className="block text-[26px] leading-none font-bold tabular-nums">{loading ? "–" : unpaid}</span>
            <span className="mt-1 block text-[11.5px] text-[#8C8C8C]">esperando Pix</span>
          </span>
        </Link>
      </div>

      <div className="mt-4 flex-1 pb-3">
        {loading ? (
          <div className="space-y-2 px-5 lg:px-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="admin-skeleton h-[58px] rounded-[18px]" />
            ))}
          </div>
        ) : failed ? (
          <p className="px-6 pb-3 text-[15px] text-[#A9A9A9]">Os pedidos não carregaram agora.</p>
        ) : list.length === 0 ? (
          <div className="mx-5 flex items-center gap-3 rounded-[20px] bg-[#232323] px-4 py-4 lg:mx-6">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#17251C] text-[#7FCF9F]">
              <Check className="size-[18px]" strokeWidth={2.6} />
            </span>
            <p className="text-[15px] font-semibold">Tudo entregue. Ninguém esperando.</p>
          </div>
        ) : (
          <ul>
            {list.slice(0, 4).map((o) => {
              const pay = paymentInfo({ final_total: o.total, amount_paid: o.amount_paid });
              return (
                <li key={o.id}>
                  <Link
                    to="/admin/pedidos"
                    search={{ pedido: o.id } as never}
                    preload="intent"
                    className="press flex min-w-0 items-center gap-3 px-5 py-2.5 transition-colors hover:bg-white/[0.03] lg:px-6"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#262626] text-[13px] font-bold">{initials(o.customer)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">{o.customer || "Cliente sem nome"}</span>
                      <span className="block truncate text-[13px] text-[#8C8C8C]">
                        {o.items[0]?.name ?? "Pedido"}
                        {o.items.length > 1 ? ` +${o.items.length - 1}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[15px] font-bold tabular-nums">{brl(o.total)}</span>
                      <span
                        className={cn(
                          "mt-0.5 inline-block rounded-full px-2 py-px text-[11px] font-bold",
                          pay.status === "paid" || o.stage !== "pendente"
                            ? "bg-[#FFD599] text-[#15130F]"
                            : pay.status === "partial"
                              ? "bg-[#2A2418] text-[#FFD599]"
                              : "bg-[#262626] text-[#A9A9A9]",
                        )}
                      >
                        {pay.status === "partial" ? `falta ${brl(pay.due)}` : o.stage === "pendente" ? "Não pago" : "Pago"}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
            {list.length > 4 ? (
              <li className="px-5 pt-2 lg:px-6">
                <Link
                  to="/admin/pedidos"
                  preload="intent"
                  className="press flex h-11 items-center justify-center gap-1.5 rounded-full bg-[#232323] text-[14px] font-bold transition-colors hover:bg-[#2A2A2A]"
                >
                  Ver os {list.length} pedidos <ArrowRight className="size-4" strokeWidth={2.4} />
                </Link>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * Semana: os 7 dias com um anel de quanto cada dia vendeu (o melhor dia fecha
 * o anel) e, no meio, frascos x decants do período escolhido.
 */
function WeekCard({ report, period, loading }: { report: DashboardReport | undefined; period: DashboardReport | undefined; loading: boolean }) {
  const days = useMemo(() => {
    const out: Array<{ ymd: string; revenue: number; orders: number }> = [];
    const byDay = new Map<string, { revenue: number; orders: number }>();
    for (const x of report?.series ?? []) {
      const k = spYmd(new Date(x.at));
      const cur = byDay.get(k) ?? { revenue: 0, orders: 0 };
      byDay.set(k, { revenue: cur.revenue + Number(x.revenue), orders: cur.orders + Number(x.orders) });
    }
    for (let i = 6; i >= 0; i--) {
      const ymd = spYmd(new Date(Date.now() - i * 86_400_000));
      out.push({ ymd, ...(byDay.get(ymd) ?? { revenue: 0, orders: 0 }) });
    }
    return out;
  }, [report]);
  const best = Math.max(...days.map((d) => d.revenue), 1);
  const [sel, setSel] = useState<string | null>(null);
  const picked = days.find((d) => d.ymd === sel) ?? days[days.length - 1]!;

  const v = period?.variants;
  const bottles = Number(v?.bottles ?? 0);
  const decants = Number(v?.decants ?? 0);
  const units = bottles + decants;

  return (
    <Card i={7}>
      <CardHead title="Semana">
        <GoLink to="/admin/conversao" label="Ver conversão" />
      </CardHead>
      <div className="grid grid-cols-7 gap-1 px-4 lg:px-5">
        {days.map((d, i) => {
          const date = new Date(`${d.ymd}T12:00:00-03:00`);
          const wd = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: TZ }).format(date).replace(".", "");
          const share = d.revenue / best;
          const on = d.ymd === picked.ymd;
          return (
            <button
              key={d.ymd}
              type="button"
              onClick={() => setSel(d.ymd)}
              aria-pressed={on}
              aria-label={`${wd}: ${brl(d.revenue)}`}
              className="press flex flex-col items-center gap-2"
            >
              <span className={cn("text-[12.5px] font-semibold", on ? "text-white" : "text-[#8C8C8C]")}>{cap(wd)}</span>
              <span className="relative grid size-11 place-items-center">
                <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden>
                  <circle cx="22" cy="22" r="19" fill={on ? "#FFD599" : "#232323"} stroke="#2E2E2E" strokeWidth="2.5" />
                  {d.revenue > 0 && !on ? (
                    <circle
                      cx="22"
                      cy="22"
                      r="19"
                      fill="none"
                      stroke="#FFD599"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      className="dash-ring"
                      strokeDasharray={`${Math.max(4, share * 119.4)} 200`}
                      style={{ transitionDelay: `${i * 60}ms` }}
                    />
                  ) : null}
                </svg>
                <span className={cn("relative text-[14px] font-bold tabular-nums", on ? "text-[#15130F]" : "text-white")}>
                  {Number(d.ymd.slice(8, 10))}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 px-5 text-center text-[13.5px] text-[#A9A9A9] lg:px-6">
        {loading ? (
          "Carregando a semana…"
        ) : (
          <>
            <span className="font-bold text-white tabular-nums">{brl(picked.revenue)}</span> em {picked.orders}{" "}
            {picked.orders === 1 ? "venda" : "vendas"} ·{" "}
            {picked.ymd === todayBR() ? "hoje" : cap(new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: TZ }).format(new Date(`${picked.ymd}T12:00:00-03:00`)))}
          </>
        )}
      </p>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 pt-4 pb-6 lg:px-6">
        <Donut bottles={bottles} decants={decants} />
        <div className="space-y-4 pr-1">
          <Legend label="Frascos" value={bottles} total={units} color="#FFD599" />
          <Legend label="Decants" value={decants} total={units} color="#FFFFFF" />
          {decants > 0 ? (
            <p className="text-[12px] leading-snug text-[#8C8C8C] tabular-nums">
              2ml {v?.ml_2 ?? 0} · 5ml {v?.ml_5 ?? 0} · 10ml {v?.ml_10 ?? 0}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function Donut({ bottles, decants }: { bottles: number; decants: number }) {
  const total = bottles + decants;
  const C = 2 * Math.PI * 64;
  const gap = total > 0 && bottles > 0 && decants > 0 ? 10 : 0;
  const b = total > 0 ? (bottles / total) * C : 0;
  const d = total > 0 ? (decants / total) * C : 0;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[188px]">
      <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
        <circle cx="80" cy="80" r="64" fill="none" stroke="#262626" strokeWidth="11" />
        {b > 0 ? (
          <circle cx="80" cy="80" r="64" fill="none" stroke="#FFD599" strokeWidth="11" strokeLinecap="round" className="dash-ring" strokeDasharray={`${Math.max(0, b - gap)} ${C}`} />
        ) : null}
        {d > 0 ? (
          <circle
            cx="80"
            cy="80"
            r="64"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="11"
            strokeLinecap="round"
            className="dash-ring"
            strokeDasharray={`${Math.max(0, d - gap)} ${C}`}
            strokeDashoffset={-b}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-[34px] leading-none font-bold tracking-[-0.04em] tabular-nums">
            <AnimatedMetric value={total} />
          </p>
          <p className="mt-1 text-[12.5px] text-[#8C8C8C]">itens vendidos</p>
        </div>
      </div>
    </div>
  );
}

function Legend({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-stretch gap-3">
      <span className="flex w-1.5 flex-col justify-end gap-[3px]" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="block h-[3px] rounded-full" style={{ background: 5 - i < Math.round(share / 17) ? color : "#2E2E2E" }} />
        ))}
      </span>
      <span>
        <span className="block text-[20px] leading-none font-bold tabular-nums">
          {value}
          <span className="text-[13px] font-semibold text-[#8C8C8C]"> · {share}%</span>
        </span>
        <span className="mt-1 block text-[13px] font-semibold" style={{ color }}>
          {label}
        </span>
      </span>
    </div>
  );
}

/** Copilot: perguntas prontas e uma caixa de pergunta, como o "AI Assistant" da referência. */
function CopilotCard({ name }: { name?: string | undefined }) {
  const { setOpen } = useCopilot();
  const [text, setText] = useState("");
  const send = (q: string) => {
    const t = q.trim();
    if (!t) return setOpen(true);
    askCopilot(t, setOpen);
    setText("");
  };
  const chips = [
    { icon: Sparkles, label: "Resumo do dia", q: "Me dá um resumo de hoje: vendas, pedidos abertos e o que precisa da minha atenção." },
    { icon: PackagePlus, label: "O que repor?", q: "O que eu preciso repor agora? Liste por fornecedor." },
    { icon: Clock3, label: "Quem espera?", q: "Quais clientes estão esperando entrega ou pagamento? Comece pelos atrasados." },
  ];
  return (
    <Card i={8} className="lg:col-span-2 xl:col-span-1">
      <CardHead title="Copilot" icon={<Sparkles className="size-5 text-[#FFD599]" strokeWidth={2} />}>
        <button type="button" onClick={() => setOpen(true)} className="dash-dots press" aria-label="Abrir o Copilot">
          <ArrowUpRight className="size-[18px]" strokeWidth={2.2} />
        </button>
      </CardHead>
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-4 text-center lg:px-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Conversar com o Copilot"
          className="press group relative mt-1 grid size-[104px] place-items-center rounded-full bg-[#FFD599] transition-transform duration-500 hover:scale-[1.04]"
        >
          <span aria-hidden className="absolute inset-[-10px] rounded-full border border-[#FFD599]/25" />
          <span aria-hidden className="absolute inset-[-22px] rounded-full border border-[#FFD599]/10" />
          <img src={symbolDark.url} alt="" className="size-12 object-contain transition-transform duration-700 group-hover:rotate-[-8deg]" />
        </button>
        <p className="mt-7 text-[16px] text-[#A9A9A9]">Oi{name ? `, ${name}` : ""}</p>
        <p className="text-[21px] leading-tight font-bold tracking-[-0.02em]">Como posso ajudar?</p>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 px-5 lg:px-6">
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => send(c.q)}
            className="press flex min-h-[72px] flex-col items-start justify-between gap-2 rounded-[18px] bg-[#232323] p-3 text-left transition-colors hover:bg-[#2A2A2A]"
          >
            <c.icon className="size-4 text-[#FFD599]" strokeWidth={2.2} />
            <span className="text-[12.5px] leading-tight font-semibold">{c.label}</span>
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-2 px-5 pt-3 pb-5 lg:px-6 lg:pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input data-slot="input-group-control"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Pergunte algo…"
          aria-label="Pergunta para o Copilot"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-[#232323] px-5 text-[15px] text-white outline-none placeholder:text-[#6F6F6F] focus:ring-2 focus:ring-[#FFD599]/50"
        />
        <button type="submit" aria-label="Enviar" className="press grid size-[52px] shrink-0 place-items-center rounded-full bg-[#FFD599] text-[#15130F] transition-colors hover:bg-[#FFDDAA]">
          <SendHorizontal className="size-5" strokeWidth={2.2} />
        </button>
      </form>
    </Card>
  );
}

/** Entregas marcadas: atrasadas → hoje → amanhã → próximas; pagos antes no mesmo dia. */
function DeliveriesCard({ orders, loading }: { orders: ActiveOrder[] | undefined; loading: boolean }) {
  const list = (orders ?? [])
    .filter((o) => o.expected_delivery_date && deliveryState(o) !== "none")
    .sort(
      (a, b) =>
        deliveryRank(a) - deliveryRank(b) ||
        a.expected_delivery_date!.localeCompare(b.expected_delivery_date!) ||
        (a.stage === "pendente" ? 1 : 0) - (b.stage === "pendente" ? 1 : 0) ||
        (a.expected_delivery_time ?? "99").localeCompare(b.expected_delivery_time ?? "99"),
    );
  const today = todayBR();
  return (
    <Card i={9}>
      <CardHead title="Próximas entregas">
        <GoLink to="/admin/pedidos" search={{ tab: "dl_week" }} label="Ver entregas" />
      </CardHead>
      {loading ? (
        <div className="space-y-2 px-5 pb-5 lg:px-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="admin-skeleton h-[62px] rounded-[18px]" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="mx-5 mb-5 rounded-[20px] bg-[#232323] px-4 py-5 text-center lg:mx-6">
          <p className="text-[15px] font-semibold">Nenhuma entrega marcada.</p>
          <p className="mt-1 text-[13px] text-[#8C8C8C]">Marque data e hora dentro do pedido.</p>
        </div>
      ) : (
        <ul className="space-y-2 px-3 pb-4 lg:px-4">
          {list.slice(0, 5).map((o) => {
            const st = deliveryState(o);
            const ymd = o.expected_delivery_date!.slice(0, 10);
            const day = st === "late" ? "Atrasada" : st === "today" ? "Hoje" : st === "tomorrow" ? "Amanhã" : weekdayShort(ymd);
            return (
              <li key={o.id}>
                <Link
                  to="/admin/pedidos"
                  search={{ pedido: o.id } as never}
                  preload="intent"
                  className={cn("press flex min-w-0 items-center gap-3 rounded-[20px] px-2 py-2 transition-colors hover:bg-white/[0.03]", o.stage === "pendente" && "opacity-70")}
                >
                  <span
                    className={cn(
                      "flex w-[62px] shrink-0 flex-col items-center rounded-[16px] py-2 leading-tight",
                      st === "late" ? "bg-[#2A1A18] text-[#FF9A8A]" : st === "today" ? "bg-[#FFD599] text-[#15130F]" : "bg-[#262626] text-white",
                    )}
                  >
                    <span className="text-[11px] font-bold">{day}</span>
                    <span className="text-[15px] font-bold tabular-nums">
                      {st === "today" || ymd === today ? fmtTime(o.expected_delivery_time) || "—" : `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{o.customer || "Cliente"}</span>
                    <span className="block truncate text-[13px] text-[#8C8C8C]">
                      {o.items[0]?.name ?? "Pedido"}
                      {o.items.length > 1 ? ` +${o.items.length - 1}` : ""}
                      {st !== "today" && o.expected_delivery_time ? ` · ${fmtTime(o.expected_delivery_time)}` : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-[18px] shrink-0 text-[#6F6F6F]" strokeWidth={2.2} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function weekdayShort(ymd: string) {
  const s = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
  return s.replace(".", "").replace(/^./, (c) => c.toUpperCase());
}

function TopProducts({ items, loading, rangeLabel }: { items: DashboardReport["top_products"] | undefined; loading: boolean; rangeLabel: string }) {
  const list = (items ?? []).filter((x) => x.units > 0).slice(0, 5);
  const max = Math.max(...list.map((x) => x.units), 1);
  return (
    <Card i={10}>
      <CardHead title="Mais vendidos">
        <span className="text-[13px] font-semibold text-[#8C8C8C]">{rangeLabel}</span>
      </CardHead>
      {loading ? (
        <div className="space-y-2 px-5 pb-5 lg:px-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="admin-skeleton h-[56px] rounded-[18px]" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="px-6 pb-6 text-[15px] text-[#8C8C8C]">Nenhuma venda nesse período.</p>
      ) : (
        <ol className="space-y-1 px-3 pb-4 lg:px-4">
          {list.map((x, i) => (
            <li key={x.product_id ?? i} className="flex min-w-0 items-center gap-3 rounded-[18px] px-2 py-2">
              <span className="relative grid size-[52px] shrink-0 place-items-center overflow-hidden rounded-[16px] bg-white">
                {x.image_url ? <img src={imgVariant(x.image_url, "thumb") ?? x.image_url} alt="" loading="lazy" className="size-full object-contain p-1" /> : null}
                <span className="absolute top-1 left-1 grid size-[18px] place-items-center rounded-full bg-[#15130F] text-[10px] font-bold text-[#FFD599]">{i + 1}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-bold">{x.name ?? "Perfume"}</span>
                <span className="mt-2 block h-[5px] overflow-hidden rounded-full bg-[#262626]">
                  <span className="dash-barx block h-full rounded-full bg-[#FFD599]" style={{ width: `${Math.max(8, (x.units / max) * 100)}%`, ["--i" as string]: i }} />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[14.5px] font-bold tabular-nums">{x.units} un.</span>
                <span className="block text-[12px] text-[#8C8C8C] tabular-nums">{brl(x.revenue)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function StockCard({ data, loading, failed }: { data: { units: number; cost: number; sale_value: number } | undefined; loading: boolean; failed: boolean }) {
  return (
    <Card i={11} className="p-5 lg:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-bold tracking-[-0.015em]">Estoque da loja</h2>
        <GoLink to="/admin/estoque" label="Abrir estoque" />
      </div>
      {loading ? (
        <div className="admin-skeleton mt-4 h-[76px] rounded-[18px]" />
      ) : failed || !data ? (
        <p className="mt-2 text-[15px] text-[#A9A9A9]">Indisponível agora.</p>
      ) : (
        <>
          <p className="mt-3 text-[36px] leading-none font-bold tracking-[-0.04em] tabular-nums">
            {data.units}
            <span className="ml-2 text-[15px] font-semibold tracking-normal text-[#8C8C8C]">{data.units === 1 ? "frasco" : "frascos"}</span>
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-[18px] bg-[#232323] px-4 py-3">
              <p className="text-[12.5px] text-[#8C8C8C]">Custo</p>
              <p className="mt-0.5 text-[16px] font-bold tabular-nums">{brl(data.cost)}</p>
            </div>
            <div className="rounded-[18px] bg-[#232323] px-4 py-3">
              <p className="text-[12.5px] text-[#8C8C8C]">Valor de venda</p>
              <p className="mt-0.5 text-[16px] font-bold text-[#FFD599] tabular-nums">{brl(data.sale_value)}</p>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function Shortcuts() {
  const items = [
    { to: "/admin/vendas-loja", search: { registrar: "manual" }, icon: Store, label: "Registrar venda" },
    { to: "/admin/estoque", search: { add: "true" }, icon: PackagePlus, label: "Adicionar estoque" },
  ];
  return (
    <div className="adm-rise grid grid-cols-2 gap-3 lg:gap-4" style={{ ["--i" as string]: 12 }}>
      {items.map((a) => (
        <Link
          key={a.label}
          to={a.to}
          search={a.search as never}
          preload="intent"
          className="dash-card press flex min-h-[96px] flex-col items-start justify-between gap-3 p-4 transition-colors hover:bg-[#1F1F1F]"
        >
          <span className="dash-ico size-10 text-[#FFD599]">
            <a.icon className="size-[18px]" strokeWidth={2} />
          </span>
          <span className="text-[15px] leading-tight font-bold">{a.label}</span>
        </Link>
      ))}
    </div>
  );
}
