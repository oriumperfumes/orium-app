/**
 * Decants da Orium — fonte única das regras de tamanho, preço e eventos.
 * Preços oficiais: 2ml R$ 19,90 · 5ml R$ 39,90 · 10ml R$ 69,90 (configuráveis no Admin).
 */
import { supabase } from "@/integrations/supabase/client";
import { saleModeOf } from "@/lib/sale-mode";

export type DecantMl = 2 | 5 | 10;
export const DECANT_SIZES: DecantMl[] = [2, 5, 10];

export const DECANT_DEFAULT_PRICES: Record<DecantMl, number> = { 2: 19.9, 5: 39.9, 10: 69.9 };

export const DECANT_HINT: Record<DecantMl, string> = {
  2: "Para conhecer",
  5: "Para usar por mais tempo",
  10: "Para quem já gostou",
};

export type DecantSettings = { price_2ml: number; price_5ml: number; price_10ml: number } | null | undefined;

export type DecantPriced = {
  decant_available?: boolean | null;
  decant_price_2ml?: number | string | null;
  decant_price_5ml?: number | string | null;
  decant_price_10ml?: number | string | null;
};

/** Preço de um tamanho: override do produto → configuração global → padrão oficial. */
export function decantPrice(product: DecantPriced | null | undefined, settings: DecantSettings, ml: DecantMl): number {
  const override = product?.[`decant_price_${ml}ml` as const];
  if (override != null && Number(override) > 0) return Number(override);
  const global = settings?.[`price_${ml}ml` as const];
  if (global != null && Number(global) > 0) return Number(global);
  return DECANT_DEFAULT_PRICES[ml];
}

export const decantLabel = (ml: number) => `Decant ${ml}ml`;

/** Custo do frasquinho vazio: 2ml e 5ml usam o mesmo (R$ 1,50); 10ml custa R$ 2,50. */
export const DECANT_VIAL_COST: Record<DecantMl, number> = { 2: 1.5, 5: 1.5, 10: 2.5 };
export const decantVialCost = (ml: number) => (ml >= 10 ? 2.5 : 1.5);

/** Custo real de um decant: líquido proporcional do frasco + frasquinho. */
export function decantUnitCost(bottleCost: number | null | undefined, volumeMl: number | null | undefined, ml: number) {
  if (bottleCost == null || !volumeMl) return null;
  return Number(((Number(bottleCost) * ml) / Number(volumeMl) + decantVialCost(ml)).toFixed(2));
}

/** Chave de SKU do carrinho: o mesmo perfume em 2ml, 5ml, 10ml e frasco são itens distintos. */
export const variantKey = (productId: string, variant: "FULL" | "DECANT", decantMl?: number | null) =>
  variant === "DECANT" ? `${productId}:D${decantMl}` : `${productId}:FULL`;

/* ---------- eventos internos (nunca exibidos ao cliente) ---------- */

export type DecantEvent =
  | "decant_view"
  | "decant_size_selected"
  | "decant_added"
  | "kit_started"
  | "kit_product_added"
  | "kit_added_to_cart"
  | "decant_checkout";

const SESSION_KEY = "orium-session";
const sessionId = () => {
  if (typeof window === "undefined") return null;
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
};

let queue: Array<Record<string, unknown>> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Registro em lote e silencioso: nunca bloqueia a interface nem gera erro visível. */
export function trackDecant(
  event: DecantEvent,
  opts: { productId?: string | null; variant?: string | null; details?: Record<string, unknown> } = {},
) {
  if (typeof window === "undefined") return;
  queue.push({
    session_id: sessionId(),
    event,
    product_id: opts.productId ?? null,
    variant: opts.variant ?? null,
    details: opts.details ?? null,
  });
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    const batch = queue;
    queue = [];
    flushTimer = null;
    void supabase
      .from("decant_events")
      .insert(batch as never)
      .then(() => undefined, () => undefined);
  }, 1200);
}

type SellableProduct =
  | {
      id?: string | null;
      product_type?: string | null;
      decant_available?: boolean | null;
      in_stock?: boolean | null;
      stock_quantity?: number | null;
      sale_mode?: string | null;
      full_bottle_available?: boolean | null;
    }
  | null
  | undefined;

/**
 * REGRA ABSOLUTA: decant existe somente em perfume.
 * Body splash, hidratante, pasta, creme e cosmético nunca têm decant.
 * REGRA DE ESTOQUE: sem estoque não existe decant — o decant sai do mesmo
 * frasco, então produto indisponível não vende frasco nem decant.
 * REGRA DE VENDA: produto marcado como "somente Frasco" nunca oferece decant.
 */
/**
 * Disponibilidade vem SÓ de `in_stock`, calculado no banco pela regra única
 * (bloqueio manual → estoque local da Orium → liberado manual → fornecedor).
 * `stock_quantity` é estoque de fornecedor e nunca bloqueia a venda.
 */
export function canDecant(product: SellableProduct): boolean {
  if (!product) return false;
  if (product.in_stock === false) return false;
  if (product.product_type !== "PERFUME") return false;
  return saleModeOf(product).decant_available;
}

/**
 * Frasco completo à venda? Produto marcado como "somente Decant" não vende
 * frasco, mesmo tendo preço cadastrado.
 */
export function canFullBottle(product: SellableProduct): boolean {
  if (!product) return false;
  if (product.in_stock === false) return false;
  return saleModeOf(product).full_bottle_available;
}
