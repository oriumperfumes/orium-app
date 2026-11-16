/**
 * FASE DO PEDIDO — em que ponto está, dita em português claro.
 *
 * Esperando pagamento → Pedir no fornecedor → Vindo do fornecedor →
 * Pronto para entregar → Entregue.
 *
 * A fase vem de `journeyOf` (mesma regra do painel), e cada etapa também
 * tem seu próprio estado (feito / agora / falta), para o Admin bater o olho
 * num pedido e saber: "já pedi? já está vindo? posso entregar?".
 * Os dados de fornecedor vêm da mesma consulta da aba Compras
 * (["purchase-board"]), então não há nenhuma busca nova.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Check, CircleDollarSign, Loader2, PackageCheck, ShoppingCart, Sparkles, Truck, Undo2, type LucideIcon } from "lucide-react";
import { rewindOrder } from "@/lib/orders.functions";
import { paymentInfo } from "@/components/orium/admin/OrderPayment";
import { purchaseBoard, type PurchaseItem } from "@/lib/orders-control.functions";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isLivePurchase } from "./model";
import { dayLabel } from "./controls";
import { buyByOrder, journeyOf, type Journey } from "./OrdersDashboard";

export type SupplyLine = {
  /** restock_item (linha da lista de compras) */
  itemId: string;
  productId: string | null;
  name: string;
  quantity: number;
  status: "comprar" | "chegando" | "chegou";
  supplier: string | null;
  purchasedAt: string | null;
  plannedDate: string | null;
};

/** Perfumes de cada pedido do cliente que passam pelo fornecedor. */
export function supplyByOrder(items: PurchaseItem[] | undefined) {
  const m = new Map<string, SupplyLine[]>();
  (items ?? []).forEach((p) => {
    if (!isLivePurchase(p)) return;
    const status = p.status === "a comprar" ? "comprar" : p.status === "pedido feito" ? "chegando" : p.status === "recebido" ? "chegou" : null;
    if (!status) return;
    p.sources.forEach((s) => {
      m.set(s.orderId, [
        ...(m.get(s.orderId) ?? []),
        { itemId: p.id, productId: p.productId, name: p.name, quantity: s.quantity, status, supplier: p.supplier, purchasedAt: p.purchasedAt, plannedDate: p.plannedDate },
      ]);
    });
  });
  return m;
}

/** Lê a lista de compras já carregada (mesma chave da aba Compras). */
export function usePurchaseBoard() {
  const load = useServerFn(purchaseBoard);
  return useQuery({ queryKey: ["purchase-board"], queryFn: () => load(), staleTime: 20_000 });
}

type PhaseMeta = { title: string; short: string; icon: LucideIcon; chip: string; dot: string };
export const PHASE: Record<Journey, PhaseMeta> = {
  pagamento: { title: "Esperando pagamento", short: "Pagamento", icon: CircleDollarSign, chip: "bg-[#262626] text-[#D4D4D4]", dot: "#D4D4D4" },
  comprar: { title: "Falta pedir no fornecedor", short: "Fornecedor", icon: ShoppingCart, chip: "bg-[#2A1A18] text-[#FF9A8A]", dot: "#FF9A8A" },
  chegando: { title: "Vindo do fornecedor", short: "A caminho", icon: Truck, chip: "bg-[#2A2418] text-[#FFD599]", dot: "#FFD599" },
  entregar: { title: "Pronto para entregar", short: "Pronto", icon: PackageCheck, chip: "bg-white text-[#15130F]", dot: "#FFFFFF" },
  entregue: { title: "Entregue", short: "Entregue", icon: Sparkles, chip: "bg-[#1C2A21] text-[#7FCF9F]", dot: "#7FCF9F" },
};
const ORDER: Journey[] = ["pagamento", "comprar", "chegando", "entregar", "entregue"];

export type PhaseInfo = {
  key: Journey;
  /** frase curta e direta para o Admin (e para responder ao cliente) */
  sentence: string;
  steps: Array<{ key: Journey; label: string; state: "done" | "now" | "todo" }>;
  supply: SupplyLine[];
};

export function phaseOf(o: any, items: PurchaseItem[] | undefined, supplyMap?: Map<string, SupplyLine[]>): PhaseInfo | null {
  const key = journeyOf(o, buyByOrder(items));
  if (!key) return null;
  const supply = (supplyMap ?? supplyByOrder(items)).get(o.id) ?? [];
  const toBuy = supply.filter((s) => s.status === "comprar");
  const coming = supply.filter((s) => s.status === "chegando");
  const pay = paymentInfo(o);
  const delivered = o.status === "entregue";

  const n = (list: SupplyLine[]) => list.reduce((s, x) => s + x.quantity, 0);
  const when = (iso: string | null) => (iso ? dayLabel(String(iso).slice(0, 10)).toLowerCase() : null);
  const sentence = delivered
    ? pay.due > 0
      ? `Entregue. Ainda falta receber ${brl(pay.due)}.`
      : "Entregue e pago. Pedido concluído."
    : key === "pagamento"
      ? toBuy.length
        ? `O cliente ainda não pagou e ${n(toBuy) === 1 ? "o perfume ainda não foi pedido" : `${n(toBuy)} perfumes ainda não foram pedidos`} no fornecedor.`
        : coming.length
          ? "O cliente ainda não pagou. O perfume já está vindo do fornecedor."
          : "O cliente ainda não pagou. O perfume já está com você."
      : key === "comprar"
        ? `Você ainda não pediu ${n(toBuy) === 1 ? "1 perfume" : `${n(toBuy)} perfumes`} no fornecedor${toBuy[0]?.plannedDate ? ` (combinado: ${when(toBuy[0].plannedDate)})` : ""}.`
        : key === "chegando"
          ? `Já foi pedido${coming[0]?.supplier ? ` na ${coming[0].supplier}` : " no fornecedor"}${coming[0]?.purchasedAt ? ` ${when(coming[0].purchasedAt)}` : ""}. Está vindo para entregar.`
          : pay.due > 0
            ? `Está tudo com você. Pode entregar e receber ${brl(pay.due)}.`
            : "Está tudo com você e já foi pago. Pode entregar.";

  const idx = ORDER.indexOf(key);
  const stepState = (k: Journey, i: number): "done" | "now" | "todo" => {
    if (k === key) return "now";
    if (delivered) return "done";
    if (k === "pagamento") return pay.paid > 0 ? "done" : "todo";
    if (k === "comprar") return toBuy.length ? "todo" : "done";
    if (k === "chegando") return toBuy.length || coming.length ? "todo" : "done";
    if (k === "entregar") return toBuy.length || coming.length ? "todo" : "done";
    return i < idx ? "done" : "todo";
  };
  return { key, sentence, supply, steps: ORDER.map((k, i) => ({ key: k, label: PHASE[k].short, state: stepState(k, i) })) };
}

/** Selo pequeno com a fase (cartões e listas). */
export function PhaseChip({ phase, className }: { phase: Journey; className?: string }) {
  const m = PHASE[phase];
  return (
    <span className={cn("inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold whitespace-nowrap", m.chip, className)}>
      <m.icon className="size-3.5 shrink-0" strokeWidth={2.4} />
      <span className="truncate">{m.title}</span>
    </span>
  );
}

/** Faixa de 5 pedaços: quanto do caminho o pedido já andou. */
export function PhaseBar({ info, className }: { info: PhaseInfo; className?: string }) {
  return (
    <span className={cn("flex gap-1", className)} aria-hidden>
      {info.steps.map((s) => (
        <span
          key={s.key}
          className={cn("h-1.5 flex-1 rounded-full transition-colors duration-500", s.state === "todo" && "bg-[#2E2E2E]", s.state === "done" && "bg-[#FFD599]/55")}
          style={s.state === "now" ? { background: PHASE[info.key].dot } : undefined}
        />
      ))}
    </span>
  );
}

/** Bloco grande do painel do pedido: fase, frase e as 5 etapas. */
export function PhaseTrack({ info }: { info: PhaseInfo }) {
  const m = PHASE[info.key];
  return (
    <div>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-full", m.chip)}>
          <m.icon className="size-[22px]" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-[#8C8C8C]">Agora o pedido está em</p>
          <p className="text-[21px] leading-tight font-bold tracking-[-0.025em]">{m.title}</p>
        </div>
      </div>
      <p className="mt-3 text-[14.5px] leading-snug text-[#D4D4D4]">{info.sentence}</p>
      <ol className="mt-4 grid grid-cols-5 gap-1.5" aria-label="Etapas do pedido">
        {info.steps.map((s, i) => (
          <li key={s.key} className="min-w-0" aria-current={s.state === "now" ? "step" : undefined}>
            <span className="ord-step block h-1.5 overflow-hidden rounded-full bg-[#2E2E2E]">
              <i
                className={cn("block h-full rounded-full", s.state === "done" && "bg-[#FFD599]/60")}
                style={{ width: s.state === "todo" ? "0%" : "100%", background: s.state === "now" ? PHASE[s.key].dot : undefined, transitionDelay: `${i * 90}ms` }}
              />
            </span>
            <span
              className={cn(
                "mt-2 flex items-center gap-1 truncate text-[11.5px] font-semibold",
                s.state === "todo" ? "text-[#6F6F6F]" : s.state === "now" ? "text-white" : "text-[#A9A9A9]",
              )}
            >
              {s.state === "done" ? <Check className="size-3 shrink-0 text-[#FFD599]" strokeWidth={3} /> : null}
              {s.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Situação de um item do pedido no fornecedor (painel do pedido). */
export function SupplyChip({ line }: { line: SupplyLine | undefined }) {
  if (!line) return <span className="rounded-full bg-[#1C2A21] px-2 py-px text-[11px] font-bold whitespace-nowrap text-[#7FCF9F]">Com você</span>;
  if (line.status === "comprar")
    return <span className="rounded-full bg-[#2A1A18] px-2 py-px text-[11px] font-bold whitespace-nowrap text-[#FF9A8A]">Falta pedir</span>;
  if (line.status === "chegando")
    return (
      <span className="rounded-full bg-[#2A2418] px-2 py-px text-[11px] font-bold whitespace-nowrap text-[#FFD599]">
        Vindo{line.purchasedAt ? ` · pedido ${dayLabel(String(line.purchasedAt).slice(0, 10)).toLowerCase()}` : ""}
      </span>
    );
  return <span className="rounded-full bg-[#1C2A21] px-2 py-px text-[11px] font-bold whitespace-nowrap text-[#7FCF9F]">Chegou</span>;
}

/* ─────────────── voltar etapa ─────────────── */

/**
 * "Cliquei sem querer": volta o pedido para uma etapa anterior.
 * Desfazer entrega → Pronto. Ou voltar para "Falta pedir no fornecedor":
 * os perfumes voltam para Compras e o histórico dessas etapas é apagado.
 */
export function RewindControl({ order, info, onDone }: { order: any; info: PhaseInfo; onDone: () => void }) {
  const run = useServerFn(rewindOrder);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<"pronto" | "fornecedor" | null>(null);
  const [busy, setBusy] = useState(false);
  const delivered = order.status === "entregue";
  const canSupply = delivered || info.key === "chegando" || info.key === "entregar" || info.supply.some((s) => s.status !== "comprar");
  const opts: Array<{ to: "pronto" | "fornecedor"; title: string; text: string }> = [];
  if (delivered) opts.push({ to: "pronto", title: "Desfazer entrega", text: "Volta para “Pronto para entregar”." });
  if (canSupply)
    opts.push({
      to: "fornecedor",
      title: "Voltar para “Falta pedir no fornecedor”",
      text: "Os perfumes voltam para Compras, saem do pedido ao fornecedor e o histórico dessas etapas é apagado. O pagamento continua igual.",
    });
  if (!opts.length) return null;
  const only = opts.length === 1 ? opts[0]!.to : null;

  const go = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      await run({ data: { orderId: order.id, to: pick } });
      toast.success(pick === "pronto" ? "Entrega desfeita. O pedido voltou para Pronto." : "Pronto! O pedido voltou para “Falta pedir no fornecedor” e os perfumes estão em Compras.");
      setOpen(false);
      setPick(null);
      qc.invalidateQueries({ queryKey: ["order-events", order.id] });
      qc.invalidateQueries({ queryKey: ["supplier-orders"] });
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível voltar a etapa.");
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button type="button" onClick={() => (setOpen(true), setPick(only))} className="press mt-3 inline-flex h-9 items-center gap-1.5 rounded-full px-1 text-[13px] font-semibold text-[#8C8C8C] hover:text-white">
        <Undo2 className="size-4" /> Voltar etapa
      </button>
    );

  return (
    <div className="adm-pop mt-3 rounded-[20px] bg-[#161616] p-2.5 ring-1 ring-white/[0.06]">
      <p className="px-1.5 pt-0.5 pb-2 text-[13px] font-semibold text-[#A9A9A9]">Para onde o pedido volta?</p>
      <div className="space-y-1.5">
        {opts.map((op) => {
          const on = pick === op.to;
          return (
            <button
              key={op.to}
              type="button"
              aria-pressed={on}
              onClick={() => setPick(op.to)}
              className={cn("press block w-full rounded-[16px] p-3 text-left transition-colors", on ? "bg-white text-[#15130F]" : "bg-[#202020] hover:bg-[#262626]")}
            >
              <span className="block text-[14px] font-bold">{op.title}</span>
              <span className={cn("mt-0.5 block text-[12.5px] leading-snug", on ? "text-[#15130F]/65" : "text-[#8C8C8C]")}>{op.text}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={() => (setOpen(false), setPick(null))} className="press h-11 rounded-full bg-[#202020] px-4 text-[13.5px] font-bold text-[#A9A9A9]">
          Cancelar
        </button>
        <button
          type="button"
          disabled={!pick || busy}
          onClick={go}
          className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-white text-[13.5px] font-bold text-[#15130F] disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />} Sim, voltar
        </button>
      </div>
    </div>
  );
}
