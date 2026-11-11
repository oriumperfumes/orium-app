/**
 * PRIMEIRO FRAME DA PÁGINA DO PERFUME.
 *
 * O catálogo já conhece foto, marca, nome e preço. Ao tocar no card guardamos
 * esses dados em memória e pedimos a decodificação da foto — assim a página
 * individual desenha na hora, sem esperar o banco e sem recarregar a imagem.
 * Nada aqui bloqueia a navegação.
 */

type Preview = Record<string, unknown> & { slug: string };

const cache = new Map<string, Preview>();

/** Guarda os dados do card (síncrono, custo desprezível). */
export function rememberProductPreview(product: { slug: string } & Record<string, unknown>) {
  if (!product?.slug) return;
  cache.set(product.slug, product as Preview);
  if (cache.size > 120) cache.delete(cache.keys().next().value as string);
}

export function getProductPreview(slug: string) {
  return cache.get(slug) ?? null;
}

/**
 * Prepara a foto já em cache do navegador: decode fora da thread de layout.
 * Sem await no caminho do clique — se falhar, a navegação segue igual.
 */
export function warmProductImage(url: string | null | undefined) {
  if (!url || typeof window === "undefined") return;
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    void img.decode?.().catch(() => undefined);
  } catch {
    /* silencioso */
  }
}

/**
 * Baixa o código da página do perfume antes do toque terminar (só o código,
 * sem carregar dados nem trocar de rota). Abrir um perfume fica instantâneo.
 */
let productChunkWarm = false;
export function warmProductRoute(router: { routesByPath?: Record<string, unknown>; loadRouteChunk?: (r: never) => Promise<unknown> }) {
  if (productChunkWarm || typeof window === "undefined") return;
  try {
    const route = router.routesByPath?.["/perfume/$slug"];
    if (!route || !router.loadRouteChunk) return;
    productChunkWarm = true;
    void router.loadRouteChunk(route as never).catch(() => {
      productChunkWarm = false;
    });
  } catch {
    productChunkWarm = false;
  }
}

/**
 * Transição da foto: o quadro tocado no card "vira" a foto da página do
 * perfume (View Transitions do navegador; sem suporte, a navegação é normal).
 * Só o card tocado recebe o nome, e por pouco tempo, para nunca existir dois
 * elementos com o mesmo nome na tela.
 */
let namedTile: HTMLElement | null = null;
export const HERO_TILE = "pd-hero";
export function nameHeroTile(el: HTMLElement | null) {
  if (typeof document === "undefined") return;
  if (namedTile && namedTile !== el) namedTile.style.viewTransitionName = "";
  // a foto da página atual (abrindo um "Você também pode gostar") sai de cena
  document.querySelectorAll<HTMLElement>(".pd-hero-tile").forEach((t) => {
    t.style.viewTransitionName = "none";
  });
  if (!el) return;
  el.style.viewTransitionName = HERO_TILE;
  namedTile = el;
  // a foto da página nova chega pela transição, sem a entrada própria
  const html = document.documentElement;
  if ("startViewTransition" in document) html.classList.add("vt-hero");
  window.setTimeout(() => {
    html.classList.remove("vt-hero");
    if (namedTile === el) {
      el.style.viewTransitionName = "";
      namedTile = null;
    }
  }, 1200);
}
