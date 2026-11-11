/**
 * NOVIDADES — perfumes que acabaram de chegar aos catálogos dos fornecedores.
 *
 * A ordem vem do banco: data informada pelo fornecedor quando existe, senão a
 * primeira vez que a Orium detectou o produto (`first_seen_at`). Nada é
 * cadastrado à mão e nenhuma data é inventada.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NewArrival = {
  id: string;
  slug: string;
  canonical_name: string;
  brand: string | null;
  gender_norm: string | null;
  product_type: string | null;
  concentration: string | null;
  volume_ml: number | null;
  image_url: string | null;
  in_stock: boolean;
  retail_price: number | null;
  wholesale_price: number | null;
  decant_available: boolean | null;
  decant_price_2ml: number | null;
  decant_price_5ml: number | null;
  decant_price_10ml: number | null;
  arrived_at: string | null;
  is_new: boolean;
};

export function useNewArrivals(limit = 12, newDays = 30) {
  const { data, isLoading } = useQuery({
    queryKey: ["new-arrivals", limit, newDays],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("new_arrivals", { p_limit: limit, p_new_days: newDays });
      if (error) throw error;
      return (data ?? []) as unknown as NewArrival[];
    },
  });
  return { items: data ?? [], isLoading };
}
