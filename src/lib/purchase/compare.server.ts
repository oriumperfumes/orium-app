/**
 * COMPARADOR DE FORNECEDORES — cálculos 100% programáticos.
 *
 * Preço e disponibilidade saem SOMENTE do banco sincronizado (supplier_products).
 * A IA nunca soma, nunca escolhe fornecedor e nunca inventa preço.
 */
import { confidenceOf, resolveProductCandidates, type MatchCandidate } from "@/lib/store-sales-match.server";
import { flat } from "@/lib/store-sales-phonetics";

type Db = any;

export type OfferStatus = "disponivel" | "indisponivel" | "desconhecido" | "desatualizado" | "erro";

export type Offer = {
  offer_id: string;
  supplier_id: string;
  supplier_name: string;
  price: number | null;
  in_stock: boolean;
  status: OfferStatus;
  stock_qty: number | null;
  stock_reliable: boolean;
  url: string | null;
  captured_at: string | null;
  source: "auto" | "manual";
  stale: boolean;
  supplier_sync_error: boolean;
  preferred?: "product" | "supplier" | null;
};

export type BasketItem = {
  key: string;
  query: string;
  quantity: number;
  product_id: string | null;
  forced_supplier_id: string | null;
};

export type ItemResult = {
  key: string;
  query: string;
  quantity: number;
  status: "found" | "ambiguous" | "not_found" | "no_offers" | "unavailable";
  confirm: boolean;
  product: { id: string; name: string; brand: string | null; image_url: string | null; volume_ml: number | null } | null;
  candidates: Array<{ id: string; name: string; brand: string | null; image_url: string | null }>;
  offers: Offer[];
  chosen: Offer | null;
  manual: boolean;
  savings: Array<{ supplier_name: string; diff: number }>;
  cheaper_unavailable: { supplier_name: string; diff: number } | null;
  split: Array<{ supplier_id: string; supplier_name: string; qty: number; price: number }> | null;
};

export type SupplierGroup = {
  supplier_id: string;
  supplier_name: string;
  items: Array<{ key: string; name: string; qty: number; price: number; subtotal: number }>;
  total: number;
};

export type AllocationOption = {
  label: string;
  supplier_ids: string[];
  total: number;
  groups: SupplierGroup[];
  uncovered: string[];
};

export type Comparison = {
  items: ItemResult[];
  cheapest: AllocationOption;
  fewest: AllocationOption | null;
  alternatives: Array<{ without: string; supplier_id: string; total: number | null; delta: number | null; uncovered: number }>;
  health: Array<{ supplier_id: string; name: string; last_sync: string | null; status: string | null; message: string | null; mode: string }>;
  generated_at: string;
};

const round = (n: number) => Math.round(n * 100) / 100;

/** "3 Asad Bourbon", "Asad Bourbon x3", "Liquid Brun - 2" → nome + quantidade. */
export function parseListLine(line: string): { name: string; quantity: number } | null {
  let s = line.replace(/^[\s\-–•*·\d]+[.)]\s+/, "").replace(/^[\s\-–•*·]+/, "").trim();
  if (!s) return null;
  let qty = 1;
  let m = s.match(/^(\d{1,3})\s*(?:x|un|unid(?:ades)?|und)?\s+(.+)$/i);
  if (m) {
    qty = Number(m[1]);
    s = m[2]!;
  } else if ((m = s.match(/^(.+?)\s*(?:x|×|-|–|:)\s*(\d{1,3})\s*(?:un|unid(?:ades)?)?$/i))) {
    s = m[1]!;
    qty = Number(m[2]);
  }
  s = s.replace(/[;,.]+$/, "").trim();
  if (s.length < 2) return null;
  return { name: s, quantity: Math.max(1, Math.min(999, qty || 1)) };
}

/** Junta grafias iguais ("Hawas Black" / "HAWAS BLACK") somando quantidades. */
export function mergeBasket(items: BasketItem[]): BasketItem[] {
  const out = new Map<string, BasketItem>();
  for (const it of items) {
    const k = it.product_id ?? `q:${flat(it.query)}`;
    const prev = out.get(k);
    if (prev) prev.quantity += it.quantity;
    else out.set(k, { ...it });
  }
  return Array.from(out.values());
}

async function loadSuppliers(db: Db) {
  const { data } = await db
    .from("suppliers")
    .select("id, name, active, last_successful_sync_at, sync_status, sync_message, update_mode, priority, use_for_purchasing")
    .eq("active", true)
    // Central de Fornecedores: só quem está habilitado para compras entra na reposição.
    .eq("use_for_purchasing", true)
    .neq("priority", "inactive")
    .order("name");
  return (data ?? []) as Array<{
    id: string;
    name: string;
    last_successful_sync_at: string | null;
    sync_status: string | null;
    sync_message: string | null;
    update_mode: string | null;
    priority: string | null;
  }>;
}

async function staleHours(db: Db) {
  const { data } = await db.from("purchase_settings").select("stale_after_hours").maybeSingle();
  return Number(data?.stale_after_hours ?? 24) || 24;
}

export async function offersFor(db: Db, productIds: string[]): Promise<Map<string, Offer[]>> {
  const out = new Map<string, Offer[]>();
  if (!productIds.length) return out;
  const [suppliers, hours, prefsRes] = await Promise.all([
    loadSuppliers(db),
    staleHours(db),
    db.from("supplier_product_preferences").select("product_id, supplier_id, mode").in("product_id", productIds),
  ]);
  const prefs = new Map<string, string>(((prefsRes as any).data ?? []).map((p: any) => [`${p.product_id}:${p.supplier_id}`, p.mode]));
  const sup = new Map(suppliers.map((s) => [s.id, s]));
  const { data } = await db
    .from("supplier_products")
    .select("id, product_id, supplier_id, price, in_stock, availability_status, stock_quantity, stock_reliable, url, last_synced_at, offer_source, active")
    .in("product_id", productIds);
  const limit = Date.now() - hours * 3600_000;
  for (const r of (data ?? []) as any[]) {
    const s = sup.get(r.supplier_id);
    if (!s) continue;
    const pref = prefs.get(`${r.product_id}:${r.supplier_id}`);
    // Bloqueio manual do fornecedor para este perfume vence qualquer preço.
    if (pref === "blocked") continue;
    const captured = r.last_synced_at as string | null;
    const stale = !captured || Date.parse(captured) < limit;
    const syncError = s.sync_status === "erro" || s.sync_status === "bloqueado";
    const price = r.price == null ? null : Number(r.price);
    const inStock = r.in_stock === true && r.active !== false;
    const availability = r.availability_status ?? (r.in_stock ? "AVAILABLE" : "UNAVAILABLE");
    const status: OfferStatus = syncError && stale ? "erro" : stale ? "desatualizado" : availability === "UNKNOWN" ? "desconhecido" : inStock ? "disponivel" : "indisponivel";
    const offer: Offer = {
      offer_id: r.id,
      supplier_id: r.supplier_id,
      supplier_name: s.name,
      price: price && price > 0 ? price : null,
      in_stock: inStock,
      status,
      stock_qty: r.stock_reliable ? r.stock_quantity : null,
      stock_reliable: r.stock_reliable === true,
      url: r.url,
      captured_at: captured,
      source: r.offer_source === "manual" ? "manual" : "auto",
      stale,
      supplier_sync_error: syncError,
      preferred: pref === "preferred" ? "product" : s.priority === "preferred" ? "supplier" : null,
    };
    const list = out.get(r.product_id) ?? [];
    // um fornecedor = uma oferta por produto (fica a mais recente)
    const idx = list.findIndex((o) => o.supplier_id === offer.supplier_id);
    if (idx >= 0) {
      if ((list[idx]!.captured_at ?? "") < (captured ?? "")) list[idx] = offer;
    } else list.push(offer);
    out.set(r.product_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  return out;
}

/** Oferta que pode ser comprada: tem preço e está disponível (desatualizada conta, com aviso). */
const buyable = (o: Offer) => o.price != null && o.in_stock && o.status !== "erro";

async function resolveItem(db: Db, it: BasketItem) {
  if (it.product_id) {
    const { data } = await db
      .from("products")
      .select("id, canonical_name, brand, image_url, volume_ml")
      .eq("id", it.product_id)
      .maybeSingle();
    if (data) return { product: data, candidates: [] as MatchCandidate[], confirm: false };
  }
  const cands = await resolveProductCandidates(db, it.query);
  const conf = confidenceOf(cands);
  const exact = cands.find((c) => flat(c.name) === flat(it.query));
  const best = exact ?? cands[0];
  if (best && (conf === "high" || exact)) return { product: { id: best.product_id, canonical_name: best.name, brand: best.brand, image_url: best.image_url, volume_ml: best.volume_ml }, candidates: cands, confirm: false };
  if (best && conf === "medium" && (!cands[1] || best.score - cands[1].score >= 0.05))
    return { product: { id: best.product_id, canonical_name: best.name, brand: best.brand, image_url: best.image_url, volume_ml: best.volume_ml }, candidates: cands, confirm: true };
  return { product: null, candidates: cands, confirm: false };
}

function allocate(items: ItemResult[], allowed: Set<string> | null, label: string): AllocationOption {
  const groups = new Map<string, SupplierGroup>();
  const uncovered: string[] = [];
  let total = 0;
  for (const it of items) {
    if (!it.product) continue;
    const pool = it.offers.filter((o) => buyable(o) && (!allowed || allowed.has(o.supplier_id)));
    let pick = pool[0] ?? null;
    if (it.manual && it.chosen && (!allowed || allowed.has(it.chosen.supplier_id))) pick = it.chosen;
    if (!pick) {
      uncovered.push(it.product.name);
      continue;
    }
    const g = groups.get(pick.supplier_id) ?? { supplier_id: pick.supplier_id, supplier_name: pick.supplier_name, items: [], total: 0 };
    const subtotal = round(pick.price! * it.quantity);
    g.items.push({ key: it.key, name: it.product.name, qty: it.quantity, price: pick.price!, subtotal });
    g.total = round(g.total + subtotal);
    total = round(total + subtotal);
    groups.set(pick.supplier_id, g);
  }
  const list = Array.from(groups.values()).sort((a, b) => b.total - a.total);
  return { label, supplier_ids: list.map((g) => g.supplier_id), total, groups: list, uncovered };
}

export async function compareBasket(db: Db, basket: BasketItem[], opts: { exclude?: string[] } = {}): Promise<Comparison> {
  const merged = mergeBasket(basket);
  const resolved = await Promise.all(merged.map((it) => resolveItem(db, it)));
  const ids = Array.from(new Set(resolved.map((r) => r.product?.id).filter(Boolean) as string[]));
  const offers = await offersFor(db, ids);
  const exclude = new Set(opts.exclude ?? []);

  const items: ItemResult[] = merged.map((it, i) => {
    const r = resolved[i]!;
    const base: ItemResult = {
      key: it.key,
      query: it.query,
      quantity: it.quantity,
      status: "not_found",
      confirm: r.confirm,
      product: null,
      candidates: r.candidates.slice(0, 5).map((c) => ({ id: c.product_id, name: c.name, brand: c.brand, image_url: c.image_url })),
      offers: [],
      chosen: null,
      manual: false,
      savings: [],
      cheaper_unavailable: null,
      split: null,
    };
    if (!r.product) {
      base.status = r.candidates.length ? "ambiguous" : "not_found";
      return base;
    }
    base.product = { id: r.product.id, name: r.product.canonical_name ?? "Perfume", brand: r.product.brand, image_url: r.product.image_url, volume_ml: r.product.volume_ml };
    const all = (offers.get(r.product.id) ?? []).filter((o) => !exclude.has(o.supplier_id));
    base.offers = all;
    if (!all.length) {
      base.status = "no_offers";
      return base;
    }
    const avail = all.filter(buyable);
    const forced = it.forced_supplier_id ? all.find((o) => o.supplier_id === it.forced_supplier_id) : null;
    // Escolha estável: preferência do perfume → fornecedor preferencial → mais barato.
    const preferred = avail.find((o) => o.preferred === "product") ?? avail.find((o) => o.preferred === "supplier");
    base.chosen = forced ?? preferred ?? avail[0] ?? null;
    base.manual = Boolean(forced);
    base.status = base.chosen ? "found" : "unavailable";
    if (base.chosen?.price != null) {
      base.savings = avail
        .filter((o) => o.supplier_id !== base.chosen!.supplier_id && o.price! > base.chosen!.price!)
        .map((o) => ({ supplier_name: o.supplier_name, diff: round(o.price! - base.chosen!.price!) }));
      const cheaper = all.find((o) => o.price != null && o.status === "indisponivel" && o.price < base.chosen!.price!);
      if (cheaper) base.cheaper_unavailable = { supplier_name: cheaper.supplier_name, diff: round(base.chosen.price! - cheaper.price!) };
      // divisão só quando o estoque informado é confiável e não cobre a quantidade
      const c = base.chosen;
      if (!base.manual && c.stock_reliable && c.stock_qty != null && c.stock_qty > 0 && c.stock_qty < it.quantity) {
        let left = it.quantity;
        const split: NonNullable<ItemResult["split"]> = [];
        for (const o of avail) {
          if (left <= 0) break;
          const take = o.stock_reliable && o.stock_qty != null ? Math.min(left, o.stock_qty) : left;
          if (take <= 0) continue;
          split.push({ supplier_id: o.supplier_id, supplier_name: o.supplier_name, qty: take, price: o.price! });
          left -= take;
        }
        if (split.length > 1 && left <= 0) base.split = split;
      }
    }
    return base;
  });

  const cheapest = allocate(items, null, "Menor preço");

  // Menor número de fornecedores: busca exata em todos os subconjuntos (poucos fornecedores).
  const supplierIds = Array.from(new Set(items.flatMap((i) => i.offers.filter(buyable).map((o) => o.supplier_id))));
  let fewest: AllocationOption | null = null;
  const coverable = cheapest.uncovered.length;
  if (supplierIds.length > 1 && supplierIds.length <= 10) {
    for (let mask = 1; mask < 1 << supplierIds.length; mask++) {
      const set = new Set(supplierIds.filter((_, b) => mask & (1 << b)));
      const opt = allocate(items, set, "Menos fornecedores");
      if (opt.uncovered.length > coverable) continue;
      if (
        !fewest ||
        opt.supplier_ids.length < fewest.supplier_ids.length ||
        (opt.supplier_ids.length === fewest.supplier_ids.length && opt.total < fewest.total)
      )
        fewest = opt;
    }
    if (fewest && fewest.supplier_ids.length >= cheapest.supplier_ids.length) fewest = null;
  }

  const alternatives = cheapest.groups.map((g) => {
    const set = new Set(supplierIds.filter((s) => s !== g.supplier_id));
    const opt = allocate(items, set, "");
    const lost = opt.uncovered.length - coverable;
    return { without: g.supplier_name, supplier_id: g.supplier_id, total: opt.total, delta: round(opt.total - cheapest.total), uncovered: lost };
  });

  const sups = await loadSuppliers(db);
  return {
    items,
    cheapest,
    fewest,
    alternatives,
    health: sups.map((s) => ({
      supplier_id: s.id,
      name: s.name,
      last_sync: s.last_successful_sync_at,
      status: s.sync_status,
      message: s.sync_message,
      mode: s.update_mode ?? "auto",
    })),
    generated_at: new Date().toISOString(),
  };
}

/** Histórico de preço por fornecedor para um produto (o suficiente para "baixou?"). */
export async function priceHistory(db: Db, productId: string) {
  const { data: offers } = await db
    .from("supplier_products")
    .select("id, supplier_id, price, suppliers(name)")
    .eq("product_id", productId);
  const rows: Array<{ supplier_name: string; points: Array<{ price: number; at: string }> }> = [];
  for (const o of (offers ?? []) as any[]) {
    const { data: hist } = await db
      .from("supplier_price_history")
      .select("price, recorded_at")
      .eq("supplier_product_id", o.id)
      .order("recorded_at", { ascending: true })
      .limit(60);
    const points: Array<{ price: number; at: string }> = [];
    for (const h of (hist ?? []) as any[]) {
      const p = Number(h.price);
      if (!p) continue;
      if (points.length && points[points.length - 1]!.price === p) continue;
      points.push({ price: p, at: h.recorded_at });
    }
    rows.push({ supplier_name: o.suppliers?.name ?? "Fornecedor", points: points.slice(-6) });
  }
  return rows;
}
