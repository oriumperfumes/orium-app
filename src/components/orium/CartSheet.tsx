import { imgVariant } from "@/lib/product-img";
import { ORIUM_WHATSAPP, useBlackOpen, usePricesOnRequestAll } from "@/lib/price-on-request";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  MessageCircle,
  Loader2,
  Check,
  ChevronLeft,
  ArrowRight,
  Ticket,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createPortal } from "react-dom";
import { brl, maskCep, maskPhone, isValidPhoneBR, productTitle } from "@/lib/format";
import { useCart, type CartItem } from "@/lib/cart";
import { canDecant, decantPrice, trackDecant } from "@/lib/decants";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { useOlfactorySimilar } from "@/lib/search-intent";
import { useAuth } from "@/lib/auth";
import { placeCatalogOrder, type FulfillmentType } from "@/lib/catalog.functions";
import { deviceId } from "@/lib/promotions";
import { usePublicCoupons } from "@/lib/use-promotions";
import { CELEBRATION, ConfettiBurst, CountUp, useCelebrateOnce } from "@/lib/celebration";
import { getPaymentPricing, paymentLabel, pixOffLabel, usePaymentSettings, type PaymentMethod } from "@/lib/payment";

import { fetchAddressByCep } from "@/lib/shipping.functions";
import { ProductImage } from "./ProductCard";
import { cn } from "@/lib/utils";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { navigatingFromLayer, useBackToClose } from "@/hooks/use-back-to-close";
import { track } from "@/lib/analytics";
import { useLead } from "@/lib/lead";
import { ReadyTag } from "@/components/orium/badges";
import { BlackCountdown, BlackOff, BlackTag } from "@/components/orium/black/Black";
import { isBlack } from "@/lib/black";
import { DecantComboBag } from "@/components/orium/DecantCombo";
import { OrderSuccess, type OrderDone } from "@/components/orium/OrderSuccess";
import { StepBar } from "@/components/orium/StepProgress";
import { useReadyToDeliverSnapshot } from "@/lib/ready-to-deliver";

const WHATSAPP = "5521977174508";

/** Sacola em tela cheia (Figma): itens → finalizar pedido → pedido enviado. */
export function CartDrawer() {
  const cart = useCart();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => setMounted(true), []);

  // entra deslizando da direita; ao fechar, sai pelo mesmo caminho
  useEffect(() => {
    if (cart.open) {
      setVisible(true);
      return;
    }
    const t = window.setTimeout(() => setVisible(false), 320);
    return () => window.clearTimeout(t);
  }, [cart.open]);

  // gesto de voltar do celular fecha a sacola (não sai do app nem troca de página)
  useBackToClose(cart.open, () => cart.setOpen(false));

  // a página de trás não rola enquanto a sacola está aberta; Esc fecha
  useEffect(() => {
    if (!cart.open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cart.setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.open]);

  if (!mounted || (!cart.open && !visible)) return null;
  return createPortal(
    <>
      {/* computador: a sacola é um painel à direita; clicar fora fecha */}
      <div
        aria-hidden
        onClick={() => cart.setOpen(false)}
        className={cn("side-scrim fixed inset-0 z-[59] hidden bg-black/55 lg:block", cart.open ? "is-in" : "is-out")}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sacola"
        className={cn("cart-page fixed inset-0 z-[60] flex flex-col bg-[#101010] text-white", cart.open ? "is-in" : "is-out")}
      >
        <CartBody keyboardOpen={false} onClose={() => cart.setOpen(false)} />
      </div>
    </>,
    document.body,
  );
}

const emptyAddress = {
  cep: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
};

function CartBody({ keyboardOpen: _keyboardOpen, onClose }: { keyboardOpen: boolean; onClose: () => void }) {
  const cart = useCart();
  const { readyIds, resolved: readyResolved } = useReadyToDeliverSnapshot();
  const hasSpecialOrder = readyResolved && cart.items.some((item) => !readyIds.has(item.productId));
  const { session } = useAuth();
  const place = useServerFn(placeCatalogOrder);
  const lookupCep = useServerFn(fetchAddressByCep);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { lead, updateLead } = useLead();
  const checkoutTracked = useRef(false);
  // Admin → Precificação → "Preços sob consulta": sacola sem preço nem checkout
  const blackOpen = useBlackOpen();
  // ...a não ser que a Sacola só tenha perfumes da Black (esses vendem pelo site)
  const onRequestAll =
    usePricesOnRequestAll() &&
    !(cart.items.length > 0 && cart.items.every((i) => blackOpen.all || blackOpen.ids.has(i.productId)));

  // mantém o campo tocado visível acima do teclado, sem pulos
  const onFieldFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    // primeiro toque em um campo = o cliente começou a finalizar (registro em segundo plano)
    if (!checkoutTracked.current) {
      checkoutTracked.current = true;
      track("checkout_started", { price: cart.total });
    }
    window.setTimeout(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 320);
  };

  // quem já se identificou não precisa digitar nome/WhatsApp de novo
  const [name, setName] = useState(lead?.name ?? "");
  const [phone, setPhone] = useState(lead?.phone ? maskPhone(lead.phone) : "");
  const [fulfillment, setFulfillment] = useState<FulfillmentType | null>(null);
  const [address, setAddress] = useState(emptyAddress);
  const [cepBusy, setCepBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const orderKey = useRef(crypto.randomUUID());
  /** Etapas da sacola: itens → finalizar → pedido enviado. */
  const [step, setStep] = useState<"bag" | "checkout">("bag");
  const [back, setBack] = useState(false);
  const [done, setDone] = useState<null | OrderDone>(null);
  const go = (next: "bag" | "checkout") => {
    setBack(next === "bag");
    setStep(next);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
    if (next === "checkout" && !checkoutTracked.current) {
      checkoutTracked.current = true;
      track("checkout_started", { price: cart.total });
    }
  };

  /**
   * A ficha do cliente é lida do aparelho depois da primeira renderização.
   * Quando ela chega, preenchemos nome/WhatsApp — sem apagar o que a pessoa
   * já estiver digitando.
   */
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !lead) return;
    prefilled.current = true;
    setName((n) => (n.trim() ? n : (lead.name ?? "")));
    setPhone((p) => (p.trim() ? p : lead.phone ? maskPhone(lead.phone) : ""));
  }, [lead]);


  const cepDigits = address.cep.replace(/\D/g, "");
  // Entrega: valor e prazo são combinados pelo WhatsApp antes do pagamento,
  // então nunca entram no total do pedido feito pelo site.
  const shippingPrice = 0;

  // Pagamento: o total dos produtos é o preço no Pix; o cartão é derivado pela
  // regra central. O frete nunca recebe a diferença.
  // No lançamento o pagamento é só Pix (regra única em checkout-rules).
  const paymentMethod: PaymentMethod = "PIX";
  const paymentSettings = usePaymentSettings();
  const payment = getPaymentPricing(cart.total, paymentSettings);
  const pixOff = pixOffLabel(paymentSettings);
  const productsTotal = payment.pixPrice;
  const grandTotal = productsTotal + shippingPrice;

  const addressComplete =
    cepDigits.length === 8 &&
    Boolean(address.street && address.number && address.district && address.city && address.state);

  const canSubmit = useMemo(() => {
    if (cart.items.length === 0) return false;
    if (name.trim().length < 3 || !isValidPhoneBR(phone)) return false;
    if (!fulfillment) return false;
    if (fulfillment === "PICKUP") return true;
    return addressComplete;
  }, [cart.items.length, name, phone, fulfillment, addressComplete]);

  // CEP preenche o endereço automaticamente
  useEffect(() => {
    if (fulfillment === "PICKUP" || cepDigits.length !== 8) return;
    let cancelled = false;
    setCepBusy(true);
    void lookupCep({ data: { cep: cepDigits } })
      .then((found) => {
        if (cancelled) return;
        if (!found) {
          toast.error("CEP não encontrado. Confira o número.");
          return;
        }
        setAddress((a) => ({ ...a, street: found.street || a.street, district: found.district || a.district, city: found.city, state: found.state }));
      })
      .finally(() => !cancelled && setCepBusy(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cepDigits, fulfillment]);

  const submit = async () => {
    if (!canSubmit || sending) return;
    setSending(true);
    try {
      const res = await place({
        data: {
          items: cart.items.map((i) => ({
            productId: i.productId,
            variant: i.variant,
            decantMl: i.decantMl,
            quantity: i.quantity,
            unitPrice: cart.finalUnitPrice(i),
          })),
          customerName: name.trim(),
          customerPhone: phone,
          couponCode: cart.couponCode,
          deviceId: deviceId(),
          fulfillment: fulfillment ?? "PICKUP",
          address: fulfillment === "PICKUP" ? null : address,
          paymentMethod,
          idempotencyKey: orderKey.current,
        },
      });

      if (!res.orderId) throw new Error("O pedido não pôde ser registrado.");
      if (res.couponMessage) toast.info(res.couponMessage);
      if (res.changed.length) toast.info(`O preço de ${res.changed.join(", ")} foi atualizado.`);
      if (res.unavailable.length) {
        toast.warning(`Sem estoque no momento: ${res.unavailable.join(", ")}. Vamos confirmar no WhatsApp.`);
      }

      if (res.lines.some((l) => l.variant === "DECANT")) trackDecant("decant_checkout", { details: { orderId: res.orderId } });

      const linhaItem = (l: (typeof res.lines)[number]) =>
        l.quantity > 1
          ? `• ${l.quantity}x ${l.name} (${l.variantLabel}) — ${brl(l.unitPrice)} cada, ${brl(l.subtotal)}`
          : `• ${l.name} (${l.variantLabel}) — ${brl(l.subtotal)}`;
      const bloco = (title: string, list: typeof res.lines) =>
        list.length ? `${title}\n${list.map(linhaItem).join("\n")}` : "";
      const decantLines = res.lines.filter((l) => l.variant === "DECANT");
      const bottleLines = res.lines.filter((l) => l.variant !== "DECANT");
      const linhas = [bloco("🧪 Decants", decantLines), bloco("🧴 Frascos", bottleLines)].filter(Boolean).join("\n\n");

      const first = name.trim().split(/\s+/)[0] ?? "";
      const addr = `${address.street}, ${address.number}${address.complement ? ` - ${address.complement}` : ""} — ${address.district}, ${address.city}/${address.state} (CEP ${address.cep})`;
      const recebimento =
        fulfillment === "PICKUP"
          ? `Vou retirar aí na loja, em Itaguaí.${hasSpecialOrder ? "\nVi que tem item sob encomenda, então fico no aguardo do prazo certinho (uns 4 dias)." : ""}`
          : `Quero receber por entrega:\n${addr}\nPode me confirmar o valor e o prazo da entrega antes do pagamento?${hasSpecialOrder ? "\nVi que tem item sob encomenda (uns 4 dias), fico no aguardo da confirmação." : ""}`;

      const descontos =
        (res.promotionDiscount > 0 ? `Promoção aplicada: -${brl(res.promotionDiscount)}\n` : "") +
        (res.couponDiscount > 0 ? `Cupom ${res.couponCode}: -${brl(res.couponDiscount)}\n` : "");
      const pagamento = `Vou pagar no Pix${res.paymentDiscountPercent > 0 ? ` (com os ${res.paymentDiscountPercent}% de desconto)` : ""}.`;
      const entregaPendente = fulfillment === "LOCAL";

      const msg =
        `Oi, Orium! Aqui é ${first || "um cliente"} 😊\n` +
        `Acabei de montar minha sacola no site e quero fechar:\n\n` +
        `${linhas}\n\n` +
        descontos +
        (entregaPendente
          ? `Total dos produtos: ${brl(res.finalTotal)} (a entrega fica de fora: valor e prazo a confirmar)\n\n`
          : `Total: ${brl(res.finalTotal)}\n\n`) +
        `${recebimento}\n\n` +
        `${pagamento}\n\n` +
        `Meus dados: ${name.trim()} · ${phone}\n\n` +
        `Consegue me confirmar e me passar como faço o pagamento? Obrigado! 🙏`;

      const waUrl = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`;
      setDone({
        number: res.orderNumber ?? null,
        url: waUrl,
        total: res.finalTotal,
        receive: fulfillment === "PICKUP" ? "Retirada na loja" : "Entrega (valor e prazo a confirmar)",
        deliveryPending: entregaPendente,
        payment: paymentLabel(res.paymentMethod),
        firstName: name.trim().split(/\s+/)[0] ?? "",
        // economia real: preço cheio dos itens − o que ele pagou pelos itens (sem frete)
        savings: Math.max(0, Number((cart.retailTotal - (res.finalTotal - (res.shippingPrice ?? 0))).toFixed(2))),
        items: cart.items.slice(0, 4).map((i) => ({ image: i.image, name: i.name })),
        count: cart.totalQuantity,
        fresh: true,
      });

      // só agora é seguro esvaziar: o pedido está salvo no banco
      cart.clear();
      setFulfillment(null);
      setAddress(emptyAddress);
      orderKey.current = crypto.randomUUID();

      // registro em segundo plano: o WhatsApp abre na hora, sem esperar nada
      track("order_created", { price: res.finalTotal, meta: { order: res.orderNumber ?? "" } });
      track("whatsapp_checkout_clicked", { price: res.finalTotal });
      updateLead({ name: name.trim(), phone: phone.replace(/\D/g, ""), customerId: lead?.customerId ?? null });

      // o WhatsApp abre no fim da animação de "pedido feito" (OrderSuccess)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar o pedido agora.");
    } finally {
      setSending(false);
    }
  };

  const topBar = (onBack: () => void, label = "Voltar") => (
    <div className="header-safe sticky top-0 z-10 border-b border-white/[0.06] bg-[#0A0A0A]">
      <div className="mx-auto flex h-[52px] max-w-xl items-center px-3">
        <button
          type="button"
          onClick={onBack}
          className="press inline-flex h-10 items-center gap-1 rounded-full pr-3 pl-1.5 text-[16px] font-semibold text-white"
        >
          <ChevronLeft className="size-[22px]" strokeWidth={2.4} />
          {label}
        </button>
      </div>
    </div>
  );

  // ———————————————————— Pedido enviado ————————————————————
  if (done) {
    return (
      <>
        {topBar(onClose, "Fechar")}
        <OrderSuccess
          done={done}
          onFinish={() => {
            setDone(null);
            setStep("bag");
          }}
          onContinue={() => {
            setDone(null);
            setStep("bag");
            onClose();
          }}
        />
      </>
    );
  }

  // ———————————————————— Sacola vazia ————————————————————
  if (cart.items.length === 0) {
    return (
      <>
        {topBar(onClose)}
        <div className="cart-step-in mx-auto w-full max-w-xl px-5 pt-3">
          <h1 className="text-[40px] leading-[1.15] font-bold tracking-[-0.035em] text-white">Sacola</h1>
          <p className="mt-1 text-[16px] text-[#BABABA]">Nenhum item ainda</p>
          <div className="mt-10 flex flex-col items-center text-center">
            <span className="grid size-[84px] place-items-center rounded-full bg-[#1A1A1A] text-[#FFD599]">
              <ShoppingBag className="size-9" strokeWidth={1.8} />
            </span>
            <p className="mt-6 text-[22px] font-bold tracking-[-0.02em] text-white">Sua sacola está vazia</p>
            <p className="mt-2 max-w-[28ch] text-[16px] leading-relaxed text-[#BABABA]">
              Comece por um decant: você prova antes de levar o frasco.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="press mt-8 flex h-[60px] w-full items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[17px] font-bold text-[#15130F]"
            >
              Explorar perfumes <ArrowRight className="size-5" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </>
    );
  }

  const missingList = [
    name.trim().length < 3 ? "seu nome" : null,
    !isValidPhoneBR(phone) ? "o WhatsApp com DDD" : null,
    !fulfillment ? "como quer receber" : null,
    fulfillment && fulfillment !== "PICKUP" && !addressComplete ? "o endereço" : null,
  ].filter(Boolean) as string[];
  const missingText = missingList.length
    ? `Para continuar, preencha ${
        missingList.length > 1 ? `${missingList.slice(0, -1).join(", ")} e ${missingList.at(-1)}` : missingList[0]
      }.`
    : null;

  return (
    <>
      {topBar(step === "bag" ? onClose : () => go("bag"))}
      <div ref={scrollRef} onFocusCapture={onFieldFocus} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          key={step}
          className={cn(
            "mx-auto w-full max-w-xl px-5 pt-3 pb-[calc(2rem+env(safe-area-inset-bottom))]",
            back ? "cart-step-back" : "cart-step-in",
          )}
        >
          {step === "bag" ? renderBag() : renderCheckout()}
        </div>
      </div>
    </>
  );

  // ———————————————————— Sacola com preços sob consulta ————————————————————
  function renderOnRequestBag() {
    const list = cart.items
      .map((i) => `• ${i.quantity}x ${[i.brand, productTitle(i.name)].filter(Boolean).join(" ")}${i.variant === "DECANT" ? ` (decant ${i.decantMl} ml)` : ""}`)
      .join("\n");
    const msg = `Oi, Orium! Queria saber o preço destes perfumes:\n${list}`;
    return (
      <>
        <h1 className="text-[40px] leading-[1.15] font-bold tracking-[-0.035em] text-white">Sacola</h1>
        <p className="mt-1 text-[16px] text-[#BABABA] tabular-nums">
          {cart.totalQuantity} {cart.totalQuantity === 1 ? "item" : "itens"}
        </p>
        <ul className="mt-5 space-y-2">
          {cart.items.map((i) => (
            <li key={i.key} className="flex items-center justify-between gap-3 rounded-[18px] bg-[#1A1A1A] px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-white">{productTitle(i.name)}</span>
                <span className="block text-[13px] text-[#8C8C8C]">
                  {[i.brand, i.variant === "DECANT" ? `Decant ${i.decantMl} ml` : "Frasco"].filter(Boolean).join(" · ")} · {i.quantity}x
                </span>
              </span>
              <button
                type="button"
                onClick={() => cart.remove(i.key)}
                className="press shrink-0 text-[13px] font-semibold text-[#A9A9A9]"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-6 rounded-[24px] bg-[#1A1A1A] p-5">
          <p className="text-[20px] font-bold text-[#FFD599]">Preços sob consulta</p>
          <p className="mt-1 text-[15px] leading-snug text-[#A9A9A9]">
            No momento os preços são informados pelo WhatsApp. Mande a sua lista e a Orium responde com valores e disponibilidade.
          </p>
        </div>
        <a
          href={`https://wa.me/${ORIUM_WHATSAPP}?text=${encodeURIComponent(msg)}`}
          target="_blank"
          rel="noreferrer"
          onClick={() => track("consultant_help_clicked", { meta: { reason: "sob-consulta-sacola" } })}
          className="press mt-6 flex h-[60px] w-full items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[17px] font-bold text-[#15130F]"
        >
          Consultar no WhatsApp <ArrowRight className="size-5" strokeWidth={2.4} />
        </a>
      </>
    );
  }

  // ———————————————————— Sacola (Figma "Carrinho") ————————————————————
  function renderBag() {
    if (onRequestAll) return renderOnRequestBag();
    return (
      <>
        <h1 className="text-[40px] leading-[1.15] font-bold tracking-[-0.035em] text-white">Sacola</h1>
        <p className="mt-1 text-[16px] text-[#BABABA] tabular-nums">
          {cart.totalQuantity} {cart.totalQuantity === 1 ? "item" : "itens"}
        </p>

        <ul className="mt-5">{cart.items.map((item) => renderItem(item))}</ul>

        {cart.promoItems.length > 0 ? <PromoSavingsCard /> : null}

        <DecantComboBag />

        {cart.bottles.some((b) => !cart.promotionOf(b)) ? <WholesaleLine /> : null}

        <TryMore />

        {/* cupom */}
        <CouponBox />

        {/* resumo */}
        <div className="mt-6 rounded-[24px] bg-[#1A1A1A] p-5">
          {cart.tier === "atacado" && cart.retailTotal > cart.subtotal ? (
            <>
              <Row label="Subtotal" value={brl(cart.retailTotal)} />
              <Row label={`Atacado · ${cart.bottleQuantity} frascos`} value={`– ${brl(cart.retailTotal - cart.subtotal)}`} gold />
            </>
          ) : (
            <Row label="Subtotal" value={brl(cart.subtotal)} />
          )}
          {cart.comboDiscount > 0 ? <Row label="Combo de decants" value={`– ${brl(cart.comboDiscount)}`} gold /> : null}
          {cart.promotionDiscount - cart.comboDiscount > 0.004 ? (
            <Row
              label={cart.promoItems.some((i) => isBlack(cart.promotionOf(i))) ? "Black November" : "Promoção"}
              value={`– ${brl(cart.promotionDiscount - cart.comboDiscount)}`}
              gold
            />
          ) : null}
          {cart.couponDiscount > 0 ? <Row label={`Cupom ${cart.couponCode}`} value={`– ${brl(cart.couponDiscount)}`} gold /> : null}
          <Row label="Entrega" value="escolhida no próximo passo" muted />
          <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-4">
            <span className="text-[17px] font-bold text-white">Total</span>
            <span key={cart.total} className="value-in text-[30px] leading-none font-bold tracking-[-0.03em] text-white tabular-nums">
              {brl(cart.total)}
            </span>
          </div>
          {cart.promoItems.length > 0 && cart.savings > 0.004 ? (
            <p className="mt-3 flex items-center justify-end gap-1.5 text-[14px] font-semibold text-[#FFD599]">
              <Check className="size-4" strokeWidth={2.6} />
              Você economiza <span className="tabular-nums">{brl(cart.savings)}</span> nesta compra
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => go("checkout")}
          className="press mt-6 flex h-[60px] w-full items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[17px] font-bold text-[#15130F]"
        >
          Finalizar compra <ArrowRight className="size-5" strokeWidth={2.4} />
        </button>
      </>
    );
  }

  function renderItem(item: CartItem) {
    const isDecant = item.variant === "DECANT";
    const promo = cart.promotionOf(item);
    return (
      <li key={item.key} className="cart-item flex gap-4 border-b border-white/10 py-4 first:pt-1">
        <Link
          to="/perfume/$slug"
          params={{ slug: item.slug }}
          replace
          onClick={() => {
            navigatingFromLayer();
            onClose();
          }}
          className="relative size-[94px] shrink-0 overflow-hidden rounded-[16px] bg-white"
        >
          <ProductImage product={{ image_url: item.image, brand: item.brand, canonical_name: item.name }} variant="thumb" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          {item.brand ? <p className="truncate text-[13px] text-[#A9A9A9]">{item.brand}</p> : null}
          <p className="line-clamp-2 text-[17px] leading-snug font-bold text-white">{item.name}</p>
          <p className="text-[14px] text-[#FFD599]">
            {isDecant ? `Decant · ${item.decantMl} ml` : `Frasco${item.volumeMl ? ` · ${item.volumeMl} ml` : ""}`}
          </p>
          {promo ? (
            <span className="mt-1.5 flex items-center gap-2">
              {isBlack(promo) ? (
                <BlackTag promotion={promo} size="xs" />
              ) : (
                <span className="rounded-[5px] bg-[#FFD599] px-1.5 py-[3px] text-[8.5px] font-black tracking-[0.06em] text-[#15130F] uppercase">
                  Promoção
                </span>
              )}
              <BlackOff
                percent={(1 - cart.unitPrice(item) / Math.max(0.01, cart.baseUnitPrice(item))) * 100}
                className="text-[12px]"
              />
            </span>
          ) : null}
          {!isDecant ? <ReadyTag productId={item.productId} /> : null}
          <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
            <div className="flex h-9 items-center rounded-full bg-[#1F1F1F]">
              <button
                type="button"
                className="press grid size-9 place-items-center rounded-full text-white"
                aria-label={item.quantity === 1 ? `Remover ${item.name}` : "Diminuir quantidade"}
                onClick={() => (item.quantity === 1 ? cart.remove(item.key) : cart.setQuantity(item.key, item.quantity - 1))}
              >
                {item.quantity === 1 ? <Trash2 className="size-[15px]" strokeWidth={2.2} /> : <Minus className="size-4" strokeWidth={2.4} />}
              </button>
              <span key={item.quantity} className="value-in min-w-5 text-center text-[15px] font-semibold text-white tabular-nums">
                {item.quantity}
              </span>
              <button
                type="button"
                className="press grid size-9 place-items-center rounded-full text-white"
                aria-label="Aumentar quantidade"
                onClick={() => cart.setQuantity(item.key, item.quantity + 1)}
              >
                <Plus className="size-4" strokeWidth={2.4} />
              </button>
            </div>
            <div className="text-right">
              <p key={cart.lineTotal(item)} className="value-in text-[17px] font-bold text-white tabular-nums">
                {brl(cart.lineTotal(item))}
              </p>
              {promo || cart.comboOf(item) > 0 ? (
                <p className="text-[12px] text-[#8C8C8C] line-through tabular-nums">{brl(cart.baseUnitPrice(item) * item.quantity)}</p>
              ) : null}
              {promo ? (
                <p className="text-[11.5px] font-semibold text-[#FFD599] tabular-nums">
                  economiza {brl((cart.baseUnitPrice(item) - cart.unitPrice(item)) * item.quantity)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </li>
    );
  }

  // ———————————————————— Finalizar pedido (Figma) ————————————————————
  function renderCheckout() {
    return (
      <>
        <h1 className="text-[40px] leading-[1.12] font-bold tracking-[-0.035em] text-white">Finalizar pedido</h1>
        <p className="mt-1.5 text-[16px] leading-snug text-[#BABABA]">Só falta saber quem é você e como quer receber.</p>

        {/* seus dados */}
        <p className="mt-8 mb-2.5 text-[15px] font-semibold text-[#CFCFCF]">Seus dados</p>
        <div className="overflow-hidden rounded-[20px] bg-[#1A1A1A]">
          <GroupField label="Nome completo">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como devemos te chamar"
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="next"
              className="g-input"
              aria-label="Nome completo"
            />
          </GroupField>
          <GroupField label="WhatsApp com DDD" divider>
            <input
              value={phone}
              onChange={(e) => setPhone(maskPhone(e.target.value))}
              placeholder="(21) 90000-0000"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="done"
              className="g-input tabular-nums"
              aria-label="WhatsApp com DDD"
            />
          </GroupField>
        </div>
        {phone && !isValidPhoneBR(phone) ? (
          <p className="mt-2 text-[13px] text-[#FFB4A8]">Confira o DDD e o número.</p>
        ) : (
          <p className="mt-2.5 text-[13px] text-[#8C8C8C]">Usamos só para confirmar o pedido com você.</p>
        )}

        {/* recebimento */}
        <p className="mt-8 mb-2.5 text-[15px] font-semibold text-[#CFCFCF]">Como quer receber?</p>
        <div className="space-y-3" role="radiogroup" aria-label="Como quer receber">
          <ReceiveOption
            active={fulfillment === "PICKUP"}
            onClick={() => setFulfillment("PICKUP")}
            title="Retirar na loja"
            subtitle="Itaguaí — RJ · Grátis"
            extra={hasSpecialOrder ? "Pronto para retirar em até 4 dias" : "Pronto para retirar no mesmo dia"}
          />
          <ReceiveOption
            active={fulfillment === "LOCAL"}
            onClick={() => setFulfillment("LOCAL")}
            title="Entrega"
            subtitle="Valor e prazo combinados pelo WhatsApp, antes do pagamento"
            extra="Frete a confirmar · você só paga depois"
          />
        </div>

        {fulfillment && fulfillment !== "PICKUP" ? (
          <div className="cart-step-in">
            <div className="mt-4 rounded-[20px] bg-[#1A1A1A] p-4" role="note">
              <p className="text-[14px] leading-relaxed text-[#E6E6E6]">
                Seu pedido é registrado agora, mas o <strong>valor e o prazo da entrega</strong> serão confirmados com você pelo
                WhatsApp <strong>antes do pagamento</strong>. Nada é cobrado pelo site.
              </p>
            </div>
            <p className="mt-8 mb-2.5 text-[15px] font-semibold text-[#CFCFCF]">Endereço de entrega</p>
            <div className="overflow-hidden rounded-[20px] bg-[#1A1A1A]">
              <GroupField label="CEP" aside={cepBusy ? <Loader2 className="size-4 animate-spin text-[#A9A9A9]" /> : null}>
                <input
                  value={address.cep}
                  onChange={(e) => setAddress({ ...address, cep: maskCep(e.target.value) })}
                  placeholder="00000-000"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  className="g-input tabular-nums"
                  aria-label="CEP"
                />
              </GroupField>
              <GroupField label="Rua" divider>
                <input value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} placeholder="Nome da rua" autoComplete="address-line1" className="g-input" aria-label="Rua" />
              </GroupField>
              <div className="grid grid-cols-[0.8fr_1.2fr] border-t border-white/10">
                <GroupField label="Número">
                  <input value={address.number} onChange={(e) => setAddress({ ...address, number: e.target.value })} placeholder="Nº" inputMode="numeric" className="g-input" aria-label="Número" />
                </GroupField>
                <div className="border-l border-white/10">
                  <GroupField label="Complemento">
                    <input value={address.complement} onChange={(e) => setAddress({ ...address, complement: e.target.value })} placeholder="Opcional" autoComplete="address-line2" className="g-input" aria-label="Complemento" />
                  </GroupField>
                </div>
              </div>
              <GroupField label="Bairro" divider>
                <input value={address.district} onChange={(e) => setAddress({ ...address, district: e.target.value })} placeholder="Bairro" className="g-input" aria-label="Bairro" />
              </GroupField>
              <div className="grid grid-cols-[1fr_92px] border-t border-white/10">
                <GroupField label="Cidade">
                  <input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} placeholder="Cidade" autoComplete="address-level2" className="g-input" aria-label="Cidade" />
                </GroupField>
                <div className="border-l border-white/10">
                  <GroupField label="UF">
                    <input value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value.toUpperCase().slice(0, 2) })} placeholder="RJ" autoComplete="address-level1" className="g-input uppercase" aria-label="Estado" />
                  </GroupField>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* pagamento: só Pix no lançamento */}
        <p className="mt-8 mb-2.5 text-[15px] font-semibold text-[#CFCFCF]">Pagamento</p>
        <div role="radiogroup" aria-label="Pagamento">
          <ReceiveOption
            active
            onClick={() => undefined}
            title="Pix"
            subtitle={brl(payment.pixPrice)}
            extra={pixOff ?? "à vista"}
            gold
          />
        </div>

        {/* resumo */}
        <div className="mt-8 rounded-[24px] bg-[#1A1A1A] p-5">
          <p className="mb-2 text-[16px] font-bold text-white">
            Resumo · {cart.totalQuantity} {cart.totalQuantity === 1 ? "item" : "itens"}
          </p>
          {cart.items.map((i) => (
            <Row
              key={i.key}
              label={`${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.name} · ${i.variant === "DECANT" ? `Decant ${i.decantMl} ml` : `Frasco${i.volumeMl ? ` ${i.volumeMl} ml` : ""}`}`}
              value={brl(cart.lineTotal(i))}
            />
          ))}
          {cart.comboDiscount > 0 ? <Row label="Combo de decants" value={`– ${brl(cart.comboDiscount)}`} gold /> : null}
          {cart.promotionDiscount - cart.comboDiscount > 0.004 ? <Row label="Promoção" value={`– ${brl(cart.promotionDiscount - cart.comboDiscount)}`} gold /> : null}
          {cart.couponDiscount > 0 ? <Row label={`Cupom ${cart.couponCode}`} value={`– ${brl(cart.couponDiscount)}`} gold /> : null}
          {payment.active && paymentMethod === "PIX" && payment.pixSavings > 0 ? (
            <Row label="Desconto no Pix" value={`– ${brl(payment.pixSavings)}`} gold />
          ) : null}
          <Row
            label="Entrega"
            value={
              !fulfillment
                ? "escolha acima"
                : fulfillment === "PICKUP"
                  ? "Grátis"
                  : "a confirmar no WhatsApp"
            }
            strong
          />
          <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-4">
            <span className="text-[17px] font-bold text-white">{fulfillment === "LOCAL" ? "Total dos produtos" : "Total"}</span>
            <span key={grandTotal} className="value-in text-[30px] leading-none font-bold tracking-[-0.03em] text-white tabular-nums">
              {brl(grandTotal)}
            </span>
          </div>
        </div>

        {fulfillment === "LOCAL" ? (
          <p className="mt-3 text-[13px] leading-relaxed text-[#BABABA]">
            A entrega não está neste total. A Orium confirma o valor e o prazo pelo WhatsApp antes de você pagar.
          </p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={sending || !canSubmit}
          className={cn(
            "press mt-6 flex h-[60px] w-full items-center justify-center gap-2 rounded-full text-[17px] font-bold transition-colors duration-300",
            canSubmit ? "bg-[#FFD599] text-[#15130F]" : "bg-[#2A2A2A] text-[#8C8C8C]",
          )}
        >
          {sending ? <Loader2 className="size-5 animate-spin" /> : <MessageCircle className="size-5" strokeWidth={2.2} />}
          {sending ? "Enviando pedido…" : "Enviar pedido pelo WhatsApp"}
        </button>
        <p key={missingText ?? "ok"} className="value-in mx-auto mt-4 max-w-[34ch] text-center text-[14px] leading-relaxed text-[#A9A9A9]">
          {missingText ?? "Você confirma tudo com a Orium no WhatsApp."}
        </p>
      </>
    );
  }
}

/** Linha do resumo: rótulo à esquerda, valor à direita. */
function Row({ label, value, gold, muted, strong }: { label: string; value: string; gold?: boolean; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="min-w-0 text-[15px] text-[#A9A9A9]">{label}</span>
      <span
        className={cn(
          "shrink-0 text-right text-[15px] tabular-nums",
          gold ? "text-[#FFD599]" : muted ? "text-[#A9A9A9]" : strong ? "text-white" : "text-white",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Campo agrupado (Figma): rótulo pequeno dentro do cartão, valor grande. */
function GroupField({
  label,
  divider,
  aside,
  children,
}: {
  label: string;
  divider?: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("g-field block px-4 pt-3 pb-2.5", divider && "border-t border-white/10")}>
      <span className="flex items-center justify-between text-[13px] text-[#A9A9A9]">
        {label}
        {aside}
      </span>
      {children}
    </label>
  );
}

/** Cartão de opção (Figma): título, linha cinza, linha de destaque e círculo à direita. */
function ReceiveOption({
  active,
  onClick,
  title,
  subtitle,
  extra,
  gold,
  compact,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  extra?: string;
  gold?: boolean;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "cart-opt press flex w-full items-center gap-3 rounded-[20px] text-left disabled:opacity-45",
        compact ? "p-4" : "p-5",
        active ? "bg-[#221C14] ring-1 ring-[#FFD599] ring-inset" : "bg-[#1A1A1A] ring-1 ring-white/10 ring-inset",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block font-bold text-white", compact ? "text-[17px]" : "text-[19px]")}>{title}</span>
        <span className={cn("mt-0.5 block text-[#A9A9A9]", compact ? "text-[15px] font-semibold text-white tabular-nums" : "text-[15px] leading-snug")}>
          {subtitle}
        </span>
        {extra ? (
          <span className={cn("mt-1 block text-[14px] font-bold", gold ? "text-[#FFD599]" : compact ? "font-medium text-[#A9A9A9]" : "text-white")}>
            {extra}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-200",
          active ? "bg-[#FFD599] text-[#15130F]" : "ring-[1.5px] ring-white/40 ring-inset",
        )}
      >
        {active ? <Check className="check-pop size-3.5" strokeWidth={3.2} /> : null}
      </span>
    </button>
  );
}

/**
 * "Leve mais um para provar" (Figma): decants de 2 ml de perfumes parecidos
 * com o que já está na sacola, com o motivo da sugestão.
 */
function TryMore() {
  const cart = useCart();
  const settings = useDecantSettings();
  const base = cart.items[0];
  const baseName = base ? productTitle(base.name) : "";
  const { items } = useOlfactorySimilar(base?.productId ?? null, 10);
  const inCart = new Set(cart.items.map((i) => i.productId));
  const list = items.filter((p) => !inCart.has(p.id) && canDecant(p) && p.in_stock).slice(0, 6);
  const price2 = decantPrice(null, settings, 2);
  if (!base || list.length === 0) return null;

  const reason = (p: (typeof list)[number]) => {
    const shared = (p.shared_accords ?? []).filter(Boolean).slice(0, 2).map((a) => a.toLowerCase());
    const accords = (p.accords ?? []).slice(0, 2).map((a) => a.toLowerCase());
    if (shared.length) {
      const words = shared.length > 1 ? `${shared[0]} e ${shared[1]}` : shared[0]!;
      return `${words.charAt(0).toUpperCase()}${words.slice(1)}, como o ${baseName}`;
    }
    if (accords.length) {
      const words = accords.length > 1 ? `${accords[0]} com ${accords[1]}` : accords[0]!;
      return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
    }
    return "Para provar junto";
  };

  return (
    <section aria-label="Leve mais um para provar" className="mt-8">
      <span className="inline-flex rounded-full bg-[#2A2217] px-3 py-1.5 text-[13px] font-bold text-[#FFD599] tabular-nums">
        Só {brl(price2)} cada
      </span>
      <h2 className="mt-3 text-[26px] leading-tight font-bold tracking-[-0.025em] text-white">Leve mais um para provar</h2>
      <p className="mt-2 text-[16px] leading-relaxed text-[#A9A9A9]">
        Decants de 2 ml de perfumes parecidos com o que você escolheu. Vão no mesmo pacote.
      </p>
      <div className="scrollbar-none -mx-5 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pb-1">
        {list.map((p) => (
          <div key={p.id} className="flex w-[190px] shrink-0 snap-start flex-col rounded-[24px] bg-[#1A1A1A] p-3.5">
            <span className="relative block aspect-square w-full overflow-hidden rounded-[16px] bg-white">
              <ProductImage product={p} />
            </span>
            <p className="mt-3 line-clamp-1 text-[17px] font-bold text-white">{productTitle(p.canonical_name)}</p>
            <p className="mt-0.5 line-clamp-2 min-h-[2.6em] text-[14px] leading-snug text-[#FFD599]">{reason(p)}</p>
            <button
              type="button"
              onClick={() => {
                cart.add(
                  {
                    productId: p.id,
                    variant: "DECANT",
                    decantMl: 2,
                    slug: p.slug,
                    name: p.canonical_name,
                    brand: p.brand,
                    image: p.image_url,
                    volumeMl: 2,
                    concentration: p.concentration,
                    retailPrice: decantPrice(p, settings, 2),
                    wholesalePrice: decantPrice(p, settings, 2),
                  },
                  1,
                );
                trackDecant("decant_added", { productId: p.id, variant: "DECANT_2", details: { source: "sacola_leve_mais" } });
              }}
              className="press mt-3 flex h-12 w-full items-center justify-center rounded-full bg-[#FFD599] text-[15px] font-bold text-[#15130F] tabular-nums"
            >
              + 2 ml · {brl(decantPrice(p, settings, 2))}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Cupom (Figma): rótulo, campo escuro com borda e botão branco "Aplicar". */
function CouponBox() {
  const cart = useCart();
  const publicCoupons = usePublicCoupons();
  const [code, setCode] = useState("");
  const [nudge, setNudge] = useState(0);
  const applied = cart.couponFeedback.status === "OK";
  const problem =
    cart.couponFeedback.status !== "OK" && cart.couponFeedback.status !== "NONE" ? cart.couponFeedback.message : null;
  const celebrate = useCelebrateOnce(
    applied && cart.couponCode && cart.couponDiscount > 0 ? `coupon-applied:${cart.couponCode}` : null,
    CELEBRATION.micro,
  );
  useEffect(() => {
    if (problem) setNudge((n) => n + 1);
  }, [problem]);

  return (
    <div className="mt-8">
      <p className="mb-2.5 text-[15px] font-semibold text-[#CFCFCF]">Cupom de desconto</p>
      {applied ? (
        <div className="coupon-ticket-row relative flex h-14 items-center overflow-hidden rounded-[18px] bg-[#1A1A1A]">
          <ConfettiBurst active={celebrate} intensity="soft" />
          <span className="flex h-full items-center gap-2.5 border-r border-dashed border-white/15 pr-4 pl-4">
            <Ticket className="size-[18px] text-[#FFD599]" strokeWidth={2.2} />
            <span className="text-[16px] font-bold tracking-[0.06em] text-white">{cart.couponCode}</span>
          </span>
          <span className="min-w-0 flex-1 truncate px-4 text-[14px] text-[#A9A9A9]">
            {cart.couponDiscount > 0 ? (
              <>
                <span className="font-semibold text-[#FFD599] tabular-nums">
                  – <CountUp value={cart.couponDiscount} format={brl} />
                </span>
              </>
            ) : (
              "Aplicado"
            )}
          </span>
          <button
            type="button"
            aria-label={`Remover cupom ${cart.couponCode}`}
            onClick={() => cart.removeCoupon()}
            className="o-pop-close press mr-3"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <>
          <div key={nudge} className={cn("flex gap-2.5", problem && "nudge-x")}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.trim().length >= 3) cart.applyCoupon(code);
              }}
              placeholder="Digite o código"
              className="h-14 min-w-0 flex-1 rounded-[18px] border border-white/10 bg-[#1A1A1A] px-4 text-[16px] text-white uppercase outline-none transition-colors placeholder:text-[#707070] placeholder:normal-case focus:border-[#FFD599]/60"
              aria-label="Cupom de desconto"
            />
            <button
              type="button"
              disabled={code.trim().length < 3 || cart.couponPending}
              onClick={() => cart.applyCoupon(code)}
              className="press h-14 shrink-0 rounded-[18px] bg-white px-6 text-[16px] font-bold text-[#15130F] transition-opacity disabled:opacity-40"
            >
              {cart.couponPending ? <Loader2 className="size-[18px] animate-spin" /> : "Aplicar"}
            </button>
          </div>
          {problem ? <p className="mt-2 text-[13px] text-[#FFB4A8]">{problem}</p> : null}
          {publicCoupons.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {publicCoupons.slice(0, 3).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCode(c.code);
                    cart.applyCoupon(c.code);
                  }}
                  className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1F1F1F] px-3.5 text-[13px] font-semibold text-white"
                >
                  {c.code}
                  <span className="text-[#FFD599]">{Math.round(Number(c.discount_percent))}% off</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Atacado na Sacola — mesmo desenho do combo de decants: título, contagem "x/6",
 * barra em passos e uma frase curta dizendo o que falta (ou quanto economiza).
 */
function WholesaleLine() {
  const cart = useCart();
  const n = Math.min(cart.bottleQuantity, cart.minQty);
  const unlocked = cart.tier === "atacado";
  const eligible = cart.bottles.filter((b) => !cart.promotionOf(b));
  const only = eligible.length === 1 ? eligible[0] : null;
  const missing = cart.missingForWholesale;

  return (
    <div
      className={cn(
        "my-4 rounded-[20px] p-4",
        unlocked ? "bg-[#221C14] ring-1 ring-[#FFD599]/60 ring-inset" : "bg-[#1A1A1A]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-[15px] font-bold", unlocked ? "text-[#FFD599]" : "text-white")}>
          {unlocked ? (
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-4" strokeWidth={2.6} /> Preço de atacado aplicado
            </span>
          ) : (
            "Preço de atacado"
          )}
        </p>
        <span className="shrink-0 text-[13px] font-semibold text-[#A9A9A9] tabular-nums">
          {n}/{cart.minQty}
        </span>
      </div>
      <StepBar value={n} total={cart.minQty} className="mt-3" />
      {cart.promoItems.some((i) => i.variant === "FULL") ? (
        <p className="mt-2.5 text-[12.5px] leading-snug text-[#8C8C8C]">
          Perfumes em promoção não entram no atacado: já estão com o menor preço.
        </p>
      ) : null}
      <p className="mt-2.5 text-[13px] leading-snug text-[#A9A9A9]">
        {unlocked ? (
          only ? (
            <>
              {brl(only.wholesalePrice)} cada, em vez de <span className="line-through">{brl(only.retailPrice)}</span>
            </>
          ) : (
            "Aplicado em todos os frascos."
          )
        ) : (
          <>
            {missing === 1 ? "Falta 1 frasco" : `Faltam ${missing} frascos`} para liberar
            {only ? (
              <>
                {" "}· cada um sai por <span className="font-semibold text-[#FFD599]">{brl(only.wholesalePrice)}</span>
              </>
            ) : null}
            .
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Promoção na Sacola — só aparece quando há perfume com desconto em vigor.
 * Selo da campanha, quanto a pessoa está economizando (subindo na tela), a
 * contagem até o fim e um confete na primeira vez que cada item entra.
 * Preço de atacado não se aplica a esses perfumes (já estão no menor preço).
 */
function PromoSavingsCard() {
  const cart = useCart();
  const promos = cart.promoItems.map((i) => cart.promotionOf(i)).filter(Boolean) as NonNullable<
    ReturnType<typeof cart.promotionOf>
  >[];
  const black = promos.find((p) => isBlack(p)) ?? null;
  const lead = black ?? promos[0] ?? null;
  const units = cart.promoItems.reduce((s, i) => s + i.quantity, 0);
  const maxOff = cart.promoItems.reduce(
    (m, i) => Math.max(m, (1 - cart.unitPrice(i) / Math.max(0.01, cart.baseUnitPrice(i))) * 100),
    0,
  );
  // confete uma vez por combinação de itens em promoção (entrou um novo = festa de novo)
  const celebrate = useCelebrateOnce(
    cart.promoSavings > 0 ? `promo-bag:${cart.promoItems.map((i) => i.key).sort().join("|")}` : null,
    CELEBRATION.micro,
  );
  if (!lead || !(cart.promoSavings > 0)) return null;
  return (
    <div className="promo-bag relative my-4 overflow-hidden rounded-[22px] bg-black p-5 ring-1 ring-white/15">
      <ConfettiBurst active={celebrate} intensity="medium" />
      <div className="flex items-center justify-between gap-3">
        {black ? (
          <BlackTag promotion={black} size="md" />
        ) : (
          <span className="rounded-[7px] bg-[#FFD599] px-2 py-[5px] text-[11px] font-black tracking-[0.06em] text-[#15130F] uppercase">
            Promoção
          </span>
        )}
        <BlackOff percent={maxOff} className="text-[15px]" />
      </div>
      <p className="mt-4 text-[14px] font-semibold text-[#A9A9A9]">Você está economizando</p>
      <p className="mt-0.5 text-[38px] leading-none font-extrabold tracking-[-0.035em] text-[#FFD599] tabular-nums">
        <CountUp value={cart.promoSavings} format={brl} />
      </p>
      <p className="mt-2 text-[13.5px] leading-snug text-[#CFCFCF]">
        {units === 1 ? "1 perfume" : `${units} perfumes`} com preço {black ? "de Black November" : "de promoção"}.
      </p>
      {lead.ends_at ? <BlackCountdown endsAt={lead.ends_at} className="mt-3" label="Acaba em" /> : null}
    </div>
  );
}
