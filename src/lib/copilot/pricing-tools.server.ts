/**
 * Ferramentas de preço do Copilot. Nenhum valor vem do modelo nem de cópia no
 * prompt: tudo sai do mesmo cálculo do catálogo/carrinho/checkout (priceCart =
 * preço-base → promoção) e das colunas oficiais de products / pricing_settings.
 * Cada chamada lê o banco na hora, então uma alteração no Admin vale na próxima pergunta.
 */
import type { CopilotCtx } from "./registry.server";

const money = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Erro classificado: o modelo sabe diferenciar "sem preço" de "ferramenta quebrou". */
export class ToolFailure extends Error {
  constructor(public code: "not_found" | "ambiguous" | "no_price" | "variant_unavailable" | "permission" | "backend_error" | "invalid_input", message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function guarded<T>(tool: string, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ToolFailure) return { error_code: e.code, message: e.message, ...e.extra };
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`copilot tool ${tool} falhou:`, msg.slice(0, 300));
    if (/permiss|permission|not authorized|42501/i.test(msg)) return { error_code: "permission", message: "Sem permissão para essa consulta." };
    if (/fetch failed|network|ECONN|timeout/i.test(msg)) return { error_code: "connection", message: "Falha de conexão com o banco. Tente de novo." };
    return { error_code: "backend_error", message: "A consulta falhou no sistema (não é falta de preço). Tente de novo." };
  }
}

type Settings = { pixPct: number; wholesaleMin: number };
async function settings(db: any): Promise<Settings> {
  const { data } = await db.from("pricing_settings").select("pix_discount_active, pix_discount_percent, wholesale_min_quantity").eq("id", true).maybeSingle();
  return {
    pixPct: data?.pix_discount_active ? Number(data.pix_discount_percent ?? 0) : 0,
    wholesaleMin: Number(data?.wholesale_min_quantity ?? 6),
  };
}
const cardOf = (pix: number | null, pct: number) => (pix != null && pct > 0 ? money(pix / (1 - pct / 100)) : pix);

async function productRow(db: any, id: string) {
  const { data, error } = await db
    .from("products")
    .select("id, canonical_name, brand, image_url, volume_ml, product_type, sale_mode, retail_price, wholesale_price, manual_pricing, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, local_stock, in_stock, catalog_eligible, active, availability_override, availability_source, supplier_available")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ToolFailure("not_found", "Produto não encontrado.");
  return data;
}

function canDecant(p: any) {
  const mode = String(p.sale_mode ?? "BOTH").toUpperCase();
  return p.product_type === "PERFUME" && !!p.decant_available && mode !== "FULL_ONLY";
}
function canFull(p: any) {
  return String(p.sale_mode ?? "BOTH").toUpperCase() !== "DECANT_ONLY";
}

/** Todos os preços aplicáveis de um produto, com promoções ativas já aplicadas. */
export async function getProductPrices(ctx: CopilotCtx, productId: string) {
  const db = ctx.adminDb;
  const [p, s, { data: override }] = await Promise.all([
    productRow(db, productId),
    settings(db),
    db.from("pricing_overrides").select("fixed_retail_price, fixed_wholesale_price").eq("product_id", productId).maybeSingle(),
  ]);
  const { priceCart } = await import("@/lib/promotions.server");
  const lines: any[] = [];
  if (canFull(p) && num(p.retail_price)) lines.push({ productId, variant: "FULL", decantMl: null, quantity: 1 });
  if (canDecant(p)) for (const ml of [2, 5, 10]) lines.push({ productId, variant: "DECANT", decantMl: ml, quantity: 1 });
  const priced = lines.length ? await priceCart(db, lines, { couponCode: null, userId: null, deviceId: null }) : { lines: [] as any[] };
  const variant = (l: any) => {
    const pix = money(l.unitPrice);
    return {
      pix,
      card: cardOf(pix, s.pixPct),
      base_price: money(l.unitBasePrice),
      promotion: l.promotionId ? { name: l.promotionName, percent: l.promotionPercent } : null,
    };
  };
  const { decantBasePrice } = await import("@/lib/promotions.server");
  const { data: dset } = await db.from("decant_settings").select("*").maybeSingle();
  // fora do catálogo público (ex.: só estoque local) o carrinho não cota: usa o preço-base oficial
  const fallback = (variant: "FULL" | "DECANT", ml: number | null) => {
    const base = variant === "FULL" ? num(p.retail_price) : decantBasePrice(p, dset, ml!);
    return base ? { unitPrice: base, unitBasePrice: base, promotionId: null } : undefined;
  };
  const full = canFull(p) && num(p.retail_price) ? (priced.lines.find((l: any) => l.variant === "FULL") ?? fallback("FULL", null)) : undefined;
  const dec = (ml: number) => (canDecant(p) ? (priced.lines.find((l: any) => l.variant === "DECANT" && l.decantMl === ml) ?? fallback("DECANT", ml)) : undefined);
  const out = {
    product: { id: p.id, name: p.canonical_name, brand: p.brand, volume_ml: p.volume_ml, image_url: p.image_url },
    note: "Preço cadastrado = preço no Pix. Cartão = Pix sem o desconto Pix. Valores já incluem promoções ativas.",
    pix_discount_percent: s.pixPct,
    pricing_mode: p.manual_pricing ? "manual" : override?.fixed_retail_price != null ? "fixado" : "automatico",
    frasco: full ? variant(full) : null,
    atacado: num(p.wholesale_price) != null ? { pix: num(p.wholesale_price), card: cardOf(num(p.wholesale_price), s.pixPct), min_quantity: s.wholesaleMin } : null,
    decant_2ml: dec(2) ? { ...variant(dec(2)), custom: num(p.decant_price_2ml) != null } : null,
    decant_5ml: dec(5) ? { ...variant(dec(5)), custom: num(p.decant_price_5ml) != null } : null,
    decant_10ml: dec(10) ? { ...variant(dec(10)), custom: num(p.decant_price_10ml) != null } : null,
    sells_full: canFull(p),
    sells_decant: canDecant(p),
  };
  if (!out.frasco && !out.decant_5ml && !out.atacado)
    return { ...out, error_code: "no_price", message: `${p.canonical_name} existe no catálogo mas está sem preço configurado.` };
  return out;
}

export async function getProductAvailability(ctx: CopilotCtx, productId: string) {
  const p = await productRow(ctx.adminDb, productId);
  const stock = Number(p.local_stock ?? 0);
  return {
    product: p.canonical_name,
    orium_stock_bottles: stock,
    orium_status: stock >= 2 ? "em estoque" : stock === 1 ? "última unidade" : "sem estoque local",
    pronta_entrega: stock > 0 || p.availability_override === "available",
    public_catalog: p.in_stock && p.catalog_eligible && p.active ? "Disponível" : "Indisponível",
    override: p.availability_override,
    supplier_available: p.supplier_available,
    decant_available: canDecant(p),
    note: "Estoque Orium = frascos lacrados da loja; fornecedor é outra coisa.",
  };
}

export async function getProductCosts(ctx: CopilotCtx, productId: string) {
  if (!ctx.roles.some((r) => r === "owner" || r === "admin")) throw new ToolFailure("permission", "Custos e margens são só para administradores.");
  const db = ctx.adminDb;
  const [p, { data: cost }, { data: p2 }, { data: dec }] = await Promise.all([
    productRow(db, productId),
    db.from("product_costs").select("best_cost").eq("product_id", productId).maybeSingle(),
    db.from("products").select("manual_cost").eq("id", productId).maybeSingle(),
    db.from("decant_settings").select("*").maybeSingle(),
  ]);
  const c = num(p2?.manual_cost) ?? num(cost?.best_cost);
  const prices = await getProductPrices(ctx, productId);
  const { decantUnitCost } = await import("@/lib/decants");
  const econ = (price: number | null | undefined, unitCost: number | null) =>
    price == null || unitCost == null ? null : { price, cost: money(unitCost), profit: money(price - unitCost), margin_percent: price > 0 ? money(((price - unitCost) / price) * 100) : null };
  void dec;
  const decCost = (ml: number) => decantUnitCost(c, p.volume_ml, ml);
  return {
    product: p.canonical_name,
    bottle_cost: c,
    cost_source: num(p2?.manual_cost) != null ? "manual" : "fornecedor vencedor",
    frasco: econ((prices as any).frasco?.pix, c),
    atacado: econ((prices as any).atacado?.pix, c),
    decant_5ml: econ((prices as any).decant_5ml?.pix, decCost(5)),
    decant_10ml: econ((prices as any).decant_10ml?.pix, decCost(10)),
    note: "Lucro/margem calculados no backend. Custo do decant estimado proporcional ao frasco.",
  };
}

export type QuoteItem = { product_id: string; variant: "FULL" | "DECANT"; decant_ml: number | null; quantity: number; unit_price?: number | null };

/** Cotação oficial: preço do sistema (com promoção), atacado por quantidade, Pix/cartão e sinal. */
export async function quoteSale(
  ctx: CopilotCtx,
  items: QuoteItem[],
  opts: { payment_method?: "PIX" | "CARTAO" | "DINHEIRO" | null; deposit_percent?: number | null; tier?: "auto" | "varejo" | "atacado" | null; coupon_code?: string | null },
) {
  if (!items.length) throw new ToolFailure("invalid_input", "Nenhum item para cotar.");
  const db = ctx.adminDb;
  const s = await settings(db);
  const { priceCart } = await import("@/lib/promotions.server");
  const priced = await priceCart(
    db,
    items.map((i) => ({ productId: i.product_id, variant: i.variant, decantMl: i.variant === "DECANT" ? i.decant_ml : null, quantity: Math.max(1, Math.round(i.quantity)) })),
    { couponCode: opts.coupon_code ?? null, userId: null, deviceId: null },
  );
  const fullQty = items.filter((i) => i.variant === "FULL").reduce((a, i) => a + Math.max(1, Math.round(i.quantity)), 0);
  const tier = opts.tier === "atacado" || (opts.tier !== "varejo" && fullQty >= s.wholesaleMin) ? "atacado" : "varejo";
  const { data: prods } = await db.from("products").select("id, canonical_name, brand, image_url, volume_ml, retail_price, wholesale_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml").in("id", [...new Set(items.map((i) => i.product_id))]);
  const byId = new Map((prods ?? []).map((p: any) => [p.id, p]));
  const { decantBasePrice } = await import("@/lib/promotions.server");
  const { data: dset } = await db.from("decant_settings").select("*").maybeSingle();
  const lines = items.map((it) => {
    const l: any = priced.lines.find((x: any) => x.productId === it.product_id && x.variant === it.variant && (it.variant === "FULL" || x.decantMl === it.decant_ml));
    const p: any = byId.get(it.product_id);
    if (!p) throw new ToolFailure("not_found", "Produto não encontrado.");
    let unit = l
      ? Number(l.unitFinalPrice)
      : it.variant === "FULL"
        ? Number(p.retail_price ?? 0)
        : p.decant_available && [2, 5, 10].includes(Number(it.decant_ml))
          ? decantBasePrice(p, dset, Number(it.decant_ml))
          : 0;
    let source = l?.promotionId ? `promoção ${l.promotionName}` : "preço do sistema";
    if (it.variant === "FULL" && tier === "atacado" && num(p.wholesale_price) && !l?.promotionId) {
      unit = Number(p.wholesale_price);
      source = "atacado";
    }
    if (it.unit_price != null && it.unit_price > 0) {
      unit = it.unit_price;
      source = "preço informado pelo Admin";
    }
    if (!(unit > 0))
      throw new ToolFailure(it.variant === "DECANT" ? "variant_unavailable" : "no_price", `${p.canonical_name}: ${it.variant === "DECANT" ? `decant ${it.decant_ml}ml indisponível` : "sem preço de frasco configurado"}.`);
    const qty = Math.max(1, Math.round(it.quantity));
    return {
      product: { id: p.id, name: p.canonical_name, brand: p.brand, image_url: p.image_url, volume_ml: p.volume_ml },
      variant: it.variant,
      decant_ml: it.variant === "DECANT" ? it.decant_ml : null,
      quantity: qty,
      unit_price: money(unit),
      price_source: source,
      subtotal: money(unit * qty),
    };
  });
  const pixTotal = money(lines.reduce((a, l) => a + l.subtotal, 0));
  const total = opts.payment_method === "CARTAO" ? (cardOf(pixTotal, s.pixPct) as number) : pixTotal;
  const dp = opts.deposit_percent != null ? Math.min(100, Math.max(0, opts.deposit_percent)) : null;
  const deposit = dp != null ? money(total * (dp / 100)) : null;
  return {
    tier,
    lines,
    total_pix: pixTotal,
    total_card: cardOf(pixTotal, s.pixPct),
    total,
    payment_method: opts.payment_method ?? null,
    deposit: dp != null ? { percent: dp, amount_paid: deposit, amount_due: money(total - (deposit ?? 0)) } : null,
    coupon: priced.coupon,
    note: "Valores calculados no backend. Valor vendido ≠ valor recebido: só o sinal conta como recebido.",
  };
}
