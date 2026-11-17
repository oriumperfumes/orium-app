/**
 * PREÇO SOB CONSULTA — perfumes que a Orium mostra no site sem preço
 * (ex.: os da Rasha, cujo site é preço de atacado). No lugar do preço aparece
 * "Consultar no WhatsApp" e o perfume não entra no carrinho.
 *
 * As listas do site vêm de funções do banco com colunas fixas; em vez de mudar
 * todas, o site busca uma vez a lista (pequena) de ids sob consulta.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { productTitle } from "@/lib/format";
import { usePublicPricingSettings } from "@/lib/pricing-settings";
import { usePromotions } from "@/lib/use-promotions";
import { runningBlack } from "@/lib/black";

export const ORIUM_WHATSAPP = "5521977174508";

/**
 * Chave geral (Admin → Precificação → "Preços sob consulta"): quando ligada,
 * TODO o catálogo público fica sob consulta.
 */
export function usePricesOnRequestAll() {
  const { data } = usePublicPricingSettings();
  return data?.prices_on_request === true;
}

/** Conjunto que responde "sim" para qualquer id: a loja inteira sob consulta. */
class AllIds extends Set<string> {
  override has(_id: string) {
    return true;
  }
}
const ALL = new AllIds();

/** Loja sob consulta, menos os perfumes liberados (os da Black). */
class AllExcept extends Set<string> {
  constructor(private open: Set<string>) {
    super();
  }
  override has(id: string) {
    return !this.open.has(id);
  }
}

/**
 * BLACK com a loja sob consulta: os perfumes de uma campanha Black em vigor
 * continuam com preço, "Comprar agora" e Sacola, mesmo com a chave geral
 * "Preços sob consulta" ligada. `all` = alguma campanha Black vale para o
 * catálogo inteiro. O servidor confere a mesma regra ao fechar o pedido.
 */
export function useBlackOpen(): { all: boolean; ids: Set<string> } {
  const black = runningBlack(usePromotions());
  const all = black.some((p) => (p.product_ids ?? []).length === 0);
  const ids = new Set(black.flatMap((p) => p.product_ids ?? []));
  return { all, ids };
}

export function useConsultIds() {
  const all = usePricesOnRequestAll();
  const { data } = useQuery({
    queryKey: ["price-on-request-ids"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("products").select("id").eq("price_on_request", true).eq("active", true).limit(2000);
      if (error) return new Set<string>();
      return new Set<string>((data ?? []).map((r: { id: string }) => r.id));
    },
  });
  const open = useBlackOpen();
  if (all) return open.all ? (data ?? EMPTY) : open.ids.size ? new AllExcept(open.ids) : ALL;
  return data ?? EMPTY;
}
const EMPTY = new Set<string>();

/** O produto é sob consulta? (coluna, quando vier, ou a lista de ids) */
export function isOnRequest(product: { id: string; price_on_request?: boolean | null } | null | undefined, ids: Set<string>) {
  if (!product) return false;
  return product.price_on_request === true || ids.has(product.id);
}

export function consultLink(product: { canonical_name: string; brand?: string | null; volume_ml?: number | null }) {
  const name = [product.brand, productTitle(product.canonical_name), product.volume_ml ? `${product.volume_ml}ml` : null].filter(Boolean).join(" ");
  const msg = `Oi, Orium! Vi o ${name} no site e queria saber o preço e a disponibilidade 😊`;
  return `https://wa.me/${ORIUM_WHATSAPP}?text=${encodeURIComponent(msg)}`;
}
