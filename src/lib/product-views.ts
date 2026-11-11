/**
 * VISUALIZAÇÕES REAIS DE PERFUME.
 *
 * Só conta quando a página individual do produto é aberta — nunca card,
 * viewport, hover ou autocomplete. A deduplicação (30 minutos por
 * pessoa/aparelho + perfume) acontece no banco, então recarregar a página
 * várias vezes não infla o ranking.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { deviceId } from "@/lib/promotions";

/**
 * Identificador do visitante — fonte única compartilhada com o CRM
 * (favoritos, carrinho, interesses), para que o histórico de acessos
 * apareça na ficha do cliente.
 */
export function visitorId(): string | null {
  return deviceId();
}

/** Registro silencioso: nunca bloqueia a página nem mostra erro ao cliente. */
export function logProductView(productId: string | null | undefined) {
  if (!productId || typeof window === "undefined") return;
  const anon = visitorId();
  void supabase
    .rpc("log_product_view", { p_product_id: productId, ...(anon ? { p_anonymous_id: anon } : {}) })
    .then(() => undefined, () => undefined);
}


export type TopViewedProduct = {
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
  views: number;
  sold: number;
};

/**
 * Ranking vem do banco (fonte da verdade), com janela móvel de 30 dias.
 * Sem acessos suficientes, o próprio ranking cai para mais vendidos e recentes.
 */
export function useTopViewed(days = 30, limit = 12) {
  const { data, isLoading } = useQuery({
    queryKey: ["top-viewed", days, limit],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("top_viewed_products", { p_days: days, p_limit: limit });
      if (error) throw error;
      return (data ?? []) as unknown as TopViewedProduct[];
    },
  });
  return { items: data ?? [], isLoading };
}

export type TopSoldProduct = Omit<TopViewedProduct, "views"> & {
  /** unidades realmente vendidas na janela considerada */
  sold: number;
  /** janela usada pelo banco (0 = histórico completo) */
  period_days: number;
};

/**
 * MAIS VENDIDOS — ranking de venda real.
 *
 * A fonte é sempre pedido confirmado, não cancelado e não excluído; nunca
 * visualização, favorito ou clique. O banco escolhe a janela: 30 dias, depois
 * 90 dias e, se ainda houver pouco histórico, o total acumulado.
 */
export function useTopSold(days = 30, limit = 12) {
  const { data, isLoading } = useQuery({
    queryKey: ["top-sold", days, limit],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("top_sold_products", { p_days: days, p_limit: limit });
      if (error) throw error;
      return (data ?? []) as unknown as TopSoldProduct[];
    },
  });
  return { items: data ?? [], isLoading };
}
