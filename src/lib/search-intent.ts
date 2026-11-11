import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CatalogProduct } from "@/components/orium/ProductCard";
import { SEARCH_MIN_CHARS } from "@/components/orium/search/search-context";

/**
 * Intenção da busca — decidida no banco a partir dos perfumes reais do catálogo.
 *
 * LINE_SEARCH          → o cliente procurou uma linha/grupo ("Club de Nuit").
 *                        A lista normal do catálogo continua sendo a resposta.
 * EXACT_PRODUCT_SEARCH → o cliente procurou UM perfume ("Club de Nuit Intense
 *                        Man", inclusive com erro de digitação). Mostramos esse
 *                        perfume em destaque e, abaixo, perfumes parecidos no
 *                        cheiro — calculados por acordes, notas e família, nunca
 *                        por semelhança de nome.
 */
export type SearchIntent = "LINE_SEARCH" | "EXACT_PRODUCT_SEARCH";

export type ExactMatch = CatalogProduct & { confidence: number };

export type SimilarProduct = CatalogProduct & {
  similarity_score: number;
  shared_accords: string[] | null;
};

export type SearchIntentResult = {
  intent: SearchIntent;
  confidence: number;
  product: ExactMatch | null;
};

export function useSearchIntent(query: string) {
  const q = query.trim();
  const enabled = q.length >= SEARCH_MIN_CHARS;

  const intent = useQuery<SearchIntentResult>({
    queryKey: ["search-intent", q],
    enabled,
    // a intenção de um mesmo termo não muda a cada digitação
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc("search_intent", { p_q: q }).abortSignal(signal);
      if (error) throw error;
      const row = (data ?? [])[0];
      if (!row || row.intent !== "EXACT_PRODUCT_SEARCH" || !row.product_id) {
        return { intent: "LINE_SEARCH", confidence: Number(row?.confidence ?? 0), product: null };
      }
      const { intent: _i, line_label: _l, product_id, confidence, ...p } = row;
      return {
        intent: "EXACT_PRODUCT_SEARCH",
        confidence: Number(confidence ?? 0),
        product: { ...(p as CatalogProduct), id: product_id, confidence: Number(confidence ?? 0) },
      };
    },
  });

  const productId = intent.data?.product?.id ?? null;

  const similar = useOlfactorySimilar(productId, 8);

  return {
    intent: intent.data?.intent ?? "LINE_SEARCH",
    exact: intent.data?.product ?? null,
    isLoading: enabled && intent.isLoading,
    similar: similar.items,
    similarLoading: similar.isLoading,
  };
}

/**
 * Engine de similaridade olfativa — uma só, compartilhada pela busca inteligente
 * e pelas recomendações da página do perfume. O ranking vem do banco
 * (acordes 45%, notas com posição na pirâmide 40%, família 15%).
 */
export function useOlfactorySimilar(productId: string | null, limit = 8) {
  const q = useQuery<SimilarProduct[]>({
    queryKey: ["olfactory-similar", productId, limit],
    enabled: Boolean(productId),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!productId) return [];
      const { data, error } = await supabase.rpc("olfactory_similar", {
        p_product_id: productId,
        p_limit: limit,
      }).abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as SimilarProduct[];
    },
  });

  return {
    items: q.data ?? [],
    isLoading: Boolean(productId) && q.isLoading,
    isError: q.isError,
  };
}
