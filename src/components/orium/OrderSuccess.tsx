import { useEffect, useMemo, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";
import { ArrowRight, Check, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { brl } from "@/lib/format";
import { imgVariant } from "@/lib/product-img";
import { ConfettiBurst, CountUp } from "@/lib/celebration";
import { track } from "@/lib/analytics";
import { comboBrl, comboPriceLine, comboTitle, comboUnitPrice } from "@/lib/decant-combos";
import { ComboCountdown, useBuildAnotherCombo, useFeaturedCombo } from "@/components/orium/DecantCombo";
import { cn } from "@/lib/utils";
import symbolLight from "@/assets/orium-symbol-light.png.asset.json";

export type OrderDone = {
  number: number | string | null;
  url: string;
  total: number;
  receive: string;
  payment: string;
  /** primeiro nome do cliente, para falar com ele */
  firstName: string;
  /** quanto deixou de pagar (preço cheio dos itens − o que pagou nos itens) */
  savings: number;
  /** fotos dos itens (só as primeiras) e a contagem total */
  items: { image: string | null; name: string }[];
  count: number;
  /** acabou de ser feito: toca a abertura e depois abre o WhatsApp */
  fresh?: boolean;
};

/** Tempo da abertura até abrir o WhatsApp (ms). */
const INTRO_MS = 5200;

/**
 * Abertura em tela cheia: o dourado inunda a tela, o ✓ se desenha, chove confete
 * e o pedido "acontece". No fim, a barra enche e o WhatsApp abre sozinho.
 */
function OrderIntro({ done, leaving, onGo }: { done: OrderDone; leaving: boolean; onGo: () => void }) {
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const pieces = useMemo(
    () =>
      reduced
        ? []
        : Array.from({ length: 70 }, (_, i) => ({
            id: i,
            x: Math.round(Math.random() * 100),
            delay: 650 + Math.round(Math.random() * 2800),
            dur: 1500 + Math.round(Math.random() * 1100),
            drift: Math.round((Math.random() - 0.5) * 120),
            rot: Math.round(360 + Math.random() * 540) * (Math.random() > 0.5 ? 1 : -1),
            w: 6 + Math.round(Math.random() * 6),
            round: Math.random() > 0.7,
            color: ["#15130F", "#FFFFFF", "#C98A2E", "#15130F", "#FFF3DC"][i % 5],
          })),
    [reduced],
  );
  return (
    <div className={cn("os-intro", leaving && "is-leaving")} role="status" aria-live="polite">
      <span className="os-flood" aria-hidden />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {pieces.map((p) => (
          <span
            key={p.id}
            className="os-piece"
            style={
              {
                left: `${p.x}%`,
                width: `${p.w}px`,
                height: `${p.round ? p.w : p.w * 1.9}px`,
                borderRadius: p.round ? "50%" : "2px",
                background: p.color,
                animationDelay: `${p.delay}ms`,
                animationDuration: `${p.dur}ms`,
                "--drift": `${p.drift}px`,
                "--rot": `${p.rot}deg`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="relative flex flex-col items-center px-8 text-center text-[#15130F]">
        <span className="os-ring grid size-[112px] place-items-center rounded-full bg-[#15130F]">
          <svg viewBox="0 0 52 52" className="size-[58px]" aria-hidden>
            <path className="os-check" d="M14 27.5 L22.5 36 L39 18" fill="none" stroke="#FFD599" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="os-rise mt-8 text-[15px] font-bold" style={{ "--od": "1050ms" } as React.CSSProperties}>
          {done.firstName ? `${done.firstName}, que bom ter você aqui` : "Que bom ter você aqui"}
        </p>
        <p className="os-rise mt-1 text-[46px] leading-[0.98] font-extrabold tracking-[-0.04em]" style={{ "--od": "1150ms" } as React.CSSProperties}>
          Pedido feito!
        </p>
        <p className="os-rise mt-3 text-[16px] font-semibold text-[#15130F]/75" style={{ "--od": "1280ms" } as React.CSSProperties}>
          Bem-vindo(a) à família Orium
        </p>
        {done.savings > 0.009 ? (
          <p className="os-rise mt-4 text-[17px] font-semibold" style={{ "--od": "1420ms" } as React.CSSProperties}>
            Você economizou <span className="font-extrabold">{brl(done.savings)}</span>
          </p>
        ) : null}
      </div>

      <div className="os-rise absolute inset-x-8 bottom-[calc(3rem+env(safe-area-inset-bottom))] text-center text-[#15130F]" style={{ "--od": "1600ms" } as React.CSSProperties}>
        <p className="text-[14px] font-bold">Já já abrimos o WhatsApp para você confirmar</p>
        <span className="mt-3 block h-[6px] overflow-hidden rounded-full bg-[#15130F]/15">
          <span className="os-bar block h-full rounded-full bg-[#15130F]" />
        </span>
        <button type="button" onClick={onGo} className="press mt-3 inline-flex min-h-[44px] items-center px-4 text-[14px] font-bold underline underline-offset-4">
          Abrir agora
        </button>
      </div>
    </div>
  );
}

/**
 * Pedido concluído — o momento mais feliz da compra.
 * 1) comemora (confete, número do pedido, economia real);
 * 2) deixa claro o único passo que falta (mandar no WhatsApp) e o que vem depois;
 * 3) já planta o próximo pedido: combo de decants ativo e "indique a Orium".
 * Nada aqui é inventado: tudo sai do pedido que acabou de ser salvo e das promoções no ar.
 */
export function OrderSuccess({
  done,
  onContinue,
  onFinish,
}: {
  done: OrderDone;
  /** volta para a loja */
  onContinue: () => void;
  /** limpa esta tela (antes de levar a outro lugar) */
  onFinish: () => void;
}) {
  const [burst, setBurst] = useState(false);
  const { featured } = useFeaturedCombo();
  const another = useBuildAnotherCombo();
  // abertura: só no pedido recém-feito, uma vez (sobrevive a remontagens)
  const [intro, setIntro] = useState<"on" | "leaving" | "off">(done.fresh ? "on" : "off");
  const opened = useRef(false);
  const goWhats = () => {
    if (!opened.current) {
      opened.current = true;
      // o navegador pode bloquear janela aberta fora do toque: aí abre na mesma aba
      const w = window.open(done.url, "_blank");
      if (w) w.opener = null;
      else window.location.href = done.url;
    }
    setIntro("leaving");
  };

  useEffect(() => {
    if (intro === "off") {
      const t = window.setTimeout(() => setBurst(true), 200);
      return () => window.clearTimeout(t);
    }
    if (intro !== "on") return;
    const t1 = window.setTimeout(goWhats, INTRO_MS);
    return () => window.clearTimeout(t1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intro, done.url]);

  useEffect(() => {
    if (intro !== "leaving") return;
    const t = window.setTimeout(() => setIntro("off"), 480);
    return () => window.clearTimeout(t);
  }, [intro]);

  const hello = done.firstName ? `${done.firstName}, bem-vindo(a) à Orium` : "Bem-vindo(a) à Orium";
  const extra = done.count - done.items.length;

  const share = async () => {
    const url = window.location.origin;
    const text = "Conheci a Orium Perfumes: perfumes árabes em decant e frasco. Olha só:";
    track("discovery_clicked", { meta: { card: "pedido_indicar" } });
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Orium Perfumes", text, url });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast.success("Link copiado", { description: "É só colar no WhatsApp de quem você quer indicar.", duration: 2200 });
    } catch {
      toast("Copie o link da Orium", { description: url, duration: 6000 });
    }
  };

  const steps: { label: string; state: "done" | "now" | "next" }[] = [
    { label: "Pedido registrado", state: "done" },
    { label: "Você envia a mensagem no WhatsApp", state: "now" },
    { label: "A Orium confirma e te passa o pagamento", state: "next" },
    { label: "Com o pagamento (metade ou o total), seus perfumes são separados", state: "next" },
    { label: done.receive, state: "next" },
  ];

  const whats = (
    <a
      href={done.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track("whatsapp_checkout_clicked", { price: done.total, meta: { source: "pedido_feito" } })}
      className="press flex h-[58px] w-full items-center justify-center gap-2 rounded-full bg-[#FFD599] text-[17px] font-bold text-[#15130F]"
    >
      <MessageCircle className="size-5" strokeWidth={2.4} />
      Confirmar no WhatsApp
    </a>
  );

  return (
    <>
      {intro !== "off" ? <OrderIntro done={done} leaving={intro === "leaving"} onGo={goWhats} /> : null}

      <div className="cart-step-in mx-auto flex w-full max-w-xl flex-col px-6 pt-6 pb-8">
        {/* ——— status: falta a mensagem ——— */}
        <div className="flex flex-col items-center text-center">
          <span className="relative">
            <span className="cart-done-badge grid size-[64px] place-items-center rounded-full bg-[#FFD599] text-[#15130F]">
              <Check className="size-8" strokeWidth={3} />
            </span>
            <ConfettiBurst active={burst} className="-inset-24 overflow-visible" />
          </span>
          <p className="mt-5 text-[14px] font-semibold text-[#FFD599]">Obrigado pela confiança</p>
          <h1 className="mt-1.5 text-[28px] leading-[1.1] font-bold tracking-[-0.03em] text-balance text-white">
            {done.firstName ? `${done.firstName}, falta só` : "Falta só"} confirmar no WhatsApp
          </h1>
          <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#221C14] px-3.5 py-1.5 text-[13px] font-semibold text-[#FFD599] ring-1 ring-[#FFD599]/40 ring-inset">
            <span className="os-wait size-2 rounded-full bg-[#FFD599]" aria-hidden />
            Aguardando sua mensagem
          </span>
          <p className="mt-3 max-w-[32ch] text-[15px] leading-relaxed text-[#BABABA]">
            Envie a mensagem para a Orium confirmar seu pedido. Ela já vai pronta.
          </p>
        </div>

        {/* ——— um bilhete da Orium: proximidade, não protocolo ——— */}
        <section className="mt-6 rounded-[24px] bg-[#F2F1ED] px-6 pt-5 pb-6 text-[#15130F]">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#15130F]">
              <img src={symbolLight.url} alt="" className="size-6 object-contain" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] leading-tight font-bold">Equipe Orium</p>
              <p className="text-[12.5px] text-[#15130F]/60">pra você, {done.firstName || "com carinho"}</p>
            </div>
          </div>
          <p className="mt-4 text-[15px] leading-relaxed text-[#15130F]/85">
            {done.firstName ? `Oi, ${done.firstName}! ` : "Oi! "}
            Obrigado por escolher a Orium. Assim que sua mensagem chegar, a gente confirma tudo e te passa o pagamento. Pagou metade ou o total, seus perfumes já são separados com carinho.
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-[#15130F]/85">Dúvida ou quer uma indicação? É só chamar a gente.</p>
        </section>

        {/* ——— os perfumes dele ——— */}
        <section className="mt-6 rounded-[24px] bg-[#1A1A1A] p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[17px] font-bold text-white">Seus perfumes</p>
            <span className="text-[13px] text-[#A9A9A9]">
              {done.count} {done.count === 1 ? "item" : "itens"}
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {done.items.map((it, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-white">
                  {it.image ? <img src={imgVariant(it.image, "thumb") ?? undefined} alt="" className="size-full object-contain p-1" loading="lazy" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">{it.name}</span>
              </li>
            ))}
            {extra > 0 ? <li className="text-[13.5px] text-[#A9A9A9]">e mais {extra} {extra === 1 ? "item" : "itens"}</li> : null}
          </ul>
          <div className="mt-4 border-t border-white/10 pt-4">
            {done.savings > 0.009 ? (
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-semibold text-[#FFD599]">Você economizou</span>
                <CountUp value={done.savings} format={brl} className="text-[16px] font-bold text-[#FFD599] tabular-nums" />
              </div>
            ) : null}
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-[14px] text-[#A9A9A9]">
                {done.payment} · {done.receive}
              </span>
              <span className="text-[26px] font-bold tracking-[-0.02em] text-white tabular-nums">{brl(done.total)}</span>
            </div>
          </div>
        </section>

        {/* ——— o caminho até chegar nele ——— */}
        <section className="mt-4 rounded-[24px] bg-[#1A1A1A] p-5">
          <p className="text-[17px] font-bold text-white">Como continua</p>
          <ol className="mt-4 space-y-3.5">
            {steps.map((st, i) => (
              <li key={i} className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-nums",
                    st.state === "done" && "bg-[#FFD599] text-[#15130F]",
                    st.state === "now" && "bg-[#15130F] text-[#FFD599] ring-2 ring-[#FFD599] ring-inset",
                    st.state === "next" && "bg-[#262626] text-[#7A7A7A]",
                  )}
                >
                  {st.state === "done" ? <Check className="size-4" strokeWidth={3} /> : i + 1}
                </span>
                <span
                  className={cn(
                    "text-[15px] leading-snug",
                    st.state === "done" && "text-[#A9A9A9]",
                    st.state === "now" && "font-bold text-white",
                    st.state === "next" && "text-[#8A8A8A]",
                  )}
                >
                  {st.label}
                  {st.state === "now" ? <span className="ml-1.5 text-[12px] font-semibold text-[#FFD599]">agora</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ——— próximo pedido ——— */}
        {featured ? (
          <section className="mt-4 rounded-[24px] bg-[#1A1A1A] p-5">
            <p className="text-[13px] font-semibold text-[#FFD599]">Para o seu próximo pedido</p>
            <p className="mt-1 text-[22px] leading-tight font-bold tracking-[-0.02em] text-white">
              {comboTitle(featured.combo)} <span className="text-[#FFD599]">{comboPriceLine(featured.combo)}</span>
            </p>
            <p className="mt-1 text-[14px] text-[#A9A9A9] tabular-nums">
              {comboBrl(comboUnitPrice(featured.combo))} cada · misture os perfumes que quiser
            </p>
            <ComboCountdown endsAt={featured.combo.ends_at} className="mt-4 bg-[#101010]" />
            <button
              type="button"
              onClick={() => {
                onFinish();
                another(true);
              }}
              className="press mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-bold text-[#15130F]"
            >
              Montar um combo <ArrowRight className="size-4" strokeWidth={2.4} />
            </button>
          </section>
        ) : null}

        <button type="button" onClick={share} className="press mt-4 flex w-full items-center gap-4 rounded-[24px] bg-[#1A1A1A] p-5 text-left">
          <span className="grid size-12 shrink-0 place-items-center rounded-[16px] bg-[#232323] text-[#FFD599]">
            <Share2 className="size-5" strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-bold text-white">Indique a Orium</span>
            <span className="mt-0.5 block text-[13.5px] leading-snug text-[#A9A9A9]">Mande para quem ama perfume. Um toque e o link vai pronto.</span>
          </span>
          <ArrowRight className="size-5 shrink-0 text-[#7A7A7A]" strokeWidth={2.2} />
        </button>

        <button type="button" onClick={onContinue} className="press mt-6 h-[52px] w-full rounded-full text-[15px] font-semibold text-[#A9A9A9]">
          Continuar comprando
        </button>
      </div>

      {/* ——— o botão que importa fica sempre à mão ——— */}
      <div className="sticky bottom-0 z-20 border-t border-white/[0.06] bg-[#0A0A0A] px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-xl">{whats}</div>
      </div>
    </>
  );
}
