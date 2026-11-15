/**
 * Adaptadores de fornecedores.
 *
 * Cada adaptador sabe ler o catálogo público de uma loja e devolver ofertas
 * normalizadas. O trabalho é feito em lotes ("cursor") para caber no tempo de
 * execução do servidor — o motor chama de novo até `nextCursor` ser nulo.
 */
import { cleanText } from "./normalize.server";
import { KLCosmeticosAdapter } from "./kl-cosmeticos.server";
import { makeKyteConnector } from "./kyte-connector.server";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export type RawOffer = {
  externalId: string;
  name: string;
  /** CUSTO real da Orium para esta variante (o que realmente é pago ao fornecedor). */
  price: number | null;
  /** Preço bruto anunciado na página, antes de qualquer desconto de pagamento. */
  rawPrice?: number | null;
  /** De onde saiu o custo (ex.: "pix-7%", "preco-lista"). */
  costSource?: string | null;
  inStock: boolean;
  stock: number | null;
  url: string | null;
  /** Candidatas de imagem, da melhor resolução para a pior. */
  images: string[];
  sku: string | null;
  brand: string | null;
  categories: string[];
  sourceUpdatedAt: string | null;
  availabilityStatus?: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  promotionalPrice?: number | null;
  rawData?: Record<string, unknown> | null;
  rawPayloadHash?: string | null;
  /**
   * O preço foi conferido na variante certa (ex.: "Lacrado" na página do produto).
   * O motor aceita a mudança mesmo se for grande — a trava de anomalia existe para
   * leituras duvidosas, não para corrigir um valor antigo errado.
   */
  priceConfirmed?: boolean;
};

export type AdapterHealth = {
  ok: boolean;
  sourceAccessible: boolean;
  catalogDetected: boolean;
  productsDetected: number;
  pricesDetected: number;
  code: string | null;
  message: string;
  durationMs: number;
  responseMeta?: Record<string, string | number | boolean | null> | null;
};

export type AdapterBatch = {
  items: RawOffer[];
  nextCursor: number | null;
  /** "index": o cursor é a posição do item (retomada exata); ausente = página (repete o lote). */
  cursorKind?: "index";
  pages: number;
  total: number | null;
  /** A loja pediu para esperar (limite de requisições). Tentar de novo em instantes. */
  throttled?: boolean;
  /** Categorias descobertas na loja (nome + endereço). */
  categories?: { name: string; externalId: string | null; url: string | null }[];
  /** Desconto de pagamento à vista/Pix aplicado pela loja (usado como custo real). */
  paymentDiscountPercent?: number | null;
  diagnostics?: Record<string, unknown>;
};

/** Dados já conhecidos do fornecedor, para o leitor usar como reserva quando uma leitura ao vivo falha. */
export type FetchContext = { knownPaymentDiscount?: number | null };

export type SupplierAdapter = {
  key: string;
  label: string;
  fetchBatch: (cursor: number, budgetMs: number, ctx?: FetchContext) => Promise<AdapterBatch>;
  healthCheck?: () => Promise<AdapterHealth>;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BROWSER_HEADERS = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
  "upgrade-insecure-requests": "1",
};

/** Leitura via serviço de leitura pública, usada quando a loja bloqueia o acesso direto. */
async function getHtmlViaReader(url: string, extra?: Record<string, string>): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { "x-return-format": "html", accept: "text/html,*/*", ...extra },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (leitura alternativa) em ${url}`);
  return res.text();
}

/** Leitura renderizada (espera o conteúdo carregar) — usada em lojas que montam a lista no navegador. */
async function getRenderedViaReader(url: string, waitForSelector: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      accept: "text/plain,*/*",
      "x-no-cache": "true",
      "x-timeout": "40",
      "x-wait-for-selector": waitForSelector,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (leitura renderizada) em ${url}`);
  return res.text();
}

/** GET com repetição educada: lojas limitam requisições muito rápidas (403/429). */
async function getHtml(url: string, attempts = 3): Promise<string> {
  let last = "";
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: BROWSER_HEADERS });
    } catch (e) {
      last = e instanceof Error ? e.message : `Falha de rede em ${url}`;
      await wait(1000 * (i + 1));
      continue;
    }
    if (res.ok) return res.text();
    last = `HTTP ${res.status} em ${url}`;
    if (res.status === 403 || res.status === 401) break;
    if (res.status === 429 || res.status >= 500) {
      await wait(1200 * (i + 1));
      continue;
    }
    break;
  }
  try {
    return await getHtmlViaReader(url);
  } catch {
    throw new Error(last || `Falha ao ler ${url}`);
  }
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const inStockFrom = (availability?: string) =>
  typeof availability === "string" ? /InStock|LimitedAvailability|PreOrder/i.test(availability) : true;

/** Remove repetidos mantendo a ordem (melhor imagem primeiro). */
const uniq = (list: (string | null | undefined)[]) =>
  Array.from(new Set(list.filter((v): v is string => Boolean(v && v.startsWith("http")))));

/* ------------------------------------------------------------------ */
/* MRX Perfumaria — Nuvemshop, listagem paginada com JSON-LD por item  */
/* ------------------------------------------------------------------ */

const MRX_BASE = "https://mrxperfumaria.com.br";
const MRX_MAX_PAGES = 60;
// 2 páginas por rodada: cada página é uma chamada externa (e pode repetir) dentro do limite do plano Free.
const MRX_PAGES_PER_BATCH = 2;
const MRX_PAGE_DELAY_MS = 2500;

type LdProduct = {
  "@type"?: string;
  name?: string;
  image?: string;
  sku?: string;
  brand?: { name?: string };
  category?: string;
  offers?: {
    url?: string;
    price?: string | number;
    availability?: string;
    inventoryLevel?: { value?: string | number };
  };
};

function parseLdProducts(html: string): LdProduct[] {
  const out: LdProduct[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse((m[1] ?? "").trim()) as LdProduct;
      if (parsed?.["@type"] === "Product") out.push(parsed);
    } catch {
      /* bloco não-JSON: ignorado */
    }
  }
  return out;
}

/**
 * A Nuvemshop entrega miniaturas com sufixo de tamanho (`-480-0.webp`).
 * Preferimos o arquivo original e deixamos tamanhos grandes como alternativa.
 */
function mrxImageCandidates(image?: string | null): string[] {
  if (!image) return [];
  const url = image.startsWith("//") ? `https:${image}` : image;
  const m = url.match(/^(.*?)-(\d{2,4})-0(\.[a-z]+)(\?.*)?$/i);
  if (!m) return [url];
  const [, head = "", , ext = ""] = m;
  return uniq([`${head}${ext}`, `${head}-1024-0${ext}`, `${head}-640-0${ext}`, url]);
}

/**
 * A MRX anuncia o preço de lista, mas o valor realmente pago pela Orium é o
 * preço à vista/Pix (desconto fixo da loja). Lemos esse desconto de uma página
 * de produto e usamos como CUSTO. Nada de frete, parcelamento ou varejo.
 */
let mrxDiscountCache: { at: number; percent: number } | null = null;

async function mrxPaymentDiscount(listHtml: string): Promise<number> {
  if (mrxDiscountCache && Date.now() - mrxDiscountCache.at < 30 * 60 * 1000) return mrxDiscountCache.percent;
  const url = Array.from(listHtml.matchAll(/https:\/\/mrxperfumaria\.com\.br\/produtos\/[a-z0-9-]+\//g))[0]?.[0];
  let percent = 0;
  if (url) {
    try {
      const html = await getHtml(url, 2);
      const direct = html.match(/data-payment-discount="(\d+(?:[.,]\d+)?)"/);
      if (direct) percent = Number(String(direct[1]).replace(",", "."));
      if (!percent) {
        // Confere pelo par preço de lista x preço à vista da própria página.
        const pair = html.match(/"price_number":([0-9.]+),"price_number_raw":\d+,"price_with_payment_discount_short":"R\$([\d.]+,\d\d)"/);
        const list = pair ? Number(pair[1]) : null;
        const pix = pair ? Number(String(pair[2]).replace(/\./g, "").replace(",", ".")) : null;
        if (list && pix && pix < list) percent = Number((((list - pix) / list) * 100).toFixed(2));
      }
    } catch {
      /* sem leitura: tratado abaixo (a leitura do lote é interrompida) */
    }
  }
  if (!(percent > 0 && percent < 40)) percent = 0;
  // Falha não é guardada em cache: a próxima rodada tenta de novo em vez de repetir o erro por 30 min.
  if (percent > 0) mrxDiscountCache = { at: Date.now(), percent };
  return percent;
}

/** Abaixo disso o preço da lista é de uma variante de decant, não do frasco. */
const MRX_DECANT_PRICE_CEILING = 60;

type MrxVariant = {
  option0?: string | null;
  price_number?: number | null;
  price_with_payment_discount_short?: string | null;
  available?: boolean;
  stock?: number | null;
};

const brlNumber = (v: string | null | undefined) => {
  if (!v) return null;
  const n = Number(String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * A lista da MRX anuncia o preço da PRIMEIRA variante disponível. Quando o frasco
 * lacrado está esgotado, esse preço é de um decant (R$ 7–20) — e a disponibilidade
 * também é do decant. Aqui lemos a variante "Lacrado" na página do produto.
 */
async function mrxSealedVariant(url: string): Promise<{ list: number; cost: number | null; available: boolean; stock: number | null } | null> {
  const html = await getHtml(url, 2);
  const attr = html.match(/data-variants="([^"]*)"/)?.[1];
  if (!attr) return null;
  let variants: MrxVariant[];
  try {
    variants = JSON.parse(attr.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as MrxVariant[];
  } catch {
    return null;
  }
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const sealed =
    variants.find((v) => /lacrad/i.test(String(v.option0 ?? ""))) ??
    // sem nome de variante: a mais cara é o frasco (decants são sempre mais baratos)
    [...variants].sort((a, b) => Number(b.price_number ?? 0) - Number(a.price_number ?? 0))[0];
  const list = Number(sealed?.price_number ?? 0);
  if (!sealed || !(list > 0)) return null;
  const stock = sealed.stock == null ? null : Number(sealed.stock);
  return {
    list,
    cost: brlNumber(sealed.price_with_payment_discount_short),
    available: sealed.available === true && (stock === null || stock > 0),
    stock,
  };
}

const mrxAdapter: SupplierAdapter = {
  key: "mrx",
  label: "MRX Perfumaria",
  async fetchBatch(cursor, budgetMs, ctx) {
    const started = Date.now();
    const items: RawOffer[] = [];
    let page = Math.max(1, cursor || 1);
    let pages = 0;
    let done = false;
    let throttled = false;
    let discount = 0;
    let discountRead = false;

    while (Date.now() - started < budgetMs && page <= MRX_MAX_PAGES && pages < MRX_PAGES_PER_BATCH) {
      let html: string;
      try {
        html = await getHtml(`${MRX_BASE}/produtos/?page=${page}`);
      } catch (e) {
        // A loja limitou o acesso: paramos o lote e continuamos desta página depois.
        if (!/HTTP 429|HTTP 5\d\d/.test(e instanceof Error ? e.message : "")) throw e;
        throttled = true;
        break;
      }
      await wait(MRX_PAGE_DELAY_MS);
      if (!discountRead) {
        discount = await mrxPaymentDiscount(html);
        // Leitura ao vivo falhou: usa o último desconto lido (gravado no fornecedor) em vez de cair no preço de lista.
        const known = Number(ctx?.knownPaymentDiscount ?? 0);
        if (!(discount > 0) && known > 0 && known < 40) discount = known;
        // Sem nenhum desconto o "custo" viraria o preço de lista (cerca de 7% acima do pago):
        // interrompe em vez de gravar custos errados.
        if (!(discount > 0)) {
          throw new Error("DESCONTO_PIX_NAO_LIDO: o desconto à vista/Pix da MRX não pôde ser lido; a leitura foi interrompida para não gravar preço de lista como custo.");
        }
        discountRead = true;
      }
      const found = parseLdProducts(html);
      pages++;
      if (found.length === 0) {
        done = true;
        break;
      }
      for (const p of found) {
        const url = p.offers?.url ?? null;
        const sku = p.sku ?? null;
        const name = cleanText(p.name);
        const externalId = sku || url || name;
        if (!name || !externalId) continue;
        let stock = num(p.offers?.inventoryLevel?.value);
        let listPrice = num(p.offers?.price);
        let inStock = inStockFrom(p.offers?.availability) && (stock === null || stock > 0);
        let pixCost: number | null = null;
        let confirmed = listPrice != null && listPrice >= MRX_DECANT_PRICE_CEILING;
        // Preço de decant na lista: o frasco está em outra variante — vamos buscá-lo.
        if (url && listPrice != null && listPrice < MRX_DECANT_PRICE_CEILING && !throttled) {
          try {
            const sealed = await mrxSealedVariant(url);
            await wait(400);
            if (sealed) {
              listPrice = sealed.list;
              pixCost = sealed.cost;
              inStock = sealed.available;
              stock = sealed.stock;
              confirmed = true;
            }
          } catch (e) {
            if (/HTTP 429/.test(e instanceof Error ? e.message : "")) throttled = true;
          }
        }
        // Sem confirmação, um preço de decant segue sem "confirmado": a trava de anomalia
        // do motor mantém o último custo válido do frasco.
        // CUSTO = preço realmente pago (à vista/Pix). Sem frete e sem parcelamento.
        const cost =
          pixCost ??
          (listPrice != null && discount > 0 ? Number((listPrice * (1 - discount / 100)).toFixed(2)) : listPrice);
        items.push({
          externalId,
          name,
          price: cost,
          rawPrice: listPrice,
          costSource: pixCost != null ? "pix-lacrado" : discount > 0 ? `pix-${discount}%` : "preco-lista",
          priceConfirmed: confirmed,
          inStock,
          stock,
          url,
          images: mrxImageCandidates(p.image),
          sku,
          brand: cleanText(p.brand?.name) || null,
          categories: p.category ? [cleanText(p.category)].filter(Boolean) : [],
          sourceUpdatedAt: null,
        });
      }
      page++;
    }

    return {
      items,
      nextCursor: done ? null : page,
      pages,
      total: null,
      throttled,
      paymentDiscountPercent: discountRead ? discount : null,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Smart Mania — Kyte (Next.js). Sitemap + categorias + payload da página */
/* ------------------------------------------------------------------ */

const KYTE_BASE = "https://smartmaniaoficial.kyte.site";

type KyteProduct = {
  id?: string;
  name?: string;
  code?: string;
  active?: boolean;
  showOnCatalog?: boolean;
  salePrice?: number | null;
  salePromotionalPrice?: number | null;
  stock?: number | null;
  stockActive?: boolean;
  stockStatus?: string;
  image?: string;
  imageLarge?: string;
  imageMedium?: string;
  imageThumb?: string;
  category?: { name?: string };
  categories?: { name?: string }[];
  dateCreation?: string;
};

const KYTE_IMG = "https://firebasestorage.googleapis.com/v0/b/kyte-7c484.appspot.com/o";

function parseKyteProduct(html: string): KyteProduct | null {
  const start = html.indexOf('{\\"product\\":');
  if (start < 0) return null;
  // Recorta o objeto do produto contando chaves na string escapada.
  const slice = html.slice(start);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  const escaped = slice.slice(0, end);
  try {
    // O payload vem dentro de uma string JS escapada: desescapamos com JSON.parse.
    const inner = JSON.parse(`"${escaped}"`) as string;
    return (JSON.parse(inner) as { product?: KyteProduct }).product ?? null;
  } catch {
    return null;
  }
}

type KyteCategory = { name: string; externalId: string | null; url: string };

async function kyteCategories(): Promise<KyteCategory[]> {
  let html = "";
  try {
    html = await getHtmlViaReader(`${KYTE_BASE}/pt-BR`);
  } catch {
    return [];
  }
  const out = new Map<string, KyteCategory>();
  for (const m of html.matchAll(/href="(\/pt-BR\/c\/([^/"]+)\/([^"]+))"/g)) {
    const url = `${KYTE_BASE}${m[1]}`;
    out.set(url, {
      name: cleanText(decodeURIComponent(m[2] ?? "").replace(/-/g, " ")).toUpperCase(),
      externalId: m[3] ?? null,
      url,
    });
  }
  return Array.from(out.values());
}

let kyteUrlCache: { at: number; urls: string[]; categories: KyteCategory[] } | null = null;

/**
 * Descoberta do catálogo: junta o mapa do site com a listagem de cada categoria.
 * As duas fontes são incompletas sozinhas, então trabalhamos com a união delas.
 */
async function kyteDiscover(): Promise<{ urls: string[]; categories: KyteCategory[] }> {
  if (kyteUrlCache && Date.now() - kyteUrlCache.at < 15 * 60 * 1000) return kyteUrlCache;
  const urls = new Set<string>();

  try {
    const xml = await getHtml(`${KYTE_BASE}/sitemap.xml`);
    const found = [
      ...Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => (m[1] ?? "").trim()),
      ...Array.from(xml.matchAll(/href="(https:\/\/[^"]+)"/g)).map((m) => (m[1] ?? "").trim()),
    ];
    for (const u of found) if (u.includes("/p/")) urls.add(u.split("?")[0] as string);
  } catch {
    /* sem mapa do site: seguimos pelas categorias */
  }

  const categories = await kyteCategories();
  for (const c of categories) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let text = "";
      try {
        text = await getRenderedViaReader(c.url, 'a[href*="/p/"]');
      } catch {
        continue;
      }
      const links = Array.from(text.matchAll(/https:\/\/[a-z0-9.-]*kyte\.site\/(?:[a-z-]+\/)?p\/[^\s")]+/gi)).map(
        (m) => (m[0] ?? "").replace(/[).,]+$/, "").split("?")[0] as string,
      );
      links.forEach((u) => urls.add(u));
      if (links.length) break;
      await wait(1000);
    }
  }

  const result = { urls: Array.from(urls), categories };
  kyteUrlCache = { at: Date.now(), ...result };
  return result;
}

function kyteImageCandidates(p: KyteProduct): string[] {
  const path = (v?: string) => (v ? `${KYTE_IMG}${v}` : null);
  // A imagem original tem a melhor qualidade; as variantes "large_"/"midle_" nem sempre existem.
  return uniq([path(p.image), path(p.imageLarge), path(p.imageMedium), path(p.imageThumb)]);
}

/* ---- Catálogo oficial da Kyte (mesma API usada pela vitrine) ------- */

const KYTE_AID = "qVV6PVTC1YOmGL";
const KYTE_API = "https://kyte-query-public.kyte.site/api";
const KYTE_API_SECRET = "kyte_prod_9f2c6e1b8a4d5f7c3e0a9d2b6c8f1e4a7d5";

type KyteApiProduct = {
  id?: string;
  _id?: string;
  uid?: string;
  name?: string;
  code?: string;
  label?: string;
  active?: boolean;
  showOnCatalog?: boolean;
  salePrice?: number | null;
  salePromotionalPrice?: number | null;
  stock?: { current?: number | null } | number | null;
  stockActive?: boolean;
  stockStatus?: string;
  image?: string;
  imageLarge?: string;
  imageMedium?: string;
  imageThumb?: string;
  gallery?: { url?: string }[];
  category?: { name?: string };
  dateCreation?: string;
};

function kyteSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const kyteApiCache = new Map<string, { at: number; items: KyteApiProduct[] }>();

/** Lista o catálogo completo em uma única chamada (paginação server-side não é necessária). */
async function kyteFetchCatalog(aid: string = KYTE_AID): Promise<KyteApiProduct[]> {
  const hit = kyteApiCache.get(aid);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.items;
  const all: KyteApiProduct[] = [];
  // Paginação defensiva: pede páginas de 1000 até vir uma página incompleta.
  for (let page = 0; page < 10; page++) {
    const url = `${KYTE_API}/product/${aid}?limit=1000&skip=${page * 1000}&isCatalog=true&isFractioned=true&unavailableLast=true&sort=PIN_FIRST`;
    const res = await fetch(url, {
      headers: { "x-kyte-cdn-secret": KYTE_API_SECRET, accept: "application/json", "user-agent": UA },
    });
    if (!res.ok) throw new Error(`kyte api ${res.status}`);
    const json = (await res.json()) as { _products?: KyteApiProduct[] };
    const items = Array.isArray(json._products) ? json._products : [];
    const before = all.length;
    const seen = new Set(all.map((p) => p.id || p._id));
    for (const p of items) if (!seen.has(p.id || p._id)) all.push(p);
    if (items.length < 1000 || all.length === before) break;
  }
  if (!all.length) throw new Error("kyte api vazio");
  kyteApiCache.set(aid, { at: Date.now(), items: all });
  return all;
}

function kyteApiOffer(p: KyteApiProduct, base: string = KYTE_BASE): RawOffer | null {
  const rawName = cleanText(p.name);
  const id = p.id || p._id || null;
  if (!rawName || !id) return null;

  const dash = rawName.lastIndexOf(" - ");
  const name = dash > 3 ? rawName.slice(0, dash).trim() : rawName;
  const brand = dash > 3 ? rawName.slice(dash + 3).trim() : cleanText(p.label) || null;

  const stockRaw = typeof p.stock === "object" && p.stock ? p.stock.current : p.stock;
  const controlled = Boolean(p.stockActive) && p.stockStatus !== "NOT_CONTROLLED";
  const stock = controlled ? num(stockRaw) : null;
  const visible = p.active !== false && p.showOnCatalog !== false;

  const galleryPaths = (p.gallery ?? [])
    .map((g) => (g?.url && p.uid ? `${KYTE_IMG}/${encodeURIComponent(p.uid)}%2F${g.url}?alt=media` : null))
    .filter(Boolean) as string[];

  return {
    externalId: id,
    name,
    price: num(p.salePromotionalPrice ?? p.salePrice),
    rawPrice: num(p.salePromotionalPrice ?? p.salePrice),
    costSource: p.salePromotionalPrice != null ? "preco-promocional" : "preco-venda",
    inStock: visible && (!controlled || (stock ?? 0) > 0),
    stock,
    url: `${base}/pt-BR/p/${kyteSlug(rawName)}/${id}`,
    images: uniq([...kyteImageCandidates(p as KyteProduct), ...galleryPaths]),
    sku: p.code || id,
    brand,
    categories: [cleanText(p.category?.name)].filter(Boolean),
    sourceUpdatedAt: p.dateCreation ?? null,
  };
}

/** Descobre o identificador público da loja Kyte a partir da vitrine (sem burlar bloqueios). */
const kyteAidCache = new Map<string, string>();
async function kyteDiscoverAid(base: string): Promise<string | null> {
  const cached = kyteAidCache.get(base);
  if (cached) return cached;
  for (const url of [`${base}/pt-BR`, base]) {
    let html = "";
    try {
      html = await getHtml(url);
    } catch {
      try {
        html = await getHtmlViaReader(url);
      } catch {
        continue;
      }
    }
    const m = html.match(/\\?"aid\\?"\s*:\s*\\?"([A-Za-z0-9]{8,32})/);
    if (m?.[1]) {
      kyteAidCache.set(base, m[1]);
      return m[1];
    }
  }
  return null;
}

/**
 * Leitor genérico para lojas Kyte (Smart Mania, KL Cosméticos…).
 * Só muda o endereço da loja. Se a vitrine estiver protegida contra automação,
 * NÃO tentamos contornar: a sincronização fica "bloqueada" e o Admin usa a
 * atualização manual (colar/enviar lista de preços).
 */
export function makeKyteAdapter(opts: { key: string; label: string; base: string; aid?: string }): SupplierAdapter {
  return {
    key: opts.key,
    label: opts.label,
    async fetchBatch(cursor) {
      const aid = opts.aid ?? (await kyteDiscoverAid(opts.base));
      if (!aid) {
        throw new Error(
          "BLOQUEADO: a loja protege o catálogo contra leitura automática. Use a atualização manual (colar lista de preços).",
        );
      }
      const all = await kyteFetchCatalog(aid);
      const start = Math.max(0, cursor || 0);
      const CHUNK = 200;
      const items = all.slice(start, start + CHUNK).map((p) => kyteApiOffer(p, opts.base)).filter(Boolean) as RawOffer[];
      const next = start + CHUNK;
      return {
        items,
        nextCursor: next >= all.length ? null : next,
        cursorKind: "index",
        pages: 1,
        total: all.length,
        throttled: false,
        paymentDiscountPercent: 0,
      };
    },
  };
}

/** Coleta legada (mapa do site + páginas renderizadas). Só usada se a API oficial falhar. */
async function kyteScrapeBatch(cursor: number | null, budgetMs: number) {
  const { urls, categories } = await kyteDiscover();
  const started = Date.now();
  const items: RawOffer[] = [];
  let i = Math.max(0, cursor || 0);
  let pages = 0;
  let failures = 0;
  let throttled = false;

  while (i < urls.length && Date.now() - started < budgetMs) {
    const url = urls[i] as string;
    let html: string;
    try {
      html = await getHtml(url);
    } catch {
      failures++;
      if (failures >= 2) {
        throttled = true;
        break;
      }
      await wait(2000);
      continue;
    }
    i++;
    pages++;
    await wait(800);
    const p = parseKyteProduct(html);
    if (!p?.name) continue;
    const price = num(p.salePromotionalPrice ?? p.salePrice);
    const controlled = Boolean(p.stockActive) && p.stockStatus !== "NOT_CONTROLLED";
    const stock = controlled ? num(p.stock) : null;
    const visible = p.active !== false && p.showOnCatalog !== false;
    const rawName = cleanText(p.name);
    const dash = rawName.lastIndexOf(" - ");
    const kyteBrand = dash > 3 ? rawName.slice(dash + 3).trim() : null;
    const cleanName = dash > 3 ? rawName.slice(0, dash).trim() : rawName;
    const cats = [p.category?.name, ...(p.categories ?? []).map((c) => c?.name)]
      .map((c) => cleanText(c))
      .filter(Boolean);
    items.push({
      externalId: p.id || url,
      name: cleanName,
      price,
      rawPrice: price,
      costSource: "preco-venda",
      inStock: visible && (!controlled || (stock ?? 0) > 0),
      stock,
      url,
      images: kyteImageCandidates(p),
      sku: p.code || p.id || null,
      brand: kyteBrand,
      categories: Array.from(new Set(cats)),
      sourceUpdatedAt: p.dateCreation ?? null,
    });
  }

  return {
    items,
    nextCursor: i >= urls.length ? null : i,
    pages,
    total: urls.length,
    throttled,
    categories: categories.map((c) => ({ name: c.name, externalId: c.externalId, url: c.url })),
  };
}

const smartManiaAdapter: SupplierAdapter = {
  key: "smart-mania",
  label: "Smart Mania",
  async fetchBatch(cursor, budgetMs) {
    try {
      const all = await kyteFetchCatalog();
      const start = Math.max(0, cursor || 0);
      const CHUNK = 200;
      const slice = all.slice(start, start + CHUNK);
      const items = slice.map((p) => kyteApiOffer(p)).filter(Boolean) as RawOffer[];
      const next = start + CHUNK;
      const cats = new Map<string, { name: string; externalId: string | null; url: string }>();
      for (const p of all) {
        const name = cleanText(p.category?.name);
        if (name && !cats.has(name)) cats.set(name, { name, externalId: null, url: `${KYTE_BASE}/pt-BR` });
      }
      return {
        items,
        nextCursor: next >= all.length ? null : next,
        pages: 1,
        total: all.length,
        throttled: false,
        paymentDiscountPercent: 0,
        categories: Array.from(cats.values()),
      };
    } catch {
      return kyteScrapeBatch(cursor, budgetMs);
    }
  },
};


/* ------------------------------------------------------------------ */
/* Loja Integrada — qualquer loja (ex.: Rasha Fragrâncias)             */
/* Listagem "/todos-os-produtos?pagina=N", um bloco .listagem-item por */
/* produto. Usada como fornecedor de CONSULTA: o preço lido é só       */
/* referência interna (pode ser atacado) e nunca vira preço do site.   */
/* ------------------------------------------------------------------ */

const LI_PAGES_PER_BATCH = 2;
const LI_MAX_PAGES = 80;
// robots.txt da Loja Integrada pede 10 s entre páginas.
const LI_PAGE_DELAY_MS = 10_000;

const htmlDecode = (v: string) =>
  v
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

/** A CDN da Loja Integrada usa o tamanho no caminho (/300x300/): pedimos o maior. */
function liImageCandidates(src: string | null | undefined): string[] {
  if (!src) return [];
  const url = src.startsWith("//") ? `https:${src}` : src;
  const big = url.replace(/\/\d{2,4}x\d{2,4}\//, "/1000x1000/");
  return uniq([big, url]);
}

function parseLojaIntegradaList(html: string, base: string): RawOffer[] {
  const out: RawOffer[] = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\blistagem-item\b/).slice(1);
  for (const raw of blocks) {
    const block = raw.slice(0, 6000);
    const anchor = block.match(/<a\b[^>]*\bproduto-sobrepor\b[^>]*>/)?.[0] ?? block.match(/<a\b[^>]*\bnome-produto\b[^>]*>/)?.[0] ?? "";
    let url = anchor.match(/href="([^"]+)"/)?.[1] ?? null;
    if (url && url.startsWith("/")) url = `${base}${url}`;
    const name = cleanText(
      htmlDecode(
        anchor.match(/title="([^"]+)"/)?.[1] ??
          block.match(/class="[^"]*\bnome-produto\b[^"]*"[^>]*>([\s\S]*?)<\/a>/)?.[1]?.replace(/<[^>]+>/g, " ") ??
          block.match(/<img[^>]+alt="([^"]+)"/)?.[1] ??
          "",
      ),
    );
    if (!name || !url) continue;
    const img = block.match(/data-imagem-caminho="([^"]+)"/)?.[1] ?? block.match(/<img[^>]+src="((?:https?:)?\/\/cdn\.awsli\.com\.br[^"]+)"/)?.[1] ?? null;
    const sell = block.match(/data-sell-price="([\d.]+)"/)?.[1];
    const promo = block.match(/class="[^"]*\bpreco-promocional\b[^"]*"[^>]*>\s*R\$\s*([\d.]+,\d{2})/)?.[1];
    const any = block.match(/R\$\s*([\d.]+,\d{2})/)?.[1];
    const price = sell ? Number(sell) : brlNumber(promo ?? any ?? null);
    const id =
      block.match(/data-produto-id="(\d+)"/)?.[1] ??
      block.match(/trustvox-product-code="(\d+)"/)?.[1] ??
      img?.match(/\/produto\/(\d+)\//)?.[1] ??
      url.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() ??
      name;
    const unavailable = /\bindisponivel\b|bandeira-indisponivel|Indispon[ií]vel|Esgotado/i.test(block);
    out.push({
      externalId: String(id),
      name,
      price: price && price > 0 ? price : null,
      rawPrice: price && price > 0 ? price : null,
      costSource: "referencia-consulta",
      inStock: !unavailable,
      stock: null,
      url,
      images: liImageCandidates(img),
      sku: block.match(/class="[^"]*\bproduto-sku\b[^"]*"[^>]*>([^<]+)</)?.[1]?.trim() ?? null,
      brand: null,
      categories: [],
      sourceUpdatedAt: null,
      availabilityStatus: unavailable ? "UNAVAILABLE" : "AVAILABLE",
    });
  }
  // Tema sem .listagem-item: tenta os dados estruturados (JSON-LD) da página.
  if (!out.length) {
    for (const p of parseLdProducts(html)) {
      if (!p.name) continue;
      const price = num(p.offers?.price);
      out.push({
        externalId: String(p.sku ?? p.offers?.url ?? p.name),
        name: cleanText(p.name),
        price,
        rawPrice: price,
        costSource: "referencia-consulta",
        inStock: inStockFrom(p.offers?.availability),
        stock: null,
        url: p.offers?.url ?? null,
        images: liImageCandidates(typeof p.image === "string" ? p.image : null),
        sku: p.sku ?? null,
        brand: p.brand?.name ?? null,
        categories: p.category ? [p.category] : [],
        sourceUpdatedAt: null,
      });
    }
  }
  return out;
}

export function makeLojaIntegradaAdapter(opts: { key: string; label: string; base: string }): SupplierAdapter {
  const base = opts.base.replace(/\/+$/, "");
  const listUrl = (page: number) => `${base}/todos-os-produtos${page > 1 ? `?pagina=${page}` : ""}`;
  return {
    key: opts.key,
    label: opts.label,
    async fetchBatch(cursor, budgetMs) {
      const started = Date.now();
      const items: RawOffer[] = [];
      let page = Math.max(1, cursor || 1);
      let pages = 0;
      let done = false;
      const seen = new Set<string>();
      while (Date.now() - started < budgetMs && page <= LI_MAX_PAGES && pages < LI_PAGES_PER_BATCH) {
        let html: string;
        try {
          html = await getHtml(listUrl(page));
        } catch (e) {
          // A loja bloqueia leitura automática das páginas seguintes (HTTP 403).
          // Fica com o que já veio (a 1ª página = lançamentos) e encerra sem erro.
          if (items.length) {
            done = true;
            break;
          }
          throw e;
        }
        const found = parseLojaIntegradaList(html, base).filter((o) => !seen.has(o.externalId));
        pages++;
        if (!found.length) {
          done = true;
          break;
        }
        found.forEach((o) => seen.add(o.externalId));
        items.push(...found);
        // sem link para a próxima página: acabou
        if (!new RegExp(`pagina=${page + 1}\\b`).test(html)) {
          done = true;
          break;
        }
        page++;
        await wait(LI_PAGE_DELAY_MS);
      }
      return { items, nextCursor: done || page > LI_MAX_PAGES ? null : page, pages, total: null };
    },
    async healthCheck() {
      const t0 = Date.now();
      try {
        const html = await getHtml(listUrl(1), 2);
        const offers = parseLojaIntegradaList(html, base);
        return {
          ok: offers.length > 0,
          sourceAccessible: true,
          catalogDetected: offers.length > 0,
          productsDetected: offers.length,
          pricesDetected: offers.filter((o) => o.price != null).length,
          code: offers.length ? null : "NO_PRODUCTS",
          message: offers.length ? `${offers.length} produtos na primeira página.` : "A página abriu, mas nenhum produto foi reconhecido.",
          durationMs: Date.now() - t0,
        };
      } catch (e) {
        return {
          ok: false,
          sourceAccessible: false,
          catalogDetected: false,
          productsDetected: 0,
          pricesDetected: 0,
          code: "UNREACHABLE",
          message: e instanceof Error ? e.message : "Loja indisponível.",
          durationMs: Date.now() - t0,
        };
      }
    },
  };
}


const ADAPTERS: SupplierAdapter[] = [mrxAdapter, smartManiaAdapter, KLCosmeticosAdapter];

export function getAdapter(supplier: { slug?: string | null; adapter?: string | null; website?: string | null; name?: string | null; adapter_config?: unknown }) {
  // Fornecedores adicionados pela Central (qualquer loja Kyte) usam o conector genérico.
  if (supplier.adapter === "kyte-connector" && supplier.website) {
    const cfg = (supplier.adapter_config ?? {}) as { aid?: string | null };
    return makeKyteConnector({ key: supplier.slug ?? "kyte", label: supplier.name ?? "Kyte", base: supplier.website.replace(/\/(pt-BR)?\/?$/, ""), aid: cfg.aid ?? null });
  }
  // Lojas Loja Integrada (ex.: Rasha) — conector genérico pela listagem pública.
  if (supplier.adapter === "loja-integrada" && supplier.website) {
    return makeLojaIntegradaAdapter({ key: supplier.slug ?? "loja-integrada", label: supplier.name ?? "Loja Integrada", base: supplier.website });
  }
  const keys = [supplier.adapter, supplier.slug].filter(Boolean).map((k) => String(k).toLowerCase());
  const direct = ADAPTERS.find((a) => keys.includes(a.key));
  if (direct) return direct;
  const site = (supplier.website ?? "").toLowerCase();
  if (site.includes("mrxperfumaria")) return mrxAdapter;
  if (site.includes("smartmania")) return smartManiaAdapter;
  if (site.includes("klcosmeticos")) return KLCosmeticosAdapter;
  return null;
}

/** Verifica se uma imagem existe de verdade e tem tamanho aceitável. */
export async function verifyImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "image/*" } });
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return false;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len && len < 3000) return false;
    if (/logo|favicon|banner|placeholder|sprite|icon/i.test(url)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Escolhe a melhor imagem que realmente carrega, na ordem de qualidade. */
export async function pickBestImage(candidates: string[]): Promise<{ best: string | null; valid: string[] }> {
  const valid: string[] = [];
  for (const url of candidates.slice(0, 4)) {
    if (await verifyImage(url)) valid.push(url);
    if (valid.length >= 2) break;
  }
  return { best: valid[0] ?? null, valid };
}
