/**
 * PREÇO COMERCIAL (arredondamento psicológico) — regra única da Orium.
 *
 * Entra DEPOIS do preço-base (custo do fornecedor vencedor + margem) e nunca
 * é aplicada duas vezes. Espelha a função `public.commercial_price` do banco,
 * para que Admin, catálogo, carrinho e pedido cheguem sempre ao mesmo valor.
 *
 * Não é promoção: é o preço normal de venda, apenas com final mais comercial.
 */
export type PsychSettings = {
  active: boolean;
  /** hoje só existe "ends_90" (final ,90) */
  strategy: string;
  /** quanto pode ser reduzido do preço-base, em reais */
  maxReduction: number;
};

const money = (v: number) => Number(v.toFixed(2));

/** Menor preço com final ",90" que caiba no ajuste máximo permitido. */
export function commercialPrice(base: number | null | undefined, psych: PsychSettings): number | null {
  if (base == null || !Number.isFinite(base)) return null;
  const rounded = money(base);
  if (!psych.active || !(psych.maxReduction > 0)) return rounded;
  const candidate = money(Math.ceil(money(rounded - psych.maxReduction - 0.9) - 1e-9) + 0.9);
  if (candidate <= 0 || candidate > rounded || money(rounded - candidate) > money(psych.maxReduction)) return rounded;
  return candidate;
}
