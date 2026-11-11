import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { brl, productTitle } from "@/lib/format";
import { deviceId } from "@/lib/promotions";
import { markOffersSeen, type Offer } from "@/lib/offers.functions";
import { useAuth } from "@/lib/auth";
import { PromotionBadge } from "@/components/orium/PromotionBadge";
import { ConfettiBurst, useCelebrateOnce } from "@/lib/celebration";
import { cn } from "@/lib/utils";
import { useAppReady } from "@/lib/splash-state";
import { useSwipeDismiss } from "@/hooks/use-swipe-dismiss";
import { navigatingFromLayer, useBackToClose } from "@/hooks/use-back-to-close";


/**
 * POPUP / CARROSSEL DE OFERTAS.
 *
 * 1 promoção ativa → um card promocional elegante.
 * 2 ou mais → o mesmo card vira carrossel com swipe.
 * Aparece uma única vez por campanha/pessoa e nunca junto do aviso de cupom.
 */
export function OfferPopup({ offers, onDone, preview = false }: { offers: Offer[]; onDone: () => void; preview?: boolean }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const mark = useServerFn(markOffersSeen);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const closed = useRef(false);
  const root = useRef<HTMLDivElement | null>(null);
  const recorded = useRef(new Set<string>());
  // a abertura do app é limpa: a oferta (e a festa dela) só aparece depois
  const appReady = useAppReady(700);

  // Celebração principal: uma única vez ao abrir o popup/carrossel — nunca a
  // cada swipe e nunca de novo na mesma campanha. No teste do Admin (preview)
  // a celebração sempre roda.
  const key = useMemo(() => {
    if (!offers.length || !appReady) return null;
    const ids = offers.map((o) => o.promotionId).sort().join("|");
    return preview ? `offer-preview:${Date.now()}` : `offer:${ids}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers.length, preview, appReady]);
  const celebrate = useCelebrateOnce(key);



  const record = async (id: string, clicked = false) => {
    if (preview || (!clicked && recorded.current.has(id))) return;
    recorded.current.add(id);
    await mark({
      data: {
        ids: [id],
        deviceId: deviceId(),
        userId: session?.user.id ?? null,
        clickedId: clicked ? id : null,
      },
    });
  };

  const finish = (clickedId: string | null) => {
    if (closed.current) return;
    closed.current = true;
    setLeaving(true);
    if (clickedId) record(clickedId, true);
    setTimeout(onDone, 260);
  };

  useEffect(() => {
    const first = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = root.current;
        const offer = offers[index];
        if (!el || !offer || document.visibilityState !== "visible") return;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
          void record(offer.promotionId);
        }
      });
    });
    return () => cancelAnimationFrame(first);
  }, [index, offers, appReady]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const step = el.clientWidth || 1;
      setIndex(Math.round(el.scrollLeft / step));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [appReady]);

  const go = (dir: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };

  const open = async (o: Offer) => {
    await record(o.promotionId, true);
    navigatingFromLayer();
    finish(null);
    await navigate({
      to: "/perfume/$slug",
      replace: true,

      params: { slug: o.slug },
      search: o.variant === "DECANT" && o.decantMl ? { ml: o.decantMl } : { frasco: 1 },
    });
  };

  const swipe = useSwipeDismiss<HTMLDivElement>(() => finish(null), "down");
  // gesto de voltar do celular fecha a oferta
  useBackToClose(offers.length > 0 && appReady && !leaving, () => finish(null));

  if (!offers.length || !appReady) return null;

  return (
    <>
      {/* Foco total na oferta: o fundo escurece enquanto o popup vive. */}
      <div
        aria-hidden
        onClick={() => finish(null)}
        className={cn("fixed inset-0 z-40", leaving ? "popup-backdrop popup-backdrop-out" : "popup-backdrop")}
      />
      <div className="pointer-events-none fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-50 flex justify-center lg:inset-0 lg:items-center">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label="Ofertas exclusivas do app"
        className={cn("pointer-events-auto w-full max-w-[400px]", leaving ? "popup-out" : "popup-in")}
      >
        <div ref={swipe} className="offer-card relative overflow-hidden rounded-[30px] bg-[#161616] text-white">
          <ConfettiBurst active={celebrate} />

          <button
            type="button"
            onClick={() => finish(null)}
            aria-label="Fechar ofertas"
            className="press absolute top-3.5 right-3.5 z-10 grid size-9 place-items-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75"
          >
            <X className="size-4" strokeWidth={2.4} />
          </button>

          <div ref={scroller} className="hcarousel flex snap-x snap-mandatory">
            {offers.map((o, i) => (
              <OfferSlide key={o.promotionId} offer={o} eager={i === 0} onOpen={() => void open(o)} />
            ))}
          </div>

          {offers.length > 1 ? (
            <div className="flex items-center justify-center gap-3 px-5 pb-4">
              <button
                aria-label="Oferta anterior"
                onClick={() => go(-1)}
                disabled={index === 0}
                className="press hidden size-9 place-items-center rounded-full bg-[#1F1F1F] text-white transition-opacity disabled:opacity-30 lg:grid"
              >
                <ChevronLeft className="size-4" strokeWidth={2.4} />
              </button>
              <div className="flex items-center gap-1.5" aria-label={`${Math.min(index + 1, offers.length)} de ${offers.length}`}>
                {offers.map((o, i) => (
                  <span
                    key={o.promotionId}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-300 ease-[var(--ease-orium)]",
                      i === index ? "w-5 bg-white" : "w-1.5 bg-white/25",
                    )}
                  />
                ))}
              </div>
              <button
                aria-label="Próxima oferta"
                onClick={() => go(1)}
                disabled={index >= offers.length - 1}
                className="press hidden size-9 place-items-center rounded-full bg-[#1F1F1F] text-white transition-opacity disabled:opacity-30 lg:grid"
              >
                <ChevronRight className="size-4" strokeWidth={2.4} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
      </div>
    </>
  );
}

function OfferSlide({ offer, eager, onOpen }: { offer: Offer; eager: boolean; onOpen: () => void }) {
  const kind =
    offer.variant === "DECANT"
      ? `Decant ${offer.decantMl} ml`
      : offer.volumeMl
        ? `Frasco ${offer.volumeMl} ml`
        : "Frasco completo";
  return (
    <div className="w-full shrink-0 snap-center p-3 pb-4">
      {/* vitrine: a foto do perfume em destaque, como no catálogo */}
      <div className="relative grid aspect-[16/11] place-items-center overflow-hidden rounded-[22px] bg-white">
        {offer.image ? (
          <img
            src={offer.image}
            alt={`${offer.brand ?? ""} ${offer.name}`}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            className="offer-photo size-full object-contain p-5"
          />
        ) : null}
        <span className="price-new absolute top-3.5 left-3.5 rounded-full bg-[#15130F] px-3 py-1.5 text-[15px] leading-none font-extrabold text-[#FFD599] tabular-nums" style={{ "--d": "280ms" } as React.CSSProperties}>
          -{Math.round(offer.percent)}%
        </span>
      </div>

      <div className="px-2 pt-4">
        <p className="reward-step text-[12.5px] font-semibold text-[#FFD599]" style={{ "--d": "60ms" } as React.CSSProperties}>
          {offer.title || "Oferta exclusiva no app"}
        </p>
        <p className="reward-step mt-1 text-[13px] text-[#A9A9A9]" style={{ "--d": "100ms" } as React.CSSProperties}>
          {offer.brand ?? "Orium"} · {kind}
          {offer.inStock ? "" : " · indisponível"}
        </p>
        <p className="reward-step mt-0.5 text-[22px] leading-[1.15] font-bold tracking-[-0.02em] break-words" style={{ "--d": "130ms" } as React.CSSProperties}>
          {productTitle(offer.name)}
        </p>
        <p className="mt-2.5 flex items-baseline gap-2.5">
          <span className="price-new text-[28px] leading-none font-extrabold tracking-[-0.02em] tabular-nums" style={{ "--d": "240ms" } as React.CSSProperties}>
            {brl(offer.finalPrice)}
          </span>
          <span className="reward-step text-[14px] text-[#8C8C8C] tabular-nums" style={{ "--d": "180ms" } as React.CSSProperties}>
            <span className="price-strike inline-block">{brl(offer.basePrice)}</span>
          </span>
        </p>
        {offer.endsToday || offer.appBadge ? (
          <p className="reward-step mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]" style={{ "--d": "300ms" } as React.CSSProperties}>
            {offer.appBadge ? <PromotionBadge label={offer.appBadge} size="sm" /> : null}
            {offer.endsToday ? (
              <span className="rounded-full bg-[#2A1C1C] px-2.5 py-1 font-bold text-[#FF9A8A]">Termina hoje</span>
            ) : null}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onOpen}
          className="press reward-step mt-4 flex h-[52px] w-full items-center justify-center rounded-full bg-[#FFD599] text-[16px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]"
          style={{ "--d": "360ms" } as React.CSSProperties}
        >
          {offer.ctaLabel}
        </button>
      </div>
    </div>
  );
}
