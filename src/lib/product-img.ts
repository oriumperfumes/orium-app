/**
 * Variantes de foto de produto — uma única regra para toda a loja.
 *
 * Fotos hospedadas pela Orium (`/api/public/produto-foto?path=<id>.webp`) têm
 * três versões geradas no upload/otimização:
 *   - thumb (~320px)  → busca, carrinho, miniaturas
 *   - card  (~640px)  → cards do catálogo, Mais vendidos, favoritos
 *   - full  (~1400px) → só na página do perfume
 * URLs externas (fornecedor ainda não otimizado) voltam como estão.
 */
export type ImgVariant = "thumb" | "card" | "full";

const ORIUM = /^\/api\/public\/produto-foto\?path=([a-zA-Z0-9_-]+)\.webp$/;

export function isOriumPhoto(url: string | null | undefined): boolean {
  return !!url && ORIUM.test(url);
}

export function imgVariant(url: string | null | undefined, variant: ImgVariant): string | null {
  if (!url) return null;
  const m = ORIUM.exec(url);
  if (!m) return url;
  if (variant === "full") return url;
  return `/api/public/produto-foto?path=${m[1]}-${variant}.webp`;
}

/** srcset com largura real de cada versão; externas não têm srcset. */
export function imgSrcSet(url: string | null | undefined): string | undefined {
  const m = url ? ORIUM.exec(url) : null;
  if (!m) return undefined;
  const base = `/api/public/produto-foto?path=${m[1]}`;
  return `${base}-thumb.webp 320w, ${base}-card.webp 640w, ${base}.webp 1400w`;
}
