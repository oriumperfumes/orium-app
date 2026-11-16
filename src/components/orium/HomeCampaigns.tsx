import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { deviceId } from "@/lib/promotions";
import { getOffers, type Offer } from "@/lib/offers.functions";
import { OfferPopup } from "@/components/orium/OfferPopup";
import { AnnouncementCard } from "@/components/orium/AnnouncementCard";
import { useAuth } from "@/lib/auth";
import { usePricesOnRequestAll } from "@/lib/price-on-request";

/**
 * FILA DE COMUNICAÇÕES — nunca dois avisos ao mesmo tempo.
 * 1º oferta promocional (popup/carrossel) · 2º cupom público (card do topo).
 */
export function HomeCampaigns({ onExplore }: { onExplore?: (() => void) | undefined }) {
  const { session } = useAuth();
  const load = useServerFn(getOffers);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [done, setDone] = useState(false);
  const onRequestAll = usePricesOnRequestAll();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await load({ data: { deviceId: deviceId(), userId: session?.user.id ?? null } });
        if (!cancelled) setOffers(res.offers);
      } catch {
        if (!cancelled) setOffers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  if (offers === null) return null;
  // preços sob consulta: nada de oferta com valor na Home
  if (onRequestAll) return null;
  if (offers.length > 0 && !done) return <OfferPopup offers={offers} onDone={() => setDone(true)} />;
  // Sem oferta pendente (ou já vista nesta sessão) o cupom pode aparecer.
  if (offers.length > 0) return null;
  return onExplore ? <AnnouncementCard onExplore={onExplore} /> : <AnnouncementCard />;
}
