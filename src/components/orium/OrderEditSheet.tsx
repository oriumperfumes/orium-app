/**
 * EDITAR PEDIDO — mesmo padrão do "Novo pedido".
 *
 * Computador: vitrine com foto à esquerda, o pedido à direita.
 * Celular: abre no pedido; "Adicionar perfume" leva à vitrine.
 * Nada é salvo a cada toque: "Revisar" mostra o antes → depois (calculado no
 * servidor) e só "Salvar alterações" grava.
 *
 * Preço: linha com preço fixado (pedido lançado à mão, ou mexido aqui) vai
 * ao servidor como `unitPrice`; as outras seguem a regra da loja (promoção/cupom).
 */
import { CustomerPicker } from "@/components/orium/admin/CustomerPicker";
import { PaymentControl } from "@/components/orium/admin/orders/controls";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Loader2, MessageCircle, Plus, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedMetric } from "@/components/orium/AnimatedMetric";
import { brl, dateBR, maskCep, maskPhone, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveOrderEdit, type EditSummary } from "@/lib/order-edit.functions";
import { fetchAddressByCep, quoteCartShipping } from "@/lib/shipping.functions";
import { PanelClose, SidePanel, burst } from "@/components/orium/admin/orders/model";
import {
  Field,
  LineRow,
  Seg,
  Vitrine,
  WholesaleToggle,
  lineKeyOf,
  useCatalogProducts,
  useFly,
  useLineCost,
  useOrderLines,
  type Line,
  type Product,
  type Size,
} from "@/components/orium/admin/orders/kit";

type Fulfillment = "PICKUP" | "LOCAL" | "SHIPPING";
const MANUAL_ORIGINS = ["MANUAL", "WHATSAPP"];

export function OrderEditSheet({
  open,
  order,
  lines,
  role,
  onClose,
  onSaved,
  originEl,
}: {
  open: boolean;
  order: any;
  lines: any[];
  role?: string | null;
  onClose: () => void;
  onSaved: () => void;
  originEl?: HTMLElement | null;
}) {
  // mantém o último pedido enquanto a janela anima a saída
  const last = useRef<{ order: any; lines: any[] } | null>(null);
  if (open && order) last.current = { order, lines };
  const shown = open && order ? { order, lines } : last.current;
  const [askClose, setAskClose] = useState(false);
  const dirtyRef = useRef(false);
  const tryClose = () => (dirtyRef.current ? setAskClose(true) : onClose());
  useEffect(() => {
    if (!open) setAskClose(false);
  }, [open]);

  return (
    <SidePanel open={open && !!order} onClose={tryClose} label="Editar pedido" wide originEl={originEl}>
      {shown ? (
        <Editor
          key={shown.order.id}
          order={shown.order}
          initialLines={shown.lines}
          role={role}
          onClose={onClose}
          tryClose={tryClose}
          onSaved={onSaved}
          onDirty={(d) => {
            dirtyRef.current = d;
          }}
          askClose={askClose}
          setAskClose={setAskClose}
        />
      ) : null}
    </SidePanel>
  );
}

/** Produto mínimo a partir da linha do pedido (se não estiver mais no catálogo). */
function productFromLine(l: any): Product {
  const ml = Number(String(l.variant_label ?? "").match(/(\d{2,4})\s*ml/i)?.[1] ?? 0) || null;
  return {
    id: l.product_id,
    canonical_name: l.product_name_snapshot ?? "Produto",
    brand: null,
    volume_ml: l.variant === "DECANT" ? null : ml,
    image_url: l.image_snapshot ?? null,
    retail_price: Number(l.unit_base_price ?? l.unit_sale_price ?? 0),
    wholesale_price: null,
    decant_available: l.variant === "DECANT",
    decant_price_2ml: null,
    decant_price_5ml: null,
    decant_price_10ml: null,
    local_stock: null,
    gender_norm: null,
  };
}

function Editor({
  order,
  initialLines,
  role,
  onClose,
  tryClose,
  onSaved,
  onDirty,
  askClose,
  setAskClose,
}: {
  order: any;
  initialLines: any[];
  role?: string | null;
  onClose: () => void;
  tryClose: () => void;
  onSaved: () => void;
  onDirty: (d: boolean) => void;
  askClose: boolean;
  setAskClose: (v: boolean) => void;
}) {
  const preview = useServerFn(saveOrderEdit);
  const persist = useServerFn(saveOrderEdit);
  const quote = useServerFn(quoteCartShipping);
  const lookupCep = useServerFn(fetchAddressByCep);
  const { data: catalog } = useCatalogProducts();
  const byId = useMemo(() => new Map((catalog ?? []).map((p) => [p.id, p])), [catalog]);
  const manual = MANUAL_ORIGINS.includes(order.order_origin ?? order.origin ?? "");

  const start = useMemo<Line[]>(
    () =>
      (initialLines ?? [])
        .filter((l: any) => l.product_id)
        .map((l: any) => {
          const size: Size = l.variant === "DECANT" ? (Number(l.decant_ml) as Size) : "FULL";
          const orig = Number(l.unit_sale_price ?? 0);
          return {
            key: lineKeyOf(l.product_id, size),
            product: productFromLine(l),
            size,
            qty: Number(l.quantity),
            // pedido lançado à mão: o preço combinado continua valendo
            price: manual ? orig : null,
            orig,
            lineId: l.id,
          };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const startWholesale = order.pricing_tier === "atacado";
  const { lines, add, patch, remove, inCart, wholesale, autoWholesale, forceWholesale, setForceWholesale, reference, unit, total, count } = useOrderLines(
    start,
    startWholesale,
  );
  const { fly, bump, deskTarget, mobTarget } = useFly();
  const lineCost = useLineCost();
  const losses = lines.filter((l) => {
    const c = lineCost(l);
    return c != null && unit(l) < c - 0.009;
  });
  const view = (l: Line): Line => ({ ...l, product: byId.get(l.product.id) ?? l.product });

  const [step, setStep] = useState<"vitrine" | "pedido">("pedido");
  const [name, setName] = useState(order.customer_name ?? "");
  const [phone, setPhone] = useState(order.customer_phone ?? "");
  const [custId, setCustId] = useState<string | null>(order.crm_customer_id ?? null);
  const [notes, setNotes] = useState(order.notes ?? "");
  const [reason, setReason] = useState("");
  const [coupon, setCoupon] = useState(order.coupon_code ?? "");
  const [fulfillment, setFulfillment] = useState<Fulfillment>((order.fulfillment_type ?? "PICKUP") as Fulfillment);
  const [paymentMethod, setPaymentMethod] = useState<"PIX" | "CARD">(order.payment_method === "CARD" ? "CARD" : "PIX");
  const [addr, setAddr] = useState({
    cep: order.shipping_cep ? maskCep(order.shipping_cep) : "",
    street: order.shipping_street ?? "",
    number: order.shipping_number ?? "",
    complement: order.shipping_complement ?? "",
    district: order.shipping_district ?? "",
    city: order.shipping_city ?? "",
    state: order.shipping_state ?? "",
  });
  const setA = (p: Partial<typeof addr>) => setAddr((a) => ({ ...a, ...p }));
  const [shipping, setShipping] = useState<{ service: string; price: number; days: number | null } | null>(
    order.fulfillment_type === "SHIPPING"
      ? { service: order.shipping_service ?? "Envio", price: Number(order.shipping_price ?? 0), days: order.shipping_days ?? null }
      : null,
  );
  const [options, setOptions] = useState<Array<{ service: string; carrier: string; price: number; days: number | null }>>([]);
  const [quoting, setQuoting] = useState(false);
  const [summary, setSummary] = useState<EditSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptDelivered, setAcceptDelivered] = useState(false);

  const { data: events } = useQuery({
    queryKey: ["order-events", order.id],
    queryFn: async () =>
      (await supabase.from("order_events").select("*").eq("order_id", order.id).order("created_at", { ascending: false })).data ?? [],
  });

  const shipPrice = fulfillment === "SHIPPING" ? Number(shipping?.price ?? 0) : 0;
  const estimate = total + shipPrice;
  const before = Number(order.final_total ?? order.grand_total ?? order.sales_total ?? 0);

  const snap = (ls: Line[]) => JSON.stringify(ls.map((l) => [l.key, l.qty, l.price]).sort());
  const dirty =
    snap(lines) !== snap(start) ||
    wholesale !== startWholesale ||
    (order.customer_name ?? "") !== name ||
    (order.customer_phone ?? "") !== phone ||
    (order.crm_customer_id ?? null) !== custId ||
    (order.notes ?? "") !== notes ||
    (order.fulfillment_type ?? "PICKUP") !== fulfillment ||
    (order.shipping_cep ?? "") !== addr.cep.replace(/\D/g, "") ||
    (order.shipping_street ?? "") !== addr.street ||
    (order.shipping_number ?? "") !== addr.number ||
    (order.shipping_complement ?? "") !== addr.complement ||
    (order.shipping_district ?? "") !== addr.district ||
    (order.shipping_city ?? "") !== addr.city ||
    (order.shipping_state ?? "") !== addr.state ||
    (order.coupon_code ?? "") !== coupon ||
    (order.payment_method === "CARD" ? "CARD" : "PIX") !== paymentMethod ||
    Number(order.shipping_price ?? 0) !== shipPrice;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  const payload = (dryRun: boolean) => ({
    orderId: order.id,
    expectedUpdatedAt: order.updated_at ?? null,
    dryRun,
    force: acceptDelivered,
    reason: reason || null,
    customerName: name,
    customerPhone: phone,
    ...((order.crm_customer_id ?? null) !== custId ? { customerId: custId } : {}),
    notes,
    fulfillment,
    couponCode: coupon.trim() ? coupon.trim().toUpperCase() : null,
    paymentMethod,
    address: fulfillment === "PICKUP" ? null : addr,
    shipping: fulfillment === "SHIPPING" && shipping ? { service: shipping.service, price: shipping.price, days: shipping.days } : null,
    items: lines.map((l) => ({
      productId: l.product.id,
      variant: (l.size === "FULL" ? "FULL" : "DECANT") as "FULL" | "DECANT",
      decantMl: l.size === "FULL" ? null : (l.size as number),
      quantity: l.qty,
      // atacado combinado na mão: o frasco vai com o preço de atacado da tela
      ...(l.price != null ? { unitPrice: l.price } : forceWholesale && !autoWholesale && l.size === "FULL" ? { unitPrice: unit(l) } : {}),
    })),
    wholesale,
  });

  const cepBlur = async () => {
    const digits = addr.cep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    try {
      const found: any = await lookupCep({ data: { cep: digits } });
      if (!found) return void toast.warning("CEP não encontrado.");
      setA({ street: found.street || addr.street, district: found.district || addr.district, city: found.city || addr.city, state: found.state || addr.state });
      if (fulfillment === "SHIPPING") void recalcShipping(digits);
    } catch {
      toast.error("Não foi possível consultar o CEP.");
    }
  };

  const recalcShipping = async (rawCep?: string) => {
    const digits = (rawCep ?? addr.cep).replace(/\D/g, "");
    if (digits.length !== 8) return void toast.warning("Informe o CEP completo para calcular o frete.");
    setQuoting(true);
    try {
      const res: any = await quote({
        data: { cep: digits, items: lines.filter((l) => l.size === "FULL").map((l) => ({ productId: l.product.id, quantity: l.qty })) },
      });
      if (!res?.ok) {
        setOptions([]);
        return void toast.warning(res?.message ?? "Não foi possível calcular o frete agora.");
      }
      setOptions(res.options ?? []);
      const cheapest = (res.options ?? [])[0];
      if (cheapest) setShipping({ service: cheapest.service, price: Number(cheapest.price), days: cheapest.days ?? null });
    } catch {
      toast.error("Não foi possível calcular o frete agora.");
    } finally {
      setQuoting(false);
    }
  };

  const review = async () => {
    if (!lines.length) return toast.warning("O pedido precisa ter ao menos um item.");
    setBusy(true);
    try {
      setSummary((await preview({ data: payload(true) })) as EditSummary);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível revisar as alterações.");
    } finally {
      setBusy(false);
    }
  };

  const saveBtn = useRef<HTMLButtonElement>(null);
  const commit = async () => {
    setBusy(true);
    try {
      const res = (await persist({ data: payload(false) })) as EditSummary;
      const r = saveBtn.current?.getBoundingClientRect();
      if (r) burst(r.left + r.width / 2, r.top + r.height / 2, 18);
      toast.success("Pedido atualizado.");
      (res.warnings ?? []).forEach((w) => toast.warning(w));
      if (res.restock && (res.restock.created || res.restock.updated || res.restock.removed)) {
        toast.info(`Reposição ajustada: +${res.restock.created} novo(s), ${res.restock.updated} atualizado(s), ${res.restock.removed} removido(s).`);
      }
      onDirty(false);
      setSummary(null);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar as alterações.");
    } finally {
      setBusy(false);
    }
  };

  const whatsappUpdate = () => {
    const digits = (phone ?? "").replace(/\D/g, "");
    if (digits.length < 10) return void toast.warning("Informe um WhatsApp válido.");
    const first = (name ?? "").trim().split(/\s+/)[0];
    const text = [
      `Oi${first ? `, ${first}` : ""}! Atualizei o seu pedido aqui na Orium 😊`,
      "",
      ...lines.map((l) => `• ${l.qty}x ${productTitle(view(l).product.canonical_name)} (${l.size === "FULL" ? "frasco" : `decant ${l.size}ml`}) — ${brl(unit(l) * l.qty)}`),
      "",
      fulfillment === "PICKUP" ? "Retirada aqui na loja." : fulfillment === "LOCAL" ? "Entrega local." : `Envio${shipping ? ` (${shipping.service}, ${brl(shipping.price)})` : ""}.`,
      `Total: ${brl(estimate)}`,
      "",
      "Qualquer coisa é só me chamar!",
    ].join("\n");
    window.open(`https://wa.me/55${digits}?text=${encodeURIComponent(text)}`, "_blank", "noreferrer");
  };

  const delivered = order.status === "entregue";
  const confirmed = order.is_confirmed || ["confirmado", "pedido feito"].includes(order.status);
  const blocked = delivered && !(role === "owner" && acceptDelivered);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-5 pt-[max(0.9rem,env(safe-area-inset-top))] pb-3.5 lg:px-7 lg:py-5">
        {step === "vitrine" ? (
          <button type="button" onClick={() => setStep("pedido")} className="press grid size-11 place-items-center rounded-full bg-[#1F1F1F] lg:hidden" aria-label="Voltar ao pedido">
            <ArrowLeft className="size-5" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] leading-tight font-bold tracking-[-0.03em] lg:text-[26px]">Editar pedido</h2>
          <p className="truncate text-[13px] text-[#8C8C8C]">
            {order.customer_name || "Cliente"} · {dateBR(order.created_at)}
            {order.order_number ? ` · #${order.order_number}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={whatsappUpdate}
          title="Mandar o pedido atualizado no WhatsApp"
          className="press hidden h-11 items-center gap-2 rounded-full bg-[#1F1F1F] px-4 text-[14px] font-bold transition-colors hover:bg-[#262626] sm:inline-flex"
        >
          <MessageCircle className="size-[17px]" strokeWidth={2.2} /> Avisar cliente
        </button>
        <PanelClose onClose={tryClose} />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_460px]">
        <Vitrine
          hidden={step === "pedido"}
          inCart={inCart}
          wholesale={wholesale}
          onAdd={add}
          onFly={fly}
          count={count}
          total={total}
          bump={bump}
          mobTarget={mobTarget}
          onOpenOrder={() => setStep("pedido")}
          autoFocus={false}
        />

        <aside className={cn("flex min-h-0 flex-col bg-[#161616] lg:border-l lg:border-white/[0.06]", step === "vitrine" && "max-lg:hidden")} aria-label="Pedido">
          <div className="ord-cascade min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pt-5 pb-6 lg:px-6">
            {delivered ? (
              <Notice tone="warn" title="Este pedido já foi entregue.">
                Mudanças aqui afetam o histórico e os relatórios. Só o dono pode salvar.
                {role === "owner" ? (
                  <button
                    type="button"
                    onClick={() => setAcceptDelivered((v) => !v)}
                    className={cn(
                      "press mt-3 flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-bold transition-colors",
                      acceptDelivered ? "bg-[#FFD599] text-[#15130F]" : "bg-[#2A2A2A] text-white",
                    )}
                  >
                    <span className={cn("grid size-4 place-items-center rounded-full border-2", acceptDelivered ? "border-[#15130F]" : "border-white/40")}>
                      {acceptDelivered ? <Check className="size-2.5" strokeWidth={4} /> : null}
                    </span>
                    Entendi, quero alterar
                  </button>
                ) : null}
              </Notice>
            ) : confirmed ? (
              <Notice tone="info" title="Pedido confirmado.">
                A reposição é ajustada só pela diferença. A etapa do pedido não muda.
              </Notice>
            ) : null}

            <div>
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <h3 className="mr-auto flex items-center gap-2 text-[17px] font-bold">
                  <ShoppingBag className="size-[18px] text-[#FFD599]" strokeWidth={2.2} />
                  Itens
                  <span ref={deskTarget} key={bump} className={cn("grid h-6 min-w-6 place-items-center rounded-full bg-[#FFD599] px-1.5 text-[12px] font-bold text-[#15130F] tabular-nums", bump && "ord-bump")}>
                    {count}
                  </span>
                </h3>
                <button
                  type="button"
                  onClick={() => setStep("vitrine")}
                  className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[#262626] px-3.5 text-[13px] font-bold lg:hidden"
                >
                  <Plus className="size-4" strokeWidth={2.4} /> Adicionar perfume
                </button>
                <WholesaleToggle auto={autoWholesale} on={forceWholesale} onChange={setForceWholesale} />
              </div>
              {lines.length === 0 ? (
                <div className="grid min-h-[120px] place-items-center rounded-[22px] border-[1.5px] border-dashed border-[#FF9A8A]/30 px-6 text-center">
                  <p className="text-[14px] text-[#FF9A8A]">O pedido ficou sem itens. Adicione ao menos um perfume.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {lines.map((l) => (
                    <LineRow
                      key={l.key}
                      cost={lineCost(l)}
                      l={view(l)}
                      suggested={reference(l)}
                      unit={unit(l)}
                      onPatch={(p) => patch(l.key, p)}
                      onRemove={() => remove(l.key)}
                      refLabel={l.orig != null ? "Preço do pedido" : "Preço sugerido da loja"}
                      resetLabel={l.orig != null ? "Voltar ao preço do pedido" : "Voltar ao sugerido"}
                    />
                  ))}
                </ul>
              )}
              <p className="mt-2 px-1 text-[12px] leading-snug text-[#6F6F6F]">
                {manual
                  ? "Pedido lançado à mão: os preços combinados continuam valendo."
                  : "Itens sem preço mexido seguem a regra da loja (promoção e cupom recalculados ao revisar)."}
              </p>
            </div>

            <Field title="Cliente" done={name.trim().length >= 2}>
              <CustomerPicker
                label=""
                inlineNew={false}
                value={{ customerId: custId, name, phone }}
                onChange={(v) => {
                  setCustId(v.customerId);
                  setName(v.name);
                  setPhone(v.phone);
                }}
              />
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                <TextField label="Nome neste pedido" value={name} onChange={setName} />
                <TextField label="WhatsApp" value={phone} inputMode="numeric" onChange={(v) => setPhone(maskPhone(v))} />
              </div>
              <p className="mt-2 px-1 text-[12px] text-[#6F6F6F]">Nome e WhatsApp valem só para este pedido; a ficha do cliente não muda.</p>
            </Field>

            <Field title="Entrega" done>
              <Seg
                value={fulfillment}
                onChange={(v) => {
                  setFulfillment(v);
                  if (v !== "SHIPPING") setShipping(null);
                }}
                options={[
                  { v: "PICKUP", label: "Retirada" },
                  { v: "LOCAL", label: "Entrega local" },
                  { v: "SHIPPING", label: "Envio" },
                ]}
              />
              {fulfillment !== "PICKUP" ? (
                <div className="ord-slide mt-3 grid grid-cols-6 gap-2.5">
                  <TextField className="col-span-3" label="CEP" value={addr.cep} inputMode="numeric" onChange={(v) => setA({ cep: maskCep(v) })} onBlur={cepBlur} />
                  <TextField className="col-span-3" label="Número" value={addr.number} onChange={(v) => setA({ number: v })} />
                  <TextField className="col-span-6" label="Rua" value={addr.street} onChange={(v) => setA({ street: v })} />
                  <TextField className="col-span-6" label="Complemento / referência" value={addr.complement} onChange={(v) => setA({ complement: v })} />
                  <TextField className="col-span-6" label="Bairro" value={addr.district} onChange={(v) => setA({ district: v })} />
                  <TextField className="col-span-4" label="Cidade" value={addr.city} onChange={(v) => setA({ city: v })} />
                  <TextField className="col-span-2" label="UF" value={addr.state} onChange={(v) => setA({ state: v.toUpperCase().slice(0, 2) })} />
                </div>
              ) : null}
              {fulfillment === "SHIPPING" ? (
                <div className="ord-slide mt-3 rounded-[20px] bg-[#1F1F1F] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[13px]">
                      <p className="text-[#8C8C8C]">Frete atual {brl(order.shipping_price ?? 0)}</p>
                      <p className="font-bold">Novo frete {brl(shipping?.price ?? 0)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={quoting}
                      onClick={() => recalcShipping()}
                      className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-[#15130F] disabled:opacity-60"
                    >
                      {quoting ? <Loader2 className="size-4 animate-spin" /> : null} Calcular
                    </button>
                  </div>
                  {options.length ? (
                    <ul className="mt-3 space-y-1.5">
                      {options.map((o) => {
                        const on = shipping?.service === o.service;
                        return (
                          <li key={`${o.carrier}-${o.service}`}>
                            <button
                              type="button"
                              onClick={() => setShipping({ service: o.service, price: Number(o.price), days: o.days ?? null })}
                              className={cn(
                                "press flex h-12 w-full items-center justify-between rounded-[14px] px-3.5 text-left text-[13.5px] transition-colors",
                                on ? "bg-white text-[#15130F]" : "bg-[#262626] hover:bg-[#2E2E2E]",
                              )}
                            >
                              <span className="truncate font-semibold">
                                {o.carrier} · {o.service}
                                {o.days ? ` · ${o.days} dias` : ""}
                              </span>
                              <span className="shrink-0 font-bold tabular-nums">{brl(o.price)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </Field>

            <Field title="Pagamento" done>
              <Seg
                value={paymentMethod}
                onChange={setPaymentMethod}
                options={[
                  { v: "PIX", label: "Pix" },
                  { v: "CARD", label: "Cartão" },
                ]}
              />
              {order.status !== "cancelado" ? (
                <div className="mt-3">
                  {/* itens já salvos: marca quais perfumes o cliente pagou */}
                  <PaymentControl order={order} onChanged={onSaved} lines={initialLines} />
                  <p className="mt-2 px-1 text-[12px] text-[#6F6F6F]">O que já foi pago não muda se o total mudar; só o restante é recalculado.</p>
                </div>
              ) : null}
            </Field>

            <Field title="Cupom e observações">
              <div className="grid gap-2.5">
                <TextField label="Cupom" value={coupon} placeholder="Sem cupom" onChange={(v) => setCoupon(v.toUpperCase())} />
                <TextField label="Observação do pedido" value={notes} onChange={setNotes} multiline />
                <TextField label="Motivo da alteração (opcional)" value={reason} placeholder="Ex.: cliente pediu mais um decant" onChange={setReason} />
              </div>
            </Field>

            <details className="group rounded-[20px] bg-[#1A1A1A]">
              <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-4 text-[14.5px] font-bold">
                Histórico do pedido
                <ChevronDown className="size-4 text-[#8C8C8C] transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <ol className="relative mx-4 mb-4 ml-6 border-l border-white/[0.08] pl-5">
                {(events ?? []).slice(0, 15).map((e: any) => (
                  <li key={e.id} className="relative pb-3 last:pb-0">
                    <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-[#FFD599] ring-4 ring-[#1A1A1A]" />
                    <p className="text-[13.5px] font-semibold capitalize">{e.event.replace(/_/g, " ")}</p>
                    <p className="text-[12px] text-[#8C8C8C]">{new Date(e.created_at).toLocaleString("pt-BR")}</p>
                  </li>
                ))}
                {(events ?? []).length === 0 ? <li className="text-[13px] text-[#8C8C8C]">Sem eventos registrados.</li> : null}
              </ol>
            </details>
          </div>

          <footer className="shrink-0 border-t border-white/[0.06] bg-[#161616] px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:px-6 lg:pb-6">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-[#8C8C8C]">
                  {count} {count === 1 ? "item" : "itens"} · antes {brl(before)}
                </p>
                <p className="text-[30px] leading-none font-bold tracking-[-0.04em] tabular-nums">
                  <AnimatedMetric value={estimate} format="BRL" />
                </p>
              </div>
              {dirty ? (
                <span className="adm-pop mb-1 rounded-full bg-[#2A2418] px-2.5 py-1 text-[11.5px] font-bold text-[#FFD599]">Alterações não salvas</span>
              ) : (
                <span className="mb-1 text-[12px] text-[#6F6F6F]">Nada mudou ainda</span>
              )}
            </div>
            <div className="mt-3.5 flex gap-2">
              <button
                type="button"
                onClick={whatsappUpdate}
                aria-label="Avisar cliente no WhatsApp"
                className="press grid size-[58px] shrink-0 place-items-center rounded-full bg-[#1F1F1F] sm:hidden"
              >
                <MessageCircle className="size-5" />
              </button>
              <button
                type="button"
                disabled={busy || !dirty || !lines.length}
                onClick={review}
                className={cn(
                  "press flex h-[58px] flex-1 items-center justify-center gap-2 rounded-full text-[16px] font-bold transition-[background-color,color,opacity] duration-300",
                  dirty && lines.length ? "bg-[#FFD599] text-[#15130F] hover:bg-[#FFDDAA]" : "bg-[#262626] text-[#8C8C8C]",
                )}
              >
                {busy && !summary ? <Loader2 className="size-5 animate-spin" /> : null}
                Revisar alterações
                {dirty && !busy ? <ArrowRight className="size-4" strokeWidth={2.6} /> : null}
              </button>
            </div>
          </footer>
        </aside>
      </div>

      {/* revisão: antes → depois, calculado no servidor */}
      {summary ? (
        <Overlay onBack={() => setSummary(null)}>
          <h3 className="text-[24px] leading-tight font-bold tracking-[-0.03em]">Confere antes de salvar</h3>
          <p className="mt-1 text-[14px] text-[#8C8C8C]">Nada foi alterado ainda.</p>

          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-[24px] bg-[#1A1A1A] p-5">
            <div>
              <p className="text-[12.5px] text-[#8C8C8C]">Antes</p>
              <p className="text-[22px] font-bold tracking-[-0.03em] text-[#A9A9A9] tabular-nums line-through decoration-[#6F6F6F]">{brl(summary.before.total)}</p>
            </div>
            <ArrowRight className="size-5 text-[#FFD599]" strokeWidth={2.4} />
            <div className="text-right">
              <p className="text-[12.5px] text-[#8C8C8C]">Depois</p>
              <p className="text-[26px] font-bold tracking-[-0.035em] tabular-nums">
                <AnimatedMetric value={summary.after.total} format="BRL" />
              </p>
            </div>
          </div>

          <ul className="mt-4 space-y-2">
            {summary.added.map((a, i) => (
              <Diff key={`a${i}`} tone="add" i={i}>
                {a}
              </Diff>
            ))}
            {summary.removed.map((a, i) => (
              <Diff key={`r${i}`} tone="del" i={i + summary.added.length}>
                {a}
              </Diff>
            ))}
            {summary.changed.map((a, i) => (
              <Diff key={`c${i}`} tone="chg" i={i + summary.added.length + summary.removed.length}>
                {a}
              </Diff>
            ))}
            {summary.fields.map((f, i) => (
              <Diff key={`f${i}`} tone="chg" i={i + 6}>
                <b>{f.label}:</b> {f.from} → {f.to}
              </Diff>
            ))}
          </ul>

          {summary.promotionDiscount > 0 || summary.couponDiscount > 0 ? (
            <div className="mt-4 space-y-1 rounded-[20px] bg-[#1A1A1A] p-4 text-[13.5px]">
              {summary.promotionDiscount > 0 ? (
                <p className="flex justify-between text-[#A9A9A9]">
                  <span>Promoções</span>
                  <span className="tabular-nums">−{brl(summary.promotionDiscount)}</span>
                </p>
              ) : null}
              {summary.couponDiscount > 0 ? (
                <p className="flex justify-between text-[#A9A9A9]">
                  <span>Cupom {summary.couponCode ?? ""}</span>
                  <span className="tabular-nums">−{brl(summary.couponDiscount)}</span>
                </p>
              ) : null}
            </div>
          ) : null}
          {summary.couponMessage ? <p className="mt-3 text-[13px] text-[#FF9A8A]">{summary.couponMessage}</p> : null}
          {losses.length ? (
            <p className="mt-3 flex items-start gap-2 rounded-[16px] bg-[#2A1A18] px-3.5 py-3 text-[13px] leading-snug text-[#FFC4BA]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#FF9A8A]" />
              <span>
                <b>Prejuízo:</b> {losses.map((l) => `${productTitle(l.product.canonical_name)} (−${brl(((lineCost(l) ?? 0) - unit(l)) * l.qty)})`).join(", ")} estão abaixo do custo.
              </span>
            </p>
          ) : null}
          {summary.warnings.map((w) => (
            <p key={w} className="mt-2 flex items-start gap-2 text-[13px] text-[#A9A9A9]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#F5C26B]" /> {w}
            </p>
          ))}

          <div className="sticky bottom-0 mt-6 flex gap-2 bg-[#121212] pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={() => setSummary(null)} className="press h-[56px] flex-1 rounded-full bg-[#1F1F1F] text-[15px] font-bold">
              Voltar
            </button>
            <button
              ref={saveBtn}
              type="button"
              disabled={busy || blocked}
              onClick={commit}
              className="press flex h-[56px] flex-[1.5] items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F] hover:bg-[#FFDDAA] disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" strokeWidth={2.6} />}
              {losses.length ? "Salvar mesmo com prejuízo" : "Salvar alterações"}
            </button>
          </div>
          {blocked ? <p className="mt-2 text-center text-[12.5px] text-[#FF9A8A]">Pedido entregue: confirme o aviso no topo para salvar.</p> : null}
        </Overlay>
      ) : null}

      {/* fechar com alterações */}
      {askClose ? (
        <div className="adm-fade absolute inset-0 z-30 grid place-items-center bg-black/60 px-6">
          <div className="adm-pop w-full max-w-[380px] rounded-[28px] border border-white/[0.08] bg-[#1A1A1A] p-6 text-center">
            <p className="text-[20px] font-bold tracking-[-0.02em]">Descartar alterações?</p>
            <p className="mt-1.5 text-[14px] text-[#A9A9A9]">O que você mudou neste pedido ainda não foi salvo.</p>
            <div className="mt-5 grid gap-2">
              <button type="button" onClick={() => setAskClose(false)} className="press h-12 rounded-full bg-white text-[15px] font-bold text-[#15130F]">
                Continuar editando
              </button>
              <button
                type="button"
                onClick={() => {
                  onDirty(false);
                  setAskClose(false);
                  onClose();
                }}
                className="press h-12 rounded-full text-[15px] font-bold text-[#FF9A8A] hover:bg-white/[0.04]"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "warn" | "info"; title: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-[20px] p-4 text-[13.5px] leading-snug", tone === "warn" ? "bg-[#2A1A18] text-[#FFC4BA]" : "bg-[#1F1F1F] text-[#A9A9A9]")}>
      <p className={cn("mb-1 flex items-center gap-2 font-bold", tone === "warn" ? "text-[#FF9A8A]" : "text-white")}>
        {tone === "warn" ? <AlertTriangle className="size-4" /> : <Check className="size-4 text-[#7FCF9F]" strokeWidth={3} />}
        {title}
      </p>
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  inputMode,
  multiline,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  inputMode?: "numeric" | "text";
  multiline?: boolean;
  className?: string;
}) {
  const base =
    "w-full bg-transparent text-[15.5px] text-white outline-none placeholder:text-[#6F6F6F]";
  return (
    <label className={cn("block rounded-[18px] bg-[#1F1F1F] px-4 pt-2 pb-2.5 transition-shadow focus-within:ring-2 focus-within:ring-[#FFD599]/50", className)}>
      <span className="block text-[11.5px] font-semibold text-[#8C8C8C]">{label}</span>
      {multiline ? (
        <textarea data-slot="input-group-control" rows={2} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} className={cn(base, "mt-0.5 resize-none")} />
      ) : (
        <input data-slot="input-group-control" value={value} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} className={cn(base, "mt-0.5 h-7")} />
      )}
    </label>
  );
}

/** Folha que sobe por cima do editor (revisão). */
function Overlay({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black/50">
      <button type="button" aria-label="Voltar" className="min-h-[8vh] flex-1 lg:hidden" onClick={onBack} />
      <div className="ord-sheet-up relative flex max-h-[92%] min-h-0 flex-col self-stretch overflow-y-auto rounded-t-[32px] bg-[#121212] px-5 pt-6 lg:absolute lg:inset-y-0 lg:right-0 lg:max-h-none lg:w-[460px] lg:rounded-none lg:border-l lg:border-white/[0.06] lg:px-6">
        {children}
      </div>
    </div>
  );
}

function Diff({ tone, i, children }: { tone: "add" | "del" | "chg"; i: number; children: ReactNode }) {
  return (
    <li
      className="ord-in flex items-start gap-3 rounded-[18px] bg-[#1A1A1A] p-3.5 text-[13.5px] leading-snug"
      style={{ ["--i" as string]: i + 2 }}
    >
      <span
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[12px] font-bold",
          tone === "add" ? "bg-[#17251C] text-[#7FCF9F]" : tone === "del" ? "bg-[#2A1A18] text-[#FF9A8A]" : "bg-[#2A2418] text-[#FFD599]",
        )}
      >
        {tone === "add" ? "+" : tone === "del" ? "−" : "~"}
      </span>
      <span className={cn("min-w-0", tone === "del" && "text-[#A9A9A9] line-through decoration-[#6F6F6F]")}>{children}</span>
    </li>
  );
}
