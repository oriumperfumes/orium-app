/**
 * Configuração de preço visível para a loja.
 *
 * As margens internas (varejo/atacado) NÃO saem do banco para o cliente:
 * a vitrine só recebe a quantidade mínima de atacado e o desconto Pix,
 * através da função pública `public_pricing_settings`.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PublicPricingSettings = {
  wholesale_min_quantity: number | null;
  pix_discount_percent: number | null;
  pix_discount_active: boolean | null;
  /** Admin → Precificação: loja inteira com preço sob consulta. */
  prices_on_request?: boolean | null;
};

export async function fetchPublicPricingSettings(): Promise<PublicPricingSettings | null> {
  const { data } = await supabase.rpc("public_pricing_settings");
  const row = Array.isArray(data) ? data[0] : data;
  return (row as PublicPricingSettings | undefined) ?? null;
}

export function usePublicPricingSettings() {
  return useQuery({
    queryKey: ["pricing-settings"],
    queryFn: fetchPublicPricingSettings,
    staleTime: 5 * 60 * 1000,
  });
}
