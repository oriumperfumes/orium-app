/**
 * REGRAS DE PROMOÇÃO E CUPOM — módulo puro, usado no cliente (exibição) e no servidor (verdade).
 * O cliente só usa isto para MOSTRAR preço promocional. Valor real de qualquer desconto
 * é sempre recalculado no servidor (ver promotions.server.ts).
 */

export type AppliesTo = "BOTH" | "DECANT" | "FULL";

export type Promotion = {
  id: string;
  name: string;
  discount_percent: number;
  applies_to: AppliesTo;
  product_ids: string[];
  decant_sizes: number[];
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  stackable: boolean;
  announce: boolean;
  headline: string | null;
  cta_label: string | null;
  /** Desconto exclusivo de quem compra pelo app da Orium (ligado por padrão). */
  app_exclusive?: boolean | null;
  /** Frase do selo escrita no Admin; vazio usa "Exclusivo no app". */
  app_badge_label?: string | null;
};

/* ---------- comunicação "Exclusivo no app" (regra única do projeto) ---------- */

export const APP_BADGE_FALLBACK = "Exclusivo no app";
export const APP_BADGE_COMPACT = "Só no app";

/** A promoção deve comunicar exclusividade do app? */
export function isAppExclusive(promotion: Promotion | null | undefined): boolean {
  return !!promotion && promotion.app_exclusive !== false;
}

/**
 * Texto do selo. `compact` é para cards pequenos: usa "Só no app" quando o
 * Admin não escreveu uma frase própria. Retorna null quando não deve aparecer.
 */
export function appBadgeLabel(promotion: Promotion | null | undefined, compact = false): string | null {
  if (!isAppExclusive(promotion)) return null;
  const custom = (promotion?.app_badge_label ?? "").trim();
  if (custom) return custom;
  return compact ? APP_BADGE_COMPACT : APP_BADGE_FALLBACK;
}

/** Frase de apoio — sem urgência falsa, o gatilho é a exclusividade. */
export function appExclusiveNote(
  promotion: Promotion | null | undefined,
  variant: "short" | "long" = "short",
): string | null {
  if (!isAppExclusive(promotion)) return null;
  return variant === "long"
    ? "Aproveite este preço especial comprando diretamente pela Orium."
    : "Preço especial disponível somente aqui.";
}

/** Rótulo do botão quando o item está em promoção. */
export function promotionCta(promotion: Promotion | null | undefined, fallback: string): string {
  return promotion ? "Aproveitar oferta" : fallback;
}

export type PublicCoupon = {
  id: string;
  code: string;
  discount_percent: number;
  applies_to: AppliesTo;
  product_ids: string[];
  decant_sizes: number[];
  announce: boolean;
  stackable: boolean;
};

export type PriceTarget = {
  productId: string;
  variant: "FULL" | "DECANT";
  decantMl?: number | null;
};

export const money = (v: number) => Number(Number(v).toFixed(2));

/** base menos o percentual, arredondado em centavos. */
export const applyPercent = (base: number, percent: number) =>
  money(Math.max(0, base * (1 - Number(percent) / 100)));

export function isRunning(
  row: { active: boolean; starts_at: string | null; ends_at: string | null },
  now: number = Date.now(),
) {
  if (!row.active) return false;
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return false;
  if (row.ends_at && new Date(row.ends_at).getTime() <= now) return false;
  return true;
}

type Rule = Pick<Promotion, "applies_to" | "product_ids" | "decant_sizes">;

/** A regra vale para este item do carrinho? Listas vazias = "todos". */
export function matches(rule: Rule, target: PriceTarget) {
  const isDecant = target.variant === "DECANT";
  if (rule.applies_to === "DECANT" && !isDecant) return false;
  if (rule.applies_to === "FULL" && isDecant) return false;
  const products = rule.product_ids ?? [];
  if (products.length > 0 && !products.includes(target.productId)) return false;
  const sizes = rule.decant_sizes ?? [];
  if (isDecant && sizes.length > 0 && !sizes.includes(Number(target.decantMl))) return false;
  return true;
}

/** Sem acumular: vale a melhor promoção válida para o item. */
export function bestPromotion(list: Promotion[], target: PriceTarget, now?: number): Promotion | null {
  let best: Promotion | null = null;
  for (const p of list) {
    if (!isRunning(p, now) || !matches(p, target)) continue;
    if (!best || Number(p.discount_percent) > Number(best.discount_percent)) best = p;
  }
  return best;
}

export type PricedUnit = {
  basePrice: number;
  finalPrice: number;
  promotion: Promotion | null;
  percent: number;
  saved: number;
};

/** Preço de uma unidade: base → promoção → preço final. Cupom nunca entra aqui. */
export function priceUnit(basePrice: number, list: Promotion[], target: PriceTarget, now?: number): PricedUnit {
  const base = money(basePrice || 0);
  const promotion = bestPromotion(list, target, now);
  const percent = promotion ? Number(promotion.discount_percent) : 0;
  const finalPrice = promotion ? applyPercent(base, percent) : base;
  return { basePrice: base, finalPrice, promotion, percent, saved: money(base - finalPrice) };
}

/** Existe alguma promoção ativa que toque este perfume (frasco ou qualquer decant)? */
export function promotionForProduct(list: Promotion[], productId: string, now?: number) {
  const full = bestPromotion(list, { productId, variant: "FULL" }, now);
  const decants = [2, 5, 10]
    .map((ml) => bestPromotion(list, { productId, variant: "DECANT", decantMl: ml }, now))
    .filter(Boolean) as Promotion[];
  const all = [full, ...decants].filter(Boolean) as Promotion[];
  if (all.length === 0) return null;
  return all.reduce((a, b) => (Number(b.discount_percent) > Number(a.discount_percent) ? b : a));
}

/* ---------- identificador local do visitante (só para não repetir campanha) ---------- */

const DEVICE_KEY = "orium-device";
const DEVICE_COOKIE = "orium_anon_campaign";
let volatileDeviceId: string | null = null;

function readCookie(name: string) {
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? null;
}

export function deviceId(): string | null {
  if (typeof window === "undefined") return null;
  const createId = () => crypto.randomUUID();
  try {
    let id = window.localStorage.getItem(DEVICE_KEY) ?? readCookie(DEVICE_COOKIE);
    if (!id) {
      id = createId();
    }
    window.localStorage.setItem(DEVICE_KEY, id);
    document.cookie = `${DEVICE_COOKIE}=${encodeURIComponent(id)}; Max-Age=31536000; Path=/; SameSite=Lax`;
    return id;
  } catch {
    try {
      const cookieId = readCookie(DEVICE_COOKIE);
      if (cookieId) return decodeURIComponent(cookieId);
      volatileDeviceId ??= createId();
      document.cookie = `${DEVICE_COOKIE}=${encodeURIComponent(volatileDeviceId)}; Max-Age=31536000; Path=/; SameSite=Lax`;
      return volatileDeviceId;
    } catch {
      volatileDeviceId ??= createId();
      return volatileDeviceId;
    }
  }
}

/** `datetime-local` do Admin representa sempre o relógio de São Paulo. */
export function saoPauloDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const parsed = new Date(`${normalized}-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
