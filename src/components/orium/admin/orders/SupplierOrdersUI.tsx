/**
 * PEDIDOS AO FORNECEDOR — registro, conferência e problemas.
 *
 * - Cada "Mandei"/"Já pedi" vira um pedido salvo (#número), com os perfumes,
 *   quantidades, custo e a mensagem enviada.
 * - Chegou? "Conferir chegada": item por item, Certo · Faltou · Quebrado ·
 *   Errado. Problema: quantos, observação e o que fazer (esperar o fornecedor
 *   ou pedir de novo). No fim, a reclamação pronta para o WhatsApp.
 * - Problemas em aberto ficam numa lista própria até serem resolvidos.
 * - Histórico pesquisável de tudo o que já foi pedido.
 */
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  ClipboardCheck,
  Hammer,
  Loader2,
  MessageCircle,
  Minus,
  PackageX,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
  Undo2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { checkSupplierOrder, deleteSupplierOrders, resolveSupplierIssue, type SupplierOrder, type SupplierOrderItem } from "@/lib/orders-control.functions";
import { imgVariant } from "@/lib/product-img";
import { todayBR } from "@/lib/delivery";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { burst } from "./model";
import { dayLabel, daysBetween } from "./controls";

type Result = "ok" | "faltou" | "quebrado" | "errado";
const RESULTS: Array<{ v: Result; label: string; icon: typeof Check; tone: string; bg: string }> = [
  { v: "ok", label: "Veio certo", icon: Check, tone: "#15130F", bg: "#7FCF9F" },
  { v: "faltou", label: "Faltou", icon: PackageX, tone: "#15130F", bg: "#FFD599" },
  { v: "quebrado", label: "Quebrado", icon: Hammer, tone: "#15130F", bg: "#FF9A8A" },
  { v: "errado", label: "Veio errado", icon: Shuffle, tone: "#15130F", bg: "#F5C26B" },
];
const RESULT_LABEL: Record<string, string> = { ok: "Veio certo", faltou: "Faltou", quebrado: "Quebrado", errado: "Veio errado" };
const RESOLUTION_LABEL: Record<string, string> = { chegou: "Chegou depois", repedido: "Pedido de novo", reembolso: "Fornecedor devolveu", credito: "Virou crédito" };

const img = (src: string | null) => (src ? (imgVariant(src, "thumb") ?? src) : null);
const waLink = (phone: string, text: string) => `https://wa.me/55${phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "")}?text=${encodeURIComponent(text)}`;
const sentLabel = (iso: string) => {
  const d = daysBetween(iso.slice(0, 10), todayBR());
  return d <= 0 ? "pedido hoje" : d === 1 ? "pedido ontem" : `pedido há ${d} dias`;
};
export const openIssues = (orders: SupplierOrder[] | undefined) =>
  (orders ?? []).flatMap((o) => o.items.filter((i) => i.result && i.result !== "ok" && !i.resolution).map((i) => ({ o, i })));

function Thumb({ src, size = 56 }: { src: string | null; size?: number }) {
  const s = img(src);
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-[14px] bg-white" style={{ width: size, height: size }}>
      {s ? <img src={s} alt="" loading="lazy" className="size-full object-contain p-1" /> : null}
    </span>
  );
}

/* ─────────────── Passo 2: pedidos enviados esperando chegar ─────────────── */

export function WaitingOrderCard({ o, i, onCheck, onOpen }: { o: SupplierOrder; i: number; onCheck: () => void; onOpen: () => void }) {
  const days = daysBetween(o.createdAt.slice(0, 10), todayBR());
  const ask = o.supplierPhone
    ? waLink(o.supplierPhone, `Olá! Tudo bem? Passando para saber do meu pedido #${o.seq} (${o.units} ${o.units === 1 ? "frasco" : "frascos"}) — já foi enviado? Obrigado!`)
    : null;
  return (
    <section className="dash-card adm-rise min-w-0 overflow-hidden" style={{ ["--i" as string]: i + 2 }}>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 p-4 pb-3 text-left lg:p-5 lg:pb-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#262626] text-[13px] font-bold">#{o.seq}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[18px] font-bold tracking-[-0.015em]">{o.supplier}</span>
          <span className="block text-[13px] text-[#8C8C8C]">
            {o.units} {o.units === 1 ? "frasco" : "frascos"} · <b className="text-white tabular-nums">{brl(o.total)}</b> · {o.via === "manual" ? "pedido por fora" : "pelo WhatsApp"}
          </span>
        </span>
        <span className={cn("shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-bold", days >= 3 ? "bg-[#2A2418] text-[#F5C26B]" : "bg-[#262626] text-[#A9A9A9]")}>
          {days >= 3 ? `Esperando há ${days} dias` : sentLabel(o.createdAt)}
        </span>
      </button>
      <ul className="flex flex-wrap gap-1.5 px-4 lg:px-5">
        {o.items.map((it) => (
          <li key={it.id} className="inline-flex items-center gap-2 rounded-full bg-[#1F1F1F] py-1 pr-3 pl-1 text-[12.5px] font-semibold">
            <Thumb src={it.image} size={28} />
            {it.quantity > 1 ? <b className="tabular-nums">{it.quantity}×</b> : null}
            <span className="max-w-[160px] truncate">{productTitle(it.name)}</span>
          </li>
        ))}
      </ul>
      <footer className="mt-4 flex items-center gap-2 border-t border-white/[0.06] p-3 lg:p-4">
        {ask ? (
          <a href={ask} target="_blank" rel="noreferrer" aria-label="Perguntar ao fornecedor" className="press grid size-12 place-items-center rounded-full bg-[#262626] hover:bg-[#2E2E2E]">
            <MessageCircle className="size-[18px]" />
          </a>
        ) : null}
        <button
          type="button"
          onClick={onCheck}
          className="press ml-auto inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white px-5 text-[15px] font-bold whitespace-nowrap text-[#15130F] hover:bg-[#7FCF9F] sm:flex-none"
        >
          <ClipboardCheck className="size-[18px]" /> Chegou · conferir
        </button>
      </footer>
    </section>
  );
}

/* ─────────────── Conferência ─────────────── */

type Draft = { result: Result | null; issueQty: number; note: string; action: "esperar" | "repedir" };

export function CheckSheet({ order, onClose, onDone }: { order: SupplierOrder; onClose: () => void; onDone: () => void }) {
  const check = useServerFn(checkSupplierOrder);
  const pending = order.items.filter((i) => !i.result);
  const [d, setD] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(pending.map((i) => [i.id, { result: null, issueQty: i.quantity, note: "", action: "esperar" }])),
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { problems: Array<{ it: SupplierOrderItem; dr: Draft }> }>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const set = (id: string, p: Partial<Draft>) => setD((s) => ({ ...s, [id]: { ...s[id]!, ...p } }));
  const checked = pending.filter((i) => d[i.id]?.result).length;
  const all = checked === pending.length;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const finish = async () => {
    setBusy(true);
    try {
      await check({
        data: {
          orderId: order.id,
          items: pending.map((i) => ({
            id: i.id,
            result: d[i.id]!.result!,
            issueQty: d[i.id]!.issueQty,
            note: d[i.id]!.note,
            action: d[i.id]!.action,
          })),
        },
      });
      const problems = pending.filter((i) => d[i.id]!.result !== "ok").map((it) => ({ it, dr: d[it.id]! }));
      const r = btn.current?.getBoundingClientRect();
      if (!problems.length && r) burst(r.left + r.width / 2, r.top + r.height / 2, 26);
      toast.success(problems.length ? "Conferência salva com problemas anotados." : "Tudo certo! Pedido conferido.");
      setDone({ problems });
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar a conferência.");
    } finally {
      setBusy(false);
    }
  };

  const complaint = (problems: Array<{ it: SupplierOrderItem; dr: Draft }>) =>
    [
      `Olá! Tudo bem? Recebi o pedido #${order.seq}, mas veio com problema:`,
      "",
      ...problems.map(
        ({ it, dr }) =>
          `• ${productTitle(it.name)}${it.volumeMl ? ` ${it.volumeMl}ml` : ""}: ${RESULT_LABEL[dr.result!]!.toLowerCase()} (${dr.issueQty} ${dr.issueQty === 1 ? "unidade" : "unidades"})${dr.note ? ` — ${dr.note}` : ""}`,
      ),
      "",
      "Como podemos resolver? Obrigado!",
    ].join("\n");

  return createPortal(
    <div className="admin-theme adm-fade fixed inset-0 z-[70] flex items-end justify-center bg-black/70 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Conferir chegada"
        onClick={(e) => e.stopPropagation()}
        className="ord-sheet-up flex max-h-[94dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-[32px] border border-white/[0.07] bg-[#121212] text-white sm:rounded-[32px]"
      >
        <header className="shrink-0 px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] text-[#8C8C8C]">
                Conferir pedido #{order.seq} · {sentLabel(order.createdAt)}
              </p>
              <p className="text-[24px] leading-tight font-bold tracking-[-0.03em]">{order.supplier}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Fechar" className="press grid size-10 place-items-center rounded-full bg-[#1F1F1F]">
              <X className="size-5" />
            </button>
          </div>
          {!done ? (
            <>
              <div className="mt-4 flex items-center justify-between text-[12.5px] font-semibold text-[#8C8C8C]">
                <span>
                  {checked} de {pending.length} conferidos
                </span>
                <button
                  type="button"
                  onClick={() => setD((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, result: "ok" as Result }])))}
                  className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-[#17251C] px-3 text-[12.5px] font-bold text-[#7FCF9F]"
                >
                  <Check className="size-3.5" strokeWidth={3} /> Veio tudo certo
                </button>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#262626]">
                <span className="block h-full rounded-full bg-[#7FCF9F] transition-[width] duration-500" style={{ width: `${(checked / Math.max(1, pending.length)) * 100}%` }} />
              </div>
            </>
          ) : null}
        </header>

        {done ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            <div className="flex flex-col items-center py-6 text-center">
              <span className={cn("ord-ok-ring grid size-20 place-items-center rounded-full", done.problems.length ? "bg-[#2A2418] text-[#FFD599]" : "bg-[#7FCF9F] text-[#15130F]")}>
                {done.problems.length ? <AlertTriangle className="size-9" /> : <Check className="size-10" strokeWidth={2.8} />}
              </span>
              <p className="mt-5 text-[22px] font-bold tracking-[-0.02em]">{done.problems.length ? "Conferido com problema" : "Pedido conferido"}</p>
              <p className="mt-1 max-w-[420px] text-[14px] text-[#8C8C8C]">
                {done.problems.length
                  ? "O que veio certo já está em “Chegou · separar”. Os problemas ficaram anotados em “Problemas” até você resolver."
                  : "Tudo chegou certinho e já está em “Chegou · separar”."}
              </p>
            </div>
            {done.problems.length ? (
              <div className="rounded-[22px] bg-[#1A1A1A] p-4">
                <p className="mb-2 text-[13px] font-bold">Reclamação pronta para o fornecedor</p>
                <pre className="rounded-[16px] bg-[#232323] p-3.5 font-sans text-[13.5px] leading-relaxed whitespace-pre-wrap">{complaint(done.problems)}</pre>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {order.supplierPhone ? (
                    <a
                      href={waLink(order.supplierPhone, complaint(done.problems))}
                      target="_blank"
                      rel="noreferrer"
                      className="press inline-flex h-[52px] items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F]"
                    >
                      <MessageCircle className="size-5" /> Mandar no WhatsApp
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(complaint(done.problems)).catch(() => undefined);
                      toast.success("Reclamação copiada.");
                    }}
                    className="press h-[52px] rounded-full bg-[#262626] text-[15px] font-bold"
                  >
                    Copiar texto
                  </button>
                </div>
              </div>
            ) : null}
            <button type="button" onClick={onClose} className="press mt-4 h-[52px] w-full rounded-full bg-white text-[15px] font-bold text-[#15130F]">
              Pronto
            </button>
          </div>
        ) : (
          <>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-4">
              {pending.map((it, idx) => {
                const dr = d[it.id]!;
                const problem = dr.result && dr.result !== "ok";
                return (
                  <li
                    key={it.id}
                    className={cn("ord-in rounded-[24px] p-3.5 transition-colors duration-300", dr.result === "ok" ? "bg-[#17251C]" : problem ? "bg-[#221A16]" : "bg-[#1A1A1A]")}
                    style={{ ["--i" as string]: idx }}
                  >
                    <div className="flex items-center gap-3">
                      <Thumb src={it.image} />
                      <div className="min-w-0 flex-1">
                        {it.brand ? <p className="truncate text-[12px] text-[#8C8C8C]">{it.brand}</p> : null}
                        <p className="truncate text-[15.5px] font-bold">{productTitle(it.name)}</p>
                        <p className="text-[12.5px] text-[#A9A9A9] tabular-nums">
                          {it.quantity}× {it.volumeMl ? `${it.volumeMl}ml · ` : ""}
                          {brl(it.unitCost)}
                          {it.customers.length ? ` · para ${it.customers.map((c) => c.split(" ")[0]).join(", ")}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-1.5">
                      {RESULTS.map((r) => {
                        const on = dr.result === r.v;
                        return (
                          <button
                            key={r.v}
                            type="button"
                            aria-pressed={on}
                            onClick={() => set(it.id, { result: r.v })}
                            className={cn(
                              "press flex h-[60px] flex-col items-center justify-center gap-1 rounded-[16px] text-[12px] font-bold transition-colors duration-200",
                              on ? "" : "bg-[#262626] text-[#D4D4D4] hover:bg-[#2E2E2E]",
                            )}
                            style={on ? { background: r.bg, color: r.tone } : undefined}
                          >
                            <r.icon className="size-[18px]" strokeWidth={2.4} />
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                    {problem ? (
                      <div className="adm-pop mt-3 space-y-2.5">
                        {it.quantity > 1 ? (
                          <div className="flex items-center justify-between rounded-[16px] bg-[#1A1A1A] px-3.5 py-2">
                            <span className="text-[13.5px] font-semibold">Quantos com problema?</span>
                            <span className="flex items-center gap-1">
                              <button type="button" onClick={() => set(it.id, { issueQty: Math.max(1, dr.issueQty - 1) })} className="press grid size-9 place-items-center rounded-full bg-[#262626]" aria-label="Menos">
                                <Minus className="size-4" />
                              </button>
                              <span className="w-8 text-center text-[16px] font-bold tabular-nums">{dr.issueQty}</span>
                              <button type="button" onClick={() => set(it.id, { issueQty: Math.min(it.quantity, dr.issueQty + 1) })} className="press grid size-9 place-items-center rounded-full bg-[#262626]" aria-label="Mais">
                                <Plus className="size-4" />
                              </button>
                            </span>
                          </div>
                        ) : null}
                        <input
                          data-slot="input-group-control"
                          value={dr.note}
                          onChange={(e) => set(it.id, { note: e.target.value })}
                          placeholder={dr.result === "errado" ? "O que veio no lugar?" : dr.result === "quebrado" ? "O que aconteceu? (ex.: tampa quebrada, vazou)" : "Observação (opcional)"}
                          className="h-12 w-full rounded-full bg-[#1A1A1A] px-4 text-[14.5px] outline-none transition-colors placeholder:text-[#6F6F6F] focus:bg-[#242424]"
                        />
                        <div className="grid grid-cols-2 gap-1.5">
                          {(
                            [
                              { v: "esperar", label: "Esperar o fornecedor", hint: "reenviar ou devolver" },
                              { v: "repedir", label: "Pedir de novo agora", hint: "volta para o Passo 1" },
                            ] as const
                          ).map((a) => (
                            <button
                              key={a.v}
                              type="button"
                              aria-pressed={dr.action === a.v}
                              onClick={() => set(it.id, { action: a.v })}
                              className={cn(
                                "press flex flex-col items-start rounded-[16px] px-3.5 py-2.5 text-left transition-colors",
                                dr.action === a.v ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] hover:bg-[#232323]",
                              )}
                            >
                              <span className="text-[13.5px] font-bold">{a.label}</span>
                              <span className={cn("text-[11.5px]", dr.action === a.v ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>{a.hint}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <footer className="shrink-0 border-t border-white/[0.06] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                ref={btn}
                type="button"
                disabled={!all || busy}
                onClick={finish}
                className={cn(
                  "press flex h-[56px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-bold transition-colors duration-300",
                  all ? "bg-[#FFD599] text-[#15130F] hover:bg-[#FFDDAA]" : "bg-[#262626] text-[#8C8C8C]",
                )}
              >
                {busy ? <Loader2 className="size-5 animate-spin" /> : <ClipboardCheck className="size-5" />}
                {all ? "Finalizar conferência" : `Falta conferir ${pending.length - checked}`}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ─────────────── Problemas em aberto ─────────────── */

export function ProblemsView({ orders, onChanged }: { orders: SupplierOrder[] | undefined; onChanged: () => void }) {
  const list = openIssues(orders);
  const resolve = useServerFn(resolveSupplierIssue);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, resolution: "chegou" | "repedido" | "reembolso" | "credito", e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setBusy(id);
    try {
      await resolve({ data: { itemId: id, resolution } });
      if (resolution === "chegou") burst(r.left + r.width / 2, r.top + r.height / 2, 16);
      toast.success(
        resolution === "chegou"
          ? "Resolvido: chegou."
          : resolution === "repedido"
            ? "Voltou para “Pedir ao fornecedor”."
            : `Anotado (${RESOLUTION_LABEL[resolution]!.toLowerCase()}). O perfume voltou para “Pedir ao fornecedor”.`,
      );
      onChanged();
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível resolver.");
    } finally {
      setBusy(null);
    }
  };
  if (!list.length)
    return (
      <div className="dash-card flex flex-col items-center px-6 py-12 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-[#17251C] text-[#7FCF9F]">
          <Check className="size-7" strokeWidth={2.6} />
        </span>
        <p className="mt-4 text-[19px] font-bold tracking-[-0.02em]">Nenhum problema em aberto</p>
        <p className="mt-1 max-w-[420px] text-[14px] text-[#8C8C8C]">Quando faltar ou vier algo quebrado/errado na conferência, fica aqui até resolver.</p>
      </div>
    );
  return (
    <ul className="grid gap-3 xl:grid-cols-2">
      {list.map(({ o, i }, idx) => {
        const r = RESULTS.find((x) => x.v === i.result)!;
        const msg = `Olá! Sobre o pedido #${o.seq}: ${productTitle(i.name)} ${RESULT_LABEL[i.result!]!.toLowerCase()} (${i.issueQty} ${i.issueQty === 1 ? "unidade" : "unidades"})${i.issueNote ? ` — ${i.issueNote}` : ""}. Conseguimos resolver? Obrigado!`;
        return (
          <li key={i.id} className="dash-card ord-in p-4" style={{ ["--i" as string]: idx }}>
            <div className="flex items-start gap-3">
              <Thumb src={i.image} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15.5px] font-bold">{productTitle(i.name)}</p>
                <p className="text-[12.5px] text-[#8C8C8C]">
                  {o.supplier} · pedido #{o.seq} · {dayLabel(o.createdAt.slice(0, 10)).toLowerCase()}
                </p>
                <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold text-[#15130F]" style={{ background: r.bg }}>
                  <r.icon className="size-3.5" /> {r.label} · {i.issueQty} {i.issueQty === 1 ? "un." : "un."} · {brl(i.unitCost * i.issueQty)}
                </span>
                {i.issueNote ? <p className="mt-1.5 text-[13px] text-[#D4D4D4]">“{i.issueNote}”</p> : null}
                {i.customers.length ? <p className="mt-1 text-[12.5px] text-[#FF9A8A]">Cliente esperando: {i.customers.join(", ")}</p> : null}
              </div>
              {o.supplierPhone ? (
                <a href={waLink(o.supplierPhone, msg)} target="_blank" rel="noreferrer" aria-label="Cobrar o fornecedor" className="press grid size-10 shrink-0 place-items-center rounded-full bg-[#262626]">
                  <MessageCircle className="size-[17px]" />
                </a>
              ) : null}
            </div>
            <p className="mt-3 mb-2 px-1 text-[12.5px] font-semibold text-[#8C8C8C]">Como foi resolvido?</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {(
                [
                  { v: "chegou", label: "Chegou", icon: Check },
                  { v: "reembolso", label: "Devolveu o $", icon: Undo2 },
                  { v: "credito", label: "Virou crédito", icon: Wallet },
                  { v: "repedido", label: "Pedir de novo", icon: RefreshCw },
                ] as const
              ).map((b) => (
                <button
                  key={b.v}
                  type="button"
                  disabled={busy === i.id}
                  onClick={(e) => act(i.id, b.v, e)}
                  className={cn(
                    "press flex h-[54px] flex-col items-center justify-center gap-0.5 rounded-[16px] text-[12px] font-bold transition-colors disabled:opacity-50",
                    b.v === "chegou" ? "bg-[#7FCF9F] text-[#15130F]" : "bg-[#262626] hover:bg-[#2E2E2E]",
                  )}
                >
                  {busy === i.id ? <Loader2 className="size-4 animate-spin" /> : <b.icon className="size-4" />}
                  {b.label}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ─────────────── Histórico ─────────────── */

const STATUS: Record<SupplierOrder["status"], { label: string; cls: string }> = {
  enviado: { label: "Esperando chegar", cls: "bg-[#262626] text-[#D4D4D4]" },
  conferido: { label: "Conferido", cls: "bg-[#17251C] text-[#7FCF9F]" },
  com_problema: { label: "Com problema", cls: "bg-[#2A1A18] text-[#FF9A8A]" },
  cancelado: { label: "Cancelado", cls: "bg-[#262626] text-[#8C8C8C]" },
};

export function HistoryView({
  orders,
  onOpen,
  onCheck,
  onDeleted,
}: {
  orders: SupplierOrder[] | undefined;
  onOpen: (o: SupplierOrder) => void;
  onCheck: (o: SupplierOrder) => void;
  onDeleted: () => void;
}) {
  const [q, setQ] = useState("");
  const [f, setF] = useState<"todos" | SupplierOrder["status"]>("todos");
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const list = useMemo(() => {
    const t = norm(q.trim());
    return (orders ?? []).filter(
      (o) =>
        (f === "todos" || o.status === f) &&
        (!t || norm(`${o.supplier} #${o.seq} ${o.items.map((i) => `${i.name} ${i.brand ?? ""} ${i.customers.join(" ")}`).join(" ")}`).includes(t)),
    );
  }, [orders, q, f]);
  const total = list.reduce((s, o) => s + o.total, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-[52px] min-w-0 flex-1 basis-[260px] items-center gap-3 rounded-full bg-[#1A1A1A] px-5 transition-colors focus-within:bg-[#212121]">
          <Search className="size-[18px] shrink-0 text-[#8C8C8C]" />
          <input
            data-slot="input-group-control"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Procurar perfume, fornecedor, cliente ou nº"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#6F6F6F]"
          />
        </label>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
          {(["todos", "enviado", "com_problema", "conferido"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={f === k}
              onClick={() => setF(k)}
              className={cn("press h-10 shrink-0 rounded-full px-4 text-[13.5px] font-semibold transition-colors", f === k ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white")}
            >
              {k === "todos" ? "Todos" : STATUS[k].label}
            </button>
          ))}
        </div>
      </div>
      <p className="px-1 text-[13px] text-[#8C8C8C]">
        {groupByDay(list).length} {groupByDay(list).length === 1 ? "dia de pedido" : "dias de pedido"} · {list.length} {list.length === 1 ? "fornecedor" : "fornecedores"} · {brl(total)}
      </p>
      {list.length === 0 ? (
        <div className="dash-card px-6 py-10 text-center text-[14.5px] text-[#8C8C8C]">{orders?.length ? "Nada encontrado." : "Os pedidos que você mandar aos fornecedores ficam guardados aqui."}</div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2 xl:gap-4">
          {groupByDay(list).map(([day, group], i) => (
            <DayOrderCard key={day} day={day} orders={group} i={i} onCheck={onCheck} onOpen={onOpen} onDeleted={onDeleted} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Detalhe de um pedido ao fornecedor (consulta). */
export function OrderSheet({ o, onClose, onCheck }: { o: SupplierOrder; onClose: () => void; onCheck: () => void }) {
  const pending = o.items.some((i) => !i.result);
  return createPortal(
    <div className="admin-theme adm-fade fixed inset-0 z-[70] flex items-end justify-center bg-black/70 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Pedido ${o.seq}`}
        onClick={(e) => e.stopPropagation()}
        className="ord-sheet-up flex max-h-[94dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-[32px] border border-white/[0.07] bg-[#121212] text-white sm:rounded-[32px]"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div>
            <p className="text-[13px] text-[#8C8C8C]">
              Pedido #{o.seq} · {new Date(o.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })}
            </p>
            <p className="text-[24px] leading-tight font-bold tracking-[-0.03em]">{o.supplier}</p>
            <span className={cn("mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-bold", STATUS[o.status].cls)}>{STATUS[o.status].label}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="press grid size-10 place-items-center rounded-full bg-[#1F1F1F]">
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
          {o.items.map((it) => {
            const r = it.result ? RESULTS.find((x) => x.v === it.result) : null;
            return (
              <div key={it.id} className="flex items-center gap-3 rounded-[20px] bg-[#1A1A1A] p-3">
                <Thumb src={it.image} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold">{productTitle(it.name)}</p>
                  <p className="text-[12.5px] text-[#A9A9A9] tabular-nums">
                    {it.quantity}× {brl(it.unitCost)}
                    {it.customers.length ? ` · ${it.customers.map((c) => c.split(" ")[0]).join(", ")}` : ""}
                  </p>
                  {r && it.result !== "ok" ? (
                    <p className="mt-1 text-[12.5px] font-semibold" style={{ color: r.bg }}>
                      {r.label} ({it.issueQty}){it.issueNote ? ` · ${it.issueNote}` : ""}
                      {it.resolution ? <span className="text-[#7FCF9F]"> · {RESOLUTION_LABEL[it.resolution]}</span> : <span className="text-[#FF9A8A]"> · em aberto</span>}
                    </p>
                  ) : null}
                </div>
                <span
                  className={cn("grid size-8 shrink-0 place-items-center rounded-full", !r ? "bg-[#262626] text-[#6F6F6F]" : "")}
                  style={r ? { background: r.bg, color: "#15130F" } : undefined}
                  title={r ? r.label : "Não conferido"}
                >
                  {r ? <r.icon className="size-4" /> : <Ban className="size-4" />}
                </span>
              </div>
            );
          })}
          <div className="flex items-baseline justify-between rounded-[18px] bg-[#1A1A1A] px-4 py-3">
            <span className="text-[14px] text-[#A9A9A9]">
              {o.units} {o.units === 1 ? "frasco" : "frascos"} · {o.via === "manual" ? "pedido por fora" : "pelo WhatsApp"}
            </span>
            <span className="text-[20px] font-bold tabular-nums">{brl(o.total)}</span>
          </div>
          {o.message ? (
            <details className="rounded-[18px] bg-[#1A1A1A] px-4 py-3">
              <summary className="cursor-pointer text-[13.5px] font-bold">Mensagem enviada</summary>
              <pre className="mt-2 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-[#D4D4D4]">{o.message}</pre>
            </details>
          ) : null}
        </div>
        {pending ? (
          <footer className="shrink-0 border-t border-white/[0.06] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={onCheck} className="press flex h-[54px] w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-bold text-[#15130F]">
              <ClipboardCheck className="size-5" /> Chegou · conferir <ArrowRight className="size-4" />
            </button>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-[#262626] px-2 py-0.5 text-[11px] font-bold">{children}</span>;
}

/* ─────────────── Pedido do dia (vários fornecedores, uma "rodada") ─────────────── */

/** Dia (AAAA-MM-DD, horário de Brasília) em que o pedido ao fornecedor foi feito. */
export const orderDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** "Pedido de hoje" · "Pedido de ontem" · "Pedido de sexta, 14/11". */
export function dayTitle(ymd: string) {
  const diff = daysBetween(ymd, todayBR());
  if (diff === 0) return "Pedido de hoje";
  if (diff === 1) return "Pedido de ontem";
  const wd = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`)).replace("-feira", "");
  return `Pedido de ${wd}, ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
}

/** Agrupa pedidos ao fornecedor por dia (mais recente primeiro). */
export function groupByDay(orders: SupplierOrder[]) {
  const m = new Map<string, SupplierOrder[]>();
  orders.forEach((o) => m.set(orderDay(o.createdAt), [...(m.get(orderDay(o.createdAt)) ?? []), o]));
  return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/**
 * Um cartão por dia: todos os fornecedores daquele pedido como "paradas"
 * (1, 2, 3…), como a corrida do motoboy que passa em cada um. Cada parada
 * mostra os perfumes, o status, conferir a chegada ou excluir (teste/engano).
 */
export function DayOrderCard({
  day,
  orders,
  i,
  onCheck,
  onOpen,
  onDeleted,
}: {
  day: string;
  orders: SupplierOrder[];
  i: number;
  onCheck: (o: SupplierOrder) => void;
  onOpen: (o: SupplierOrder) => void;
  onDeleted: () => void;
}) {
  const del = useServerFn(deleteSupplierOrders);
  const [ask, setAsk] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const units = orders.reduce((s, o) => s + o.units, 0);
  const total = orders.reduce((s, o) => s + o.total, 0);
  const arrived = orders.filter((o) => o.status !== "enviado").length;
  const customers = [...new Set(orders.flatMap((o) => o.items.flatMap((it) => it.customers)))].map((c) => c.split(" ")[0]);
  const age = daysBetween(day, todayBR());

  const remove = async () => {
    if (!ask || busy) return;
    setBusy(true);
    try {
      const r = await del({ data: { ids: ask } });
      toast.success(`${r.deleted === 1 ? "Pedido excluído" : `${r.deleted} pedidos excluídos`}. Os perfumes voltaram para “Pedir ao fornecedor”.`);
      setAsk(null);
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível excluir.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dash-card adm-rise min-w-0 overflow-hidden" style={{ ["--i" as string]: i + 2 }} aria-label={dayTitle(day)}>
      <header className="flex flex-wrap items-start gap-3 p-4 pb-2 lg:p-5 lg:pb-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-[16px] bg-[#FFD599] text-[#15130F]">
          <span className="text-center leading-none">
            <span className="block text-[18px] font-bold tabular-nums">{day.slice(8, 10)}</span>
            <span className="block text-[10px] font-bold uppercase">{new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)).replace(".", "")}</span>
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[18px] leading-tight font-bold tracking-[-0.02em]">{dayTitle(day)}</h3>
          <p className="text-[13px] text-[#8C8C8C]">
            {orders.length} {orders.length === 1 ? "fornecedor" : "fornecedores"} · {units} {units === 1 ? "frasco" : "frascos"} · <b className="text-white tabular-nums">{brl(total)}</b>
          </p>
          {customers.length ? (
            <p className="mt-0.5 truncate text-[12.5px] text-[#A9A9A9]">
              Para {customers.slice(0, 4).join(", ")}
              {customers.length > 4 ? ` +${customers.length - 4}` : ""}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-bold",
            arrived === orders.length ? "bg-[#17251C] text-[#7FCF9F]" : age >= 3 ? "bg-[#2A2418] text-[#F5C26B]" : "bg-[#262626] text-[#A9A9A9]",
          )}
        >
          {arrived === orders.length ? "Tudo chegou" : arrived ? `${arrived} de ${orders.length} chegaram` : age >= 3 ? `Esperando há ${age} dias` : "Esperando chegar"}
        </span>
      </header>

      <ol className="relative space-y-1.5 px-3 pb-3 lg:px-4 lg:pb-4">
        {orders.map((o, n) => {
          const done = o.status !== "enviado";
          const askLink = o.supplierPhone && !done
            ? waLink(o.supplierPhone, `Olá! Tudo bem? Passando para saber do meu pedido de ${dayTitle(day).replace("Pedido de ", "").toLowerCase()} (${o.units} ${o.units === 1 ? "frasco" : "frascos"}) — já saiu? Obrigado!`)
            : null;
          return (
            <li key={o.id} className="relative flex gap-3 rounded-[20px] bg-[#202020] p-3">
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-bold", done ? "bg-[#7FCF9F] text-[#15130F]" : "bg-[#2E2E2E] text-white")}>
                {done ? <Check className="size-4" strokeWidth={3} /> : n + 1}
              </span>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onOpen(o)} className="flex w-full min-w-0 items-center gap-2 text-left">
                  <span className="truncate text-[15px] font-bold">{o.supplier}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", STATUS[o.status].cls)}>{STATUS[o.status].label}</span>
                  <span className="ml-auto shrink-0 text-[13px] font-semibold tabular-nums">{brl(o.total)}</span>
                </button>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {o.items.map((it) => (
                    <li key={it.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-[#2A2A2A] py-1 pr-3 pl-1 text-[12px] font-semibold">
                      <Thumb src={it.image} size={24} />
                      {it.quantity > 1 ? <b className="tabular-nums">{it.quantity}×</b> : null}
                      <span className="max-w-[150px] truncate">{productTitle(it.name)}</span>
                      {it.customers.length ? <span className="text-[#8C8C8C]">· {it.customers.map((c) => c.split(" ")[0]).join(", ")}</span> : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {!done ? (
                    <button
                      type="button"
                      onClick={() => onCheck(o)}
                      className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-bold text-[#15130F] hover:bg-[#7FCF9F]"
                    >
                      <ClipboardCheck className="size-4" /> Chegou · conferir
                    </button>
                  ) : null}
                  {askLink ? (
                    <a href={askLink} target="_blank" rel="noreferrer" className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[#2A2A2A] px-3.5 text-[13px] font-bold hover:bg-[#333]">
                      <MessageCircle className="size-4" /> Perguntar
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setAsk([o.id])}
                    aria-label={`Excluir pedido de ${o.supplier}`}
                    className="press ml-auto grid size-9 place-items-center rounded-full text-[#8C8C8C] hover:bg-[#2A1A18] hover:text-[#FF9A8A]"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {orders.length > 1 ? (
        <footer className="flex justify-end border-t border-white/[0.06] px-4 py-2">
          <button type="button" onClick={() => setAsk(orders.map((o) => o.id))} className="press inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-[#8C8C8C] hover:text-[#FF9A8A]">
            <Trash2 className="size-3.5" /> Excluir o pedido do dia inteiro
          </button>
        </footer>
      ) : null}

      {ask ? (
        <div className="adm-pop mx-3 mb-3 rounded-[20px] bg-[#2A1A18] p-3.5 lg:mx-4 lg:mb-4">
          <p className="text-[14px] font-bold text-[#FF9A8A]">
            Excluir {ask.length === 1 ? `o pedido de ${orders.find((o) => o.id === ask[0])?.supplier ?? "fornecedor"}` : `os ${ask.length} pedidos deste dia`}?
          </p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-[#D4D4D4]">Use para teste ou engano. Os perfumes voltam para “Pedir ao fornecedor” e os clientes continuam com o pedido deles.</p>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={() => setAsk(null)} className="press h-10 rounded-full bg-[#15130F] px-4 text-[13px] font-bold text-white">
              Cancelar
            </button>
            <button type="button" disabled={busy} onClick={remove} className="press flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#FF9A8A] text-[13px] font-bold text-[#15130F] disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Sim, excluir
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
