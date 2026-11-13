/**
 * COMPRAS NO FORNECEDOR — em 3 fases, só o que está pendente.
 *
 *   1. Pedir ao fornecedor   → perfumes de pedidos em andamento ainda não pedidos
 *   2. Esperando o fornecedor → já pedidos; "Chegou" quando chegar
 *   3. Chegou · separar       → chegaram e o pedido do cliente ainda não foi entregue
 *
 * "Enviar pedido" abre a central de envio: mensagem pronta (editável) para o
 * WhatsApp de cada fornecedor e, depois de mandar, um toque marca como pedido.
 * Itens de pedidos já entregues/cancelados não aparecem; um aviso oferece
 * arquivá-los (o servidor confere pedido por pedido).
 */
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CalendarClock,
  History,
  Check,
  ClipboardCopy,
  Loader2,
  MessageCircle,
  PackageCheck,
  RotateCcw,
  Send,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  archiveStalePurchases,
  markPurchased,
  markReceived,
  saveSupplierPhone,
  schedulePurchase,
  undoPurchased,
  type PurchaseItem,
} from "@/lib/orders-control.functions";
import { imgVariant } from "@/lib/product-img";
import { todayBR } from "@/lib/delivery";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { burst, isLivePurchase } from "./model";
import { CheckSheet, DayOrderCard, HistoryView, OrderSheet, ProblemsView, groupByDay, openIssues } from "./SupplierOrdersUI";
import { supplierOrders, type SupplierOrder } from "@/lib/orders-control.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateChips, dayLabel, daysBetween } from "./controls";
import { AnimatedNumber, Collapse, PillTrack } from "../motion";
import { useBackToClose } from "@/hooks/use-back-to-close";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

type Group = { supplier: string; supplierId: string | null; phone: string | null; minOrder: number | null; items: PurchaseItem[] };
type Phase = "pedir" | "esperando" | "chegou" | "problemas" | "historico";

const groupBy = (items: PurchaseItem[]): Group[] => {
  const m = new Map<string, Group>();
  items.forEach((p) => {
    const k = p.supplier ?? "Sem fornecedor";
    const g = m.get(k) ?? { supplier: k, supplierId: p.supplierId, phone: p.supplierPhone, minOrder: p.supplierMinOrder, items: [] };
    g.items.push(p);
    m.set(k, g);
  });
  return [...m.values()].sort((a, b) => cost(b.items) - cost(a.items));
};
const cost = (items: PurchaseItem[]) => items.reduce((s, p) => s + (p.unitCost + p.extraFee) * p.quantity, 0);
const units = (items: PurchaseItem[]) => items.reduce((s, p) => s + p.quantity, 0);
const fr = (n: number) => `${n} ${n === 1 ? "frasco" : "frascos"}`;
const unpaidFor = (p: PurchaseItem) => p.sources.filter((s) => s.active && s.paid <= 0);

/** Mensagem para o fornecedor. */
function supplierMessage(g: Group, withPrices: boolean) {
  return [
    "Olá! Tudo bem? Aqui é da Orium Perfumes 😊",
    "Gostaria de fazer um pedido:",
    "",
    ...g.items.map(
      (p) => `• ${p.quantity}x ${productTitle(p.name)}${p.volumeMl ? ` ${p.volumeMl}ml` : ""}${withPrices && p.unitCost ? ` — ${brl(p.unitCost)} cada` : ""}`,
    ),
    "",
    `Total: ${units(g.items)} ${units(g.items) === 1 ? "frasco" : "frascos"}${withPrices ? ` · ${brl(cost(g.items))}` : ""}.`,
    "Pode me confirmar disponibilidade e o valor final? Obrigado!",
  ].join("\n");
}
const waLink = (phone: string, text: string) => `https://wa.me/55${phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "")}?text=${encodeURIComponent(text)}`;

export function PurchasesView({
  items,
  loading,
  onChanged,
  onOpenOrder,
}: {
  items: PurchaseItem[] | undefined;
  loading: boolean;
  onChanged: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const qc = useQueryClient();
  const loadOrders = useServerFn(supplierOrders);
  const so = useQuery({ queryKey: ["supplier-orders"], queryFn: () => loadOrders(), staleTime: 20_000 });
  const changed = () => {
    qc.invalidateQueries({ queryKey: ["supplier-orders"] });
    onChanged();
  };
  const sentOrders = (so.data?.orders ?? []).filter((o) => o.status === "enviado");
  // pedido do dia: todos os fornecedores pedidos no mesmo dia aparecem juntos
  const waitingDays = groupByDay(so.data?.orders ?? []).filter(([, list]) => list.some((o) => o.status === "enviado"));
  const issues = openIssues(so.data?.orders);
  const [checking, setChecking] = useState<SupplierOrder | null>(null);
  const [viewing, setViewing] = useState<SupplierOrder | null>(null);
  const all = items ?? [];
  const live = all.filter(isLivePurchase);
  const toAsk = useMemo(() => groupBy(live.filter((p) => p.status === "a comprar")), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  // pedidos antigos (antes do registro): itens "pedido feito" sem pedido salvo
  const waiting = useMemo(() => groupBy(live.filter((p) => p.status === "pedido feito" && !p.supplierOrderId)), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const arrived = live.filter((p) => p.status === "recebido" && p.sources.some((s) => s.active));
  const stale = all.filter((p) => p.status === "a comprar" && !isLivePurchase(p));
  const [phase, setPhase] = useState<Phase | null>(null);
  const waitingCount = waitingDays.length + waiting.length;
  const current: Phase = phase ?? (toAsk.length ? "pedir" : waitingCount ? "esperando" : arrived.length ? "chegou" : "pedir");
  const [send, setSend] = useState<{ groups: Group[]; origin: HTMLElement | null } | null>(null);
  // troca de fase desliza para o lado certo (para frente = da direita)
  const ORDER: Phase[] = ["pedir", "esperando", "chegou", "problemas", "historico"];
  const prevPhase = useRef<Phase | null>(null);
  const [confirm, setConfirm] = useState<Group | null>(null);
  const archive = useServerFn(archiveStalePurchases);
  const [archiving, setArchiving] = useState(false);

  if (loading)
    return (
      <div className="space-y-4">
        <div className="admin-skeleton h-[120px] rounded-[28px]" />
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="admin-skeleton h-[320px] rounded-[28px]" />
          ))}
        </div>
      </div>
    );

  const phases: Array<{ key: Phase; n: number; title: string; sub: string; icon: typeof ShoppingCart }> = [
    { key: "pedir", n: 1, title: "Pedir ao fornecedor", sub: toAsk.length ? `${fr(units(toAsk.flatMap((g) => g.items)))} · ${brl(toAsk.reduce((s, g) => s + cost(g.items), 0))}` : "nada para pedir", icon: Send },
    { key: "esperando", n: 2, title: "Esperando o fornecedor", sub: waitingCount ? `${sentOrders.length + waiting.length} ${sentOrders.length + waiting.length === 1 ? "fornecedor" : "fornecedores"} a caminho` : "nada a caminho", icon: Truck },
    { key: "chegou", n: 3, title: "Chegou · separar", sub: arrived.length ? `${units(arrived)} para entregar` : "nada para separar", icon: PackageCheck },
  ];
  const count: Record<string, number> = { pedir: toAsk.length, esperando: waitingCount, chegou: arrived.length };

  return (
    <div className="space-y-5">
      {stale.length ? (
        <div className="adm-rise flex flex-wrap items-center gap-3 rounded-[24px] bg-[#1A1A1A] p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#2A2418] text-[#FFD599]">
            <Archive className="size-5" />
          </span>
          <p className="min-w-0 flex-1 basis-[220px] text-[14px] leading-snug text-[#D4D4D4]">
            <b className="text-white">{stale.length} {stale.length === 1 ? "perfume" : "perfumes"} de pedidos já entregues</b> ainda estavam marcados como “a comprar”. Eles não
            aparecem mais aqui — quer arquivar para limpar a lista?
          </p>
          <button
            type="button"
            disabled={archiving}
            onClick={async () => {
              setArchiving(true);
              try {
                const r = await archive({ data: { itemIds: stale.map((p) => p.id) } });
                toast.success(`${r.archived} ${r.archived === 1 ? "item arquivado" : "itens arquivados"}.`);
                onChanged();
              } catch (e: any) {
                toast.error(e?.message ?? "Não foi possível arquivar.");
              } finally {
                setArchiving(false);
              }
            }}
            className="press inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-[#15130F] disabled:opacity-60 max-sm:w-full"
          >
            {archiving ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />} Arquivar
          </button>
        </div>
      ) : null}

      {/* fases */}
      <PillTrack
        activeKey={current}
        label="Fases da compra"
        pillClassName="bg-white rounded-[22px]!"
        className="adm-rise grid gap-2 rounded-[28px] bg-[#141414] p-2 sm:grid-cols-3"
      >
        {phases.map((ph, i) => {
          const on = current === ph.key;
          return (
            <div key={ph.key} className="relative z-[1]">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setPhase(ph.key)}
                className={cn(
                  "press flex w-full items-center gap-3 rounded-[22px] p-3.5 text-left transition-colors duration-500",
                  on ? "text-[#15130F]" : "hover:bg-white/[0.04]",
                )}
              >
                <span
                  className={cn(
                    "relative grid size-12 shrink-0 place-items-center rounded-full text-[15px] font-bold transition-[background-color,color,transform] duration-500",
                    on && "scale-105",
                    on ? "bg-[#FFD599] text-[#15130F]" : count[ph.key] ? "bg-[#262626] text-[#FFD599]" : "bg-[#1F1F1F] text-[#6F6F6F]",
                  )}
                >
                  <ph.icon className="size-5" strokeWidth={2.2} />
                  {count[ph.key] ? (
                    <span key={count[ph.key]} className="ord-bump absolute -top-1 -right-1 grid h-6 min-w-6 place-items-center rounded-full bg-[#15130F] px-1.5 text-[11.5px] font-bold text-[#FFD599] ring-2 ring-[#141414]">
                      {ph.key === "chegou" ? units(arrived) : count[ph.key]}
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-[11.5px] font-bold uppercase tracking-[0.06em]", on ? "text-[#15130F]/50" : "text-[#6F6F6F]")}>Passo {ph.n}</span>
                  <span className="block truncate text-[15.5px] font-bold">{ph.title}</span>
                  <span className={cn("block truncate text-[12.5px]", on ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>{ph.sub}</span>
                </span>
                {i < phases.length - 1 ? <ArrowRight className={cn("ml-auto hidden size-4 shrink-0 sm:block", on ? "text-[#15130F]/40" : "text-[#3A3A3A]")} /> : null}
              </button>
            </div>
          );
        })}
      </PillTrack>

      <div className="-mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={current === "problemas"}
          onClick={() => setPhase("problemas")}
          className={cn(
            "press inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-bold transition-colors",
            current === "problemas" ? "bg-white text-[#15130F]" : issues.length ? "bg-[#2A1A18] text-[#FF9A8A]" : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
          )}
        >
          <AlertTriangle className="size-4" /> Problemas com fornecedor
          {issues.length ? <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-[#FF9A8A] px-1.5 text-[11.5px] text-[#15130F]">{issues.length}</span> : null}
        </button>
        <button
          type="button"
          aria-pressed={current === "historico"}
          onClick={() => setPhase("historico")}
          className={cn(
            "press inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-bold transition-colors",
            current === "historico" ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
          )}
        >
          <History className="size-4" /> Tudo o que já pedi
          {so.data?.orders.length ? <span className="tabular-nums opacity-60">{so.data.orders.length}</span> : null}
        </button>
      </div>

      <div
        key={current}
        className={(() => {
          const back = prevPhase.current != null && ORDER.indexOf(current) < ORDER.indexOf(prevPhase.current);
          prevPhase.current = current;
          return back ? "ord-slide-back" : "ord-slide";
        })()}
      >
        {current === "pedir" ? (
          toAsk.length === 0 ? (
            <Empty icon={<Check className="size-7" />} title="Nada para pedir agora">
              Quando um pedido de cliente for confirmado e precisar de perfume do fornecedor, ele aparece aqui.
            </Empty>
          ) : (
            <div className="space-y-4">
              <div className="dash-hero adm-rise flex flex-wrap items-center gap-4 p-5 lg:p-6">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-[#15130F]/70">Para pedir agora</p>
                  <p className="text-[clamp(1.8rem,4vw,2.6rem)] leading-none font-bold tracking-[-0.045em] tabular-nums">
                    <AnimatedNumber value={toAsk.reduce((s, g) => s + cost(g.items), 0)} format={brl} />
                  </p>
                  <p className="mt-1.5 text-[13.5px] text-[#15130F]/65">
                    {fr(units(toAsk.flatMap((g) => g.items)))} em {toAsk.length} {toAsk.length === 1 ? "fornecedor" : "fornecedores"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => setSend({ groups: toAsk, origin: e.currentTarget })}
                  className="press inline-flex h-[58px] items-center gap-2.5 rounded-full bg-[#15130F] pr-7 pl-6 text-[16px] font-bold text-[#FFD599] transition-transform hover:scale-[1.02] max-sm:w-full max-sm:justify-center"
                >
                  <Send className="size-5" /> {toAsk.length === 1 ? `Enviar pedido para ${toAsk[0]!.supplier}` : `Enviar para os ${toAsk.length} fornecedores`}
                </button>
              </div>
              <div className="grid gap-3 xl:grid-cols-2 xl:gap-4">
                {toAsk.map((g, i) => (
                  <SupplierCard key={g.supplier} g={g} i={i} mode="pedir" onChanged={changed} onSend={(el) => setSend({ groups: [g], origin: el })} onManual={() => setConfirm(g)} onOpenOrder={onOpenOrder} />
                ))}
              </div>
            </div>
          )
        ) : current === "esperando" ? (
          waitingCount === 0 ? (
            <Empty icon={<Truck className="size-7" />} title="Nenhum pedido a caminho">
              Depois que você mandar o pedido para o fornecedor, ele fica aqui até chegar. Na chegada, toque em “Chegou · conferir”.
            </Empty>
          ) : (
            <div className={cn("grid gap-3 xl:gap-4", waitingDays.length + waiting.length > 1 && "xl:grid-cols-2")}>
              {waitingDays.map(([day, list], i) => (
                <DayOrderCard key={day} day={day} orders={list} i={i} onCheck={setChecking} onOpen={setViewing} onDeleted={changed} />
              ))}
              {waiting.map((g, i) => (
                <SupplierCard key={g.supplier} g={g} i={i + waitingDays.length} mode="esperando" onChanged={changed} onOpenOrder={onOpenOrder} />
              ))}
            </div>
          )
        ) : current === "problemas" ? (
          <ProblemsView orders={so.data?.orders} onChanged={changed} />
        ) : current === "historico" ? (
          <HistoryView orders={so.data?.orders} onOpen={setViewing} onCheck={setChecking} onDeleted={changed} />
        ) : (
          <Arrived items={arrived} onOpenOrder={onOpenOrder} />
        )}
      </div>

      {checking ? <CheckSheet order={checking} onClose={() => setChecking(null)} onDone={changed} /> : null}
      {viewing ? (
        <OrderSheet
          o={viewing}
          onClose={() => setViewing(null)}
          onCheck={() => {
            setChecking(viewing);
            setViewing(null);
          }}
        />
      ) : null}
      {send ? (
        <SendCenter
          groups={send.groups}
          origin={send.origin}
          onClose={() => setSend(null)}
          onSent={() => changed()}
          onAllDone={() => {
            setSend(null);
            setPhase("esperando");
          }}
        />
      ) : null}
      {confirm ? (
        <ConfirmBuy
          g={confirm}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            changed();
          }}
        />
      ) : null}
    </div>
  );
}

function SupplierCard({
  g,
  i,
  mode,
  onChanged,
  onSend,
  onManual,
  onOpenOrder,
}: {
  g: Group;
  i: number;
  mode: "pedir" | "esperando";
  onChanged: () => void;
  onSend?: (from: HTMLElement) => void;
  onManual?: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const schedule = useServerFn(schedulePurchase);
  const receive = useServerFn(markReceived);
  const undo = useServerFn(undoPurchased);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = todayBR();
  const dates = [...new Set(g.items.map((p) => p.plannedDate).filter(Boolean))] as string[];
  const planned = dates.length === 1 && g.items.every((p) => p.plannedDate) ? dates[0]! : null;
  const late = mode === "pedir" && planned != null && planned < t;
  const due = mode === "pedir" && planned === t;
  const cheaper = g.items.filter((p) => p.cheaper);
  const total = cost(g.items);
  const belowMin = g.minOrder != null && g.minOrder > 0 && total < g.minOrder;
  const sentAt = g.items.map((p) => p.purchasedAt).filter(Boolean).sort()[0] ?? null;
  const waitedDays = sentAt ? daysBetween(sentAt.slice(0, 10), t) : 0;
  const btnRef = useRef<HTMLButtonElement>(null);

  const setDate = async (d: string | null) => {
    setBusy(true);
    try {
      await schedule({ data: { itemIds: g.items.map((p) => p.id), date: d } });
      toast.success(d ? `Pedido na ${g.supplier} agendado: ${dayLabel(d).toLowerCase()}.` : "Agendamento removido.");
      setPicking(false);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível agendar.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(supplierMessage(g, true));
      toast.success("Mensagem copiada.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };
  const arrived = async () => {
    setBusy(true);
    try {
      const r = await receive({ data: { itemIds: g.items.map((p) => p.id) } });
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 18);
      toast.success(`${r.updated} ${r.updated === 1 ? "perfume chegou" : "perfumes chegaram"}. Agora é separar e entregar!`);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível marcar.");
    } finally {
      setBusy(false);
    }
  };
  const undoBuy = async () => {
    setBusy(true);
    try {
      await undo({ data: { itemIds: g.items.map((p) => p.id) } });
      toast.success("Voltou para “Pedir ao fornecedor”.");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível desfazer.");
    } finally {
      setBusy(false);
    }
  };
  const askStatus = g.phone
    ? waLink(g.phone, `Olá! Tudo bem? Passando para saber do meu pedido (${units(g.items)} ${units(g.items) === 1 ? "frasco" : "frascos"}) — já foi enviado? Obrigado!`)
    : null;

  return (
    <section className="dash-card adm-rise min-w-0 overflow-hidden" style={{ ["--i" as string]: i + 2 }}>
      <header className="flex flex-wrap items-start gap-3 p-4 pb-3 lg:p-5 lg:pb-3">
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-full text-[16px] font-bold", mode === "pedir" ? "bg-[#FFD599] text-[#15130F]" : "bg-[#262626]")}>
          {g.supplier.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[18px] font-bold tracking-[-0.015em]">{g.supplier}</h3>
          <p className="text-[13px] text-[#8C8C8C]">
            {units(g.items)} {units(g.items) === 1 ? "frasco" : "frascos"} · <b className="text-white tabular-nums">{brl(total)}</b>
            {g.phone ? null : mode === "pedir" ? <span className="text-[#F5C26B]"> · sem WhatsApp</span> : null}
          </p>
        </div>
        {mode === "pedir" ? (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className={cn(
              "press inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-colors max-sm:order-last max-sm:w-full",
              late ? "bg-[#2A1A18] text-[#FF9A8A]" : due ? "bg-[#FFD599] text-[#15130F]" : planned ? "bg-[#262626] text-white" : "bg-[#262626] text-[#A9A9A9]",
            )}
          >
            <CalendarClock className="size-4" />
            {planned ? (late ? `Era para ${dayLabel(planned).toLowerCase()}` : `Pedir ${dayLabel(planned).toLowerCase()}`) : "Agendar"}
          </button>
        ) : (
          <span className={cn("rounded-full px-3 py-1.5 text-[12.5px] font-bold", waitedDays >= 3 ? "bg-[#2A2418] text-[#F5C26B]" : "bg-[#262626] text-[#A9A9A9]")}>
            {waitedDays <= 0 ? "Pedido hoje" : waitedDays === 1 ? "Pedido ontem" : `Esperando há ${waitedDays} dias`}
          </span>
        )}
      </header>

      {picking ? (
        <div className="adm-pop mx-4 mb-3 rounded-[20px] bg-[#141414] p-3 lg:mx-5">
          <p className="mb-2 px-1 text-[13px] font-semibold text-[#A9A9A9]">Que dia você vai pedir para a {g.supplier}?</p>
          <DateChips value={planned} onChange={setDate} busy={busy} clearLabel="Tirar data" days={7} />
        </div>
      ) : null}

      {mode === "pedir" && belowMin ? (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-[16px] bg-[#2A2418] px-3.5 py-2.5 text-[12.5px] text-[#FFE2B3] lg:mx-5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#F5C26B]" />
          <span>
            Pedido mínimo da {g.supplier} é {brl(g.minOrder)} — faltam <b>{brl(g.minOrder! - total)}</b>. Dá para esperar mais pedidos ou completar com estoque.
          </span>
        </div>
      ) : null}
      {cheaper.length && mode === "pedir" ? (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-[16px] bg-[#17251C] px-3.5 py-2.5 text-[12.5px] text-[#B6E7C8] lg:mx-5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#7FCF9F]" />
          <span>
            {cheaper.length === 1 ? "1 perfume está" : `${cheaper.length} perfumes estão`} mais barato em outro fornecedor — economia de{" "}
            <b>{brl(cheaper.reduce((s, p) => s + (p.unitCost - p.cheaper!.cost) * p.quantity, 0))}</b>.
          </span>
        </div>
      ) : null}

      <ul className="space-y-1.5 px-3 lg:px-4">
        {g.items.map((p) => (
          <ItemRow key={p.id} p={p} onOpenOrder={onOpenOrder} />
        ))}
      </ul>

      <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] p-3 lg:p-4">
        {mode === "pedir" ? (
          <>
            <button type="button" onClick={copy} aria-label="Copiar mensagem" className="press grid size-12 place-items-center rounded-full bg-[#262626] hover:bg-[#2E2E2E]">
              <ClipboardCopy className="size-[18px]" />
            </button>
            <button type="button" onClick={onManual} className="press inline-flex h-12 items-center rounded-full px-2 text-[13px] font-semibold whitespace-nowrap text-[#A9A9A9] hover:text-white">
              Já pedi por fora
            </button>
            <button
              type="button"
              onClick={(e) => onSend?.(e.currentTarget)}
              className="press ml-auto inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#FFD599] px-5 text-[15px] font-bold whitespace-nowrap text-[#15130F] hover:bg-[#FFDDAA] sm:flex-none"
            >
              <Send className="size-[18px]" /> Enviar pedido
            </button>
          </>
        ) : (
          <>
            {askStatus ? (
              <a href={askStatus} target="_blank" rel="noreferrer" aria-label="Perguntar ao fornecedor" className="press grid size-12 place-items-center rounded-full bg-[#262626] hover:bg-[#2E2E2E]">
                <MessageCircle className="size-[18px]" />
              </a>
            ) : null}
            <button type="button" disabled={busy} onClick={undoBuy} className="press inline-flex h-12 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[#A9A9A9] hover:text-white">
              <RotateCcw className="size-4" /> Desfazer
            </button>
            <button
              ref={btnRef}
              type="button"
              disabled={busy}
              onClick={arrived}
              className="press ml-auto inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white px-5 text-[15px] font-bold text-[#15130F] hover:bg-[#7FCF9F] sm:flex-none"
            >
              {busy ? <Loader2 className="size-[18px] animate-spin" /> : <PackageCheck className="size-[18px]" />} Chegou tudo
            </button>
          </>
        )}
      </footer>
    </section>
  );
}

/** Fase 3: o que chegou, agrupado pelo pedido do cliente. */
function Arrived({ items, onOpenOrder }: { items: PurchaseItem[]; onOpenOrder: (orderId: string) => void }) {
  const byOrder = new Map<string, { customer: string; deliveryDate: string | null; items: PurchaseItem[] }>();
  items.forEach((p) =>
    p.sources
      .filter((s) => s.active)
      .forEach((s) => {
        const cur = byOrder.get(s.orderId) ?? { customer: s.customer ?? "Cliente", deliveryDate: s.deliveryDate, items: [] };
        cur.items.push(p);
        byOrder.set(s.orderId, cur);
      }),
  );
  const list = [...byOrder.entries()];
  if (!list.length)
    return (
      <Empty icon={<PackageCheck className="size-7" />} title="Nada para separar">
        Quando os perfumes chegarem do fornecedor, aparecem aqui por cliente, prontos para entregar.
      </Empty>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map(([orderId, o], i) => (
        <button
          key={orderId}
          type="button"
          onClick={() => onOpenOrder(orderId)}
          className="ord-card ord-in flex flex-col gap-3 p-4 text-left"
          style={{ ["--i" as string]: i }}
        >
          <span className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#17251C] text-[#7FCF9F]">
              <PackageCheck className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15.5px] font-bold">{o.customer}</span>
              <span className="block text-[12.5px] text-[#8C8C8C]">{o.deliveryDate ? `Entrega ${dayLabel(o.deliveryDate).toLowerCase()}` : "Sem dia de entrega"}</span>
            </span>
          </span>
          <span className="flex flex-wrap gap-1.5">
            {o.items.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-2 rounded-full bg-[#141414] py-1 pr-3 pl-1 text-[12.5px] font-semibold">
                <span className="grid size-7 place-items-center overflow-hidden rounded-full bg-white">
                  {p.image ? <img src={imgVariant(p.image, "thumb") ?? p.image} alt="" className="size-full object-contain p-0.5" /> : null}
                </span>
                {productTitle(p.name)}
              </span>
            ))}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#FFD599]">
            Abrir pedido para entregar <ArrowRight className="size-4" />
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Central de envio: um fornecedor por vez. Mensagem pronta (editável),
 * WhatsApp do fornecedor (pede uma vez e guarda), abrir o WhatsApp e, depois
 * de mandar, "Mandei" marca como pedido feito. Progresso no topo.
 *
 * Movimento: a janela nasce do botão "Enviar pedido" (recorte que cresce, cor
 * do botão virando a da janela) e volta para ele ao fechar. No "Mandei", o
 * aviãozinho sai voando, o fornecedor fecha com um check verde e o próximo abre.
 */
const SEND_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const motionOff = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** quadros da animação "nasce do botão": a janela parte do tamanho/posição do botão */
function morphFrames(panel: DOMRect, from: DOMRect, bg: string) {
  const sx = from.width / panel.width;
  const sy = from.height / panel.height;
  const dx = from.left + from.width / 2 - (panel.left + panel.width / 2);
  const dy = from.top + from.height / 2 - (panel.top + panel.height / 2);
  const r = from.height / 2;
  return {
    start: { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: `${r / sx}px / ${r / sy}px`, backgroundColor: bg },
    end: { transform: "none", borderRadius: "32px", backgroundColor: "#121212" },
  };
}

function SendCenter({
  groups,
  origin,
  onClose,
  onSent,
  onAllDone,
}: {
  groups: Group[];
  origin: HTMLElement | null;
  onClose: () => void;
  onSent: () => void;
  onAllDone: () => void;
}) {
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(groups[0]?.supplier ?? "");
  const done = groups.filter((g) => sent[g.supplier]).length;
  const finished = done === groups.length;
  const panel = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  const total = groups.reduce((s, g) => s + cost(g.items), 0);

  // entrada: nasce do botão
  useLayoutEffect(() => {
    const p = panel.current;
    if (!p || motionOff()) return;
    back.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: "ease-out", fill: "both" });
    const from = origin?.isConnected ? origin.getBoundingClientRect() : null;
    const to = p.getBoundingClientRect();
    if (from && from.width > 0) {
      const f = morphFrames(to, from, getComputedStyle(origin!).backgroundColor);
      p.animate([f.start, { backgroundColor: "#121212", offset: 0.5 }, f.end], { duration: 640, easing: "cubic-bezier(0.2, 0.9, 0.1, 1)", fill: "both" }).onfinish = (e) =>
        (e.target as Animation).cancel();
    } else {
      p.animate([{ transform: "translateY(40px) scale(0.96)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 520, easing: SEND_EASE, fill: "both" });
    }
    inner.current?.querySelectorAll<HTMLElement>("[data-rise]").forEach((el, i) => {
      el.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 520, delay: 220 + i * 70, easing: SEND_EASE, fill: "both" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a janela muda de altura com suavidade (ex.: virou a tela de "enviado")
  const lastH = useRef(0);
  useLayoutEffect(() => {
    const p = panel.current;
    if (!p) return;
    const h = p.offsetHeight;
    if (lastH.current && Math.abs(h - lastH.current) > 24 && !motionOff() && !leaving.current)
      p.animate([{ height: `${lastH.current}px` }, { height: `${h}px` }], { duration: 480, easing: SEND_EASE });
    lastH.current = h;
  }, [finished]);

  // saída: volta para o botão
  const close = () => {
    if (leaving.current) return;
    leaving.current = true;
    const p = panel.current;
    if (!p || motionOff()) return onClose();
    back.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: "ease-in", fill: "both" });
    inner.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-in", fill: "both" });
    const from = origin?.isConnected ? origin.getBoundingClientRect() : null;
    const to = p.getBoundingClientRect();
    const visible = from && from.width > 0 && from.bottom > 0 && from.top < window.innerHeight;
    const a = visible
      ? (() => {
          const f = morphFrames(to, from!, getComputedStyle(origin!).backgroundColor);
          return p.animate([f.end, { backgroundColor: "#121212", offset: 0.45 }, f.start], { duration: 520, easing: "cubic-bezier(0.5, 0, 0.15, 1)", fill: "both" });
        })()
      : p.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(40px) scale(0.97)", opacity: 0 }], { duration: 280, easing: "ease-in", fill: "both" });
    a.onfinish = onClose;
  };
  useBackToClose(true, close);
  useBodyScrollLock(true);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // terminou: confete no meio do check
  const okRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => {
      const r = okRef.current?.getBoundingClientRect();
      if (r) burst(r.left + r.width / 2, r.top + r.height / 2, 30);
    }, 520);
    return () => clearTimeout(t);
  }, [finished]);

  return createPortal(
    <div className="admin-theme fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div ref={back} className="absolute inset-0 bg-black/70" onClick={close} />
      <div
        ref={panel}
        role="dialog"
        aria-modal
        aria-label="Enviar pedidos aos fornecedores"
        className="relative flex max-h-[94dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-[32px] bg-[#121212] text-white sm:rounded-[32px]"
      >
        <div ref={inner} className="flex min-h-0 flex-1 flex-col">
          <header data-rise className="shrink-0 px-5 pt-5 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] text-[#8C8C8C]">{groups.length === 1 ? "Enviar pedido" : "Enviar pedidos"}</p>
                <p className="text-[24px] leading-tight font-bold tracking-[-0.03em]">{groups.length === 1 ? groups[0]!.supplier : `${groups.length} fornecedores`}</p>
              </div>
              <button type="button" onClick={close} aria-label="Fechar" className="press grid size-10 place-items-center rounded-full bg-[#1F1F1F] hover:bg-[#2A2A2A]">
                <X className="size-5" />
              </button>
            </div>
            {groups.length > 1 ? (
              <div className="mt-4">
                <div className="flex justify-between text-[12.5px] font-semibold text-[#8C8C8C]">
                  <span>
                    <span key={done} className="ord-bump inline-block text-white tabular-nums">
                      {done}
                    </span>{" "}
                    de {groups.length} enviados
                  </span>
                  <span className="tabular-nums">{brl(total)}</span>
                </div>
                <div className="mt-2 flex h-2 gap-1">
                  {groups.map((g) => (
                    <span key={g.supplier} className="relative flex-1 overflow-hidden rounded-full bg-[#262626]">
                      <span
                        className="send-seg absolute inset-0 rounded-full bg-[#7FCF9F]"
                        data-on={!!sent[g.supplier]}
                      />
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {finished ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <span ref={okRef} className="relative grid size-24 place-items-center">
                  <svg viewBox="0 0 96 96" className="absolute inset-0 size-full -rotate-90" aria-hidden>
                    <circle cx="48" cy="48" r="44" fill="none" stroke="#7FCF9F" strokeWidth="5" strokeLinecap="round" className="send-ring" />
                  </svg>
                  <span className="send-ok grid size-[72px] place-items-center rounded-full bg-[#7FCF9F] text-[#15130F]">
                    <svg viewBox="0 0 24 24" className="size-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12.5l4.5 4.5L19 7.5" className="send-check" />
                    </svg>
                  </span>
                </span>
                <div className="ui-cascade mt-6 flex w-full flex-col items-center">
                  <p className="text-[24px] font-bold tracking-[-0.025em]" style={{ ["--i" as string]: 6 }}>
                    {groups.length === 1 ? "Pedido enviado!" : "Todos os pedidos enviados!"}
                  </p>
                  <p className="mt-1.5 max-w-[340px] text-[14px] text-[#8C8C8C]" style={{ ["--i" as string]: 7 }}>
                    Agora {groups.length === 1 ? "ele está" : "eles estão"} em “Esperando o fornecedor”. Quando chegar, é só tocar em “Chegou tudo”.
                  </p>
                  <button
                    type="button"
                    onClick={onAllDone}
                    style={{ ["--i" as string]: 8 }}
                    className="press mt-7 inline-flex h-[54px] w-full max-w-[320px] items-center justify-center gap-2 rounded-full bg-white text-[15px] font-bold text-[#15130F]"
                  >
                    <Truck className="size-5" /> Ver o que está a caminho
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {groups.map((g, i) => (
                  <div key={g.supplier} data-rise style={{ ["--i" as string]: i }}>
                    <SendStep
                      g={g}
                      open={open === g.supplier && !sent[g.supplier]}
                      sent={!!sent[g.supplier]}
                      onOpen={() => setOpen(g.supplier)}
                      onSent={() => {
                        setSent((s) => ({ ...s, [g.supplier]: true }));
                        onSent();
                        const next = groups.find((x) => x.supplier !== g.supplier && !sent[x.supplier]);
                        // o fornecedor fecha primeiro; depois o próximo abre
                        if (next) setTimeout(() => setOpen(next.supplier), 380);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** aviãozinho de papel que sai voando do botão (fora de qualquer recorte) */
function flyPlane(from: DOMRect) {
  if (typeof document === "undefined" || motionOff()) return;
  const el = document.createElement("span");
  const x = from.left + from.width / 2;
  const y = from.top + from.height / 2;
  el.style.cssText = `position:fixed;left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;z-index:95;pointer-events:none;color:#FFD599`;
  el.innerHTML =
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>';
  document.body.appendChild(el);
  const dx = Math.min(window.innerWidth - x - 20, 260);
  const a = el.animate(
    [
      { transform: "translate(0,0) scale(0.6) rotate(0deg)", opacity: 0 },
      { transform: "translate(-18px, 10px) scale(1.15) rotate(-12deg)", opacity: 1, offset: 0.18 },
      { transform: `translate(${dx * 0.45}px, -70px) scale(1) rotate(8deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, -220px) scale(0.5) rotate(18deg)`, opacity: 0 },
    ],
    { duration: 900, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "both" },
  );
  // rastro: três pontinhos que somem
  for (let i = 1; i <= 3; i++) {
    const d = document.createElement("span");
    d.style.cssText = `position:fixed;left:${x - 2.5}px;top:${y - 2.5}px;width:5px;height:5px;border-radius:9px;background:#FFD599;z-index:94;pointer-events:none`;
    document.body.appendChild(d);
    d.animate(
      [
        { transform: "translate(0,0)", opacity: 0 },
        { transform: `translate(${dx * 0.3}px, -40px)`, opacity: 0.7, offset: 0.4 },
        { transform: `translate(${dx * 0.75}px, -150px)`, opacity: 0 },
      ],
      { duration: 820, delay: i * 70, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "both" },
    ).onfinish = () => d.remove();
  }
  a.onfinish = () => el.remove();
}

function SendStep({ g, open, sent, onOpen, onSent }: { g: Group; open: boolean; sent: boolean; onOpen: () => void; onSent: () => void }) {
  const savePhone = useServerFn(saveSupplierPhone);
  const buy = useServerFn(markPurchased);
  const [phone, setPhone] = useState(g.phone ?? "");
  const [phoneSaved, setPhoneSaved] = useState(!!g.phone);
  const [withPrices, setWithPrices] = useState(true);
  const [text, setText] = useState(() => supplierMessage(g, true));
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flying, setFlying] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const unpaid = g.items.filter((p) => unpaidFor(p).length);

  const save = async () => {
    setBusy(true);
    try {
      const r = await savePhone({ data: { supplierId: g.supplierId!, phone } });
      setPhone(r.phone);
      setPhoneSaved(true);
      toast.success(`WhatsApp da ${g.supplier} salvo.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };
  const mark = async () => {
    setBusy(true);
    try {
      const r = await buy({ data: { itemIds: g.items.map((p) => p.id), via: "whatsapp", message: text } });
      const rect = ref.current?.getBoundingClientRect();
      setFlying(true);
      if (rect) {
        flyPlane(rect);
        setTimeout(() => burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 16), 120);
      }
      if (r.skipped) toast.info(`${r.skipped} ${r.skipped === 1 ? "item já estava" : "itens já estavam"} como pedido — não contei de novo.`);
      toast.success(`Pedido${r.orders?.[0] ? ` #${r.orders[0]}` : ""} na ${g.supplier} salvo.`);
      // deixa ver o check no botão antes de fechar o fornecedor
      setTimeout(onSent, motionOff() ? 0 : 560);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível registrar.");
    } finally {
      setBusy(false);
    }
  };

  const phoneOk = phone.replace(/\D/g, "").length >= 10;
  const field = "bg-[#232323] outline-none transition-colors duration-200 placeholder:text-[#6F6F6F] hover:bg-[#262626] focus:bg-[#2A2A2A]";
  return (
    <div className={cn("send-step rounded-[24px] transition-colors duration-500", sent ? "bg-[#152019]" : "bg-[#1A1A1A]")} data-open={open}>
      <button
        type="button"
        onClick={sent || open ? undefined : onOpen}
        aria-expanded={open}
        className={cn("flex w-full items-center gap-3 rounded-[24px] p-3.5 text-left", !sent && !open && "press hover:bg-white/[0.03]")}
      >
        <span
          key={sent ? "ok" : "todo"}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-full text-[14px] font-bold transition-colors duration-300",
            sent ? "send-pop bg-[#7FCF9F] text-[#15130F]" : open ? "bg-[#FFD599] text-[#15130F]" : "bg-[#262626]",
          )}
        >
          {sent ? <Check className="size-5" strokeWidth={3} /> : g.supplier.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-bold">{g.supplier}</span>
          <span className={cn("block text-[12.5px] tabular-nums transition-colors duration-300", sent ? "text-[#7FCF9F]" : "text-[#8C8C8C]")}>
            {sent ? "Pedido enviado" : `${fr(units(g.items))} · ${brl(cost(g.items))}`}
          </span>
        </span>
        {!sent && !open ? <ArrowRight className="size-4 shrink-0 text-[#6F6F6F]" /> : null}
      </button>

      <Collapse open={open}>
        <div className="ui-stagger px-4 pb-4">
          {/* 1. WhatsApp do fornecedor */}
          <div style={{ ["--i" as string]: 0 }}>
            <p className="mb-2 flex items-center gap-2 px-1 text-[13px] font-bold">
              <Num n={1} ok={phoneSaved && phoneOk} /> WhatsApp da {g.supplier}
            </p>
            {phoneSaved ? (
              <div className="flex items-center justify-between rounded-[16px] bg-[#232323] px-4 py-3 text-[14.5px]">
                <span className="tabular-nums">{fmtPhone(phone)}</span>
                <button type="button" onClick={() => setPhoneSaved(false)} className="press text-[13px] font-semibold text-[#A9A9A9] hover:text-white">
                  Trocar
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  data-slot="input-group-control"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d()\s-]/g, ""))}
                  placeholder="(21) 99999-9999"
                  className={cn("h-12 min-w-0 flex-1 rounded-full px-4 text-[15.5px]", field)}
                />
                <button type="button" disabled={!phoneOk || busy || !g.supplierId} onClick={save} className="press h-12 rounded-full bg-white px-5 text-[14px] font-bold text-[#15130F] disabled:opacity-40">
                  Salvar
                </button>
              </div>
            )}
          </div>

          {/* 2. mensagem */}
          <div className="mt-4" style={{ ["--i" as string]: 1 }}>
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="flex items-center gap-2 text-[13px] font-bold">
                <Num n={2} ok /> Mensagem
              </p>
              <button
                type="button"
                onClick={() => {
                  setWithPrices((v) => !v);
                  setText(supplierMessage(g, !withPrices));
                }}
                className="press text-[12.5px] font-semibold text-[#A9A9A9] hover:text-white"
              >
                {withPrices ? "Tirar os valores" : "Mostrar os valores"}
              </button>
            </div>
            <textarea
              data-slot="input-group-control"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={Math.min(12, text.split("\n").length + 1)}
              className={cn("block w-full resize-none rounded-[18px] px-4 py-3 text-[14px] leading-relaxed", field)}
            />
            {unpaid.length ? (
              <p className="mt-2 flex items-start gap-2 rounded-[14px] bg-[#2A1A18] px-3 py-2 text-[12.5px] text-[#FFC4BA]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#FF9A8A]" />
                {[...new Set(unpaid.flatMap((p) => unpaidFor(p).map((s) => s.customer?.split(" ")[0] ?? "cliente")))].join(", ")} ainda não pagou nada. Se desistir, o
                perfume fica com você.
              </p>
            ) : null}
          </div>

          {/* 3. enviar e marcar */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2" style={{ ["--i" as string]: 2 }}>
            {phoneSaved && phoneOk ? (
              <a
                href={waLink(phone, text)}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpened(true)}
                className="press inline-flex h-[54px] items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F] hover:bg-[#FFDDAA]"
              >
                <MessageCircle className="size-5" /> Abrir no WhatsApp
              </a>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(text).catch(() => undefined);
                  setOpened(true);
                  toast.success("Mensagem copiada. Cole no WhatsApp do fornecedor.");
                }}
                className="press inline-flex h-[54px] items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F] hover:bg-[#FFDDAA]"
              >
                <ClipboardCopy className="size-5" /> Copiar mensagem
              </button>
            )}
            <button
              ref={ref}
              type="button"
              disabled={busy || flying}
              onClick={mark}
              className={cn(
                "press relative inline-flex h-[54px] items-center justify-center gap-2 overflow-hidden rounded-full text-[15px] font-bold transition-colors duration-300",
                flying ? "bg-[#7FCF9F] text-[#15130F]" : opened ? "bg-white text-[#15130F] hover:bg-[#7FCF9F]" : "bg-[#262626] text-[#A9A9A9] hover:text-white",
              )}
            >
              <span key={flying ? "done" : busy ? "busy" : "idle"} className="send-label inline-flex items-center gap-2">
                {flying ? (
                  <>
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12.5l4.5 4.5L19 7.5" className="send-check" />
                    </svg>
                    Pedido feito!
                  </>
                ) : busy ? (
                  <>
                    <Loader2 className="size-5 animate-spin" /> Salvando…
                  </>
                ) : (
                  <>
                    <Send className="size-[18px]" /> Mandei, marcar como pedido
                  </>
                )}
              </span>
            </button>
          </div>
          <Collapse open={!opened}>
            <p className="pt-2 text-center text-[12px] text-[#6F6F6F]">Primeiro mande a mensagem; depois toque em “Mandei”.</p>
          </Collapse>
        </div>
      </Collapse>
    </div>
  );
}

function Num({ n, ok }: { n: number; ok?: boolean }) {
  return (
    <span className={cn("grid size-5 place-items-center rounded-full text-[11px] font-bold", ok ? "bg-[#7FCF9F] text-[#15130F]" : "bg-[#3A3A3A] text-white")}>
      {ok ? <Check className="size-3" strokeWidth={3.5} /> : n}
    </span>
  );
}

const fmtPhone = (v: string) => {
  const d = v.replace(/\D/g, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : v;
};

function ItemRow({ p, onOpenOrder }: { p: PurchaseItem; onOpenOrder: (orderId: string) => void }) {
  const img = imgVariant(p.image, "thumb") ?? p.image;
  return (
    <li className="rounded-[20px] bg-[#1F1F1F] p-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-white">
          {img ? <img src={img} alt="" loading="lazy" className="size-full object-contain p-1" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          {p.brand ? <span className="block truncate text-[11.5px] text-[#8C8C8C]">{p.brand}</span> : null}
          <span className="block truncate text-[14.5px] font-bold">{productTitle(p.name)}</span>
          <span className="block text-[12.5px] text-[#A9A9A9] tabular-nums">
            {p.quantity}× {brl(p.unitCost)}
            {p.extraFee ? ` + ${brl(p.extraFee)} taxa` : ""}
          </span>
        </span>
        <span className="shrink-0 text-right text-[15px] font-bold tabular-nums">{brl((p.unitCost + p.extraFee) * p.quantity)}</span>
      </div>
      {p.cheaper && p.status === "a comprar" ? (
        <p className="mt-2 rounded-[12px] bg-[#17251C] px-3 py-1.5 text-[12px] font-semibold text-[#7FCF9F]">
          {p.cheaper.supplier} tem por {brl(p.cheaper.cost)} (−{brl(p.unitCost - p.cheaper.cost)} cada)
        </p>
      ) : null}
      {p.sources.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {p.sources.filter((s) => s.active).map((s) => {
            const paid = s.total > 0 && s.paid >= s.total;
            const partial = s.paid > 0 && !paid;
            return (
              <button
                key={s.orderId}
                type="button"
                onClick={() => onOpenOrder(s.orderId)}
                className="press inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-[#141414] pr-3 pl-2 text-[12px] font-semibold hover:bg-[#262626]"
                title={paid ? "Pago" : partial ? "Pagou parte" : "Ainda não pagou"}
              >
                <span className={cn("size-2 shrink-0 rounded-full", paid ? "bg-[#7FCF9F]" : partial ? "bg-[#FFD599]" : "bg-[#FF9A8A]")} />
                <span className="truncate">{s.customer?.split(/\s+/).slice(0, 2).join(" ") || "Cliente"}</span>
                {s.quantity > 1 ? <span className="text-[#8C8C8C]">×{s.quantity}</span> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-[#8C8C8C]">Para o estoque da loja</p>
      )}
    </li>
  );
}

/** Confirmação da compra: total, avisos e um botão só. */
function ConfirmBuy({ g, onClose, onDone }: { g: Group; onClose: () => void; onDone: () => void }) {
  const buy = useServerFn(markPurchased);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const unpaid = g.items.filter((p) => unpaidFor(p).length > 0);
  const cheaper = g.items.filter((p) => p.cheaper);
  const go = async () => {
    setBusy(true);
    try {
      const r = await buy({ data: { itemIds: g.items.map((p) => p.id), via: "manual", message: null } });
      const rect = ref.current?.getBoundingClientRect();
      if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 24);
      if (r.skipped) toast.info(`${r.skipped} ${r.skipped === 1 ? "item já estava" : "itens já estavam"} comprado${r.skipped === 1 ? "" : "s"} — não contei de novo.`);
      toast.success(`Pedido na ${g.supplier} registrado.`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível registrar a compra.");
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div className="admin-theme adm-fade fixed inset-0 z-[70] flex items-end justify-center bg-black/65 sm:items-center" onClick={onClose}>
      <div
        className="ord-sheet-up w-full max-w-[480px] rounded-t-[32px] border border-white/[0.07] bg-[#141414] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white sm:rounded-[32px] sm:pb-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Confirmar compra"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] text-[#8C8C8C]">Já pediu por fora para a</p>
            <p className="text-[24px] leading-tight font-bold tracking-[-0.03em]">{g.supplier}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="press grid size-10 place-items-center rounded-full bg-[#1F1F1F]">
            <X className="size-5" />
          </button>
        </div>
        <ul className="mt-4 max-h-[34vh] space-y-1.5 overflow-y-auto">
          {g.items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-[14px] bg-[#1F1F1F] px-3.5 py-2.5 text-[14px]">
              <span className="min-w-0 truncate">
                <b className="tabular-nums">{p.quantity}×</b> {productTitle(p.name)}
              </span>
              <span className="shrink-0 font-bold tabular-nums">{brl((p.unitCost + p.extraFee) * p.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-baseline justify-between rounded-[18px] bg-[#FFD599] px-4 py-3 text-[#15130F]">
          <span className="text-[14px] font-bold">Total a pagar</span>
          <span className="text-[24px] font-bold tracking-[-0.03em] tabular-nums">{brl(cost(g.items))}</span>
        </div>
        {unpaid.length ? (
          <Warn tone="red">
            <b>{unpaid.length === 1 ? "1 perfume é" : `${unpaid.length} perfumes são`} para quem ainda não pagou nada</b> (
            {[...new Set(unpaid.flatMap((p) => unpaidFor(p).map((s) => s.customer?.split(" ")[0] ?? "cliente")))].join(", ")}). Se comprar e a pessoa
            desistir, o perfume fica com você.
          </Warn>
        ) : null}
        {cheaper.length ? (
          <Warn tone="green">
            {cheaper.map((p) => `${productTitle(p.name)} sai ${brl(p.unitCost - p.cheaper!.cost)} mais barato na ${p.cheaper!.supplier}`).join(" · ")}.
          </Warn>
        ) : null}
        <button
          ref={ref}
          type="button"
          disabled={busy}
          onClick={go}
          className="press mt-4 flex h-[56px] w-full items-center justify-center gap-2 rounded-full bg-white text-[16px] font-bold text-[#15130F] hover:bg-[#FFD599] disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" strokeWidth={2.6} />}
          Sim, já fiz esse pedido
        </button>
        <p className="mt-2 text-center text-[12px] text-[#6F6F6F]">Se errar, dá para desfazer em “Esperando o fornecedor”.</p>
      </div>
    </div>,
    document.body,
  );
}

function Warn({ tone, children }: { tone: "red" | "green"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "mt-3 flex items-start gap-2 rounded-[16px] px-3.5 py-2.5 text-[13px] leading-snug",
        tone === "red" ? "bg-[#2A1A18] text-[#FFC4BA]" : "bg-[#17251C] text-[#B6E7C8]",
      )}
    >
      <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", tone === "red" ? "text-[#FF9A8A]" : "text-[#7FCF9F]")} />
      <span>{children}</span>
    </p>
  );
}


function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="dash-card flex flex-col items-center px-6 py-12 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-[#1F1F1F] text-[#8C8C8C]">{icon}</span>
      <p className="mt-4 text-[19px] font-bold tracking-[-0.02em]">{title}</p>
      <p className="mt-1 max-w-[420px] text-[14px] text-[#8C8C8C]">{children}</p>
    </div>
  );
}

