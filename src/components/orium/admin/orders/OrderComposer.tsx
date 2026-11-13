/**
 * LANÇAR PEDIDO — vitrine com foto à esquerda, pedido à direita.
 *
 * 1. Toca no perfume → escolhe Frasco ou Decant 2/5/10 ml.
 * 2. No pedido: quantidade e o preço que você realmente vendeu (vem o sugerido).
 * 3. Cliente, entrega, pagamento → "Criar pedido".
 * O preço só vai ao servidor quando foi mexido; senão vale a regra da loja
 * (varejo/atacado e decant por tamanho), calculada lá.
 */
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Loader2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { createManualOrder } from "@/lib/orders.functions";
import { CustomerPicker, type PickedCustomer } from "@/components/orium/admin/CustomerPicker";
import { DateChips, DeliveryPicker, PayAmount, dayLabel, resolvePaid, type DeliveryDraft, type PayDraft } from "./controls";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PanelClose, SidePanel, burst } from "./model";
import { Field, LineRow, Seg, Vitrine, WholesaleToggle, nameOf, supplyOptionsOf, useComposerSupply, useFly, useLineCost, useOrderLines, type Line } from "./kit";
import { AnimatedMetric } from "@/components/orium/AnimatedMetric";

export function OrderComposer({ open, onClose, onCreated, originEl }: { open: boolean; onClose: () => void; onCreated: (id: string) => void; originEl?: HTMLElement | null }) {
  return (
    <SidePanel open={open} onClose={onClose} label="Novo pedido" wide originEl={originEl}>
      {open ? <Composer onClose={onClose} onCreated={onCreated} /> : <div className="flex-1" />}
    </SidePanel>
  );
}

function Composer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const create = useServerFn(createManualOrder);
  const { lines, add, patch, remove, inCart, wholesale, autoWholesale, forceWholesale, setForceWholesale, reference, unit, total, count } = useOrderLines();
  const { fly, bump, deskTarget, mobTarget } = useFly();
  const [cust, setCust] = useState<PickedCustomer>({ customerId: null, name: "", phone: "" });
  const [origin, setOrigin] = useState<"WHATSAPP" | "MANUAL">("WHATSAPP");
  const [method, setMethod] = useState<"PIX" | "CARD">("PIX");
  const [pay, setPay] = useState<PayDraft>({ mode: "none", text: "" });
  /** perfumes que o cliente já pagou (pagamento por item) */
  const [paidKeys, setPaidKeys] = useState<Set<string>>(() => new Set());
  const [delivery, setDelivery] = useState<DeliveryDraft>({ type: "PICKUP", date: null, time: null, notes: "" });
  const [payDue, setPayDue] = useState<string | null>(null);
  const [lossAsk, setLossAsk] = useState(false);
  const baseCost = useLineCost();
  const { data: supply } = useComposerSupply();
  /** fornecedor do item: o escolhido na mão ou o primeiro (disponível, compra normal, mais barato) */
  const supplierOf = (l: Line) => {
    const options = supplyOptionsOf(supply, l.product);
    return { options, chosen: options.find((o) => o.id === l.supplierProductId) ?? null, value: l.supplierProductId ?? options[0]?.id ?? null };
  };
  const lineCost = (l: Line) => {
    // frasco: custo do fornecedor marcado (escolhido ou o padrão); decant: parte do frasco
    const { options, value } = supplierOf(l);
    const picked = options.find((o) => o.id === value);
    if (l.size === "FULL" && picked?.cost != null) return picked.cost;
    return baseCost(l);
  };
  const losses = lines.filter((l) => {
    const c = lineCost(l);
    return c != null && unit(l) < c - 0.009;
  });
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<"vitrine" | "pedido">("vitrine");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ id: string; number: string | null; total: number } | null>(null);
  const sections = { itens: useRef<HTMLDivElement>(null), cliente: useRef<HTMLDivElement>(null), pagamento: useRef<HTMLDivElement>(null) };
  const [pulse, setPulse] = useState<string | null>(null);
  const goTo = (k: keyof typeof sections) => {
    if (window.matchMedia("(max-width: 63.99rem)").matches) setStep("pedido");
    setTimeout(() => {
      sections[k].current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPulse(k);
      setTimeout(() => setPulse(null), 1300);
    }, 60);
  };

  const paidNow = resolvePaid(pay, total);
  const fullyPaid = paidNow != null && total > 0 && paidNow >= total - 0.009;
  const ready = cust.name.trim().length >= 2 && lines.length > 0 && paidNow != null;

  const submit = async (force = false) => {
    if (!ready || saving) return;
    if (losses.length && !force) return setLossAsk(true);
    setLossAsk(false);
    setSaving(true);
    try {
      const res: any = await create({
        data: {
          customerName: cust.name,
          customerPhone: cust.phone,
          customerId: cust.customerId,
          origin,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          paidAmount: paidNow ?? 0,
          paymentMethod: method,
          wholesale: wholesale,
          items: lines.map((l) => ({
            productId: l.product.id,
            quantity: l.qty,
            paid: paidKeys.has(l.key) || pay.mode === "all",
            variant: l.size === "FULL" ? "FULL" : "DECANT",
            decantMl: l.size === "FULL" ? null : l.size,
            ...(l.price != null ? { unitPrice: l.price } : {}),
            ...(l.size === "FULL" && l.supplierProductId ? { supplierProductId: l.supplierProductId } : {}),
          })),
          fulfillmentType: delivery.type === "LOCAL" ? "LOCAL" : "PICKUP",
          paymentDueDate: !fullyPaid ? payDue : null,
          expectedDeliveryDate: delivery.date || null,
          expectedDeliveryTime: delivery.time || null,
          deliveryNotes: delivery.notes || null,
        },
      });
      if (res?.created > 0) toast.success(`${res.created} ${res.created === 1 ? "item foi" : "itens foram"} para a reposição.`);
      (res?.warnings ?? []).forEach((w: string) => toast.warning(w));
      setDone({ id: res.orderId, number: res.orderNumber ?? null, total });
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível criar o pedido.");
    } finally {
      setSaving(false);
    }
  };

  if (done) return <Created done={done} name={cust.name} onClose={onClose} onOpen={() => onCreated(done.id)} />;

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-5 pt-[max(0.9rem,env(safe-area-inset-top))] pb-3.5 lg:px-7 lg:py-5">
        {step === "pedido" ? (
          <button type="button" onClick={() => setStep("vitrine")} className="press grid size-11 place-items-center rounded-full bg-[#1F1F1F] lg:hidden" aria-label="Voltar aos perfumes">
            <ArrowLeft className="size-5" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] leading-tight font-bold tracking-[-0.03em] lg:text-[26px]">Novo pedido</h2>
          <p className="truncate text-[13px] text-[#8C8C8C]">Escolha os perfumes, ajuste o preço e salve.</p>
        </div>
        <PanelClose onClose={onClose} />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_440px]">
        {/* ── vitrine ─────────────────────────── */}
        <Vitrine hidden={step === "pedido"} inCart={inCart} wholesale={wholesale} onAdd={add} onFly={fly} count={count} total={total} bump={bump} mobTarget={mobTarget} onOpenOrder={() => setStep("pedido")} />

        {/* ── pedido ─────────────────────────── */}
        <aside className={cn("flex min-h-0 flex-col bg-[#161616] lg:border-l lg:border-white/[0.06]", step === "vitrine" && "max-lg:hidden")} aria-label="Pedido">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pt-5 pb-6 lg:px-6">
            <div ref={sections.itens} className={cn("rounded-[26px] transition-shadow duration-500", pulse === "itens" && "ord-pulse")}>
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[17px] font-bold">
                  <ShoppingBag className="size-[18px] text-[#FFD599]" strokeWidth={2.2} />
                  Itens
                  <span ref={deskTarget} key={bump} className={cn("grid h-6 min-w-6 place-items-center rounded-full bg-[#FFD599] px-1.5 text-[12px] font-bold text-[#15130F] tabular-nums", bump && "ord-bump")}>
                    {count}
                  </span>
                </h3>
                <WholesaleToggle auto={autoWholesale} on={forceWholesale} onChange={setForceWholesale} />
              </div>
              {lines.length === 0 ? (
                <div className="grid min-h-[132px] place-items-center rounded-[22px] border-[1.5px] border-dashed border-white/10 px-6 text-center">
                  <p className="text-[14px] text-[#8C8C8C]">
                    Toque num perfume <span className="max-lg:hidden">ao lado</span>
                    <span className="lg:hidden">na vitrine</span> para colocar aqui.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {lines.map((l) => (
                    <LineRow
                      cost={lineCost(l)}
                      supply={(() => {
                        const s = supplierOf(l);
                        return { options: s.options, value: s.value, onChange: (id: string) => patch(l.key, { supplierProductId: id }) };
                      })()}
                      key={l.key}
                      l={l}
                      suggested={reference(l)}
                      unit={unit(l)}
                      onPatch={(p) => patch(l.key, p)}
                      onRemove={() => remove(l.key)}
                    />
                  ))}
                </ul>
              )}
            </div>

            <Field title="Cliente" ref={sections.cliente} pulse={pulse === "cliente"} done={cust.name.trim().length >= 2}>
              <CustomerPicker value={cust} onChange={setCust} label="" />
              <Seg
                className="mt-2.5"
                value={origin}
                onChange={setOrigin}
                options={[
                  { v: "WHATSAPP", label: "Veio pelo WhatsApp" },
                  { v: "MANUAL", label: "No balcão" },
                ]}
              />
            </Field>

            <Field title="Entrega" done={!!delivery.date || delivery.type === "PICKUP"}>
              <DeliveryPicker value={delivery} onChange={setDelivery} />
            </Field>

            <Field title="Pagamento" ref={sections.pagamento} pulse={pulse === "pagamento"} done>
              <Seg
                value={method}
                onChange={setMethod}
                options={[
                  { v: "PIX", label: "Pix" },
                  { v: "CARD", label: "Cartão" },
                ]}
              />
              <div className="mt-2.5">
                <PayAmount
                  value={pay}
                  onChange={setPay}
                  total={total}
                  items={lines.map((l) => ({
                    key: l.key,
                    name: nameOf(l.product),
                    detail: `${l.qty}× ${l.size === "FULL" ? `frasco${l.product.volume_ml ? ` ${l.product.volume_ml}ml` : ""}` : `decant ${l.size}ml`}`,
                    amount: Math.round(unit(l) * l.qty * 100) / 100,
                  }))}
                  paidKeys={new Set([...paidKeys].filter((k) => lines.some((l) => l.key === k)))}
                  onPaidKeys={setPaidKeys}
                />
              </div>
              {!fullyPaid && lines.length ? (
                <div className="adm-pop mt-3">
                  <p className="mb-2 px-1 text-[13px] font-semibold text-[#A9A9A9]">
                    {(paidNow ?? 0) > 0 ? "Quando paga o resto?" : "Quando vai pagar?"}
                    {payDue ? <span className="text-white"> · {dayLabel(payDue)}</span> : null}
                  </p>
                  <DateChips value={payDue} onChange={setPayDue} clearLabel="Sem data" />
                </div>
              ) : null}
            </Field>

            <Field title="Observação">
              <textarea data-slot="input-group-control"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Ex.: embrulhar para presente"
                className="w-full resize-none rounded-[18px] bg-[#1F1F1F] px-4 py-3 text-[15px] text-white outline-none placeholder:text-[#6F6F6F] focus:ring-2 focus:ring-[#FFD599]/50"
              />
            </Field>
          </div>

          <footer className="shrink-0 border-t border-white/[0.06] bg-[#161616] px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:px-6 lg:pb-6">
            <div className="flex flex-col gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-[#8C8C8C]">
                  {count} {count === 1 ? "item" : "itens"}
                </p>
                <p className="text-[30px] leading-none font-bold tracking-[-0.04em] tabular-nums">
                  <AnimatedMetric value={total} format="BRL" />
                </p>
              </div>
              <ol className="order-first flex items-center gap-1.5" aria-label="Falta preencher">
                {(
                  [
                    ["itens", "Itens", lines.length > 0],
                    ["cliente", "Cliente", cust.name.trim().length >= 2],
                    ["pagamento", "Pagamento", true],
                  ] as const
                ).map(([k, label, ok]) => (
                  <li key={k}>
                    <button
                      type="button"
                      onClick={() => goTo(k)}
                      className={cn(
                        "press inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold transition-colors duration-300",
                        ok ? "bg-[#17251C] text-[#7FCF9F]" : "bg-[#2A2418] text-[#FFD599]",
                      )}
                    >
                      {ok ? <Check className="size-3.5" strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-current" />}
                      {label}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => (ready ? submit() : goTo(lines.length ? "cliente" : "itens"))}
              className={cn(
                "press relative mt-3.5 flex h-[58px] w-full items-center justify-center gap-2 overflow-hidden rounded-full text-[16px] font-bold transition-[background-color,color] duration-300",
                ready ? "bg-[#FFD599] text-[#15130F] hover:bg-[#FFDDAA]" : "bg-[#262626] text-[#A9A9A9]",
              )}
            >
              {saving ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" strokeWidth={2.6} />}
              {saving ? "Criando…" : ready ? "Criar pedido" : lines.length ? "Falta o cliente" : "Escolha os perfumes"}
            </button>
          </footer>
        </aside>
      </div>
      {lossAsk ? (
        <div className="admin-theme adm-fade fixed inset-0 z-[75] flex items-end justify-center bg-black/65 sm:items-center" onClick={() => setLossAsk(false)}>
          <div
            role="alertdialog"
            aria-label="Venda abaixo do custo"
            onClick={(e) => e.stopPropagation()}
            className="ord-sheet-up w-full max-w-[440px] rounded-t-[32px] border border-white/[0.07] bg-[#141414] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white sm:rounded-[32px] sm:pb-5"
          >
            <span className="grid size-12 place-items-center rounded-full bg-[#2A1A18] text-[#FF9A8A]">
              <AlertTriangle className="size-6" />
            </span>
            <p className="mt-4 text-[22px] leading-tight font-bold tracking-[-0.03em]">Você vai ter prejuízo</p>
            <p className="mt-1 text-[14px] text-[#A9A9A9]">Estes perfumes estão com preço abaixo do que custam:</p>
            <ul className="mt-3 space-y-1.5">
              {losses.map((l) => {
                const c = lineCost(l)!;
                return (
                  <li key={l.key} className="flex items-center justify-between gap-3 rounded-[14px] bg-[#2A1A18] px-3.5 py-2.5 text-[13.5px]">
                    <span className="min-w-0 truncate">{l.product.canonical_name}</span>
                    <span className="shrink-0 font-bold text-[#FF9A8A] tabular-nums">−{brl((c - unit(l)) * l.qty)}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => setLossAsk(false)} className="press h-[54px] rounded-full bg-white text-[15px] font-bold text-[#15130F]">
                Ajustar o preço
              </button>
              <button type="button" onClick={() => void submit(true)} className="press h-12 rounded-full text-[14px] font-bold text-[#FF9A8A] hover:bg-white/[0.04]">
                Vender assim mesmo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Tela de sucesso: anel + check desenhado, valor e próximos passos. */
function Created({ done, name, onClose, onOpen }: { done: { id: string; number: string | null; total: number }; name: string; onClose: () => void; onOpen: () => void }) {
  const ring = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const r = ring.current?.getBoundingClientRect();
      if (r) burst(r.left + r.width / 2, r.top + r.height / 2, 30);
    }, 420);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <span ref={ring} className="ord-ok-ring grid size-[112px] place-items-center rounded-full bg-[#FFD599]">
        <svg viewBox="0 0 24 24" className="size-14" fill="none" stroke="#15130F" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path className="ord-ok-check" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <h2 className="adm-rise mt-8 text-[30px] leading-tight font-bold tracking-[-0.035em]" style={{ ["--i" as string]: 6 }}>
        Pedido criado
      </h2>
      <p className="adm-rise mt-2 text-[16px] text-[#A9A9A9]" style={{ ["--i" as string]: 7 }}>
        {name.trim().split(/\s+/)[0]} · <b className="text-white tabular-nums">{brl(done.total)}</b>
        {done.number ? ` · #${done.number}` : ""}
      </p>
      <div className="adm-rise mt-8 flex w-full max-w-[360px] flex-col gap-2.5" style={{ ["--i" as string]: 8 }}>
        <button type="button" onClick={onOpen} className="press h-[54px] rounded-full bg-[#FFD599] text-[16px] font-bold text-[#15130F] hover:bg-[#FFDDAA]">
          Abrir o pedido
        </button>
        <button type="button" onClick={onClose} className="press h-[54px] rounded-full bg-[#1F1F1F] text-[16px] font-bold hover:bg-[#262626]">
          Voltar aos pedidos
        </button>
      </div>
    </div>
  );
}
