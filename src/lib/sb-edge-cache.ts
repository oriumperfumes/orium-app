/**
 * Leituras públicas do catálogo que podem sair do cache da borda (Cloudflare) por 60 s.
 *
 * Só entram aqui leituras iguais para qualquer visitante anônimo (catálogo, preços,
 * promoções, notas olfativas). Pedidos com usuário logado (admin, cliente) nunca
 * passam pelo cache: vão direto ao banco como antes.
 */
export const EDGE_TTL_SECONDS = 60;

const TABLES = new Set([
  "products",
  "brands",
  "promotions",
  "pricing_settings",
  "negotiation_items",
  "fragrance_details",
  "fragrance_accords",
  "fragrance_notes",
  "decant_settings",
  "shipping_settings",
]);

const RPCS = new Set([
  "search_catalog",
  "public_coupons",
  "public_decant_combos",
  "public_pricing_settings",
  "public_promotions",
  "public_ready_to_deliver_ids",
  "public_sale_modes",
  "top_sold_products",
  "olfactory_similar",
  "fragrance_publicly_visible",
]);

/**
 * Caminho depois de `/rest/v1/` (com a query string) se a leitura puder usar o cache;
 * senão `null`.
 */
export function cacheableRestPath(method: string, restPath: string): string | null {
  const m = method.toUpperCase();
  const [name] = restPath.split("?");
  if (m === "GET" || m === "HEAD") return TABLES.has(name) ? restPath : null;
  if (m === "POST" && name.startsWith("rpc/") && !restPath.includes("?")) {
    return RPCS.has(name.slice(4)) ? restPath : null;
  }
  return null;
}

/** Endereço do cache para uma leitura do banco (mesma origem do site). */
export function edgeCacheUrl(restPath: string): string {
  return `/api/public/sb-cache?p=${encodeURIComponent(restPath)}`;
}
