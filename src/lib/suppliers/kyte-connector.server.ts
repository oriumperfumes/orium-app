/**
 * KyteSupplierConnector — leitor reutilizável para qualquer catálogo *.kyte.site.
 *
 * Estratégia (em ordem): feeds documentados (/feed/google, /feed/facebook) →
 * consulta pública do catálogo usada pela própria vitrine. Nunca contorna
 * CAPTCHA/autenticação: se o identificador da loja não puder ser lido, a
 * integração fica "bloqueada" e o Admin usa importação manual.
 */
import { createHash } from "crypto";
import type { AdapterBatch, AdapterHealth, RawOffer, SupplierAdapter } from "./adapters.server";
import { cleanText } from "./normalize.server";
import { assertSafePublicUrl, safeFetch, UnsafeUrlError } from "./url-guard.server";

const API = "https://kyte-query-public.kyte.site/api";
const API_SECRET = "kyte_prod_9f2c6e1b8a4d5f7c3e0a9d2b6c8f1e4a7d5";
const IMG = "https://firebasestorage.googleapis.com/v0/b/kyte-7c484.appspot.com/o";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const PAGE = 500;
const MAX_PAGES = 30;
const CHUNK = 200;

export type KyteProduct = {
  _id?: string;
  id?: string;
  uid?: string;
  active?: boolean;
  showOnCatalog?: boolean;
  name?: string;
  code?: string;
  label?: string;
  salePrice?: number | string | null;
  salePromotionalPrice?: number | string | null;
  stockActive?: boolean;
  stock?: { current?: number | null } | number | null;
  stockStatus?: string;
  image?: string;
  imageLarge?: string;
  imageMedium?: string;
  imageThumb?: string;
  gallery?: Array<{ url?: string }> | null;
  description?: string;
  category?: { name?: string } | null;
  categoryName?: string;
  dateCreation?: string;
};

export type KyteStore = { base: string; slug: string };

/** Aceita https://loja.kyte.site, loja.kyte.site/pt-BR, loja.catalog.kyte.site… */
export function parseKyteUrl(raw: string): KyteStore | null {
  const url = assertSafePublicUrl(raw);
  const m = url.hostname.toLowerCase().match(/^([a-z0-9-]+)(\.catalog)?\.kyte\.site$/);
  if (!m?.[1]) return null;
  return { base: `https://${url.hostname.toLowerCase()}`, slug: m[1] };
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "string") {
    const s = v.replace(/R\$\s*/i, "").trim();
    const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};

const GENDER = /^(masculino|feminino|unissex|unisex|compartilh[aá]vel|infantil)\b/i;

/** Extrai volume, concentração e gênero do nome comercial Kyte. Nada é inventado. */
export function parseKyteName(rawName: string) {
  const name = cleanText(rawName);
  const vol = name.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  const volumeMl = vol?.[1] ? Number(vol[1].replace(",", ".")) : null;
  const conc = name.match(/\b(extrait de parfum|eau de parfum|eau de toilette|eau de cologne|parfum|elixir|edp|edt|edc)\b/i)?.[1]?.toLowerCase() ?? null;
  const concentration = conc
    ? ({ "eau de parfum": "EDP", edp: "EDP", "eau de toilette": "EDT", edt: "EDT", "eau de cologne": "EDC", edc: "EDC", parfum: "PARFUM", "extrait de parfum": "EXTRAIT", elixir: "ELIXIR" } as Record<string, string>)[conc] ?? null
    : null;
  const dash = name.lastIndexOf(" - ");
  const tail = dash > 3 ? name.slice(dash + 3).trim() : "";
  const gender = GENDER.exec(tail)?.[1]?.toLowerCase() ?? null;
  // Quando o final NÃO é gênero/volume, ele costuma ser a marca ("Yara - Lattafa").
  const brand = tail && !gender && !/^\d/.test(tail) ? tail.replace(/\s*\d+(?:[.,]\d+)?\s*ml\b.*$/i, "").trim() || null : null;
  return { name, volumeMl, concentration, gender, brand };
}

function imagesOf(p: KyteProduct): string[] {
  const path = (v?: string | null) => (v ? (/^https?:\/\//.test(v) ? v : `${IMG}${v.startsWith("/") ? v : `/${v}`}`) : null);
  const gallery = (p.gallery ?? []).map((g) => (g?.url && p.uid ? `${IMG}/${encodeURIComponent(p.uid)}%2F${g.url}?alt=media` : null));
  return Array.from(new Set([path(p.image), path(p.imageLarge), path(p.imageMedium), ...gallery].filter((v): v is string => Boolean(v))));
}

function availability(p: KyteProduct): "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN" {
  if (p.active === false || /OUT_OF_STOCK|UNAVAILABLE/i.test(p.stockStatus ?? "")) return "UNAVAILABLE";
  if (!p.stockActive || p.stockStatus === "NOT_CONTROLLED") return "UNKNOWN";
  const s = typeof p.stock === "object" && p.stock ? p.stock.current : p.stock;
  return typeof s === "number" ? (s > 0 ? "AVAILABLE" : "UNAVAILABLE") : "UNKNOWN";
}

const slugify = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function kyteToOffer(p: KyteProduct, base: string): RawOffer | null {
  const id = p._id ?? p.id;
  const parsed = parseKyteName(p.name ?? "");
  if (!id || !parsed.name) return null;
  const regular = num(p.salePrice);
  const promo = num(p.salePromotionalPrice);
  const status = availability(p);
  const stockRaw = typeof p.stock === "object" && p.stock ? p.stock.current : p.stock;
  const category = cleanText(p.category?.name ?? p.categoryName);
  // Só dados públicos do anúncio. Campos internos do lojista (ex.: custo dele) nunca são lidos.
  const raw = { id, name: parsed.name, code: p.code ?? null, price: regular, promotional_price: promo, availability: status, category: category || null, volume_ml: parsed.volumeMl, concentration: parsed.concentration, gender: parsed.gender, description: p.description?.slice(0, 1000) ?? null };
  return {
    externalId: id,
    name: parsed.name,
    price: promo ?? regular,
    rawPrice: promo ?? regular,
    promotionalPrice: promo,
    costSource: promo != null ? "preco-promocional" : "preco-venda",
    inStock: status === "AVAILABLE",
    availabilityStatus: status,
    stock: status !== "UNKNOWN" && typeof stockRaw === "number" ? stockRaw : null,
    url: `${base}/pt-BR/p/${slugify(parsed.name)}/${id}`,
    images: imagesOf(p),
    sku: id,
    brand: parsed.brand,
    categories: category ? [category] : [],
    sourceUpdatedAt: p.dateCreation ?? null,
    rawData: raw,
    rawPayloadHash: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
  };
}

/** Lê a vitrine (direta e, se protegida, leitura pública renderizada) só para achar o ID público da loja. */
export async function discoverKyteStore(base: string): Promise<{ aid: string | null; method: string; html: string | null; status: number | null }> {
  let status: number | null = null;
  for (const url of [`${base}/pt-BR`, base]) {
    try {
      const res = await safeFetch(url, { headers: { "user-agent": UA, accept: "text/html" }, timeoutMs: 12_000 });
      status = res.status;
      const html = await res.text();
      const m = html.match(/\\?"aid\\?"\s*:\s*\\?"([A-Za-z0-9]{8,32})/);
      if (m?.[1]) return { aid: m[1], method: "vitrine-direta", html, status };
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw e;
    }
  }
  try {
    const res = await fetch(`https://r.jina.ai/${base}/pt-BR`, { headers: { "x-return-format": "html", accept: "text/html" }, signal: AbortSignal.timeout(40_000) });
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/\\?"aid\\?"\s*:\s*\\?"([A-Za-z0-9]{8,32})/);
      if (m?.[1]) return { aid: m[1], method: "vitrine-renderizada", html, status };
    }
  } catch {
    /* sem leitura alternativa */
  }
  return { aid: null, method: "indisponivel", html: null, status };
}

export async function probeKyteFeeds(base: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const feed of ["feed/google", "feed/facebook"]) {
    try {
      const res = await safeFetch(`${base}/${feed}`, { headers: { "user-agent": UA }, timeoutMs: 8_000 });
      const type = res.headers.get("content-type") ?? "";
      out[feed] = res.ok && /xml|csv|text\/plain/i.test(type) ? "disponivel" : res.status === 403 ? "bloqueado (403)" : `indisponivel (${res.status})`;
    } catch {
      out[feed] = "indisponivel (rede)";
    }
  }
  return out;
}

const cache = new Map<string, { at: number; data: { products: KyteProduct[]; reported: number | null; pages: number } }>();

/** Percorre TODAS as páginas até esgotar (ou até o total informado pela fonte). */
export async function fetchKyteCatalog(aid: string): Promise<{ products: KyteProduct[]; reported: number | null; pages: number; hidden: number }> {
  if (!/^[A-Za-z0-9]{8,32}$/.test(aid)) throw new Error("Identificador da loja inválido.");
  const hit = cache.get(aid);
  const fresh = hit && Date.now() - hit.at < 5 * 60_000 ? hit.data : null;
  let data = fresh;
  if (!data) {
    const all = new Map<string, KyteProduct>();
    let reported: number | null = null;
    let pages = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${API}/product/${aid}?limit=${PAGE}&skip=${page * PAGE}&isCatalog=true&isFractioned=true&unavailableLast=true&sort=PIN_FIRST`;
      let json: { count?: number; _products?: KyteProduct[] } | null = null;
      for (let attempt = 0; attempt < 3 && !json; attempt++) {
        const res = await fetch(url, { headers: { "x-kyte-cdn-secret": API_SECRET, accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
          continue;
        }
        if (!res.ok) throw new Error(`Catálogo Kyte respondeu HTTP ${res.status}.`);
        json = await res.json();
      }
      if (!json) throw new Error("Catálogo Kyte indisponível após novas tentativas.");
      pages++;
      reported = typeof json.count === "number" ? json.count : reported;
      const items = Array.isArray(json._products) ? json._products : [];
      const before = all.size;
      for (const p of items) {
        const id = p._id ?? p.id;
        if (id && !all.has(id)) all.set(id, p);
      }
      if (items.length < PAGE || all.size === before) break;
    }
    data = { products: Array.from(all.values()), reported, pages };
    cache.set(aid, { at: Date.now(), data });
  }
  const visible = data.products.filter((p) => p.active !== false && p.showOnCatalog !== false);
  return { products: visible, reported: data.reported, pages: data.pages, hidden: data.products.length - visible.length };
}

export type KyteAnalysis = {
  ok: boolean;
  platform: "kyte" | "desconhecida";
  base: string | null;
  slug: string | null;
  aid: string | null;
  suggestedName: string | null;
  method: string;
  feeds: Record<string, string>;
  reachable: boolean;
  storefrontStatus: number | null;
  totalProcessed: number;
  reportedBySource: number | null;
  hiddenBySource: number;
  pages: number;
  categories: Array<{ name: string; count: number }>;
  withPrice: number;
  withPromo: number;
  withImage: number;
  stockControlled: number;
  rejected: number;
  prices: "disponiveis" | "parciais" | "indisponiveis";
  images: "disponiveis" | "parciais" | "indisponiveis";
  sample: Array<{ name: string; price: number | null; promo: number | null; image: string | null; url: string | null; category: string | null; volumeMl: number | null; concentration: string | null }>;
  instagram: string | null;
  message: string;
  durationMs: number;
};

const level = (n: number, total: number) => (total && n === total ? "disponiveis" : n > 0 ? "parciais" : "indisponiveis");

export async function analyzeKyte(rawUrl: string, aidHint?: string | null): Promise<KyteAnalysis> {
  const t0 = Date.now();
  const store = parseKyteUrl(rawUrl);
  const empty: KyteAnalysis = { ok: false, platform: "desconhecida", base: null, slug: null, aid: null, suggestedName: null, method: "-", feeds: {}, reachable: false, storefrontStatus: null, totalProcessed: 0, reportedBySource: null, hiddenBySource: 0, pages: 0, categories: [], withPrice: 0, withPromo: 0, withImage: 0, stockControlled: 0, rejected: 0, prices: "indisponiveis", images: "indisponiveis", sample: [], instagram: null, message: "", durationMs: 0 };
  if (!store) return { ...empty, message: "Este endereço não é de um catálogo Kyte. Por enquanto só lojas Kyte têm leitura automática; use a importação manual de lista.", durationMs: Date.now() - t0 };
  const base = { ...empty, platform: "kyte" as const, base: store.base, slug: store.slug, suggestedName: store.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) };
  const [feeds, found] = await Promise.all([probeKyteFeeds(store.base), aidHint ? Promise.resolve({ aid: aidHint, method: "id-salvo", html: null, status: null }) : discoverKyteStore(store.base)]);
  const instagram = found.html?.match(/\\?"instagram\\?"\s*:\s*\\?"(@?[A-Za-z0-9_.]{2,40})/)?.[1] ?? null;
  if (!found.aid) return { ...base, feeds, method: found.method, storefrontStatus: found.status, message: "A vitrine está protegida contra leitura automática e o catálogo público não pôde ser identificado. Use a importação manual por arquivo.", durationMs: Date.now() - t0 };
  try {
    const cat = await fetchKyteCatalog(found.aid);
    const offers = cat.products.map((p) => kyteToOffer(p, store.base));
    const ok = offers.filter((o): o is RawOffer => Boolean(o));
    const cats = new Map<string, number>();
    for (const o of ok) for (const c of o.categories) cats.set(c, (cats.get(c) ?? 0) + 1);
    const withPrice = ok.filter((o) => o.price != null).length;
    const withImage = ok.filter((o) => o.images.length).length;
    return {
      ...base,
      ok: ok.length > 0,
      aid: found.aid,
      method: `${found.method} + catalogo-publico-kyte`,
      feeds,
      reachable: true,
      storefrontStatus: found.status,
      totalProcessed: ok.length,
      reportedBySource: cat.reported,
      hiddenBySource: cat.hidden,
      pages: cat.pages,
      categories: Array.from(cats.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      withPrice,
      withPromo: ok.filter((o) => o.promotionalPrice != null).length,
      withImage,
      stockControlled: ok.filter((o) => o.availabilityStatus !== "UNKNOWN").length,
      rejected: offers.length - ok.length,
      prices: level(withPrice, ok.length),
      images: level(withImage, ok.length),
      sample: ok.slice(0, 12).map((o) => ({ name: o.name, price: o.price, promo: o.promotionalPrice ?? null, image: o.images[0] ?? null, url: o.url, category: o.categories[0] ?? null, volumeMl: (o.rawData?.["volume_ml"] as number | null) ?? null, concentration: (o.rawData?.["concentration"] as string | null) ?? null })),
      instagram,
      message: ok.length ? `${ok.length} produtos visíveis lidos em ${cat.pages} página(s).` : "O catálogo respondeu sem produtos visíveis.",
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return { ...base, aid: found.aid, feeds, method: found.method, reachable: true, storefrontStatus: found.status, message: e instanceof Error ? e.message : "Falha ao ler o catálogo.", durationMs: Date.now() - t0 };
  }
}

/** Adaptador de sincronização para qualquer loja Kyte salva no cadastro. */
export function makeKyteConnector(opts: { key: string; label: string; base: string; aid?: string | null }): SupplierAdapter {
  const resolveAid = async () => opts.aid ?? (await discoverKyteStore(opts.base)).aid;
  return {
    key: opts.key,
    label: opts.label,
    async fetchBatch(cursor): Promise<AdapterBatch> {
      const aid = await resolveAid();
      if (!aid) throw new Error("BLOQUEADO: a vitrine protege o catálogo contra leitura automática. Use a importação manual.");
      const cat = await fetchKyteCatalog(aid);
      const start = Math.max(0, cursor || 0);
      const slice = cat.products.slice(start, start + CHUNK);
      const items = slice.map((p) => kyteToOffer(p, opts.base)).filter((o): o is RawOffer => Boolean(o));
      const cats = new Map<string, { name: string; externalId: string | null; url: string | null }>();
      for (const p of cat.products) {
        const n = cleanText(p.category?.name ?? p.categoryName);
        if (n && !cats.has(n)) cats.set(n, { name: n, externalId: null, url: `${opts.base}/pt-BR` });
      }
      return {
        items,
        nextCursor: start + CHUNK >= cat.products.length ? null : start + CHUNK,
        cursorKind: "index",
        pages: cat.pages,
        total: cat.products.length,
        throttled: false,
        paymentDiscountPercent: 0,
        categories: Array.from(cats.values()),
        diagnostics: { source: "kyte-connector", raw_products: cat.products.length, reported_by_source: cat.reported, hidden_by_source: cat.hidden, pages: cat.pages, rejected: slice.length - items.length, cursor: start },
      };
    },
    async healthCheck(): Promise<AdapterHealth> {
      const t0 = Date.now();
      try {
        const aid = await resolveAid();
        if (!aid) return { ok: false, sourceAccessible: false, catalogDetected: false, productsDetected: 0, pricesDetected: 0, code: "SOURCE_BLOCKED", message: "Catálogo protegido; leitura automática indisponível.", durationMs: Date.now() - t0 };
        const cat = await fetchKyteCatalog(aid);
        const prices = cat.products.filter((p) => num(p.salePromotionalPrice) ?? num(p.salePrice)).length;
        return { ok: cat.products.length > 0, sourceAccessible: true, catalogDetected: true, productsDetected: cat.products.length, pricesDetected: prices, code: cat.products.length ? null : "NO_PRODUCTS_FOUND", message: `${cat.products.length} produtos visíveis em ${cat.pages} página(s).`, durationMs: Date.now() - t0 };
      } catch (e) {
        return { ok: false, sourceAccessible: false, catalogDetected: false, productsDetected: 0, pricesDetected: 0, code: "NETWORK_ERROR", message: e instanceof Error ? e.message : "Falha", durationMs: Date.now() - t0 };
      }
    },
  };
}
