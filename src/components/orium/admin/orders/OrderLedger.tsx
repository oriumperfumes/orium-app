/**
 * LIVRO DE PEDIDOS — a aba "Lista".
 *
 * O Quadro é o que está em andamento; a Lista é o livro inteiro da loja,
 * como um caderno de vendas: cada dia é uma página (dia grande em dourado,
 * quantos pedidos e quanto vendeu) e cada pedido é uma linha fina com hora,
 * foto, cliente, perfumes, a fase em 5 pontinhos e o valor com o pagamento.
 * Tocar abre o pedido. Em cima, uma faixa com o mês, sem cartões repetidos.
 */
import { useMemo, useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { paymentInfo } from "@/components/orium/admin/OrderPayment";
import { todayBR } from "@/lib/delivery";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ExpandButton, ItemsExpand, OrderPhotos, TierBadge, itemsText } from "./ident";
import { Collapse } from "@/components/orium/admin/motion";
import { orderTotal } from "./model";
import { addDays, daysBetween } from "./controls";
import { PHASE, type PhaseInfo } from "./phase";

const TZ = "America/Sao_Paulo";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const at12 = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

function dayName(ymd: string) {
  const diff = daysBetween(ymd, todayBR());
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  const wd = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(at12(ymd)).replace("-feira", "");
  return wd.charAt(0).toUpperCase() + wd.slice(1);
}
const monthShort = (ymd: string) => new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(at12(ymd)).replace(".", "");

/* ─────────────── faixa do mês ─────────────── */

export function LedgerSummary({ orders, onPick }: { orders: any[]; onPick: (tab: string) => void }) {
  const t = todayBR();
  const month = t.slice(0, 7);
  const live = orders.filter((o) => !o.deleted_at && o.status !== "cancelado");
  const inMonth = live.filter((o) => dayOf(o.created_at).slice(0, 7) === month);
  const sold = inMonth.reduce((s, o) => s + orderTotal(o), 0);
  const due = live.reduce((s, o) => s + paymentInfo(o).due, 0);
  const open = live.filter((o) => o.status !== "entregue").length;
  const days = Array.from({ length: 30 }, (_, i) => addDays(t, i - 29));
  const perDay = days.map((d) => live.filter((o) => dayOf(o.created_at) === d).reduce((s, o) => s + orderTotal(o), 0));
  const max = Math.max(1, ...perDay);
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(at12(t));

  const Metric = ({ label, value, tab, tone }: { label: string; value: string; tab?: string; tone?: string }) => (
    <button
      type="button"
      disabled={!tab}
      onClick={() => tab && onPick(tab)}
      className="press min-w-0 rounded-[16px] px-3 py-2 text-left transition-colors enabled:hover:bg-white/[0.04] disabled:cursor-default"
    >
      <span className="block truncate text-[12px] font-medium text-[#8C8C8C]">{label}</span>
      <span className={cn("block truncate text-[19px] font-semibold tracking-[-0.03em] tabular-nums lg:text-[22px]", tone)}>{value}</span>
    </button>
  );

  return (
    <section className="dash-card adm-rise flex flex-wrap items-center gap-x-2 gap-y-1 p-2.5 lg:flex-nowrap lg:p-3" aria-label="Resumo do mês">
      <div className="grid min-w-0 flex-1 grid-cols-2 sm:grid-cols-4 lg:divide-x lg:divide-white/[0.06]">
        <Metric label={`Vendido em ${monthName}`} value={brl(sold)} />
        <Metric label="Pedidos no mês" value={String(inMonth.length)} />
        <Metric label="Em andamento" value={String(open)} tab="andamento" />
        <Metric label="A receber" value={brl(due)} tab="pg_due" tone={due > 0 ? "text-[#FFD599]" : undefined} />
      </div>
      {/* 30 dias: uma barrinha por dia */}
      <div className="flex h-12 w-full items-end gap-[3px] px-3 pb-1 max-sm:hidden lg:w-[260px] lg:shrink-0" aria-hidden>
        {perDay.map((v, i) => (
          <span
            key={days[i]}
            className={cn("flex-1 rounded-full", i === perDay.length - 1 ? "bg-[#FFD599]" : v ? "bg-[#4A4A4A]" : "bg-[#262626]")}
            style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
          />
        ))}
      </div>
    </section>
  );
}

/* ─────────────── o livro ─────────────── */

const PAGE = 60;

export function OrderLedger({
  orders,
  grouped,
  linesOf,
  imageOf,
  phaseOf,
  onOpen,
}: {
  orders: any[];
  /** agrupa por dia (ordem por data); false = lista corrida (valor, entrega) */
  grouped: boolean;
  linesOf: (o: any) => any[];
  imageOf: (l: any) => string | null | undefined;
  phaseOf: (o: any) => PhaseInfo | null;
  onOpen: (o: any, el?: HTMLElement | null) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const shown = orders.slice(0, limit);
  const days = useMemo(() => {
    if (!grouped) return [["", shown]] as Array<[string, any[]]>;
    const m = new Map<string, any[]>();
    shown.forEach((o) => {
      const d = dayOf(o.created_at);
      m.set(d, [...(m.get(d) ?? []), o]);
    });
    return [...m.entries()];
  }, [shown, grouped]);

  return (
    <div className="space-y-3 lg:space-y-4">
      {days.map(([day, list], gi) => {
        const total = list.filter((o) => o.status !== "cancelado" && !o.deleted_at).reduce((s, o) => s + orderTotal(o), 0);
        return (
          <section key={day || "all"} className="dash-card adm-rise overflow-hidden" style={{ ["--i" as string]: Math.min(gi, 8) }} aria-label={day ? dayName(day) : "Pedidos"}>
            {day ? (
              <header className="flex items-center gap-3.5 px-4 pt-4 pb-2 lg:px-5">
                <span className="text-[34px] leading-none font-semibold tracking-[-0.05em] text-[#FFD599] tabular-nums lg:text-[40px]">{day.slice(8, 10)}</span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block text-[16px] font-bold">{dayName(day)}</span>
                  <span className="block text-[12.5px] text-[#8C8C8C]">
                    {monthShort(day).charAt(0).toUpperCase() + monthShort(day).slice(1)} · {list.length} {list.length === 1 ? "pedido" : "pedidos"}
                  </span>
                </span>
                <span className="text-right leading-tight">
                  <span className="block text-[11.5px] text-[#8C8C8C]">vendido</span>
                  <span className="block text-[16px] font-semibold tabular-nums">{brl(total)}</span>
                </span>
              </header>
            ) : null}
            <ul className="divide-y divide-white/[0.05] px-1.5 pb-1.5 lg:px-2">
              {list.map((o) => (
                <LedgerRow key={o.id} o={o} lines={linesOf(o)} imageOf={imageOf} phase={phaseOf(o)} onOpen={onOpen} showDay={!grouped} />
              ))}
            </ul>
          </section>
        );
      })}
      {orders.length > limit ? (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE)}
          className="press mx-auto flex h-12 items-center gap-2 rounded-full bg-[#1A1A1A] px-6 text-[14px] font-bold text-[#D4D4D4] hover:text-white"
        >
          Mostrar mais {Math.min(PAGE, orders.length - limit)} pedidos
        </button>
      ) : null}
    </div>
  );
}

function Dots({ phase }: { phase: PhaseInfo }) {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {phase.steps.map((s) => (
        <span
          key={s.key}
          className={cn("size-[7px] rounded-full", s.state === "done" ? "bg-[#FFD599]" : s.state === "todo" ? "bg-[#333]" : "")}
          style={s.state === "now" ? { background: PHASE[s.key].dot, boxShadow: `0 0 0 3px ${PHASE[s.key].dot}26` } : undefined}
        />
      ))}
    </span>
  );
}

function LedgerRow({
  o,
  lines,
  imageOf,
  phase,
  onOpen,
  showDay,
}: {
  o: any;
  lines: any[];
  imageOf: (l: any) => string | null | undefined;
  phase: PhaseInfo | null;
  onOpen: (o: any, el?: HTMLElement | null) => void;
  showDay: boolean;
}) {
  const pay = paymentInfo(o);
  const total = orderTotal(o);
  const cancelled = o.status === "cancelado" || !!o.deleted_at;
  const delivered = o.status === "entregue";
  const [open, setOpen] = useState(false);
  const label = cancelled ? (o.deleted_at ? "Na lixeira" : "Cancelado") : delivered ? "Entregue" : phase ? PHASE[phase.key].title : "—";
  const payText = cancelled ? null : pay.due <= 0.009 ? "pago" : pay.paid > 0 ? `falta ${brl(pay.due)}` : "não pagou";
  const payTone = pay.due <= 0.009 ? "text-[#7FCF9F]" : pay.paid > 0 ? "text-[#FFD599]" : "text-[#FF9A8A]";

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        data-order-id={o.id}
        onClick={(e) => onOpen(o, e.currentTarget)}
        onKeyDown={(e) => e.key === "Enter" && onOpen(o, e.currentTarget)}
        className={cn(
          "group grid cursor-pointer grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[18px] px-2.5 py-3 transition-colors hover:bg-white/[0.035] lg:grid-cols-[52px_44px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_20px] lg:gap-x-4 lg:px-3",
          cancelled && "opacity-55",
        )}
      >
        {/* hora (computador) */}
        <span className="text-[13px] text-[#8C8C8C] tabular-nums max-lg:hidden">
          {showDay ? new Date(o.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TZ }) : timeOf(o.created_at)}
        </span>

        {/* foto */}
        <OrderPhotos lines={lines} imageOf={imageOf} size={44} radius={13} />

        {/* cliente + perfumes */}
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn("truncate text-[15px] font-semibold", cancelled && "line-through decoration-white/30")}>{o.customer_name || "Cliente"}</span>
            <TierBadge o={o} className="self-center" />
            <span className="shrink-0 text-[11.5px] text-[#6F6F6F] tabular-nums">#{String(o.order_number ?? "").replace(/^OR-/, "")}</span>
            <span className="shrink-0 text-[11.5px] text-[#6F6F6F] tabular-nums lg:hidden">{timeOf(o.created_at)}</span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-[12.5px] text-[#8C8C8C]">{itemsText(lines)}</span>
            {lines.length ? <ExpandButton open={open} count={lines.length} onToggle={() => setOpen((v) => !v)} /> : null}
          </span>
          {/* celular: fase embaixo */}
          <span className="mt-1.5 flex items-center gap-2 lg:hidden">
            {phase && !cancelled ? <Dots phase={phase} /> : null}
            <span className={cn("truncate text-[12px] font-semibold", delivered ? "text-[#7FCF9F]" : cancelled ? "text-[#8C8C8C]" : "text-[#D4D4D4]")}>{label}</span>
          </span>
        </span>

        {/* fase (computador) */}
        <span className="flex min-w-0 items-center gap-2.5 max-lg:hidden">
          {phase && !cancelled ? <Dots phase={phase} /> : null}
          <span className={cn("truncate text-[13px] font-semibold", delivered ? "text-[#7FCF9F]" : cancelled ? "text-[#8C8C8C]" : "text-[#D4D4D4]")}>{label}</span>
        </span>

        {/* valor */}
        <span className="text-right leading-tight">
          <span className={cn("block text-[15px] font-semibold tabular-nums", cancelled && "line-through decoration-white/30")}>{brl(total)}</span>
          {payText ? <span className={cn("block text-[12px] tabular-nums", payTone)}>{payText}</span> : null}
        </span>

        <ChevronRight className="size-4 text-[#4A4A4A] transition-colors group-hover:text-white max-lg:hidden" />
      </div>
      <Collapse open={open}>
        <ItemsExpand lines={lines} imageOf={imageOf} o={o} />
      </Collapse>
    </li>
  );
}
