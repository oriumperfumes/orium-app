/**
 * PAINEL DO PEDIDO — abre ao lado (computador) ou por cima (celular).
 * Topo: cliente e total. Logo abaixo: as 4 etapas e a próxima ação.
 * Depois: itens com foto, dinheiro, entrega, cliente e histórico.
 */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ArrowRight, Check, ClipboardList, Loader2, MessageCircle, Pencil, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminMore, type AdminAction } from "@/components/orium/admin/AdminUI";
import { paymentEventLabel, paymentInfo } from "@/components/orium/admin/OrderPayment";
import { DeliveryControl, PaymentControl } from "./controls";
import { deliveryEventLabel } from "@/components/orium/admin/Delivery";
import { ArrivalNoticeDialog } from "@/components/orium/admin/ArrivalNoticeDialog";
import { brl, fullDateTime, listDateTime, whatsappLink } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DeliveryChip, PanelClose, SidePanel, initials, orderTotal, originOf } from "./model";
import type { Quick } from "./OrderBoard";

const FULFILLMENT: Record<string, string> = { PICKUP: "Retirada na loja", LOCAL: "Entrega local", SHIPPING: "Envio pelos Correios" };

export function OrderPanel({
  order,
  lines,
  imageOf,
  brandOf,
  restock,
  inRestock,
  alreadyBought,
  quick,
  busy,
  onClose,
  onEdit,
  onChanged,
  more,
  originEl,
}: {
  originEl?: HTMLElement | null;
  order: any | null;
  lines: any[];
  imageOf: (l: any) => string | null | undefined;
  brandOf: (l: any) => string | null;
  restock: "nao" | "parcial" | "enviada";
  inRestock: boolean;
  alreadyBought: boolean;
  quick: Quick;
  busy: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
  onChanged: () => void;
  more: (o: any) => AdminAction[];
}) {
  // mantém o último pedido enquanto o painel anima a saída
  const [last, setLast] = useState<{ o: any; l: any[] } | null>(null);
  if (order && (last?.o !== order || last?.l !== lines)) setLast({ o: order, l: lines });
  const o = order ?? last?.o;
  const ls = order ? lines : (last?.l ?? []);

  return (
    <SidePanel open={!!order} onClose={onClose} label="Pedido" originEl={originEl}>
      {o ? (
        <PanelBody
          o={o}
          lines={ls}
          imageOf={imageOf}
          brandOf={brandOf}
          restock={restock}
          inRestock={inRestock}
          alreadyBought={alreadyBought}
          quick={quick}
          busy={busy}
          onClose={onClose}
          onEdit={onEdit}
          onChanged={onChanged}
          more={more}
        />
      ) : null}
    </SidePanel>
  );
}

function PanelBody({
  o,
  lines,
  imageOf,
  brandOf,
  restock,
  inRestock,
  alreadyBought,
  quick,
  busy,
  onClose,
  onEdit,
  onChanged,
  more,
}: {
  o: any;
  lines: any[];
  imageOf: (l: any) => string | null | undefined;
  brandOf: (l: any) => string | null;
  restock: "nao" | "parcial" | "enviada";
  inRestock: boolean;
  alreadyBought: boolean;
  quick: Quick;
  busy: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
  onChanged: () => void;
  more: (o: any) => AdminAction[];
}) {
  const navigate = useNavigate();
  const [notice, setNotice] = useState(false);
  const wa = whatsappLink(o.customer_phone);
  const pay = paymentInfo(o);
  const total = orderTotal(o);
  const closed = o.deleted_at || o.status === "cancelado";
  const cost = Number(o.cost_total ?? 0);
  const sales = Number(o.sales_total ?? 0);

  const { data: events } = useQuery({
    queryKey: ["order-events", o.id],
    queryFn: async () =>
      (await supabase.from("order_events").select("*").eq("order_id", o.id).order("created_at", { ascending: false })).data ?? [],
  });

  const steps: Array<{ label: string; state: "done" | "half" | "todo" }> = [
    { label: "Recebido", state: "done" },
    { label: "Pago", state: pay.status === "paid" ? "done" : pay.status === "partial" ? "half" : "todo" },
    { label: "Reposição", state: restock === "enviada" ? "done" : restock === "parcial" ? "half" : "todo" },
    { label: "Entregue", state: o.status === "entregue" ? "done" : "todo" },
  ];
  const address = o.shipping_street
    ? `${o.shipping_street}, ${o.shipping_number ?? ""}${o.shipping_complement ? ` — ${o.shipping_complement}` : ""}\n${o.shipping_district ?? ""} · ${o.shipping_city ?? ""}/${o.shipping_state ?? ""} · CEP ${o.shipping_cep ?? ""}`
    : null;

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4 lg:px-6 lg:pt-6">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[16px] font-bold text-[#15130F]">{initials(o.customer_name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[19px] leading-tight font-bold tracking-[-0.02em]">{o.customer_name || "Cliente sem nome"}</p>
          <p className="mt-0.5 truncate text-[13px] text-[#8C8C8C]">
            {fullDateTime(o.created_at)} · {originOf(o)}
            {o.order_number ? ` · #${o.order_number}` : ""}
          </p>
        </div>
        <AdminMore actions={more(o)} />
        <PanelClose onClose={onClose} />
      </header>

      <div className="ord-cascade min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-8">
        {/* total + etapas */}
        <section className="ord-slide rounded-[26px] bg-[#1A1A1A] p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[13px] text-[#8C8C8C]">{closed ? (o.deleted_at ? "Na lixeira" : "Cancelado") : "Total do pedido"}</p>
              <p className="mt-1 text-[34px] leading-none font-bold tracking-[-0.045em] tabular-nums">{brl(total)}</p>
            </div>
            <DeliveryChip order={o} className="mb-1 h-7 px-3 text-[12.5px]" />
          </div>
          {!closed ? (
            <ol className="mt-5 grid grid-cols-4 gap-1.5">
              {steps.map((s, i) => (
                <li key={s.label} className="min-w-0">
                  <span className="ord-step block h-1.5 overflow-hidden rounded-full bg-[#2E2E2E]">
                    <i
                      className={cn("block h-full rounded-full", s.state === "todo" ? "bg-transparent" : "bg-[#FFD599]")}
                      style={{ width: s.state === "done" ? "100%" : s.state === "half" ? "50%" : "0%", transitionDelay: `${i * 90}ms` }}
                    />
                  </span>
                  <span className={cn("mt-2 flex items-center gap-1 truncate text-[12px] font-semibold", s.state === "todo" ? "text-[#6F6F6F]" : "text-white")}>
                    {s.state === "done" ? <Check className="size-3.5 text-[#FFD599]" strokeWidth={3} /> : null}
                    {s.label}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {quick || wa ? (
            <div className="mt-5 flex gap-2">
              {quick ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => quick.run({ x: e.clientX, y: e.clientY })}
                  className="press inline-flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#FFD599] px-5 text-[15px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA] disabled:opacity-60"
                >
                  {busy ? <Loader2 className="size-5 animate-spin" /> : <>{quick.label} <ArrowRight className="size-4" strokeWidth={2.6} /></>}
                </button>
              ) : null}
              {wa ? (
                <a
                  href={wa}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "press inline-flex h-[52px] items-center justify-center gap-2 rounded-full bg-[#262626] px-5 text-[15px] font-bold transition-colors hover:bg-[#2E2E2E]",
                    !quick && "flex-1",
                  )}
                >
                  <MessageCircle className="size-[18px]" strokeWidth={2.2} /> WhatsApp
                </a>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* itens */}
        <Block title={`${lines.length} ${lines.length === 1 ? "item" : "itens"}`} action={
          <button type="button" onClick={() => onEdit(o.id)} className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1F1F1F] px-3.5 text-[13px] font-bold text-[#D4D4D4] hover:text-white">
            <Pencil className="size-3.5" strokeWidth={2.4} /> Editar
          </button>
        }>
          <ul className="space-y-2">
            {lines.map((l, i) => {
              const img = imageOf(l);
              const decant = l.variant === "DECANT";
              const listed = Number(l.unit_base_price ?? 0);
              const sold = Number(l.unit_sale_price ?? 0);
              return (
                <li key={l.id} className="ord-slide flex min-w-0 items-center gap-3 rounded-[22px] bg-[#1A1A1A] p-2.5 pr-4" style={{ animationDelay: `${60 + i * 50}ms` }}>
                  <span className="grid size-[68px] shrink-0 place-items-center overflow-hidden rounded-[16px] bg-white">
                    {img ? <img src={img} alt="" loading="lazy" className="size-full object-contain p-1.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    {brandOf(l) ? <span className="block truncate text-[12px] text-[#8C8C8C]">{brandOf(l)}</span> : null}
                    <span className="block truncate text-[15px] font-bold">{l.product_name_snapshot}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className={cn("rounded-full px-2 py-px text-[11px] font-bold whitespace-nowrap", decant ? "bg-[#2A2418] text-[#FFD599]" : "bg-[#262626] text-[#D4D4D4]")}>
                        {decant ? `Decant ${l.decant_ml ?? "?"}ml` : (l.variant_label ?? "Frasco")}
                      </span>
                      <span className="text-[12.5px] whitespace-nowrap text-[#8C8C8C] tabular-nums">
                        {l.quantity}× {brl(sold)}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[15px] font-bold tabular-nums">{brl(l.subtotal ?? sold * l.quantity)}</span>
                    {listed > 0 && Math.abs(listed - sold) >= 0.01 ? (
                      <span className="block text-[11.5px] text-[#8C8C8C] line-through tabular-nums">{brl(listed * l.quantity)}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
            {lines.length === 0 ? <li className="text-[14px] text-[#8C8C8C]">Sem itens.</li> : null}
          </ul>
          <dl className="mt-3 space-y-1.5 rounded-[22px] bg-[#1A1A1A] p-4 text-[14px]">
            <Row label="Produtos" value={brl(sales)} />
            <Row
              label="Frete"
              value={o.fulfillment_type === "SHIPPING" ? brl(o.shipping_price) : o.fulfillment_type === "LOCAL" ? "a combinar" : "grátis"}
            />
            {Number(o.discount_total ?? 0) > 0 ? <Row label="Desconto" value={`− ${brl(o.discount_total)}`} /> : null}
            {Number(o.payment_discount_percent ?? 0) > 0 ? (
              <Row label={`Pix (${o.payment_discount_percent}% off) · cartão`} value={`${brl(o.pix_total ?? total)} · ${brl(o.card_total ?? total)}`} />
            ) : null}
            <div className="mt-2 flex items-baseline justify-between border-t border-white/[0.06] pt-2.5">
              <dt className="font-bold">Total</dt>
              <dd className="text-[18px] font-bold tabular-nums">{brl(total)}</dd>
            </div>
          </dl>
        </Block>

        {/* pagamento */}
        <Block
          title="Pagamento"
          action={
            <span className="text-[13px] font-semibold text-[#8C8C8C]">
              {o.payment_method === "CARD" ? "Cartão" : "Pix"} · {brl(pay.paid)} de {brl(pay.total)}
            </span>
          }
        >
          <div className="rounded-[22px] bg-[#1A1A1A] p-3.5">
            {!closed ? <PaymentControl order={o} onChanged={onChanged} /> : <p className="text-[14px] text-[#8C8C8C]">Pedido {o.deleted_at ? "na lixeira" : "cancelado"}.</p>}
          </div>
        </Block>

        {/* entrega */}
        <Block title={o.fulfillment_type === "PICKUP" ? "Retirada" : "Entrega"} action={<span className="text-[13px] font-semibold text-[#8C8C8C]">{FULFILLMENT[o.fulfillment_type ?? "PICKUP"]}</span>}>
          <div className="rounded-[22px] bg-[#1A1A1A] p-3.5">
            {address ? <p className="mb-3 px-1 text-[14px] whitespace-pre-line text-[#D4D4D4]">{address}</p> : null}
            {!closed ? <DeliveryControl order={o} onChanged={onChanged} /> : null}
          </div>
        </Block>

        {/* cliente */}
        <Block title="Cliente">
          <div className="flex flex-wrap items-center gap-2 rounded-[22px] bg-[#1A1A1A] p-4">
            <span className="inline-flex min-w-0 flex-1 items-center gap-2 text-[14.5px]">
              <Phone className="size-4 shrink-0 text-[#8C8C8C]" />
              <span className="truncate">{o.customer_phone || "Sem telefone"}</span>
            </span>
            {wa ? (
              <button type="button" onClick={() => setNotice(true)} className="press h-10 rounded-full bg-white px-4 text-[13.5px] font-bold text-[#15130F]">
                Avisar que chegou
              </button>
            ) : null}
            <ArrivalNoticeDialog open={notice} onOpenChange={setNotice} order={o} lines={lines} />
          </div>
          {o.notes ? <p className="mt-2 rounded-[18px] bg-[#1A1A1A] px-4 py-3 text-[14px] text-[#D4D4D4]">“{o.notes}”</p> : null}
        </Block>

        {/* histórico */}
        <Block title="Histórico">
          <ol className="relative ml-2 border-l border-white/[0.08] pl-5">
            {(events ?? []).slice(0, 12).map((e: any) => (
              <li key={e.id} className="relative pb-4 last:pb-0">
                <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-[#FFD599] ring-4 ring-[#121212]" />
                <p className="text-[14px] font-semibold">
                  {cap(paymentEventLabel(e.event, e.details) ?? deliveryEventLabel(e.event, e.details) ?? e.event.replace(/_/g, " "))}
                </p>
                <p className="text-[12.5px] text-[#8C8C8C]">{listDateTime(e.created_at)}</p>
              </li>
            ))}
            {(events ?? []).length === 0 ? <li className="text-[14px] text-[#8C8C8C]">Sem eventos registrados.</li> : null}
          </ol>
        </Block>

        {/* interno */}
        <Block title="Só para a equipe">
          <dl className="space-y-1.5 rounded-[22px] bg-[#1A1A1A] p-4 text-[14px]">
            <Row label="Custo dos produtos" value={brl(cost)} />
            <Row label="Lucro estimado" value={<span className="text-[#7FCF9F]">{brl(sales - cost)}</span>} />
            <Row label="Preço" value={o.pricing_tier === "atacado" ? "Atacado" : "Varejo"} />
            {lines.some((l) => l.supplier_snapshot) ? (
              <Row label="Fornecedor" value={[...new Set(lines.map((l) => l.supplier_snapshot).filter(Boolean))].join(", ")} />
            ) : null}
            <Row label="Reposição" value={alreadyBought ? "já encomendado" : inRestock ? "na lista" : "fora da lista"} />
          </dl>
          {o.is_confirmed ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate({ to: "/admin/reposicao", search: { pedido: o.id } as never });
              }}
              className="press mt-2 inline-flex h-10 items-center gap-1.5 rounded-full px-1 text-[13.5px] font-bold text-[#FFD599]"
            >
              <ClipboardList className="size-4" /> Ver na reposição
            </button>
          ) : null}
        </Block>
      </div>
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
        <h3 className="text-[16px] font-bold tracking-[-0.01em]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[#8C8C8C]">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
