/**
 * COMUNICAÇÃO DA CAMPANHA — texto que o cliente vê em promoções e cupons.
 * O Admin escreve título, mensagem, botão e texto auxiliar; aqui só trocamos
 * as variáveis e aplicamos um fallback elegante. Nada de desconto muda aqui.
 */

export type CampaignTheme = "DEFAULT" | "PROMO" | "DECANT" | "FULL";

export const CAMPAIGN_LIMITS = { title: 60, message: 200, cta: 30, footnote: 80 } as const;

export const THEME_LABEL: Record<CampaignTheme, string> = {
  DEFAULT: "Padrão",
  PROMO: "Promoção",
  DECANT: "Decants",
  FULL: "Frascos",
};

/** Molduras discretas, sempre dentro da identidade Orium. */
export const THEME_STYLE: Record<CampaignTheme, { card: string; badge: string }> = {
  DEFAULT: { card: "border-border bg-card", badge: "bg-muted text-foreground" },
  PROMO: { card: "border-gold/40 bg-gold/[0.07]", badge: "bg-gold/15 text-gold" },
  DECANT: { card: "border-primary/35 bg-primary/[0.06]", badge: "bg-primary/12 text-primary" },
  FULL: { card: "border-foreground/20 bg-foreground/[0.04]", badge: "bg-foreground/10 text-foreground" },
};

export const PLACEHOLDERS = ["coupon", "discount", "product", "category"] as const;
export type PlaceholderKey = (typeof PLACEHOLDERS)[number];

export type CampaignVars = Partial<Record<PlaceholderKey, string>>;

export type CampaignCopy = {
  title: string | null;
  message: string | null;
  cta: string | null;
  footnote: string | null;
  theme?: string | null;
};

export type RenderedCampaign = {
  title: string;
  message: string;
  cta: string;
  footnote: string | null;
  theme: CampaignTheme;
};

export const FALLBACK_TITLE = "Uma oferta especial para você";
export const FALLBACK_CTA = "Ver oferta";

const clean = (v: string | null | undefined) => (typeof v === "string" ? v.trim() : "");

/** Troca {coupon}, {discount}, {product}, {category}. Variável sem valor simplesmente sai. */
export function fillPlaceholders(text: string, vars: CampaignVars): string {
  const out = text.replace(/\{\s*([a-zA-Z_]+)\s*\}/g, (_m, key: string) => {
    const value = vars[key.toLowerCase() as PlaceholderKey];
    return value ? value : "";
  });
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
}

/** Variáveis usadas no texto que não têm valor nesta campanha. */
export function unknownPlaceholders(text: string, vars: CampaignVars): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\s*([a-zA-Z_]+)\s*\}/g)) {
    const raw = m[1] ?? "";
    const key = raw.toLowerCase();
    if (!(PLACEHOLDERS as readonly string[]).includes(key) || !vars[key as PlaceholderKey]) found.add(raw);
  }

  return [...found];
}

export function normalizeTheme(value: string | null | undefined): CampaignTheme {
  return value === "PROMO" || value === "DECANT" || value === "FULL" ? value : "DEFAULT";
}

/** Texto final que aparece no aplicativo (também usado na prévia do Admin). */
export function renderCampaign(copy: CampaignCopy, vars: CampaignVars, fallbackMessage = ""): RenderedCampaign {
  const title = fillPlaceholders(clean(copy.title), vars) || FALLBACK_TITLE;
  const message = fillPlaceholders(clean(copy.message), vars) || fallbackMessage;
  const cta = fillPlaceholders(clean(copy.cta), vars) || FALLBACK_CTA;
  const footnote = fillPlaceholders(clean(copy.footnote), vars) || null;
  return { title, message, cta, footnote, theme: normalizeTheme(copy.theme) };
}
