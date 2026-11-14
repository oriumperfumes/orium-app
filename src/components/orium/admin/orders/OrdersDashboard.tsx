/**
 * PAINEL DE PEDIDOS — limpo, no estilo "cartões + uma tabela".
 *
 * 1. Quatro cartões: Entregar · Pedir no fornecedor · Vindo do fornecedor ·
 *    A receber (bolinha colorida = tem coisa atrasada). Tocar filtra a tabela.
 * 2. Uma tabela de pedidos em andamento, já na ordem de urgência:
 *    cliente + perfumes · entrega · valor/pagamento · FASE · abrir.
 *    Busca por nome (cliente perguntou? digita e vê a fase).
 * Tudo calculado dos pedidos já carregados.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CircleDollarSign,
  HandCoins,
  MessageCircle,
  PackageCheck,
  Search,
  ShoppingCart,
  Sparkles,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { paymentInfo } from "@/components/orium/admin/OrderPayment";
import { deliveryState, fmtTime, todayBR } from "@/lib/delivery";
import { brl, whatsappLink } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ExpandButton, ItemsExpand, OrderPhotos, TierBadge, WhenPill, itemsText } from "./ident";
import { AnimatedNumber, Collapse, PillTrack } from "@/components/orium/admin/motion";
import type { PurchaseItem } from "@/lib/orders-control.functions";
import { orderTotal } from "./model";
import { dayLabel, daysBetween, dueInfo } from "./controls";
import { PHASE } from "./phase";
import { TodayFocus, buildRows, useToday, type Filter, type Row, type TrackActions } from "./OrderTrack";

/* ─────────────── o caminho do pedido ─────────────── */

export type Journey = "pagamento" | "comprar" | "chegando" | "entregar" | "entregue";

export const JOURNEY: Array<{ key: Journey; title: string; hint: string; icon: LucideIcon; tone: string }> = [
  { key: "pagamento", title: "Esperando pagamento", hint: "ainda não pagaram nada", icon: CircleDollarSign, tone: "#8C8C8C" },
  { key: "comprar", title: "Falta pedir no fornecedor", hint: "ainda não pedi", icon: ShoppingCart, tone: "#FFD599" },
  { key: "chegando", title: "Vindo do fornecedor", hint: "já pedi, está vindo", icon: Truck, tone: "#F5C26B" },
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function OrdersDashboard({
  orders,
  linesOf,
  imageOf,
  purchases,
  onOpen,
  onDeliver,
  onArrived,
  onGoPurchases,
  busyId,
}: {
  orders: any[];
  linesOf: (o: any) => any[];
  imageOf: (l: any) => string | null | undefined;
  purchases: PurchaseItem[] | undefined;
  onOpen: (o: any, el?: HTMLElement | null) => void;
  onDeliver: (o: any, at?: { x: number; y: number }) => void;
  onArrived: TrackActions["onArrived"];
  busyId?: string | null;
  onReceived?: (o: any, at?: { x: number; y: number }) => void;
  onGoPurchases: () => void;
  onJourney?: (j: Journey) => void;
  onBoard?: () => void;
}) {
  const t = todayBR();
  const [filter, setFilter] = useState<Filter>("todos");
  const [q, setQ] = useState("");

  const liveDay = useToday();
  const rows = useMemo(() => buildRows(orders, purchases), [orders, purchases, liveDay]);
  const actions: TrackActions = { onOpen, onDeliver, onGoPurchases, onArrived };

  const count = (f: Filter) => rows.filter((r) => r.tags.has(f)).length;
  const late = rows.filter((r) => r.when.tone === "red").length;
  const today = rows.filter((r) => r.when.tone === "gold").length;
  const toBuyUnits = rows.reduce((s, r) => s + r.phase.supply.filter((x) => x.status === "comprar").reduce((n, x) => n + x.quantity, 0), 0);
  const comingUnits = rows.reduce((s, r) => s + r.phase.supply.filter((x) => x.status === "chegando").reduce((n, x) => n + x.quantity, 0), 0);
  const owe = rows.filter((r) => r.tags.has("pagamento"));
  const oweValue = owe.reduce((s, r) => s + r.pay.due, 0);
  const oweLate = owe.filter((r) => r.o.status === "entregue" || dueInfo(r.o).state === "late").length;

  const cards: Array<{ f: Filter; icon: LucideIcon; label: string; short?: string; value: string; compact?: string; foot: ReactNode; dot?: string; n?: number; money?: boolean }> = [
    {
      f: "entregar",
      icon: Truck,
      label: "Entregar",
      value: String(count("entregar")),
      n: count("entregar"),
      foot: late ? <b className="font-semibold text-[#FF9A8A]">{late} {late === 1 ? "atrasada" : "atrasadas"}</b> : today ? `${today} para hoje` : "nada urgente",
      dot: late ? "#FF8A75" : today ? "#FFD599" : undefined,
    },
    {
      f: "fornecedor",
      icon: ShoppingCart,
      label: "Pedir no fornecedor",
      short: "Fornecedor",
      value: String(count("fornecedor")),
      n: count("fornecedor"),
      foot: toBuyUnits ? `${plural(toBuyUnits, "perfume", "perfumes")} para pedir` : "tudo já pedido",
      dot: count("fornecedor") ? "#FFD599" : undefined,
    },
    {
      f: "caminho",
      icon: PackageCheck,
      label: "Vindo do fornecedor",
      short: "A caminho",
      value: String(count("caminho")),
      n: count("caminho"),
      foot: comingUnits ? `${plural(comingUnits, "perfume", "perfumes")} a caminho` : "nada a caminho",
    },
    {
      f: "pagamento",
      icon: HandCoins,
      label: "A receber",
      value: brl(oweValue),
      n: oweValue,
      money: true,
      compact: `R$ ${Math.round(oweValue).toLocaleString("pt-BR")}`,
      foot: owe.length ? oweLate ? <b className="font-semibold text-[#FF9A8A]">{oweLate} {oweLate === 1 ? "atrasado" : "atrasados"}</b> : plural(owe.length, "cliente", "clientes") : "ninguém devendo",
      dot: oweLate ? "#FF8A75" : undefined,
    },
  ];

  const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const needle = norm(q.trim());
  const digits = q.replace(/\D/g, "");
  const shown = rows.filter((r) => {
    if (needle) {
      const hay = norm(`${r.o.customer_name ?? ""} ${linesOf(r.o).map((l) => l.product_name_snapshot).join(" ")} ${r.o.order_number ?? ""}`);
      const phone = String(r.o.customer_phone ?? "").replace(/\D/g, "");
      return hay.includes(needle) || (digits.length >= 4 && phone.includes(digits));
    }
    return r.tags.has(filter);
  });

  const TABS: Array<{ f: Filter; label: string }> = [
    { f: "todos", label: "Todos" },
    { f: "entregar", label: "Entregar" },
    { f: "fornecedor", label: "Fornecedor" },
    { f: "caminho", label: "A caminho" },
    { f: "pagamento", label: "A receber" },
  ];

  return (
    <div className="space-y-3 lg:space-y-4">
      {/* 0 · urgente hoje */}
      <TodayFocus rows={rows} linesOf={linesOf} imageOf={imageOf} actions={actions} busyId={busyId} />

      {/* 1 · cartões */}
      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4" aria-label="Resumo">
        {cards.map((c, i) => {
          const on = filter === c.f && !needle;
          return (
            <button
              key={c.f}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setQ("");
                setFilter(on ? "todos" : c.f);
              }}
              className={cn(
                "press adm-rise flex min-h-[128px] min-w-0 flex-col rounded-[24px] p-4 text-left transition-colors duration-300 lg:min-h-[150px] lg:p-5",
                on ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-white hover:bg-[#1F1F1F]",
              )}
              style={{ ["--i" as string]: i }}
            >
              <span className="flex items-center gap-2">
                <c.icon className={cn("size-4 shrink-0", on ? "text-[#15130F]/60" : "text-[#8C8C8C]")} strokeWidth={2.2} />
                <span className={cn("min-w-0 flex-1 truncate text-[13.5px] font-medium", on ? "text-[#15130F]/75" : "text-[#C9C9C9]")}>
                  <span className={cn(c.short && "max-sm:hidden")}>{c.label}</span>
                  {c.short ? <span className="sm:hidden">{c.short}</span> : null}
                </span>
                {c.dot ? <span className="size-2 shrink-0 rounded-full" style={{ background: c.dot }} /> : null}
              </span>
              <span className="mt-auto flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-1 pt-4">
                <span className="truncate text-[clamp(1.6rem,3.4vw,2.6rem)] leading-none font-semibold tracking-[-0.045em] tabular-nums">
                  {/* o número conta até o valor novo quando muda */}
                  <span className={cn(c.compact && "max-sm:hidden")}>
                    {typeof (c as any).n === "number" ? <AnimatedNumber value={(c as any).n} format={(c as any).money ? brl : undefined} /> : c.value}
                  </span>
                  {c.compact ? (
                    <span className="sm:hidden">
                      <AnimatedNumber value={(c as any).n ?? 0} format={(v) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`} />
                    </span>
                  ) : null}
                </span>
                <span className={cn("truncate pb-0.5 text-[12px]", on ? "text-[#15130F]/55" : "text-[#8C8C8C]")}>{c.foot}</span>
              </span>
            </button>
          );
        })}
      </section>

      {/* 2 · tabela */}
      <section className="dash-card adm-rise min-w-0 p-2.5 lg:p-4" style={{ ["--i" as string]: 4 }} aria-label="Pedidos em andamento">
        <div className="flex flex-wrap items-center gap-2 px-1 pb-3 lg:px-1.5">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#202020] px-4 focus-within:ring-2 focus-within:ring-[#FFD599]/40 sm:max-w-[300px]">
            <Search className="size-4 shrink-0 text-[#8C8C8C]" />
            <input
              data-slot="input-group-control"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cliente perguntou? Busque o nome"
              aria-label="Buscar cliente, perfume ou telefone"
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[#6F6F6F]"
            />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label="Limpar busca" className="press grid size-6 place-items-center rounded-full bg-[#2E2E2E]">
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>
          <PillTrack activeKey={needle ? null : filter} label="Filtrar" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 max-sm:order-last max-sm:w-full">
            {TABS.map((tb) => {
              const on = !needle && filter === tb.f;
              const n = count(tb.f);
              return (
                <button
                  key={tb.f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setQ("");
                    setFilter(tb.f);
                  }}
                  className={cn(
                    "press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                    on ? "text-[#15130F]" : "text-[#A9A9A9] hover:bg-white/[0.05] hover:text-white",
                  )}
                >
                  {tb.label}
                  {n ? <span className={cn("text-[12px] tabular-nums", on ? "text-[#15130F]/50" : "text-[#6F6F6F]")}>{n}</span> : null}
                </button>
              );
            })}
          </PillTrack>
          {filter === "fornecedor" && !needle && count("fornecedor") ? (
            <button type="button" onClick={onGoPurchases} className="press ml-auto inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-[#15130F] hover:bg-[#FFD599] max-sm:w-full max-sm:justify-center">
              Fazer pedidos no fornecedor <ArrowRight className="size-4" strokeWidth={2.6} />
            </button>
          ) : null}
        </div>

        {/* cabeçalho (computador) */}
        {shown.length ? (
          <div className="hidden grid-cols-[minmax(0,2.3fr)_minmax(0,1.05fr)_minmax(0,1.15fr)_minmax(0,1.5fr)_40px] items-center gap-4 px-4 pb-2 text-[12px] font-medium text-[#6F6F6F] lg:grid">
            <span>Cliente</span>
            <span>Entrega</span>
            <span>Valor</span>
            <span>Fase</span>
            <span />
          </div>
        ) : null}

        <ul className="space-y-1.5">
          {shown.map((r, i) => (
            <OrderRow key={r.o.id} r={r} i={i} lines={linesOf(r.o)} imageOf={imageOf} onOpen={onOpen} />
          ))}
        </ul>
        {!shown.length ? (
          <p className="px-4 py-12 text-center text-[14px] text-[#8C8C8C]">
            {needle ? `Nenhum pedido em andamento com “${q.trim()}”.` : filter === "todos" ? "Nenhum pedido em andamento. Tudo em dia." : "Nada aqui agora."}
          </p>
        ) : null}
      </section>
    </div>
  );
}

const WHEN_TONE = { red: "text-[#FF9A8A] font-semibold", gold: "text-[#FFD599] font-semibold", plain: "text-white", muted: "text-[#8C8C8C]" };

function OrderRow({ r, i, lines, imageOf, onOpen }: { r: Row; i: number; lines: any[]; imageOf: (l: any) => string | null | undefined; onOpen: (o: any, el?: HTMLElement | null) => void }) {
  const o = r.o;
  const [open, setOpen] = useState(false);
  const meta = PHASE[r.phase.key];
  const total = orderTotal(o);
  const paidRatio = total > 0 ? Math.min(1, r.pay.paid / total) : 0;
  const wa = r.pay.due > 0.009 ? whatsappLink(o.customer_phone) : null;
  const first = (o.customer_name ?? "").trim().split(/\s+/)[0];
  const msg = `Oi${first ? `, ${first}` : ""}! Tudo bem? Passando para lembrar do valor de ${brl(r.pay.due)} do seu pedido na Orium. Me avisa quando puder fazer o Pix? 😊`;

  const phasePill = (
    <span className="inline-flex h-8 max-w-full min-w-0 items-center gap-2 rounded-full bg-[#262626] px-3 text-[12.5px] font-semibold">
      <span className="size-2 shrink-0 rounded-full" style={{ background: meta.dot }} />
      <span className="truncate">{meta.title}</span>
    </span>
  );
  const payCell = (
    <span className="block min-w-0">
      <span className="block text-[14.5px] font-semibold tabular-nums">{brl(total)}</span>
      <span className="mt-1 flex items-center gap-2">
        <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-[#2E2E2E]">
          <span className={cn("block h-full rounded-full", paidRatio >= 1 ? "bg-[#7FCF9F]" : "bg-[#FFD599]")} style={{ width: `${paidRatio * 100}%` }} />
        </span>
        <span className={cn("truncate text-[12px]", r.pay.due <= 0.009 ? "text-[#7FCF9F]" : r.pay.paid > 0 ? "text-[#FFD599]" : "text-[#FF9A8A]")}>
          {r.pay.due <= 0.009 ? "Pago" : r.pay.paid > 0 ? `falta ${brl(r.pay.due)}` : "não pagou"}
        </span>
      </span>
    </span>
  );

  return (
    <li className="ord-in" style={{ ["--i" as string]: Math.min(i, 12) }}>
      <div
        role="button"
        tabIndex={0}
        data-order-id={o.id}
        onClick={(e) => onOpen(o, e.currentTarget)}
        onKeyDown={(e) => e.key === "Enter" && onOpen(o, e.currentTarget)}
        className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 rounded-[20px] bg-[#202020] p-3 transition-colors hover:bg-[#252525] lg:grid-cols-[minmax(0,2.3fr)_minmax(0,1.05fr)_minmax(0,1.15fr)_minmax(0,1.5fr)_40px] lg:gap-4 lg:px-4"
      >
        {/* cliente + perfumes */}
        <span className="flex min-w-0 items-center gap-3">
          <OrderPhotos lines={lines} imageOf={imageOf} size={48} radius={14} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] font-semibold">{o.customer_name || "Cliente"}</span>
              <TierBadge o={o} />
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-[12.5px] text-[#8C8C8C]">{itemsText(lines)}</span>
              {lines.length ? <ExpandButton open={open} count={lines.length} onToggle={() => setOpen((v) => !v)} /> : null}
            </span>
          </span>
        </span>

        {/* abrir (celular: canto) */}
        <span className="flex items-center gap-1.5 lg:hidden">
          {wa ? (
            <a
              href={`${wa}${wa.includes("?") ? "&" : "?"}text=${encodeURIComponent(msg)}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Cobrar ${first || "cliente"} no WhatsApp`}
              className="press grid size-10 place-items-center rounded-full bg-[#2A2A2A]"
            >
              <MessageCircle className="size-4" />
            </a>
          ) : null}
          <span className="grid size-10 place-items-center rounded-full bg-[#2A2A2A]">
            <ArrowUpRight className="size-[18px]" />
          </span>
        </span>

        {/* entrega */}
        <span className="min-w-0 max-lg:hidden">
          <WhenPill when={r.when} big />
        </span>
        {/* valor */}
        <span className="max-lg:hidden">{payCell}</span>
        {/* fase */}
        <span className="min-w-0 max-lg:hidden">{phasePill}</span>
        {/* abrir (computador) */}
        <span className="flex justify-end max-lg:hidden">
          <span className="grid size-10 place-items-center rounded-full bg-[#2A2A2A] transition-colors group-hover:bg-white group-hover:text-[#15130F]">
            <ArrowUpRight className="size-[18px]" />
          </span>
        </span>

        {/* celular: fase + entrega + valor numa linha */}
        <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 lg:hidden">
          {phasePill}
          <WhenPill when={r.when} />
          <span className="ml-auto text-right">{payCell}</span>
        </span>
      </div>
      <Collapse open={open}>
        <ItemsExpand lines={lines} imageOf={imageOf} o={o} />
      </Collapse>
    </li>
  );
}
