import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isRunning, type Promotion, type PublicCoupon } from "@/lib/promotions";
import { runningCombos, type DecantCombo } from "@/lib/decant-combos";

/**
 * Leitura pública de promoções e cupons.
 *
 * O navegador nunca lê as tabelas direto: usa consultas seguras do banco que
 * devolvem só o que o cliente precisa ver. Números internos (visualizações,
 * cliques, vendas, desconto acumulado) ficam restritos à equipe.
 */
async function publicRpc<T>(name: "public_promotions" | "public_coupons"): Promise<T[]> {
  const client = supabase as unknown as {
    rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
  };
  const { data } = await client.rpc(name);
  return (Array.isArray(data) ? data : []) as T[];
}

/** Promoções em vigor + se a resposta já chegou (evita render com estado errado). */
export function usePromotionsResolved() {
  const { data, isPending } = useQuery({
    queryKey: ["promotions-active"],
    queryFn: async () => {
      const rows = await publicRpc<Promotion>("public_promotions");
      const now = Date.now();
      return rows.filter((p) => isRunning(p, now));
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  return { promotions: data ?? [], ready: !isPending };
}

/** Promoções em vigor — só leitura pública, atualiza sozinho sem publicar de novo. */
export function usePromotions() {
  return usePromotionsResolved().promotions;
}


/** Cupons públicos ativos. Cupons secretos nunca chegam ao navegador. */
export function usePublicCoupons() {
  const { data } = useQuery({
    queryKey: ["coupons-public"],
    queryFn: async () => publicRpc<PublicCoupon>("public_coupons"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  return data ?? [];
}


/**
 * Combos de decants em vigor (ex.: "leve 3 por R$ 100"). Leitura pública pela consulta
 * segura do banco; se ela ainda não existir, devolve lista vazia sem quebrar a loja.
 */
function useCombosQuery() {
  return useQuery({
    queryKey: ["decant-combos-active"],
    queryFn: async () => {
      const client = supabase as unknown as {
        rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
      };
      const { data: rows, error } = await client.rpc("public_decant_combos");
      if (error) return [] as DecantCombo[];
      return runningCombos((Array.isArray(rows) ? rows : []) as DecantCombo[]);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useDecantCombos() {
  return useCombosQuery().data ?? [];
}

/** A consulta dos combos já respondeu (com ou sem combo)? Evita "piscar" um cartão e trocar por outro. */
export function useDecantCombosLoaded() {
  return useCombosQuery().isFetched;
}
