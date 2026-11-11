/**
 * Serviços de produto usados pelo PAINEL e pelo COPILOT.
 * Uma única implementação: estoque local, disponibilidade e preço.
 * A regra de disponibilidade efetiva mora no banco (compute_availability_source).
 */
import type { CopilotCtx } from "@/lib/copilot/registry.server";

export type StockMode = "set" | "add" | "remove";
export type AvailabilityMode = "AUTO" | "FORCE_AVAILABLE" | "FORCE_UNAVAILABLE";
export type PriceKind = "retail" | "pix" | "wholesale" | "decant_2" | "decant_5" | "decant_10" | "auto" | "auto_wholesale";

export const MODE_TO_OVERRIDE: Record<AvailabilityMode, "none" | "available" | "blocked"> = {
  AUTO: "none",
  FORCE_AVAILABLE: "available",
  FORCE_UNAVAILABLE: "blocked",
};
export const OVERRIDE_TO_MODE: Record<string, AvailabilityMode> = { none: "AUTO", available: "FORCE_AVAILABLE", blocked: "FORCE_UNAVAILABLE" };

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export async function setLocalStock(
  ctx: CopilotCtx,
  a: { productId: string; mode: StockMode; quantity: number; reason?: string | null; source: "painel" | "copilot"; actionId?: string | null },
) {
  const { data, error } = await ctx.userDb.rpc("inventory_adjust", {
    p_product_id: a.productId,
    p_mode: a.mode,
    p_qty: a.quantity,
    p_reason: a.reason || (a.source === "copilot" ? "Ajuste via Copilot" : "Ajuste manual"),
    p_source: a.source,
    p_action_id: a.actionId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { product_id: string; name: string; before: number; after: number; available_after: boolean; source_after: string };
}

export async function setAvailabilityMode(
  ctx: CopilotCtx,
  a: { productId: string; mode: AvailabilityMode; reason?: string | null; source: "painel" | "copilot"; actionId?: string | null },
) {
  const { data, error } = await ctx.userDb.rpc("set_availability_override", {
    p_product_id: a.productId,
    p_override: MODE_TO_OVERRIDE[a.mode],
    p_reason: a.reason || (a.source === "copilot" ? "Copilot" : "Painel manual"),
    p_action_id: a.actionId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { before: string; after: string; available_after: boolean; source_after: string };
}

export async function priceState(ctx: CopilotCtx, productId: string) {
  const [{ data: p }, { data: o }] = await Promise.all([
    ctx.adminDb
      .from("products")
      .select("manual_pricing, retail_price, wholesale_price, decant_price_2ml, decant_price_5ml, decant_price_10ml")
      .eq("id", productId)
      .single(),
    ctx.adminDb.from("pricing_overrides").select("fixed_retail_price, fixed_wholesale_price").eq("product_id", productId).maybeSingle(),
  ]);
  return { p, o };
}

/** Preço que o produto teria sem nenhum preço fixado (mesma fórmula central). */
export async function automaticPrice(ctx: CopilotCtx, productId: string) {
  const { calculateProductPricing } = await import("@/lib/pricing.server");
  const { data: o } = await ctx.adminDb.from("pricing_overrides").select("*").eq("product_id", productId).maybeSingle();
  const cur = await calculateProductPricing(ctx.adminDb, productId);
  if (!cur) return null;
  if (!o || (o.fixed_retail_price == null && o.fixed_wholesale_price == null)) {
    return { retail: cur.retailPrice, wholesale: cur.wholesalePrice, cost: cur.baseCost };
  }
  // simula sem os preços fixos: mesma função, override neutralizado
  const { commercialPrice } = await import("@/lib/pricing.server");
  const retail = cur.baseCost != null ? commercialPrice(Number((cur.baseCost + cur.retailMarkup).toFixed(2)), cur.psych) : null;
  const wholesale = cur.baseCost != null ? commercialPrice(Number((cur.baseCost + cur.wholesaleMarkup).toFixed(2)), cur.psych) : null;
  return { retail, wholesale, cost: cur.baseCost };
}

/** Único caminho para mudar preço (painel e Copilot). Pix = preço cadastrado. */
export async function updateProductPrice(
  ctx: CopilotCtx,
  a: { productId: string; kind: PriceKind; value: number | null; source: "painel" | "copilot"; actionId?: string | null },
) {
  if (!ctx.roles.length) throw new Error("Somente Admin ou Owner pode alterar preços.");
  const db = ctx.adminDb;
  const kind = a.kind === "pix" ? "retail" : a.kind;
  const value = a.kind === "auto" || a.kind === "auto_wholesale" ? null : a.value;
  if (value != null && !(value > 0)) throw new Error("Preço inválido.");
  const before = await priceState(ctx, a.productId);
  const { persistProductPricing } = await import("@/lib/pricing.server");
  const manual = before.p.manual_pricing === true;

  if (kind.startsWith("decant")) {
    const ml = kind.split("_")[1];
    const { error } = await db.from("products").update({ [`decant_price_${ml}ml`]: value }).eq("id", a.productId);
    if (error) throw new Error(error.message);
  } else if (kind === "wholesale" || kind === "auto_wholesale") {
    if (manual) {
      if (value == null) throw new Error("Produto cadastrado à mão não tem preço automático.");
      const { error } = await db.from("products").update({ wholesale_price: value, base_wholesale_price: value }).eq("id", a.productId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("pricing_overrides").upsert({ product_id: a.productId, fixed_wholesale_price: value }, { onConflict: "product_id" });
      if (error) throw new Error(error.message);
      await persistProductPricing(db, a.productId);
    }
  } else {
    if (manual) {
      if (value == null) throw new Error("Produto cadastrado à mão não tem preço automático.");
      const { error } = await db.from("products").update({ retail_price: value, base_retail_price: value }).eq("id", a.productId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("pricing_overrides").upsert({ product_id: a.productId, fixed_retail_price: value }, { onConflict: "product_id" });
      if (error) throw new Error(error.message);
      await persistProductPricing(db, a.productId);
    }
  }
  const after = await priceState(ctx, a.productId);
  await db.from("activity_logs").insert({
    user_id: ctx.userId,
    action: "preço",
    entity: "products",
    entity_id: a.productId,
    details: {
      kind: a.kind,
      source: a.source,
      action_id: a.actionId ?? null,
      from: { retail: num(before.p.retail_price), wholesale: num(before.p.wholesale_price), d2: num(before.p.decant_price_2ml), d5: num(before.p.decant_price_5ml), d10: num(before.p.decant_price_10ml) },
      to: { retail: num(after.p.retail_price), wholesale: num(after.p.wholesale_price), d2: num(after.p.decant_price_2ml), d5: num(after.p.decant_price_5ml), d10: num(after.p.decant_price_10ml) },
    },
  });
  return { before, after };
}

export type HistoryItem = { at: string; kind: "estoque" | "disponibilidade" | "preço"; from: string; to: string; who: string | null; note: string | null };

const MODE_LABEL: Record<string, string> = { none: "Automática", available: "Pronta entrega", blocked: "Indisponível" };
const money = (v: unknown) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export async function productHistory(ctx: CopilotCtx, productId: string): Promise<HistoryItem[]> {
  const db = ctx.adminDb;
  const [{ data: moves }, { data: logs }] = await Promise.all([
    db.from("inventory_movements").select("before_qty, after_qty, reason, source, actor, created_at").eq("product_id", productId).order("created_at", { ascending: false }).limit(30),
    db
      .from("activity_logs")
      .select("user_id, action, details, created_at")
      .eq("entity_id", productId)
      .in("action", ["disponibilidade manual", "preço", "copilot: preço"])
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const ids = [...new Set([...(moves ?? []).map((m: any) => m.actor), ...(logs ?? []).map((l: any) => l.user_id)].filter(Boolean))];
  const { data: people } = ids.length ? await db.from("profiles").select("id, name, email").in("id", ids) : { data: [] };
  const who = (id: string | null) => {
    const p = (people ?? []).find((x: any) => x.id === id);
    return p ? p.name || p.email : null;
  };
  const items: HistoryItem[] = [
    ...(moves ?? []).map((m: any) => ({
      at: m.created_at,
      kind: "estoque" as const,
      from: String(m.before_qty),
      to: String(m.after_qty),
      who: who(m.actor),
      note: [m.reason, m.source === "copilot" ? "Copilot" : m.source === "venda_loja" ? "Venda da loja" : m.source === "painel" ? "Painel" : m.source].filter(Boolean).join(" · "),
    })),
    ...(logs ?? []).map((l: any) =>
      l.action === "disponibilidade manual"
        ? { at: l.created_at, kind: "disponibilidade" as const, from: MODE_LABEL[l.details?.from] ?? "—", to: MODE_LABEL[l.details?.to] ?? "—", who: who(l.user_id), note: l.details?.reason ?? null }
        : {
            at: l.created_at,
            kind: "preço" as const,
            from: money(l.details?.from?.retail_price ?? l.details?.from?.retail),
            to: money(l.details?.to?.retail_price ?? l.details?.to?.retail),
            who: who(l.user_id),
            note: l.details?.source === "copilot" || l.action === "copilot: preço" ? "Copilot" : "Painel",
          },
    ),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
}
