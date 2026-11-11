/**
 * HOJE — a central de alertas dos pedidos.
 *
 * Responde em uma tela: o que entregar, de quem cobrar, o que comprar e o que
 * está sem data. Cada linha já traz a ação certa (Entregar, Recebi, Cobrar no
 * WhatsApp, Marcar dia). Se não há nada, diz que está tudo em dia.
 */
import type { ReactNode } from "react";
import { ArrowRight, CalendarClock, Check, HandCoins, MessageCircle, PackageCheck, ShoppingCart, Truck } from "lucide-react";
import { paymentInfo } from "@/components/orium/admin/OrderPayment";
import { deliveryState, fmtTime, todayBR } from "@/lib/delivery";
import { brl, whatsappLink } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PurchaseItem } from "@/lib/orders-control.functions";
import { PhotoStack, initials, orderTotal } from "./model";
import { addDays, dayLabel, daysBetween, dueInfo } from "./controls";

type Pt = { x: number; y: number };

export function TodayView({
  orders,
  linesOf,
  imageOf,
  purchases,
  onOpen,
  onDeliver,
  onReceived,
  onGoPurchases,
  compact,
}: {
  /** sem os 4 números do topo (dentro do painel de Pedidos) */
  compact?: boolean;
  orders: any[];
  linesOf: (o: any) => any[];
  imageOf: (l: any) => string | null | undefined;
  purchases: PurchaseItem[] | undefined;
  onOpen: (o: any, el?: HTMLElement | null) => void;
  onDeliver: (o: any, at?: Pt) => void;
  onReceived: (o: any, at?: Pt) => void;
  onGoPurchases: () => void;
}) {
  const t = todayBR();
  const live = orders.filter((o) => !o.deleted_at && o.status !== "cancelado");
  const open = live.filter((o) => o.status !== "entregue");

  const lateDelivery = open.filter((o) => deliveryState(o) === "late");
  const todayDelivery = open.filter((o) => deliveryState(o) === "today").sort((a, b) => (a.expected_delivery_time ?? "99").localeCompare(b.expected_delivery_time ?? "99"));
  const tomorrowDelivery = open.filter((o) => deliveryState(o) === "tomorrow");
  const noDate = open.filter((o) => o.status === "pedido feito" && !o.expected_delivery_date);

  const deliveredOwing = live.filter((o) => o.status === "entregue" && paymentInfo(o).due > 0);
  const payLate = open.filter((o) => dueInfo(o).state === "late");
  const payToday = open.filter((o) => dueInfo(o).state === "today");
  const payTomorrow = open.filter((o) => dueInfo(o).state === "tomorrow");
  const stale = open.filter(
    (o) => o.status === "pendente" && paymentInfo(o).paid <= 0 && dueInfo(o).state === "none" && Date.now() - new Date(o.created_at).getTime() > 2 * 86_400_000,
  );

  const toBuy = (purchases ?? []).filter((p) => p.status === "a comprar");
  const buyNow = toBuy.filter((p) => p.plannedDate && p.plannedDate <= t);
  const buyNoDate = toBuy.filter((p) => !p.plannedDate);
  const arriving = (purchases ?? []).filter((p) => p.status === "pedido feito");

  const cobrar = [...deliveredOwing, ...payLate, ...payToday];
  const cobrarValor = cobrar.reduce((s, o) => s + paymentInfo(o).due, 0);
  const buyValue = buyNow.reduce((s, p) => s + p.unitCost * p.quantity, 0);
  const nothing =
    !lateDelivery.length && !todayDelivery.length && !cobrar.length && !buyNow.length && !noDate.length && !stale.length && !buyNoDate.length;

  const row = (o: any, extra: ReactNode, action?: ReactNode, tone?: "late" | "today" | "info") => {
    const lines = linesOf(o);
    return (
      <li key={o.id}>
        <div
          role="button"
          tabIndex={0}
          data-order-id={o.id}
          onClick={(e) => onOpen(o, e.currentTarget)}
          onKeyDown={(e) => e.key === "Enter" && onOpen(o, e.currentTarget)}
          className="ord-card flex min-w-0 items-center gap-3 p-3 pr-3.5"
        >
          <span
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full text-[13px] font-bold",
              tone === "late" ? "bg-[#2A1A18] text-[#FF9A8A]" : tone === "today" ? "bg-[#FFD599] text-[#15130F]" : "bg-[#2E2E2E]",
            )}
          >
            {initials(o.customer_name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-bold">{o.customer_name || "Cliente"}</span>
            <span className="block truncate text-[12.5px] text-[#8C8C8C]">{extra}</span>
          </span>
          <span className="hidden sm:block">
            <PhotoStack images={lines.map(imageOf)} more={Math.max(0, lines.length - 3)} size={32} />
          </span>
          {action ? (
            <span className="shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              {action}
            </span>
          ) : null}
        </div>
      </li>
    );
  };

  const btn = (label: ReactNode, onClick: (e: React.MouseEvent<HTMLButtonElement>) => void, gold?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition-colors",
        gold ? "bg-[#FFD599] text-[#15130F] hover:bg-[#FFDDAA]" : "bg-white text-[#15130F] hover:bg-[#FFD599]",
      )}
    >
      {label}
    </button>
  );
  const at = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const charge = (o: any) => {
    const wa = whatsappLink(o.customer_phone);
    if (!wa) return null;
    const first = (o.customer_name ?? "").trim().split(/\s+/)[0];
    const msg = `Oi${first ? `, ${first}` : ""}! Tudo bem? Passando para lembrar do valor de ${brl(paymentInfo(o).due)} do seu pedido na Orium. Me avisa quando puder fazer o Pix? 😊`;
    const href = `${wa}${wa.includes("?") ? "&" : "?"}text=${encodeURIComponent(msg)}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label="Cobrar no WhatsApp"
        className="press grid size-10 place-items-center rounded-full bg-[#262626] text-white transition-colors hover:bg-[#2E2E2E]"
      >
        <MessageCircle className="size-[17px]" />
      </a>
    );
  };
  const deliverBtn = (o: any) => {
    const p = paymentInfo(o);
    return p.due > 0 ? (
      <span className="flex items-center gap-1.5">
        {charge(o)}
        {btn(<>Cobrar<span className="max-sm:hidden"> {brl(p.due)}</span></>, () => onOpen(o), true)}
      </span>
    ) : (
      btn(<>Entregar <ArrowRight className="size-3.5" strokeWidth={2.6} /></>, (e) => onDeliver(o, at(e)))
    );
  };

  return (
    <div className="space-y-4">
      {/* resumo do dia */}
      <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4", compact && "hidden")}>
        <Big i={0} hero icon={<Truck className="size-[18px]" />} label="Entregar hoje" value={String(todayDelivery.length + lateDelivery.length)} hint={lateDelivery.length ? `${lateDelivery.length} atrasada${lateDelivery.length > 1 ? "s" : ""}` : "no horário"} alert={lateDelivery.length > 0} />
        <Big i={1} icon={<HandCoins className="size-[18px]" />} label="Cobrar" value={brl(cobrarValor)} hint={cobrar.length ? `${cobrar.length} ${cobrar.length === 1 ? "cliente" : "clientes"}` : "ninguém devendo hoje"} alert={payLate.length + deliveredOwing.length > 0} />
        <Big i={2} icon={<ShoppingCart className="size-[18px]" />} label="Comprar hoje" value={brl(buyValue)} hint={buyNow.length ? `${buyNow.reduce((s, p) => s + p.quantity, 0)} frascos` : buyNoDate.length ? `${buyNoDate.length} sem dia marcado` : "nada agendado"} onClick={onGoPurchases} />
        <Big i={3} icon={<PackageCheck className="size-[18px]" />} label="Chegando" value={String(arriving.reduce((s, p) => s + p.quantity, 0))} hint="frascos já comprados" onClick={onGoPurchases} />
      </div>

      {nothing ? (
        <div className="dash-card adm-rise flex flex-col items-center px-6 py-14 text-center" style={{ ["--i" as string]: 4 }}>
          <span className="ord-ok-ring grid size-20 place-items-center rounded-full bg-[#17251C] text-[#7FCF9F]">
            <Check className="size-10" strokeWidth={2.6} />
          </span>
          <p className="mt-5 text-[22px] font-bold tracking-[-0.02em]">Tudo em dia</p>
          <p className="mt-1 text-[14.5px] text-[#8C8C8C]">Nenhuma entrega, cobrança ou compra pendente para hoje.</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
          {lateDelivery.length || todayDelivery.length ? (
            <Section i={4} tone={lateDelivery.length ? "late" : "today"} icon={<Truck className="size-[18px]" />} title="Entregas de hoje" count={lateDelivery.length + todayDelivery.length}>
              {lateDelivery.map((o) => row(o, <span className="font-semibold text-[#FF9A8A]">Atrasada desde {dayLabel(o.expected_delivery_date).toLowerCase()} · {brl(orderTotal(o))}</span>, deliverBtn(o), "late"))}
              {todayDelivery.map((o) => row(o, <>{fmtTime(o.expected_delivery_time) ? `Às ${fmtTime(o.expected_delivery_time)}` : "Hoje"} · {o.fulfillment_type === "PICKUP" ? "retira na loja" : "entrega"} · {brl(orderTotal(o))}</>, deliverBtn(o), "today"))}
            </Section>
          ) : null}

          {cobrar.length ? (
            <Section i={5} tone={deliveredOwing.length || payLate.length ? "late" : "today"} icon={<HandCoins className="size-[18px]" />} title="Cobrar" count={cobrar.length} right={brl(cobrarValor)}>
              {deliveredOwing.map((o) =>
                row(
                  o,
                  <span className="font-semibold text-[#FF9A8A]">Já entregue e deve {brl(paymentInfo(o).due)}</span>,
                  <span className="flex items-center gap-1.5">
                    {charge(o)}
                    {btn("Recebi", (e) => onReceived(o, at(e)), true)}
                  </span>,
                  "late",
                ),
              )}
              {payLate.map((o) =>
                row(
                  o,
                  <span className="font-semibold text-[#FF9A8A]">
                    Combinado {dayLabel(dueInfo(o).date).toLowerCase()} · falta {brl(paymentInfo(o).due)}
                  </span>,
                  <span className="flex items-center gap-1.5">
                    {charge(o)}
                    {btn("Recebi", (e) => onReceived(o, at(e)), true)}
                  </span>,
                  "late",
                ),
              )}
              {payToday.map((o) =>
                row(
                  o,
                  <>Paga hoje · falta {brl(paymentInfo(o).due)}</>,
                  <span className="flex items-center gap-1.5">
                    {charge(o)}
                    {btn("Recebi", (e) => onReceived(o, at(e)), true)}
                  </span>,
                  "today",
                ),
              )}
            </Section>
          ) : null}

          {buyNow.length || buyNoDate.length ? (
            <Section i={6} tone={buyNow.some((p) => p.plannedDate! < t) ? "late" : "today"} icon={<ShoppingCart className="size-[18px]" />} title="Comprar no fornecedor" count={buyNow.length} right={buyNow.length ? brl(buyValue) : undefined}>
              {groupBySupplier(buyNow).map(([sup, items]) => (
                <li key={sup}>
                  <button type="button" onClick={onGoPurchases} className="ord-card flex w-full min-w-0 items-center gap-3 p-3 pr-3.5 text-left">
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[#15130F]">
                      <ShoppingCart className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">{sup}</span>
                      <span className="block truncate text-[12.5px] text-[#8C8C8C]">
                        {items.reduce((s, p) => s + p.quantity, 0)} frascos · {brl(items.reduce((s, p) => s + p.unitCost * p.quantity, 0))}
                        {items.some((p) => p.plannedDate! < t) ? " · era para ter comprado" : ""}
                      </span>
                    </span>
                    <PhotoStack images={items.map((p) => p.image)} more={Math.max(0, items.length - 3)} size={32} />
                  </button>
                </li>
              ))}
              {buyNoDate.length ? (
                <li>
                  <button type="button" onClick={onGoPurchases} className="press flex h-12 w-full items-center justify-between rounded-[18px] bg-[#1F1F1F] px-4 text-[13.5px] font-semibold text-[#A9A9A9] hover:text-white">
                    <span>
                      <CalendarClock className="mr-1.5 inline size-4" /> {buyNoDate.length} {buyNoDate.length === 1 ? "perfume" : "perfumes"} sem dia de compra
                    </span>
                    <span className="text-[#FFD599]">Agendar →</span>
                  </button>
                </li>
              ) : null}
            </Section>
          ) : null}

          {noDate.length ? (
            <Section i={7} tone="info" icon={<CalendarClock className="size-[18px]" />} title="Pagos sem dia de entrega" count={noDate.length}>
              {noDate.map((o) => row(o, <>Pago · {brl(orderTotal(o))} · combine o dia com o cliente</>, btn("Marcar dia", () => onOpen(o))))}
            </Section>
          ) : null}

          {tomorrowDelivery.length || payTomorrow.length ? (
            <Section i={8} tone="info" icon={<CalendarClock className="size-[18px]" />} title={`Amanhã · ${addDays(t, 1).slice(8, 10)}/${addDays(t, 1).slice(5, 7)}`} count={tomorrowDelivery.length + payTomorrow.length}>
              {tomorrowDelivery.map((o) => row(o, <>Entrega{fmtTime(o.expected_delivery_time) ? ` às ${fmtTime(o.expected_delivery_time)}` : ""} · {brl(orderTotal(o))}</>))}
              {payTomorrow.map((o) => row(o, <>Combinou pagar {brl(paymentInfo(o).due)}</>))}
            </Section>
          ) : null}

          {stale.length ? (
            <Section i={9} tone="info" icon={<HandCoins className="size-[18px]" />} title="Pedidos parados sem pagamento" count={stale.length}>
              {stale.map((o) =>
                row(
                  o,
                  <>Há {Math.max(2, daysBetween(o.created_at.slice(0, 10), t))} dias · {brl(orderTotal(o))} · sem data combinada</>,
                  <span className="flex items-center gap-1.5">{charge(o)}</span>,
                ),
              )}
            </Section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function groupBySupplier(items: PurchaseItem[]) {
  const m = new Map<string, PurchaseItem[]>();
  items.forEach((p) => {
    const k = p.supplier ?? "Sem fornecedor";
    m.set(k, [...(m.get(k) ?? []), p]);
  });
  return [...m.entries()];
}

function Big({ label, value, hint, icon, hero, alert, i, onClick }: { label: string; value: string; hint: string; icon: ReactNode; hero?: boolean; alert?: boolean; i: number; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn("adm-rise flex min-h-[132px] flex-col justify-between p-4 text-left lg:p-5", hero ? "dash-hero" : "dash-card", onClick && "press transition-colors hover:bg-[#1F1F1F]")}
      style={{ ["--i" as string]: i }}
    >
      <span className="flex items-start justify-between gap-2">
        <span className={cn("text-[14px] font-semibold", hero ? "text-[#15130F]/70" : "text-[#A9A9A9]")}>{label}</span>
        <span className="dash-ico size-10">{icon}</span>
      </span>
      <span>
        <span className="block truncate text-[clamp(1.5rem,4.5vw,2.1rem)] leading-none font-bold tracking-[-0.04em] tabular-nums">{value}</span>
        <span className={cn("mt-1.5 flex items-center gap-1.5 truncate text-[12.5px]", hero ? "text-[#15130F]/65" : alert ? "font-bold text-[#FF9A8A]" : "text-[#8C8C8C]")}>
          {alert && !hero ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#FF9A8A]" /> : null}
          {hint}
        </span>
      </span>
    </Tag>
  );
}

function Section({
  title,
  count,
  icon,
  tone,
  right,
  i,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  tone: "late" | "today" | "info";
  right?: string | undefined;
  i: number;
  children: ReactNode;
}) {
  return (
    <section className="dash-card adm-rise min-w-0 p-3 lg:p-4" style={{ ["--i" as string]: i }}>
      <header className="flex items-center gap-2.5 px-1.5 pt-1 pb-3">
        <span
          className={cn(
            "grid size-9 place-items-center rounded-full",
            tone === "late" ? "bg-[#2A1A18] text-[#FF9A8A]" : tone === "today" ? "bg-[#FFD599] text-[#15130F]" : "bg-[#262626] text-white",
          )}
        >
          {icon}
        </span>
        <h2 className="min-w-0 truncate text-[17px] font-bold tracking-[-0.01em]">{title}</h2>
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[#262626] px-2 text-[12px] font-bold tabular-nums">{count}</span>
        {right ? <span className="ml-auto text-[14px] font-bold tabular-nums">{right}</span> : null}
      </header>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}
