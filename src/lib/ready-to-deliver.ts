import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * A fonte de verdade é products.ready_to_deliver (estoque lacrado local ou
 * liberação manual). Nunca inferir "sob encomenda" enquanto a consulta carrega
 * ou quando ela falha, para não prometer um prazo falso.
 */
const queryOptions = {
  queryKey: ["ready-to-deliver", "serializable-v2"] as const,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("products")
      .select("id")
      .eq("ready_to_deliver", true)
      .eq("active", true)
      .limit(2000);
    if (error) throw error;
    // O cache do TanStack Query precisa ser serializável no SSR/hydration.
    return (data ?? []).map((r) => r.id as string);
  },
  staleTime: 60_000,
};
const EMPTY = new Set<string>();

export function useReadyToDeliver() {
  const { data } = useQuery(queryOptions);
  return useMemo(() => (data ? new Set(data) : EMPTY), [data]);
}

export function useReadyToDeliverStatus(productId: string | null | undefined) {
  const { data, isSuccess } = useQuery(queryOptions);
  return { ready: !!productId && !!data?.includes(productId), resolved: isSuccess };
}

/** Para o checkout, distingue falta de pronta entrega de consulta ainda pendente. */
export function useReadyToDeliverSnapshot() {
  const { data, isSuccess } = useQuery(queryOptions);
  const readyIds = useMemo(() => (data ? new Set(data) : EMPTY), [data]);
  return { readyIds, resolved: isSuccess };
}

export function useIsReadyToDeliver(productId: string | null | undefined) {
  return useReadyToDeliverStatus(productId).ready;
}
