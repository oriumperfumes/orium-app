import { createHash } from "crypto";
import type { AdapterBatch, AdapterHealth, RawOffer, SupplierAdapter } from "./adapters.server";
import { cleanText } from "./normalize.server";

const BASE = "https://klcosmeticos.catalog.kyte.site";
const CATALOG_URL = `${BASE}/?preview=old`;
const API = "https://kyte-query-public.kyte.site/api";
const AID = "wzbQSMRkVgOlUF";
const API_HEADER = "kyte_prod_9f2c6e1b8a4d5f7c3e0a9d2b6c8f1e4a7d5";
const IMAGE_BASE = "https://firebasestorage.googleapis.com/v0/b/kyte-7c484.appspot.com/o";
const CHUNK = 30;
const MAX_ITEMS = 10_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export type KlErrorCode =
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_BLOCKED"
  | "HTML_CHANGED"
  | "NO_PRODUCTS_FOUND"
  | "PARSER_FAILED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "INVALID_RESPONSE";

export class KlAdapterError extends Error {
  constructor(
    public readonly code: KlErrorCode,
    message: string,
    public readonly responseMeta?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
    this.name = "KlAdapterError";
  }
}

type KlProduct = {
  _id?: string;
  id?: string;
  uid?: string;
  active?: boolean;
  name?: string;
  code?: string;
  salePrice?: number | string | null;
  salePromotionalPrice?: number | string | null;
  stockActive?: boolean;
  stock?: { current?: number | null } | number | null;
  stockStatus?: string;
  image?: string;
  imageThumb?: string;
  gallery?: Array<{ url?: string }>;
  description?: string;
  categoryId?: string;
  categoryName?: string;
  category?: { name?: string };
  dateCreation?: string;
};

type FetchResult = {
  products: KlProduct[];
  categories: Array<{ name: string; externalId: string | null; url: string | null }>;
  meta: Record<string, string | number | boolean | null>;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseBrazilianPrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/R\$\s*/i, "").replace(/\s/g, "");
  if (!clean) return null;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const result = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(result) ? result : null;
}

function safeSample(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 500);
}

function classifyResponse(response: Response, body: string, expected: "html" | "json"): void {
  const type = response.headers.get("content-type") ?? "";
  const meta = {
    endpoint: response.url,
    status_code: response.status,
    content_type: type,
    response_bytes: new TextEncoder().encode(body).length,
    captured_at: new Date().toISOString(),
    sample: safeSample(body),
  };
  if (response.status === 429) throw new KlAdapterError("RATE_LIMITED", "A KL limitou temporariamente as consultas.", meta);
  if (response.status === 403 && (/challenge|just a moment|captcha/i.test(body) || response.headers.get("cf-mitigated") === "challenge")) {
    throw new KlAdapterError("SOURCE_BLOCKED", "A proteção do catálogo bloqueou a leitura automática.", meta);
  }
  if (!response.ok) throw new KlAdapterError("SOURCE_UNAVAILABLE", `A fonte respondeu HTTP ${response.status}.`, meta);
  if (expected === "json" && !/json/i.test(type)) throw new KlAdapterError("INVALID_RESPONSE", "A fonte deveria responder JSON, mas devolveu outro formato.", meta);
  if (expected === "html" && !/html/i.test(type)) throw new KlAdapterError("INVALID_RESPONSE", "A vitrine deveria responder HTML, mas devolveu outro formato.", meta);
}

async function request(url: string, expected: "html" | "json", headers: Record<string, string> = {}): Promise<{ body: string; response: Response }> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
        headers: { "user-agent": UA, accept: expected === "json" ? "application/json" : "text/html,application/xhtml+xml", "accept-language": "pt-BR,pt;q=0.9", ...headers },
      });
      const body = await response.text();
      classifyResponse(response, body, expected);
      return { body, response };
    } catch (error) {
      last = error;
      if (error instanceof KlAdapterError && !["RATE_LIMITED", "SOURCE_UNAVAILABLE"].includes(error.code)) throw error;
      if (attempt < 2) await wait(350 * 2 ** attempt);
    }
  }
  if (last instanceof KlAdapterError) throw last;
  const message = last instanceof Error ? last.message : "Falha de rede";
  throw new KlAdapterError(/timeout|aborted/i.test(message) ? "TIMEOUT" : "NETWORK_ERROR", message);
}

function parseNextData(html: string): FetchResult {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) throw new KlAdapterError("HTML_CHANGED", "O catálogo abriu, mas os dados estruturados esperados não foram encontrados.");
  try {
    const root = JSON.parse(match[1]) as any;
    const state = root?.props?.initialReduxState?.products;
    const products = state?.productsGroup ?? state?.allProducts;
    if (!Array.isArray(products)) throw new Error("productsGroup ausente");
    const categories = Array.isArray(state?.categories)
      ? state.categories.filter((c: any) => c?.name).map((c: any) => ({ name: cleanText(c.name), externalId: c._id ?? null, url: c.friendly ? `${BASE}/pt-BR/c/${c.friendly}/${c._id ?? ""}` : null }))
      : [];
    return { products, categories, meta: { source: "next-data", build_id: root?.buildId ?? null, endpoint: CATALOG_URL } };
  } catch (error) {
    throw new KlAdapterError("PARSER_FAILED", `Os dados da vitrine mudaram: ${error instanceof Error ? error.message : "JSON inválido"}.`);
  }
}

function parseApi(body: string, endpoint: string, status: number, contentType: string): FetchResult {
  try {
    const json = JSON.parse(body) as { _products?: KlProduct[]; products?: KlProduct[] };
    const products = Array.isArray(json._products) ? json._products : Array.isArray(json.products) ? json.products : null;
    if (!products) throw new Error("lista de produtos ausente");
    return { products, categories: [], meta: { source: "kyte-catalog", endpoint, status_code: status, content_type: contentType, response_bytes: new TextEncoder().encode(body).length, sample: safeSample(body) } };
  } catch (error) {
    throw new KlAdapterError("PARSER_FAILED", `A fonte estruturada da KL mudou: ${error instanceof Error ? error.message : "JSON inválido"}.`);
  }
}

async function fetchCatalog(): Promise<FetchResult> {
  try {
    const { body, response } = await request(CATALOG_URL, "html");
    const parsed = parseNextData(body);
    parsed.meta = { ...parsed.meta, final_url: response.url, status_code: response.status, content_type: response.headers.get("content-type"), response_bytes: new TextEncoder().encode(body).length };
    if (!parsed.products.length) throw new KlAdapterError("NO_PRODUCTS_FOUND", "A vitrine respondeu, mas não apresentou nenhum produto.", parsed.meta);
    return parsed;
  } catch (error) {
    if (!(error instanceof KlAdapterError) || error.code !== "SOURCE_BLOCKED") throw error;
    const endpoint = `${API}/product/${AID}?limit=1000&skip=0&isCatalog=true&isFractioned=true&unavailableLast=true&sort=PIN_FIRST`;
    const { body, response } = await request(endpoint, "json", { "x-kyte-cdn-secret": API_HEADER });
    const parsed = parseApi(body, response.url, response.status, response.headers.get("content-type") ?? "");
    parsed.meta["vitrine_status"] = "SOURCE_BLOCKED";
    if (!parsed.products.length) throw new KlAdapterError("NO_PRODUCTS_FOUND", "A fonte estruturada respondeu sem produtos.", parsed.meta);
    return parsed;
  }
}

function imageUrl(value?: string | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;
  return `${IMAGE_BASE}${value.startsWith("/") ? value : `/${value}`}`;
}

function availabilityOf(product: KlProduct): "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN" {
  if (product.active === false || /OUT_OF_STOCK|UNAVAILABLE/i.test(product.stockStatus ?? "")) return "UNAVAILABLE";
  if (!product.stockActive || product.stockStatus === "NOT_CONTROLLED") return "UNKNOWN";
  const stock = typeof product.stock === "object" && product.stock ? product.stock.current : product.stock;
  if (typeof stock === "number") return stock > 0 ? "AVAILABLE" : "UNAVAILABLE";
  return "UNKNOWN";
}

function normalize(product: KlProduct): RawOffer | null {
  const id = product._id ?? product.id;
  const name = cleanText(product.name);
  if (!id || !name) return null;
  const promotional = parseBrazilianPrice(product.salePromotionalPrice);
  const regular = parseBrazilianPrice(product.salePrice);
  const status = availabilityOf(product);
  const stockValue = typeof product.stock === "object" && product.stock ? product.stock.current : product.stock;
  const raw = { id, name, code: product.code ?? null, price: regular, promotional_price: promotional, availability: status, category: product.categoryName ?? product.category?.name ?? null, description: product.description?.slice(0, 1000) ?? null };
  return {
    externalId: id,
    name,
    price: promotional ?? regular,
    promotionalPrice: promotional,
    rawPrice: promotional ?? regular,
    costSource: promotional != null ? "preco-promocional" : "preco-venda",
    inStock: status === "AVAILABLE",
    availabilityStatus: status,
    stock: typeof stockValue === "number" ? stockValue : null,
    url: `${BASE}/pt-BR/p/${name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}/${id}`,
    images: Array.from(new Set([imageUrl(product.image), imageUrl(product.imageThumb), ...(product.gallery ?? []).map((g) => imageUrl(g.url))].filter((v): v is string => Boolean(v)))),
    // O ID Kyte é a chave persistente. O código comercial fica preservado no rawData.
    sku: id,
    brand: null,
    categories: [cleanText(product.categoryName ?? product.category?.name)].filter(Boolean),
    sourceUpdatedAt: product.dateCreation ?? null,
    rawData: raw,
    rawPayloadHash: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
  };
}

export const KLCosmeticosAdapter: SupplierAdapter = {
  key: "kl",
  label: "KL Cosméticos",
  async fetchBatch(cursor) {
    const fetched = await fetchCatalog();
    const unique = new Map<string, KlProduct>();
    for (const product of fetched.products.slice(0, MAX_ITEMS)) {
      const id = product._id ?? product.id;
      if (id && !unique.has(id)) unique.set(id, product);
    }
    const all = Array.from(unique.values());
    if (!all.length) throw new KlAdapterError("PARSER_FAILED", "A KL respondeu com zero produtos válidos.", fetched.meta);
    const start = Math.max(0, cursor || 0);
    const slice = all.slice(start, start + CHUNK);
    const items = slice.map(normalize).filter((item): item is RawOffer => Boolean(item));
    if (!items.length) throw new KlAdapterError("PARSER_FAILED", "O lote da KL não continha produtos normalizáveis.", fetched.meta);
    return {
      items,
      nextCursor: start + CHUNK >= all.length ? null : start + CHUNK,
      pages: 1,
      total: all.length,
      categories: fetched.categories,
      paymentDiscountPercent: 0,
      diagnostics: { ...fetched.meta, raw_products: fetched.products.length, unique_products: all.length, parsed_products: items.length, cursor: start },
    };
  },
  async healthCheck(): Promise<AdapterHealth> {
    const started = Date.now();
    try {
      const fetched = await fetchCatalog();
      const unique = new Set(fetched.products.map((p) => p._id ?? p.id).filter(Boolean));
      const prices = fetched.products.filter((p) => (parseBrazilianPrice(p.salePromotionalPrice) ?? parseBrazilianPrice(p.salePrice)) != null).length;
      return { ok: fetched.products.length > 0, sourceAccessible: true, catalogDetected: true, productsDetected: unique.size, pricesDetected: prices, code: fetched.products.length ? null : "NO_PRODUCTS_FOUND", message: fetched.products.length ? "Catálogo e preços identificados." : "A fonte respondeu sem produtos.", durationMs: Date.now() - started, responseMeta: fetched.meta };
    } catch (error) {
      const e = error instanceof KlAdapterError ? error : new KlAdapterError("NETWORK_ERROR", error instanceof Error ? error.message : "Falha desconhecida");
      return { ok: false, sourceAccessible: !["NETWORK_ERROR", "TIMEOUT", "SOURCE_UNAVAILABLE"].includes(e.code), catalogDetected: false, productsDetected: 0, pricesDetected: 0, code: e.code, message: e.message, durationMs: Date.now() - started, responseMeta: e.responseMeta ?? null };
    }
  },
};