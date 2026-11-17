/**
 * ORIUM COPILOT — superpoderes.
 *
 * Fotos (o Admin manda a foto e o Copilot reconhece/usa), pesquisa de perfume
 * na internet (volumetria, gênero, pirâmide, acordes, descrição), cadastro no
 * catálogo e na Negociação, edição de produto e de pedido, pagamento.
 *
 * Mesma regra de sempre: tudo que altera vira um cartão que o Admin confirma.
 * A prévia mostra exatamente o que vai mudar; a execução usa as mesmas
 * funções das telas do Admin (catálogo manual, edição de pedido, etc.).
 */
import type { UIMessage } from "ai";
import { brl, findOrder, needsProduct, resolveProduct, savePending, type CopilotCtx, type Proposal } from "./registry.server";

const MANUAL_ORIGINS = ["MANUAL", "WHATSAPP"];

export const POWER_TOOLS = new Set([
  "negotiation_create",
  "negotiation_delete",
  "catalog_create",
  "catalog_hide",
  "product_update",
  "product_restore",
  "order_edit",
  "order_payment",
]);

/* ─────────────────────────────── fotos ─────────────────────────────── */

export type CopilotPhoto = { index: number; mediaType: string; dataUrl: string };

/** Fotos das mensagens do Admin, da mais recente (1) para a mais antiga. */
export function collectPhotos(messages: UIMessage[], max = 6): CopilotPhoto[] {
  const out: CopilotPhoto[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < max; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const files = (m.parts as any[]).filter((p) => p?.type === "file" && /^image\//.test(p.mediaType ?? "") && /^data:image\//.test(p.url ?? ""));
    for (let j = files.length - 1; j >= 0 && out.length < max; j--) out.push({ index: out.length + 1, mediaType: files[j].mediaType, dataUrl: files[j].url });
  }
  return out;
}

/** A última mensagem do Admin tem foto? (escolhe o modelo com visão) */
export const lastUserHasPhoto = (messages: UIMessage[]) => {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return !!last && (last.parts as any[]).some((p) => p?.type === "file" && /^image\//.test(p.mediaType ?? ""));
};

function photoBytes(p: CopilotPhoto) {
  const b64 = p.dataUrl.split(",", 2)[1] ?? "";
  const bytes = Buffer.from(b64, "base64");
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("Foto muito grande.");
  const ext = /png/.test(p.mediaType) ? "png" : /webp/.test(p.mediaType) ? "webp" : "jpg";
  const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { bytes, ext, contentType };
}

/** Guarda a foto escolhida no armazenamento certo e devolve o caminho/URL. */
async function storePhoto(db: any, bucket: "produtos" | "negociacao", photo: CopilotPhoto): Promise<string> {
  const { bytes, ext, contentType } = photoBytes(photo);
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`Não consegui guardar a foto: ${error.message}`);
  return bucket === "produtos" ? `/api/public/produto-foto?path=${path}` : path;
}

const pickPhoto = (photos: CopilotPhoto[], n: number | null | undefined) => (n ? (photos.find((p) => p.index === n) ?? null) : null);

/* ─────────────────────────── pesquisa web ──────────────────────────── */

export type PerfumeResearch = {
  found: boolean;
  name: string;
  brand: string | null;
  concentration: string | null;
  volume_ml: number | null;
  sizes_ml: number[];
  gender: "MASCULINO" | "FEMININO" | "UNISSEX" | null;
  olfactory_family: string | null;
  accords: Array<{ name: string; intensity: number }>;
  top: string[];
  heart: string[];
  base: string[];
  description: string | null;
  year: number | null;
  perfumer: string | null;
  fragrantica_url: string | null;
  confidence: number;
  sources: string[];
};

const nullable = (t: string) => ({ type: [t, "null"] });
const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "name", "brand", "concentration", "volume_ml", "sizes_ml", "gender", "olfactory_family", "accords", "top", "heart", "base", "description", "year", "perfumer", "fragrantica_url", "confidence"],
  properties: {
    found: { type: "boolean" },
    name: { type: "string" },
    brand: nullable("string"),
    concentration: { type: ["string", "null"], enum: ["EDP", "EDT", "Extrait", "Parfum", "EDC", null] },
    volume_ml: nullable("number"),
    sizes_ml: { type: "array", items: { type: "number" } },
    gender: { type: ["string", "null"], enum: ["MASCULINO", "FEMININO", "UNISSEX", null] },
    olfactory_family: nullable("string"),
    accords: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "intensity"], properties: { name: { type: "string" }, intensity: { type: "number" } } },
    },
    top: { type: "array", items: { type: "string" } },
    heart: { type: "array", items: { type: "string" } },
    base: { type: "array", items: { type: "string" } },
    description: nullable("string"),
    year: nullable("number"),
    perfumer: nullable("string"),
    fragrantica_url: nullable("string"),
    confidence: { type: "number" },
  },
};

/** Página da Fragrantica (enorme) → só os trechos úteis: título, acordes (com força), resumo, pirâmide, perfumista. */
export function fragranticaExcerpt(md: string): string {
  const clean = (t: string) =>
    t
      .replace(/\[!\[[^\]]*\]\([^)]*\)\s*([^\]]+)\]\([^)]*\)/g, "$1, ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\((?!https:\/\/www\.fragrantica\.com\/accords-search)[^)]*\)/g, "$1")
      .replace(/\n{3,}/g, "\n\n");
  const win = (key: string, len: number, before = 0) => {
    const i = md.indexOf(key);
    return i >= 0 ? clean(md.slice(Math.max(0, i - before), i + len)) : "";
  };
  return [
    clean(md.slice(0, 500)),
    win("main accords", 900),
    win("Top notes are", 900, 450),
    win("#### Top Notes", 3200),
  ]
    .filter(Boolean)
    .join("\n---\n")
    .slice(0, 9000);
}

/** Pesquisa um perfume na internet (Fragrantica + outra fonte) e organiza a ficha em português. */
export async function researchPerfume(args: { name: string; brand: string | null; details?: string | null }): Promise<PerfumeResearch | { found: false; message: string }> {
  const { searchWeb, readSourceLong } = await import("@/lib/catalog/research.server");
  const { aiJson } = await import("@/lib/ai/engine.server");
  const who = `${args.brand ?? ""} ${args.name}`.replace(/\s+/g, " ").trim();
  if (who.length < 3) return { found: false, message: "Diga o nome (e, se souber, a marca) do perfume." };

  const results = [...(await searchWeb(`${who} fragrantica`))];
  let fr = results.find((r) => /fragrantica\./.test(r.domain) && /\/perfume\//.test(r.url));
  if (!fr) {
    results.push(...(await searchWeb(`${who} perfume notas`)));
    fr = results.find((r) => /fragrantica\./.test(r.domain) && /\/perfume\//.test(r.url));
  }
  const other =
    results.find((r) => /parfumo|basenotes|notino|sephora|fragrancex|perfumesclub|lattafa|armaf|afnan|rasasi|ajmal|maison/.test(r.domain)) ??
    results.find((r) => !/fragrantica|youtube|facebook|instagram|tiktok|mercadolivre|shopee|amazon/.test(r.domain));

  const pages: string[] = [];
  const sources: string[] = [];
  const reads = await Promise.all([fr ? readSourceLong(fr.url, 120000).then((t) => (t ? fragranticaExcerpt(t) : null)) : null, other ? readSourceLong(other.url, 6000) : null]);
  if (fr && reads[0]) {
    pages.push(`FONTE 1 (${fr.url}):\n${reads[0]}`);
    sources.push(fr.url);
  }
  if (other && reads[1]) {
    pages.push(`FONTE 2 (${other.url}):\n${reads[1]}`);
    sources.push(other.url);
  }
  const snippets = results.slice(0, 10).map((r) => `- ${r.title} (${r.domain}): ${r.snippet}`).join("\n");
  if (!pages.length && !snippets) return { found: false, message: `Não achei "${who}" na internet agora. Tente com a marca ou outro nome.` };

  const prompt = `Perfume pedido pelo Admin: "${who}".${args.details ? ` Detalhes vistos na foto/fala: ${args.details}.` : ""}

Use SOMENTE as fontes abaixo. Se não for o mesmo perfume, found=false.
Regras:
- name: nome oficial sem a marca e sem concentração (ex.: "Club de Nuit Intense Man").
- brand: marca oficial. concentration: EDP, EDT, Extrait, Parfum ou EDC.
- volume_ml: tamanho mais comum do frasco (ex.: 100). sizes_ml: tamanhos encontrados.
- gender: MASCULINO, FEMININO ou UNISSEX (como a fonte classifica; "for women and men" = UNISSEX).
- accords: até 8 acordes principais (a força vem do link "Search by accords": citrus=100&fruity=58… → intensidade = valor/100), EM PORTUGUÊS como "Amadeirado", "Doce", "Cítrico", "Âmbar", "Baunilha", "Frutado", "Aromático", "Floral Branco", "Especiarias Quentes", "Almiscarado", "Couro", "Oud", "Fumado"; intensity de 0.2 a 1 (o primeiro mais forte).
- top/heart/base: notas da pirâmide EM PORTUGUÊS DO BRASIL (ex.: Bergamota, Abacaxi, Groselha Preta, Bétula, Patchouli, Baunilha, Almíscar). Se a fonte não separa por nível, coloque tudo em heart.
- olfactory_family: família olfativa em português (ex.: "Âmbar Amadeirado").
- description: 3 a 4 frases em português, elegantes e vendedoras, sem exagero e sem inventar (como uma perfumaria de luxo descreveria). Não cite preço nem a fonte.
- confidence: 0 a 1.

${pages.join("\n\n")}

RESULTADOS DA BUSCA:
${snippets}`;

  const data = await aiJson<Omit<PerfumeResearch, "sources">>({
    feature: "catalog_research",
    profile: "copilot",
    system: "Você organiza fichas de perfumes para uma perfumaria brasileira. Responde só com o JSON pedido.",
    prompt,
    schema: { name: "ficha_perfume", schema: RESEARCH_SCHEMA },
  });
  return {
    ...data,
    fragrantica_url: data.fragrantica_url ?? fr?.url ?? null,
    accords: (data.accords ?? []).slice(0, 8),
    sources,
  };
}

/* ───────────────────────── ficha olfativa ──────────────────────────── */

type FragranceData = {
  description?: string | null;
  olfactory_family?: string | null;
  fragrantica_url?: string | null;
  accords?: Array<{ name: string; intensity?: number | null }>;
  top?: string[];
  heart?: string[];
  base?: string[];
};

const hasFragrance = (f: FragranceData) => !!(f.description || f.accords?.length || f.top?.length || f.heart?.length || f.base?.length);

async function writeFragrance(db: any, productId: string, f: FragranceData, userId: string) {
  const { matchNote } = await import("@/lib/catalog/fragrance.server");
  const { data: library } = await db.from("olfactory_notes").select("id, canonical_name, aliases, category");
  const rows = (library ?? []) as Array<{ id: string; canonical_name: string; aliases: string[] | null; category: string }>;
  const source = "Orium Copilot (pesquisa)";

  const accords = (f.accords ?? [])
    .map((a, i) => ({ product_id: productId, accord_name: a.name.trim(), intensity: Math.max(0.2, Math.min(1, Number(a.intensity) || 0.7)), position: i, source }))
    .filter((a) => a.accord_name.length > 1);

  const notes: any[] = [];
  for (const [level, list] of [["TOP", f.top ?? []], ["HEART", f.heart ?? []], ["BASE", f.base ?? []]] as const) {
    let pos = 0;
    for (const raw of list) {
      const label = String(raw).trim();
      if (label.length < 2) continue;
      let note = matchNote(label, rows as never) as (typeof rows)[number] | null;
      if (!note) {
        const { data: created } = await db
          .from("olfactory_notes")
          .insert({ canonical_name: label, aliases: [label.toLowerCase()], category: "outros" })
          .select("id, canonical_name, aliases, category")
          .maybeSingle();
        if (created) {
          note = created;
          rows.push(created);
        }
      }
      notes.push({ product_id: productId, note_id: note?.id ?? null, note_label: note?.canonical_name ?? label, pyramid_level: level, position: pos++, source });
    }
  }

  if (accords.length || f.accords) {
    await db.from("fragrance_accords").delete().eq("product_id", productId);
    if (accords.length) await db.from("fragrance_accords").insert(accords);
  }
  if (notes.length) {
    await db.from("fragrance_notes").delete().eq("product_id", productId);
    await db.from("fragrance_notes").insert(notes);
  }
  await db.from("fragrance_details").upsert(
    {
      product_id: productId,
      ...(f.description ? { description: f.description.trim(), description_source: "orium-copilot" } : {}),
      ...(f.olfactory_family ? { olfactory_family: f.olfactory_family.trim() } : {}),
      ...(f.fragrantica_url ? { fragrantica_url: f.fragrantica_url } : {}),
      status: accords.length && notes.length ? "completo" : "parcial",
      verified: true,
      verified_by: userId,
      locked: true,
      audit_status: "MANUALLY_VERIFIED",
      audited_at: new Date().toISOString(),
      confidence: 1,
      enriched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "product_id" },
  );
}

/* ─────────────────────────── Negociação ────────────────────────────── */

export type NegotiationCreateArgs = {
  name: string;
  brand: string | null;
  volume_ml: number | null;
  remaining_ml: number | null;
  condition_note: string | null;
  status: "AVAILABLE" | "NEGOTIATING" | "HIDDEN" | null;
  photo: number | null;
  description: string | null;
  olfactory_family: string | null;
  fragrantica_url: string | null;
  accords: Array<{ name: string; intensity: number }> | null;
  top: string[] | null;
  heart: string[] | null;
  base: string[] | null;
};

export async function proposeNegotiationCreate(ctx: CopilotCtx, a: NegotiationCreateArgs, photos: CopilotPhoto[], utterance: string | null): Promise<Proposal> {
  const name = (a.name ?? "").trim();
  if (name.length < 2) return { kind: "needs", message: "Qual o nome do perfume?" };
  if (a.remaining_ml != null && a.volume_ml && a.remaining_ml > a.volume_ml) return { kind: "needs", message: "O que resta não pode passar do tamanho do frasco." };
  const photo = pickPhoto(photos, a.photo);
  if (a.photo && !photo) return { kind: "needs", message: "Não encontrei essa foto na conversa. Mande a foto de novo." };
  const image = photo ? await storePhoto(ctx.adminDb, "negociacao", photo) : null;
  const { conditionFromMl } = await import("@/lib/negotiation");
  const condition = a.condition_note?.trim() || (a.remaining_ml != null && a.volume_ml ? conditionFromMl(a.remaining_ml, a.volume_ml) : "Praticamente cheio");
  const params = { ...a, name, condition_note: condition, image_path: image, status: a.status ?? "AVAILABLE" };
  return savePending(ctx, "negotiation_create", params, {
    name,
    brand: a.brand,
    volume_ml: a.volume_ml,
    remaining_ml: a.remaining_ml,
    condition,
    status: params.status,
    image: image ? `/api/public/negociacao-foto?path=${encodeURIComponent(image)}` : null,
    accords: (a.accords ?? []).slice(0, 6).map((x) => x.name),
    notes: { top: a.top ?? [], heart: a.heart ?? [], base: a.base ?? [] },
    description: a.description,
  }, utterance);
}

/* ──────────────────────────── catálogo ─────────────────────────────── */

export type CatalogCreateArgs = {
  name: string;
  brand: string;
  volume_ml: number | null;
  concentration: string | null;
  gender: "MASCULINO" | "FEMININO" | "UNISSEX" | null;
  sale_mode: "FULL" | "DECANT" | "BOTH" | null;
  visibility: "ATIVO" | "OCULTO" | "INDISPONIVEL" | null;
  retail_price: number | null;
  cost: number | null;
  stock: number | null;
  price_on_request: boolean | null;
  photo: number | null;
  description: string | null;
  olfactory_family: string | null;
  fragrantica_url: string | null;
  accords: Array<{ name: string; intensity: number }> | null;
  top: string[] | null;
  heart: string[] | null;
  base: string[] | null;
};

export async function proposeCatalogCreate(ctx: CopilotCtx, a: CatalogCreateArgs, photos: CopilotPhoto[], utterance: string | null): Promise<Proposal> {
  const name = (a.name ?? "").trim();
  const brand = (a.brand ?? "").trim();
  if (name.length < 2 || brand.length < 2) return { kind: "needs", message: "Preciso do nome e da marca do perfume." };
  const sale = a.sale_mode ?? "BOTH";
  const onRequest = a.price_on_request === true;
  if (sale !== "DECANT" && !onRequest && !(Number(a.retail_price) > 0) && !(Number(a.cost) > 0))
    return { kind: "needs", message: "Qual o preço de venda do frasco? (ou o custo, para eu calcular pela regra da loja, ou deixar sob consulta)", options: ["Sob consulta", "Só decant"] } as Proposal;

  // já existe no catálogo?
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const { data: same } = await ctx.adminDb.from("products").select("id, canonical_name, brand, image_url, volume_ml").ilike("canonical_name", `%${name.slice(0, 40)}%`).limit(8);
  const dup = (same ?? []).find((p: any) => norm(p.canonical_name) === norm(name) && norm(p.brand ?? "") === norm(brand));

  const photo = pickPhoto(photos, a.photo);
  if (a.photo && !photo) return { kind: "needs", message: "Não encontrei essa foto na conversa. Mande a foto de novo." };
  const image = photo ? await storePhoto(ctx.adminDb, "produtos", photo) : null;

  let retail = Number(a.retail_price) > 0 ? Number(a.retail_price) : null;
  let auto = false;
  if (!retail && Number(a.cost) > 0 && sale !== "DECANT" && !onRequest) {
    const { autoPricesFor } = await import("@/lib/manual-product.functions");
    const p = await autoPricesFor(Number(a.cost));
    if (p.retail) {
      retail = p.retail;
      auto = true;
    }
  }
  const params = { ...a, name, brand, sale_mode: sale, visibility: a.visibility ?? "ATIVO", image_url: image, retail_price: retail, auto_price: auto };
  return savePending(ctx, "catalog_create", params, {
    name,
    brand,
    volume_ml: a.volume_ml,
    concentration: a.concentration,
    gender: a.gender,
    sale_mode: sale,
    visibility: params.visibility,
    retail_price: onRequest ? null : retail,
    price_on_request: onRequest,
    auto_price: auto,
    cost: a.cost,
    stock: a.stock,
    image,
    accords: (a.accords ?? []).slice(0, 6).map((x) => x.name),
    notes: { top: a.top ?? [], heart: a.heart ?? [], base: a.base ?? [] },
    description: a.description,
    duplicate: dup ? { id: dup.id, name: dup.canonical_name, brand: dup.brand } : null,
  }, utterance);
}

/* ───────────────────────── editar produto ──────────────────────────── */

export type ProductUpdateArgs = {
  product_id: string | null;
  query: string | null;
  name: string | null;
  brand: string | null;
  volume_ml: number | null;
  concentration: string | null;
  gender: "MASCULINO" | "FEMININO" | "UNISSEX" | null;
  visibility: "ATIVO" | "OCULTO" | "INDISPONIVEL" | null;
  sale_mode: "FULL" | "DECANT" | "BOTH" | null;
  price_on_request: boolean | null;
  pinned: boolean | null;
  photo: number | null;
  description: string | null;
  olfactory_family: string | null;
  accords: Array<{ name: string; intensity: number }> | null;
  top: string[] | null;
  heart: string[] | null;
  base: string[] | null;
};

const PRODUCT_FIELDS = "id, canonical_name, brand, brand_id, volume_ml, concentration, gender, gender_norm, visibility_status, sale_mode, price_on_request, pinned_at, image_url, image_urls, source";

export async function proposeProductUpdate(ctx: CopilotCtx, a: ProductUpdateArgs, photos: CopilotPhoto[], utterance: string | null): Promise<Proposal> {
  const r = await resolveProduct(ctx, a.product_id, a.query);
  if (r.status !== "ok") return needsProduct(r);
  const { data: p } = await ctx.adminDb.from("products").select(PRODUCT_FIELDS).eq("id", r.product.id).single();
  const photo = pickPhoto(photos, a.photo);
  if (a.photo && !photo) return { kind: "needs", message: "Não encontrei essa foto na conversa. Mande a foto de novo." };

  const changes: Array<{ label: string; from: string; to: string }> = [];
  const patch: Record<string, unknown> = {};
  const set = (key: string, label: string, value: unknown, from: unknown, show = (v: unknown) => (v == null || v === "" ? "—" : String(v))) => {
    if (value == null) return;
    if (String(value) === String(from ?? "")) return;
    patch[key] = value;
    changes.push({ label, from: show(from), to: show(value) });
  };
  set("canonical_name", "Nome", a.name?.trim() || null, p.canonical_name);
  set("brand", "Marca", a.brand?.trim() || null, p.brand);
  set("volume_ml", "Volume", a.volume_ml, p.volume_ml, (v) => (v == null ? "—" : `${v} ml`));
  set("concentration", "Concentração", a.concentration, p.concentration);
  set("gender", "Gênero", a.gender, p.gender ?? p.gender_norm);
  set("visibility_status", "Situação", a.visibility, p.visibility_status, (v) => ({ ATIVO: "À venda", OCULTO: "Oculto", INDISPONIVEL: "Indisponível" })[String(v)] ?? String(v ?? "—"));
  set("sale_mode", "Venda", a.sale_mode, p.sale_mode, (v) => ({ FULL: "Só frasco", DECANT: "Só decant", BOTH: "Frasco e decant" })[String(v)] ?? String(v ?? "—"));
  set("price_on_request", "Sob consulta", a.price_on_request, p.price_on_request, (v) => (v ? "Sim" : "Não"));
  if (a.pinned != null && a.pinned !== !!p.pinned_at) changes.push({ label: "Fixado no topo", from: p.pinned_at ? "Sim" : "Não", to: a.pinned ? "Sim" : "Não" });

  const identity = ["canonical_name", "brand", "volume_ml", "concentration", "gender"].filter((k) => k in patch);
  if (identity.length && p.source !== "manual")
    return { kind: "needs", message: "Este perfume vem de fornecedor: nome, marca, volume e gênero vêm da sincronização. Posso mudar foto, descrição, situação, venda e notas." };

  const fragrance: FragranceData = { description: a.description, olfactory_family: a.olfactory_family, accords: a.accords ?? undefined, top: a.top ?? undefined, heart: a.heart ?? undefined, base: a.base ?? undefined };
  if (a.description) changes.push({ label: "Descrição", from: "atual", to: a.description.slice(0, 80) + (a.description.length > 80 ? "…" : "") });
  if (a.accords?.length) changes.push({ label: "Acordes", from: "atuais", to: a.accords.map((x) => x.name).slice(0, 5).join(", ") });
  if (a.top?.length || a.heart?.length || a.base?.length) changes.push({ label: "Pirâmide", from: "atual", to: [...(a.top ?? []), ...(a.heart ?? []), ...(a.base ?? [])].slice(0, 6).join(", ") });
  const image = photo ? await storePhoto(ctx.adminDb, "produtos", photo) : null;
  if (image) changes.push({ label: "Foto", from: "atual", to: "foto enviada" });
  if (!changes.length) return { kind: "needs", message: "Não vi nada para mudar. O que você quer alterar?" };

  const before = { ...p };
  return savePending(ctx, "product_update", { product_id: p.id, patch, pinned: a.pinned, image_url: image, fragrance: hasFragrance(fragrance) ? fragrance : null, before }, {
    product: { name: p.canonical_name, brand: p.brand, image: image ?? p.image_url },
    changes,
  }, utterance);
}

/* ───────────────────────── pedidos ─────────────────────────────────── */

export type OrderEditArgs = {
  order_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  fulfillment: "PICKUP" | "LOCAL" | "SHIPPING" | null;
  coupon_code: string | null;
  payment_method: "PIX" | "CARD" | null;
  delivery_date: string | null;
  delivery_time: string | null;
  add_items: Array<{ product_id: string | null; query: string | null; variant: "FRASCO" | "DECANT"; decant_ml: number | null; quantity: number; unit_price: number | null }> | null;
  remove_items: Array<{ product_id: string | null; query: string | null; variant: "FRASCO" | "DECANT" | null; decant_ml: number | null }> | null;
  set_quantity: Array<{ product_id: string | null; query: string | null; variant: "FRASCO" | "DECANT" | null; decant_ml: number | null; quantity: number }> | null;
};

const sameLine = (it: any, productId: string, variant: "FRASCO" | "DECANT" | null, ml: number | null) =>
  it.productId === productId && (variant == null || (variant === "DECANT" ? it.variant === "DECANT" && (ml == null || it.decantMl === ml) : it.variant === "FULL"));

export async function proposeOrderEdit(ctx: CopilotCtx, a: OrderEditArgs, utterance: string | null): Promise<Proposal> {
  const o = await findOrder(ctx.adminDb, a.order_number);
  if (!o) return { kind: "needs", message: `Não encontrei o pedido ${a.order_number}.` };
  const { data: rows } = await ctx.adminDb.from("catalog_order_items").select("id, product_id, variant, decant_ml, quantity, unit_sale_price").eq("order_id", o.id);
  const { data: head } = await ctx.adminDb.from("catalog_orders").select("order_origin, origin").eq("id", o.id).single();
  // pedido lançado à mão: o preço combinado de cada item continua valendo (igual à tela de edição)
  const manual = MANUAL_ORIGINS.includes(head?.order_origin ?? head?.origin ?? "");
  let items: any[] = (rows ?? [])
    .filter((i: any) => i.product_id)
    .map((i: any) => ({
      id: i.id,
      productId: i.product_id,
      variant: i.variant === "DECANT" ? "DECANT" : "FULL",
      decantMl: i.decant_ml ?? null,
      quantity: i.quantity,
      ...(manual ? { unitPrice: Number(i.unit_sale_price ?? 0) } : {}),
    }));

  for (const r of a.remove_items ?? []) {
    const res = await resolveProduct(ctx, r.product_id, r.query);
    if (res.status !== "ok") return needsProduct(res);
    const before = items.length;
    items = items.filter((it) => !sameLine(it, res.product.id, r.variant, r.decant_ml));
    if (items.length === before) return { kind: "needs", message: `${res.product.name} não está no pedido ${o.order_number}.` };
  }
  for (const r of a.set_quantity ?? []) {
    const res = await resolveProduct(ctx, r.product_id, r.query);
    if (res.status !== "ok") return needsProduct(res);
    const line = items.find((it) => sameLine(it, res.product.id, r.variant, r.decant_ml));
    if (!line) return { kind: "needs", message: `${res.product.name} não está no pedido ${o.order_number}.` };
    line.quantity = Math.max(1, Math.round(r.quantity));
  }
  for (const r of a.add_items ?? []) {
    const res = await resolveProduct(ctx, r.product_id, r.query);
    if (res.status !== "ok") return needsProduct(res);
    const variant = r.variant === "DECANT" ? "DECANT" : "FULL";
    if (variant === "DECANT" && ![2, 5, 10].includes(Number(r.decant_ml))) return { kind: "needs", message: "Qual o tamanho do decant?", options: ["2ml", "5ml", "10ml"] } as Proposal;
    const line = items.find((it) => it.productId === res.product.id && it.variant === variant && (variant === "FULL" || it.decantMl === r.decant_ml));
    if (line) line.quantity += Math.max(1, Math.round(r.quantity));
    else items.push({ productId: res.product.id, variant, decantMl: variant === "DECANT" ? Number(r.decant_ml) : null, quantity: Math.max(1, Math.round(r.quantity)), ...(r.unit_price != null ? { unitPrice: r.unit_price } : {}) });
  }

  const input: any = {
    orderId: o.id,
    items,
    ...(a.customer_name ? { customerName: a.customer_name } : {}),
    ...(a.customer_phone ? { customerPhone: a.customer_phone } : {}),
    ...(a.notes != null ? { notes: a.notes } : {}),
    ...(a.fulfillment ? { fulfillment: a.fulfillment } : {}),
    ...(a.coupon_code != null ? { couponCode: a.coupon_code || null } : {}),
    ...(a.payment_method ? { paymentMethod: a.payment_method } : {}),
  };
  const { runOrderEdit } = await import("@/lib/order-edit.functions");
  let summary: any;
  try {
    summary = await runOrderEdit(ctx.adminDb, { supabase: ctx.userDb, userId: ctx.userId }, { ...input, dryRun: true });
  } catch (e) {
    return { kind: "needs", message: e instanceof Error ? e.message : "Não consegui montar a edição." };
  }
  const delivery = a.delivery_date ? { date: a.delivery_date, time: a.delivery_time } : null;
  const nothing = !summary.added.length && !summary.removed.length && !summary.changed.length && !summary.fields.length && !delivery;
  if (nothing) return { kind: "needs", message: "Não vi nenhuma mudança no pedido. O que você quer alterar?" };
  return savePending(ctx, "order_edit", { input, delivery }, {
    order_number: o.order_number,
    customer: o.customer_name,
    added: summary.added,
    removed: summary.removed,
    changed: summary.changed,
    fields: summary.fields,
    before: summary.before.total,
    after: summary.payment?.finalTotal ?? summary.after.total,
    warnings: summary.warnings,
    delivery,
  }, utterance);
}

export async function proposeOrderPayment(ctx: CopilotCtx, a: { order_number: string; mode: "unpaid" | "deposit" | "paid" | "amount"; amount: number | null }, utterance: string | null): Promise<Proposal> {
  const o = await findOrder(ctx.adminDb, a.order_number);
  if (!o) return { kind: "needs", message: `Não encontrei o pedido ${a.order_number}.` };
  const { data: full } = await ctx.adminDb.from("catalog_orders").select("final_total, grand_total, sales_total, amount_paid, deposit_percent").eq("id", o.id).single();
  const total = Math.round(Number(full.final_total ?? full.grand_total ?? full.sales_total ?? 0) * 100) / 100;
  const before = Number(full.amount_paid ?? 0);
  const pct = Number(full.deposit_percent ?? 50);
  let after = a.mode === "unpaid" ? 0 : a.mode === "deposit" ? Math.round(total * pct) / 100 : a.mode === "paid" ? total : Math.max(0, Math.round(Number(a.amount ?? 0) * 100) / 100);
  after = Math.min(after, Math.max(total, before));
  if (after === before) return { kind: "needs", message: `O pedido ${o.order_number} já está com ${brl(before)} pago.` };
  return savePending(ctx, "order_payment", { order_id: o.id, before, after, total }, { order_number: o.order_number, customer: o.customer_name, total, before, after }, utterance);
}

/* ─────────────────────────── execução ──────────────────────────────── */

export async function runPower(ctx: CopilotCtx, tool: string, params: any): Promise<any> {
  const db = ctx.adminDb;
  switch (tool) {
    case "negotiation_create": {
      const { data: created, error } = await db
        .from("negotiation_items")
        .insert({
          name: params.name,
          brand: params.brand ?? null,
          volume_ml: params.volume_ml ? Math.round(params.volume_ml) : null,
          remaining_ml: params.remaining_ml != null ? Math.round(params.remaining_ml) : null,
          description: params.description ?? null,
          condition_note: params.condition_note,
          status: params.status ?? "AVAILABLE",
          show_when_negotiating: true,
          image_url: params.image_path ?? null,
          fragrantica_url: params.fragrantica_url ?? null,
          olfactory_family: params.olfactory_family ?? null,
          accords: params.accords ?? [],
          notes: [
            ...(params.top ?? []).map((l: string) => ({ level: "TOP", label: l })),
            ...(params.heart ?? []).map((l: string) => ({ level: "HEART", label: l })),
            ...(params.base ?? []).map((l: string) => ({ level: "BASE", label: l })),
          ],
          priority: 0,
          created_by: ctx.userId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const { ensureFragranceSubject } = await import("@/lib/negotiation.functions");
      const productId = await ensureFragranceSubject(db, created.id, { name: params.name, brand: params.brand ?? null, volume_ml: params.volume_ml ?? null, image_url: params.image_path ?? null });
      if (productId && hasFragrance(params)) await writeFragrance(db, productId, params, ctx.userId);
      return { id: created.id, name: params.name, undo: { tool: "negotiation_delete", params: { id: created.id, product_id: productId } } };
    }
    case "negotiation_delete": {
      await db.from("negotiation_items").delete().eq("id", params.id);
      if (params.product_id) {
        for (const t of ["fragrance_accords", "fragrance_notes", "fragrance_details"]) await db.from(t).delete().eq("product_id", params.product_id);
        await db.from("products").delete().eq("id", params.product_id);
      }
      return { deleted: params.id };
    }
    case "catalog_create": {
      const { data: b } = await db.from("brands").select("id").ilike("canonical_name", params.brand).limit(1).maybeSingle();
      const { saveManualCore } = await import("@/lib/manual-product.functions");
      const res = await saveManualCore(
        {
          name: params.name,
          brandId: b?.id ?? null,
          newBrandName: b?.id ? null : params.brand,
          volumeMl: params.volume_ml,
          concentration: params.concentration,
          gender: params.gender,
          description: params.description,
          saleMode: params.sale_mode,
          visibility: params.visibility,
          stockQuantity: params.stock ?? 0,
          manualPricing: !params.auto_price,
          cost: params.cost,
          retailPrice: params.auto_price ? null : params.retail_price,
          wholesalePrice: null,
          imageUrl: params.image_url,
          fragranticaUrl: params.fragrantica_url,
          priceOnRequest: params.price_on_request === true,
        },
        { userId: ctx.userId },
      );
      if (hasFragrance(params)) await writeFragrance(db, res.id, params, ctx.userId);
      const { data: p } = await db.from("products").select("slug").eq("id", res.id).maybeSingle();
      return { id: res.id, slug: p?.slug ?? null, name: params.name, undo: { tool: "catalog_hide", params: { id: res.id } } };
    }
    case "catalog_hide": {
      await db.from("products").update({ visibility_status: "OCULTO", updated_at: new Date().toISOString() }).eq("id", params.id);
      return { hidden: params.id };
    }
    case "product_update": {
      const patch: Record<string, unknown> = { ...params.patch, updated_at: new Date().toISOString() };
      if ("gender" in patch) patch.gender_norm = patch.gender;
      if ("canonical_name" in patch) patch.raw_name = patch.canonical_name;
      if (params.pinned != null) patch.pinned_at = params.pinned ? (params.before.pinned_at ?? new Date().toISOString()) : null;
      if (params.image_url) {
        patch.image_url = params.image_url;
        patch.image_urls = [params.image_url, ...((params.before.image_urls as string[] | null) ?? []).filter((u) => u !== params.image_url)].slice(0, 8);
      }
      if (patch.price_on_request === true) Object.assign(patch, { sale_mode: "FULL", decant_available: false });
      const { error } = await db.from("products").update(patch).eq("id", params.product_id);
      if (error) throw new Error(error.message);
      if (params.fragrance) await writeFragrance(db, params.product_id, params.fragrance, ctx.userId);
      const restore: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) if (k !== "updated_at" && k in params.before) restore[k] = params.before[k];
      if ("gender" in patch) restore.gender_norm = params.before.gender_norm;
      return { name: params.before.canonical_name, undo: { tool: "product_restore", params: { product_id: params.product_id, restore } } };
    }
    case "product_restore": {
      const { error } = await db.from("products").update({ ...params.restore, updated_at: new Date().toISOString() }).eq("id", params.product_id);
      if (error) throw new Error(error.message);
      return { restored: params.product_id };
    }
    case "order_edit": {
      const { runOrderEdit } = await import("@/lib/order-edit.functions");
      const summary = await runOrderEdit(db, { supabase: ctx.userDb, userId: ctx.userId }, { ...params.input, dryRun: false, force: true });
      if (params.delivery?.date) {
        await db
          .from("catalog_orders")
          .update({ expected_delivery_date: params.delivery.date, expected_delivery_time: params.delivery.time ?? null, updated_at: new Date().toISOString() })
          .eq("id", params.input.orderId);
      }
      return { total: summary.payment?.finalTotal ?? summary.after.total, warnings: summary.warnings };
    }
    case "order_payment": {
      await db.from("catalog_orders").update({ amount_paid: params.after, updated_at: new Date().toISOString() }).eq("id", params.order_id);
      const delta = Math.round((params.after - params.before) * 100) / 100;
      const event = delta < 0 ? "pagamento_estornado" : params.after >= params.total ? (params.before > 0 ? "pagamento_saldo" : "pagamento_integral") : "pagamento_sinal";
      await db
        .from("order_events")
        .insert({ order_id: params.order_id, event, created_by: ctx.userId, details: { amount: delta, before: params.before, after: params.after, total: params.total, origin: "copilot" } })
        .then(() => null, () => null);
      return { after: params.after, undo: { tool: "order_payment", params: { ...params, before: params.after, after: params.before } } };
    }
    default:
      throw new Error("Ação desconhecida.");
  }
}
