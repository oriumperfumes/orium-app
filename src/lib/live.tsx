/**
 * AO VIVO (lado do cliente).
 *
 * Envia apenas presença comercial: página atual, perfume aberto, modo escolhido
 * e resumo do carrinho. Nada de rolagem, mouse, teclado ou texto digitado.
 * Recebe, no máximo, uma abordagem discreta da equipe por vez.
 */
import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { currentContext, currentSessionKey, currentSource, deviceKind, onTrack } from "@/lib/analytics";
import { livePing, liveAck, liveInbox, type LiveInteraction } from "@/lib/live.functions";
import { deviceId } from "@/lib/promotions";
import { useCart } from "@/lib/cart";
import { useFavorites } from "@/lib/favorites";
import { useLead } from "@/lib/lead";
import { toast } from "sonner";
import { MessageCircle, Sparkles } from "lucide-react";
import { PopCard, PopIcon } from "@/components/orium/PopCard";

const HEARTBEAT_MS = 45_000;
const MIN_INTERVAL_MS = 6_000;

export function LiveProvider() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { items, total } = useCart();
  const { count: favorites } = useFavorites();
  const { requestLead } = useLead();

  const [pending, setPending] = useState<LiveInteraction | null>(null);

  // Contexto comercial atual — derivado dos eventos que já registramos.
  const ctx = useRef({
    productId: null as string | null,
    variant: null as string | null,
    decantMl: null as number | null,
    inCheckout: false,
    negotiation: false,
    views: 0,
    query: null as string | null,
  });
  const seenProducts = useRef(new Set<string>());
  const lastSentAt = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cartItems = items.reduce((s, i) => s + i.quantity, 0);

  useEffect(() => {
    const stop = onTrack((event, payload) => {
      const c = ctx.current;
      if (payload.productId) {
        c.productId = payload.productId;
        if (event === "product_view" && !seenProducts.current.has(payload.productId)) {
          seenProducts.current.add(payload.productId);
          c.views = seenProducts.current.size;
        }
      }
      if (event === "decant_selected") {
        c.variant = "DECANT";
        c.decantMl = payload.decantMl ?? null;
      }
      if (event === "bottle_selected") {
        c.variant = "FULL";
        c.decantMl = null;
      }
      if (event === "checkout_started") c.inCheckout = true;
      if (event === "cart_opened" || event === "product_view") c.inCheckout = false;
      if (event === "negotiation_interest") c.negotiation = true;
      if (event === "search" && payload.query) c.query = payload.query;
      schedule(true);
    });
    return () => {
      stop();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function send(force = false) {
    const sessionKey = currentSessionKey();
    const visitorId = deviceId();
    if (!sessionKey || !visitorId) return;
    if (!force && Date.now() - lastSentAt.current < MIN_INTERVAL_MS) return;
    lastSentAt.current = Date.now();
    const c = ctx.current;
    void livePing({
      data: {
        sessionKey,
        visitorId,
        route: window.location.pathname,
        productId: c.productId,
        variant: c.variant,
        decantMl: c.decantMl,
        device: deviceKind(),
        source: currentSource(),
        cartItems,
        cartTotal: total,
        favorites,
        views: c.views,
        inCheckout: c.inCheckout,
        negotiation: c.negotiation,
        query: c.query,
        context: (() => {
          const ctxInfo = currentContext();
          return ctxInfo
            ? {
                browser: ctxInfo.browser,
                os: ctxInfo.os,
                standalone: ctxInfo.standalone,
                viewport: ctxInfo.viewport,
                timezone: ctxInfo.timezone,
                language: ctxInfo.language,
                theme: ctxInfo.theme,
                connection: ctxInfo.connection,
              }
            : null;
        })(),
      },
    })
      .then((res) => {
        const next = res?.pending?.[0] ?? null;
        if (next) setPending((prev) => (prev?.id === next.id ? prev : next));
      })
      .catch(() => {});
  }

  function schedule(soon = false) {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => send(true), soon ? 800 : 0);
  }

  // Batida periódica só com a aba visível; presença some por inatividade.
  useEffect(() => {
    send(true);
    const beat = setInterval(() => {
      if (document.visibilityState === "visible") send();
    }, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") send(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    schedule(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, cartItems, total, favorites]);

  // Entrega imediata: a equipe avisa por um canal exclusivo desta sessão.
  useEffect(() => {
    const sessionKey = currentSessionKey();
    if (!sessionKey) return;
    const channel = supabase
      .channel(`orium-live-${sessionKey}`)
      .on("broadcast", { event: "interaction" }, () => {
        void liveInbox({ data: { sessionKey } })
          .then((res) => {
            const next = res.pending[0] ?? null;
            if (next) setPending(next);
          })
          .catch(() => {});
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  if (!pending) return null;

  return (
    <LiveMessage
      interaction={pending}
      onClose={() => setPending(null)}
      onRequestLead={() =>
        requestLead({
          trigger: "ajuda_para_escolher",
          title: "Vamos te ajudar a escolher",
          subtitle: "Deixe seu nome e WhatsApp para um consultor da Orium continuar com você.",
          cta: "Continuar",
        })
      }
    />
  );
}

function LiveMessage({
  interaction,
  onClose,
  onRequestLead,
}: {
  interaction: LiveInteraction;
  onClose: () => void;
  onRequestLead: () => void;
}) {
  const sessionKey = currentSessionKey() ?? "";
  const { applyCoupon, setOpen } = useCart();
  const { lead } = useLead();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void liveAck({ data: { id: interaction.id, sessionKey, action: "seen" } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction.id]);

  const isCoupon = interaction.kind === "cupom" && !!interaction.coupon_code;

  const accept = async () => {
    setBusy(true);
    try {
      await liveAck({ data: { id: interaction.id, sessionKey, action: "accepted" } });
      if (isCoupon) {
        applyCoupon(interaction.coupon_code!);
        setOpen(true);
        toast.success("Cupom aplicado na sua sacola.");
      } else if (!lead?.name || !lead?.phone) {
        onRequestLead();
      } else {
        toast.success("Pronto! Um consultor da Orium já vai falar com você.");
      }
    } finally {
      setBusy(false);
      onClose();
    }
  };

  const dismiss = () => {
    void liveAck({ data: { id: interaction.id, sessionKey, action: "dismissed" } }).catch(() => {});
    onClose();
  };

  return (
    <PopCard
      media={
        <PopIcon>
          {isCoupon ? <Sparkles className="size-[20px]" strokeWidth={2} /> : <MessageCircle className="size-[20px]" strokeWidth={2} />}
        </PopIcon>
      }
      eyebrow={isCoupon ? "Uma condição especial para você" : "Equipe Orium"}
      title={interaction.message}
      primary={{
        label: isCoupon ? "Aplicar cupom" : interaction.kind === "salvar_escolhas" ? "Salvar minhas escolhas" : "Quero ajuda",
        onClick: () => void accept(),
        disabled: busy,
      }}
      secondary={{ label: "Agora não", onClick: dismiss }}
      onDismiss={dismiss}
      z={60}
    >
      {isCoupon ? (
        <span className="coupon-ticket inline-flex items-center gap-1.5 text-[12px] font-bold tracking-[0.12em] uppercase">
          Cupom {interaction.coupon_code}
        </span>
      ) : null}
    </PopCard>
  );
}
