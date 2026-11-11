import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { saveCart } from "@/lib/relationship.functions";
import { visitorId } from "@/lib/product-views";

const NOTICE_KEY = "orium-cart-notice";

/**
 * Carrinho guardado no servidor: serve para o cliente voltar e continuar,
 * e para a Orium atender melhor (carrinho atual e abandonado no CRM).
 * Silencioso: nunca bloqueia a navegação nem mostra erro ao cliente.
 */
export function CartPersistence() {
  const { items, setOpen, totalQuantity } = useCart();
  const { session } = useAuth();
  const push = useServerFn(saveCart);
  const last = useRef<string>("");
  const notified = useRef(false);

  useEffect(() => {
    const signature = items.map((i) => `${i.key}x${i.quantity}`).join("|");
    if (signature === last.current) return;
    const t = window.setTimeout(() => {
      last.current = signature;
      void push({
        data: {
          anonymousId: visitorId(),
          name: (session?.user.user_metadata?.["name"] as string | undefined) ?? null,
          phone: null,
          items: items.map((i) => ({
            productId: i.productId,
            variant: i.variant,
            decantMl: i.decantMl,
            quantity: i.quantity,
            unitPrice: i.retailPrice ?? null,
            name: i.name,
            brand: i.brand,
            image: i.image,
          })),
        },
      }).then(
        () => undefined,
        () => undefined,
      );
    }, 1500);
    return () => window.clearTimeout(t);
  }, [items, push, session]);

  // lembrete discreto, uma vez por visita, sem pressa nem contagem
  useEffect(() => {
    if (notified.current || totalQuantity === 0) return;
    notified.current = true;
    try {
      if (window.sessionStorage.getItem(NOTICE_KEY)) return;
      window.sessionStorage.setItem(NOTICE_KEY, "1");
    } catch {
      /* modo privado */
    }
    const t = window.setTimeout(() => {
      toast("Sua sacola ainda está aqui", {
        description: "Continuar de onde você parou?",
        duration: 6000,
        action: { label: "Ver sacola", onClick: () => setOpen(true) },
      });
    }, 1200);
    return () => window.clearTimeout(t);
  }, [totalQuantity, setOpen]);

  return null;
}
