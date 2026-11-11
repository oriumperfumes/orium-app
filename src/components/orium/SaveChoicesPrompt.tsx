/**
 * Chamada discreta "Salve suas escolhas".
 *
 * Só aparece quando existe contexto real (favoritos ou carrinho) e nunca no
 * primeiro acesso. Se o cliente fechar, não volta a aparecer por dias.
 */
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/lib/cart";
import { useFavorites } from "@/lib/favorites";
import { useLead } from "@/lib/lead";
import { imgVariant } from "@/lib/product-img";
import { PopCard, PopIcon, ThumbStack } from "@/components/orium/PopCard";

const VISITS_KEY = "orium-visits";

function bumpVisits(): number {
  try {
    const next = Number(window.localStorage.getItem(VISITS_KEY) ?? 0) + 1;
    window.localStorage.setItem(VISITS_KEY, String(next));
    return next;
  } catch {
    return 1;
  }
}

export function SaveChoicesPrompt() {
  const { lead, ready, nudgeDismissed, dismissNudge, requestLead } = useLead();
  const cart = useCart();
  const favorites = useFavorites();
  const [visits, setVisits] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setVisits(bumpVisits());
  }, []);

  const hasContext = favorites.count > 0 || cart.totalQuantity > 0;
  const show =
    ready &&
    !lead &&
    !nudgeDismissed &&
    !hidden &&
    !cart.open &&
    hasContext &&
    (visits >= 2 || cart.totalQuantity > 0);

  // as fotos dos perfumes do próprio cliente: favoritos primeiro, depois a sacola
  const favIds = favorites.entries.slice(0, 3).map((e) => e.productId);
  const { data: favImages } = useQuery({
    queryKey: ["save-prompt-thumbs", favIds.join(",")],
    enabled: show && favIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id, image_url").in("id", favIds);
      const byId = new Map((data ?? []).map((r) => [r.id, r.image_url as string | null]));
      return favIds.map((id) => byId.get(id)).filter(Boolean) as string[];
    },
  });

  if (!show) return null;

  const cartImages = cart.items.map((i) => i.image).filter(Boolean) as string[];
  const images = Array.from(new Set([...(favImages ?? []), ...cartImages]))
    .map((u) => imgVariant(u, "thumb") ?? u)
    .slice(0, 3);
  const total = new Set([...favorites.entries.map((e) => e.productId), ...cart.items.map((i) => i.productId)]).size;
  const more = Math.max(0, total - images.length);

  const close = () => {
    setHidden(true);
    dismissNudge();
  };

  return (
    <PopCard
      media={
        images.length ? (
          <ThumbStack images={images} more={more} />
        ) : (
          <PopIcon>
            <Heart className="size-[20px]" fill="currentColor" strokeWidth={0} />
          </PopIcon>
        )
      }
      eyebrow="Salve suas escolhas"
      title={total === 1 ? "Não perca o perfume que você escolheu" : `Não perca os ${total} perfumes que você escolheu`}
      text="Com seu nome e WhatsApp, tudo fica guardado para quando você voltar."
      primary={{
        label: "Salvar minhas escolhas",
        onClick: () => {
          // o cartão sai e a folha de cadastro assume (nesta visita ele não volta)
          setHidden(true);
          requestLead({
            trigger: "salvar_escolhas",
            onDone: (l) => toast.success(`Prontinho, ${l.name.split(" ")[0]}! Suas escolhas estão salvas.`),
          });
        },
      }}
      secondary={{ label: "Agora não", onClick: close }}
      onDismiss={close}
      dismissLabel="Agora não"
      mediaTop={images.length > 0}
      z={40}
    />
  );
}
