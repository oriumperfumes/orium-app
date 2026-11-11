/**
 * COMPRAS — o que pedir para cada fornecedor.
 *
 * A comprar (por fornecedor): fotos, quantidade, custo, para quais clientes
 * (com o pagamento de cada um), dia agendado da compra.
 * Comprados: esperando chegar → "Chegou".
 * Proteções: "Comprei" só vale para o que ainda está a comprar (nunca em
 * dobro), a confirmação mostra o total e avisa de cliente que ainda não pagou
 * e de fornecedor mais barato; "Desfazer" se clicou errado.
 */
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CalendarClock, Check, ClipboardCopy, Loader2, PackageCheck, RotateCcw, ShoppingCart, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { markPurchased, markReceived, schedulePurchase, undoPurchased, type PurchaseItem } from "@/lib/orders-control.functions";
import { imgVariant } from "@/lib/product-img";
import { todayBR } from "@/lib/delivery";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { burst } from "./model";
import { DateChips, dayLabel } from "./controls";

type Group = { supplier: string; items: PurchaseItem[] };

const groupBy = (items: PurchaseItem[]): Group[] => {
  const m = new Map<string, PurchaseItem[]>();
  items.forEach((p) => m.set(p.supplier ?? "Sem fornecedor", [...(m.get(p.supplier ?? "Sem fornecedor") ?? []), p]));
  return [...m.entries()].map(([supplier, items]) => ({ supplier, items })).sort((a, b) => cost(b.items) - cost(a.items));
};
const cost = (items: PurchaseItem[]) => items.reduce((s, p) => s + (p.unitCost + p.extraFee) * p.quantity, 0);
const units = (items: PurchaseItem[]) => items.reduce((s, p) => s + p.quantity, 0);
const unpaidFor = (p: PurchaseItem) => p.sources.filter((s) => s.paid <= 0 && s.status !== "cancelado");

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
  const toBuy = useMemo(() => groupBy((items ?? []).filter((p) => p.status === "a comprar")), [items]);
  const bought = useMemo(() => groupBy((items ?? []).filter((p) => p.status === "pedido feito")), [items]);
  const received = (items ?? []).filter((p) => p.status === "recebido");
  const [confirm, setConfirm] = useState<Group | null>(null);
  const total = toBuy.reduce((s, g) => s + cost(g.items), 0);
  const scheduled = toBuy.flatMap((g) => g.items).filter((p) => p.plannedDate).length;
  const all = toBuy.flatMap((g) => g.items).length;

  if (loading)
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="admin-skeleton h-[320px] rounded-[28px]" />
        ))}
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Mini i={0} hero label="A comprar" value={brl(total)} hint={`${units(toBuy.flatMap((g) => g.items))} frascos · ${toBuy.length} ${toBuy.length === 1 ? "fornecedor" : "fornecedores"}`} />
        <Mini i={1} label="Com dia marcado" value={`${scheduled}/${all}`} hint={all - scheduled ? `${all - scheduled} sem data` : "tudo agendado"} />
        <Mini i={2} label="Esperando chegar" value={String(units(bought.flatMap((g) => g.items)))} hint={`${brl(bought.reduce((s, g) => s + cost(g.items), 0))} já pagos`} />
        <Mini i={3} label="Recebidos" value={String(units(received))} hint="nesta lista" />
      </div>

      <Block icon={<ShoppingCart className="size-[18px]" />} title="Para comprar" count={toBuy.length}>
        {toBuy.length === 0 ? (
          <Empty>Nada para comprar agora. Quando um pedido for confirmado, os perfumes aparecem aqui.</Empty>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2 xl:gap-4">
            {toBuy.map((g, i) => (
              <SupplierCard key={g.supplier} g={g} i={i} mode="buy" onChanged={onChanged} onBuy={() => setConfirm(g)} onOpenOrder={onOpenOrder} />
            ))}
          </div>
        )}
      </Block>

      {bought.length ? (
        <Block icon={<Truck className="size-[18px]" />} title="Comprados · esperando chegar" count={bought.length}>
          <div className="grid gap-3 xl:grid-cols-2 xl:gap-4">
            {bought.map((g, i) => (
              <SupplierCard key={g.supplier} g={g} i={i} mode="arriving" onChanged={onChanged} onOpenOrder={onOpenOrder} />
            ))}
          </div>
        </Block>
      ) : null}

      {received.length ? (
        <details className="group dash-card">
          <summary className="flex h-14 cursor-pointer list-none items-center gap-2.5 px-5 text-[15px] font-bold">
            <PackageCheck className="size-[18px] text-[#7FCF9F]" /> Recebidos ({units(received)} frascos)
            <span className="ml-auto text-[13px] font-semibold text-[#8C8C8C] group-open:hidden">Ver</span>
          </summary>
          <ul className="space-y-1.5 px-3 pb-4">
            {received.map((p) => (
              <ItemRow key={p.id} p={p} onOpenOrder={onOpenOrder} />
            ))}
          </ul>
        </details>
      ) : null}

      {confirm ? (
        <ConfirmBuy
          g={confirm}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            onChanged();
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
  onBuy,
  onOpenOrder,
}: {
  g: Group;
  i: number;
  mode: "buy" | "arriving";
  onChanged: () => void;
  onBuy?: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const schedule = useServerFn(schedulePurchase);
  const receive = useServerFn(markReceived);
  const undo = useServerFn(undoPurchased);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const dates = [...new Set(g.items.map((p) => p.plannedDate).filter(Boolean))] as string[];
  const planned = dates.length === 1 && g.items.every((p) => p.plannedDate) ? dates[0]! : null;
  const t = todayBR();
  const late = mode === "buy" && planned != null && planned < t;
  const due = mode === "buy" && planned === t;
  const cheaper = g.items.filter((p) => p.cheaper);
  const btnRef = useRef<HTMLButtonElement>(null);

  const setDate = async (d: string | null) => {
    setBusy(true);
    try {
      await schedule({ data: { itemIds: g.items.map((p) => p.id), date: d } });
      toast.success(d ? `Compra na ${g.supplier} agendada: ${dayLabel(d).toLowerCase()}.` : "Agendamento removido.");
      setPicking(false);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível agendar.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    const text = [
      "Olá! Tudo bem? Gostaria de fazer um pedido:",
      "",
      ...g.items.map((p) => `• ${p.quantity}x ${productTitle(p.name)}${p.volumeMl ? ` ${p.volumeMl}ml` : ""}`),
      "",
      `Total de ${units(g.items)} ${units(g.items) === 1 ? "frasco" : "frascos"}. Obrigado!`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Lista copiada. É só colar no WhatsApp do fornecedor.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };
  const arrived = async () => {
    setBusy(true);
    try {
      const r = await receive({ data: { itemIds: g.items.map((p) => p.id) } });
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 16);
      toast.success(`${r.updated} ${r.updated === 1 ? "item chegou" : "itens chegaram"}. Agora é separar e entregar!`);
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
      toast.success("Voltou para “a comprar”.");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível desfazer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cn("dash-card adm-rise min-w-0 overflow-hidden", late && "ring-1 ring-[#FF9A8A]/40")} style={{ ["--i" as string]: i + 4 }}>
      <header className="flex flex-wrap items-start gap-3 p-4 pb-3 lg:p-5 lg:pb-3">
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-full text-[16px] font-bold", mode === "buy" ? "bg-[#FFD599] text-[#15130F]" : "bg-[#262626]")}>
          {g.supplier.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[18px] font-bold tracking-[-0.015em]">{g.supplier}</h3>
          <p className="text-[13px] text-[#8C8C8C]">
            {units(g.items)} {units(g.items) === 1 ? "frasco" : "frascos"} · <b className="text-white tabular-nums">{brl(cost(g.items))}</b>
          </p>
        </div>
        {mode === "buy" ? (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className={cn(
              "press inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-colors max-sm:order-last max-sm:w-full",
              late ? "bg-[#2A1A18] text-[#FF9A8A]" : due ? "bg-[#FFD599] text-[#15130F]" : planned ? "bg-[#262626] text-white" : "bg-[#262626] text-[#A9A9A9]",
            )}
          >
            <CalendarClock className="size-4" />
            {planned ? (late ? `Era ${dayLabel(planned).toLowerCase()}` : `Comprar ${dayLabel(planned).toLowerCase()}`) : "Agendar compra"}
          </button>
        ) : (
          <span className="rounded-full bg-[#262626] px-3 py-1.5 text-[12.5px] font-semibold text-[#A9A9A9]">
            Comprado {g.items[0]?.purchasedAt ? dayLabel(g.items[0].purchasedAt.slice(0, 10)).toLowerCase() : ""}
          </span>
        )}
      </header>

      {picking ? (
        <div className="adm-pop mx-4 mb-3 rounded-[20px] bg-[#141414] p-3 lg:mx-5">
          <p className="mb-2 px-1 text-[13px] font-semibold text-[#A9A9A9]">Que dia você vai comprar na {g.supplier}?</p>
          <DateChips value={planned} onChange={setDate} busy={busy} clearLabel="Tirar data" days={7} />
        </div>
      ) : null}

      {cheaper.length && mode === "buy" ? (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-[16px] bg-[#17251C] px-3.5 py-2.5 text-[12.5px] text-[#B6E7C8] lg:mx-5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#7FCF9F]" />
          <span>
            {cheaper.length === 1 ? "1 perfume está" : `${cheaper.length} perfumes estão`} mais barato em outro fornecedor — economia de{" "}
            <b>{brl(cheaper.reduce((s, p) => s + (p.unitCost - p.cheaper!.cost) * p.quantity, 0))}</b>. Veja abaixo.
          </span>
        </div>
      ) : null}

      <ul className="space-y-1.5 px-3 lg:px-4">
        {g.items.map((p) => (
          <ItemRow key={p.id} p={p} onOpenOrder={onOpenOrder} />
        ))}
      </ul>

      <footer className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.06] p-3 lg:p-4">
        <button type="button" onClick={copy} className="press inline-flex h-12 items-center gap-2 rounded-full bg-[#262626] px-4 text-[14px] font-bold hover:bg-[#2E2E2E]">
          <ClipboardCopy className="size-4" /> Copiar lista
        </button>
        {mode === "buy" ? (
          <button
            type="button"
            onClick={onBuy}
            className="press ml-auto inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#FFD599] px-5 text-[15px] font-bold text-[#15130F] hover:bg-[#FFDDAA] sm:flex-none"
          >
            <Check className="size-[18px]" strokeWidth={2.6} /> Comprei
          </button>
        ) : (
          <>
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
              {busy ? <Loader2 className="size-[18px] animate-spin" /> : <PackageCheck className="size-[18px]" />} Chegou
            </button>
          </>
        )}
      </footer>
    </section>
  );
}

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
          {p.sources.map((s) => {
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
      const r = await buy({ data: { itemIds: g.items.map((p) => p.id) } });
      const rect = ref.current?.getBoundingClientRect();
      if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 24);
      if (r.skipped) toast.info(`${r.skipped} ${r.skipped === 1 ? "item já estava" : "itens já estavam"} comprado${r.skipped === 1 ? "" : "s"} — não contei de novo.`);
      toast.success(`Compra na ${g.supplier} registrada.`);
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
            <p className="text-[13px] text-[#8C8C8C]">Confirmar compra na</p>
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
          Sim, comprei e paguei
        </button>
        <p className="mt-2 text-center text-[12px] text-[#6F6F6F]">Se errar, dá para desfazer em “Comprados”.</p>
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

function Block({ icon, title, count, children }: { icon: ReactNode; title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2.5 px-1 text-[19px] font-bold tracking-[-0.015em]">
        <span className="grid size-9 place-items-center rounded-full bg-[#1A1A1A] text-[#FFD599]">{icon}</span>
        {title}
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[#262626] px-2 text-[12px] font-bold tabular-nums">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="dash-card px-6 py-10 text-center text-[14.5px] text-[#8C8C8C]">{children}</div>;
}

function Mini({ label, value, hint, hero, i }: { label: string; value: string; hint: string; hero?: boolean; i: number }) {
  return (
    <div className={cn("adm-rise flex min-h-[112px] flex-col justify-between p-4 lg:p-5", hero ? "dash-hero" : "dash-card")} style={{ ["--i" as string]: i }}>
      <span className={cn("text-[14px] font-semibold", hero ? "text-[#15130F]/70" : "text-[#A9A9A9]")}>{label}</span>
      <span>
        <span className="block truncate text-[clamp(1.4rem,4.5vw,2rem)] leading-none font-bold tracking-[-0.04em] tabular-nums">{value}</span>
        <span className={cn("mt-1 block truncate text-[12.5px]", hero ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>{hint}</span>
      </span>
    </div>
  );
}
