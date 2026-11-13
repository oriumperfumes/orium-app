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

export const ORIUM_WHATSAPP = "5521977174508";

export function useConsultIds() {
  const { data } = useQuery({
    queryKey: ["price-on-request-ids"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("products").select("id").eq("price_on_request", true).eq("active", true).limit(2000);
      if (error) return new Set<string>();
      return new Set<string>((data ?? []).map((r: { id: string }) => r.id));
    },
  });
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
