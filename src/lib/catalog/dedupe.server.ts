/**
 * Product Identity & Deduplicação da Orium.
 *
 * Objetivo: dois registros que representam EXATAMENTE o mesmo perfume/variante
 * viram UM produto canônico com várias ofertas de fornecedor. Flankers, volumes
 * e concentrações diferentes continuam produtos separados.
 *
 * Sinais usados: marca normalizada, nome normalizado, versão (flanker),
 * concentração, volume, apelidos e assinatura da foto do frasco.
 * A foto NUNCA decide sozinha — ela só reforça marca + nome + variante.
 */
import { createHash } from "crypto";
import { flat } from "./classify";
import { flankerDifference, flankerTerms, stripConcentrationPhrases } from "./flankers";
import { brandKey } from "@/lib/suppliers/normalize.server";

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export type DuplicateLevel = "HIGH_CONFIDENCE_DUPLICATE" | "REVIEW_REQUIRED" | "NOT_DUPLICATE";

/** Palavras que não identificam a fragrância (ruído comercial/categoria/volume). */
const NOISE = new Set([
  "perfume",
  "perfumes",
  "perfumaria",
  "masculino",
  "masculina",
  "feminino",
  "feminina",
  "unissex",
  "unisex",
  "arabe",
  "arabes",
  "importado",
  "importada",
  "original",
  "originais",
  "lacrado",
  "lacrada",
  "novo",
  "nova",
  "promocao",
  "oferta",
  "atacado",
  "varejo",
  "pronta",
  "entrega",
  "eau",
  "de",
  "du",
  "da",
  "do",
  "des",
  "the",
  "la",
  "le",
  "les",
  "of",
  "for",
  "and",
  "e",
  "y",
  "spray",
  "vaporisateur",
  "edp",
  "edt",
  "edc",
  "toilette",
  "ml",
  "g",
]);

/**
 * Tokens significativos do nome, sem marca, ruído nem volume.
 *
 * Palavras de versão (Elixir, Parfum, Extrait…) NÃO são removidas: elas são o
 * que diferencia Yara de Yara Elixir. Só a concentração escrita por extenso
 * ("Eau de Parfum", "EDP") sai do nome.
 */
export function nameTokens(name: string, brand?: string | null): string[] {
  const brandWords = new Set(
    flat(brand ?? "")
      .split(" ")
      .filter(Boolean),
  );
  return flat(stripConcentrationPhrases(name ?? ""))
    .replace(/\b\d{1,4}\s?(ml|g)\b/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter((w) => w && !NOISE.has(w) && !brandWords.has(w) && !/^\d+(ml|g)$/.test(w));
}

/** Nome comparável: tokens significativos em ordem alfabética. */
export const nameKey = (name: string, brand?: string | null) =>
  Array.from(new Set(nameTokens(name, brand)))
    .sort()
    .join(" ");

export type IdentityParts = {
  brand: string | null;
  name: string;
  flanker?: string | null | undefined;
  concentration?: string | null | undefined;
  volumeMl?: number | null;
  productType?: string | null;
};

/**
 * Chave de identidade: marca + nome + versão + concentração + volume + tipo.
 * Mesma chave = mesmo produto. É ela que evita recriar duplicados na sincronização.
 */
export function identityKeyOf(p: IdentityParts): string {
  const nk = nameKey(p.name, p.brand);
  const fl = flat(p.flanker ?? "").replace(/\s+/g, "");
  const key = [
    brandKey(p.brand ?? "") || "sem-marca",
    nk.replace(/\s+/g, "-") || "sem-nome",
    fl && !nk.includes(flat(p.flanker ?? "")) ? fl : "-",
    (p.concentration ?? "-").toUpperCase(),
    p.volumeMl ?? "-",
    p.productType ?? "UNKNOWN",
  ].join("|");
  return key;
}

/** Coeficiente de Dice sobre bigramas — similaridade textual tolerante a grafia. */
export function dice(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.replace(/\s+/g, "");
    const out = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  };
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return (2 * inter) / (ga.size + gb.size);
}

export type DupProduct = {
  id: string;
  canonical_name: string;
  brand: string | null;
  brand_id?: string | null;
  flanker?: string | null;
  concentration: string | null;
  volume_ml: number | null;
  product_type: string;
  image_url: string | null;
  image_signature?: string | null;
  search_aliases?: string[] | null;
  identity_key?: string | null;
  created_at?: string;
  in_stock?: boolean | null;
  canonical_identity_locked?: boolean | null;
  identity_verified?: boolean | null;
};

export type DuplicateVerdict = {
  level: DuplicateLevel;
  score: number;
  signals: Record<string, unknown>;
};

const aliasKeys = (p: DupProduct) =>
  new Set((p.search_aliases ?? []).map((a) => nameKey(a, p.brand)).filter(Boolean));

/**
 * Compara dois produtos com todos os sinais.
 * Diferença de flanker, volume ou concentração encerra a comparação: são produtos diferentes.
 */
export function compareProducts(a: DupProduct, b: DupProduct): DuplicateVerdict {
  const signals: Record<string, unknown> = {};
  if (a.id === b.id) return { level: "NOT_DUPLICATE", score: 0, signals };
  if (a.product_type !== b.product_type)
    return { level: "NOT_DUPLICATE", score: 0, signals: { tipo: "diferente" } };

  const ka = brandKey(a.brand ?? "");
  const kb = brandKey(b.brand ?? "");
  const sameBrand = Boolean(ka && kb && ka === kb);
  const brandMissing = !ka || !kb;
  if (!sameBrand && !brandMissing)
    return { level: "NOT_DUPLICATE", score: 0, signals: { marca: "diferente" } };
  signals["marca"] = sameBrand ? "igual" : "faltando em um dos lados";

  // volume e concentração: divergência explícita separa os produtos
  if (a.volume_ml && b.volume_ml && a.volume_ml !== b.volume_ml)
    return { level: "NOT_DUPLICATE", score: 0, signals: { volume: "diferente" } };
  if (a.concentration && b.concentration && a.concentration !== b.concentration)
    return { level: "NOT_DUPLICATE", score: 0, signals: { concentracao: "diferente" } };

  const na = nameKey(a.canonical_name, a.brand);
  const nb = nameKey(b.canonical_name, b.brand);
  if (!na || !nb) return { level: "NOT_DUPLICATE", score: 0, signals: { nome: "vazio" } };

  // Versão/flanker tem peso alto: Yara ≠ Yara Elixir, Asad ≠ Asad Bourbon.
  // Basta um lado ter a palavra de versão para os produtos ficarem separados.
  const flankerDiff = flankerDifference(
    `${a.canonical_name} ${a.flanker ?? ""}`,
    `${b.canonical_name} ${b.flanker ?? ""}`,
  );
  if (flankerDiff.length > 0)
    return {
      level: "NOT_DUPLICATE",
      score: 0,
      signals: { versao: "diferente", diferenca: flankerDiff },
    };
  signals["versao"] = flankerTerms(a.canonical_name).join(" ") || "sem versão";

  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const extraA = [...ta].filter((t) => !tb.has(t));
  const extraB = [...tb].filter((t) => !ta.has(t));

  // Palavra significativa a mais em um dos lados = flanker/versão diferente
  // (Asad ≠ Asad Bourbon, Fakhar Black ≠ Fakhar Rose, Yara ≠ Yara Moi).
  const extraSignificant = [...extraA, ...extraB].filter((t) => t.length >= 3 || /^\d/.test(t));
  const sameName = na === nb;
  const aliasHit = !sameName && ([...aliasKeys(a)].includes(nb) || [...aliasKeys(b)].includes(na));

  if (!sameName && !aliasHit && extraSignificant.length > 0) {
    return {
      level: "NOT_DUPLICATE",
      score: 0,
      signals: { nome: "versão/flanker diferente", diferenca: extraSignificant },
    };
  }

  const textual = dice(na, nb);
  let score = sameName ? 0.62 : aliasHit ? 0.58 : textual >= 0.92 ? 0.5 : 0;
  if (score === 0)
    return {
      level: "NOT_DUPLICATE",
      score: 0,
      signals: { nome: "diferente", similaridade: textual },
    };
  signals["nome"] = sameName ? "igual" : aliasHit ? "apelido equivalente" : "muito parecido";
  signals["similaridade"] = Number(textual.toFixed(3));

  if (a.concentration && b.concentration) score += 0.1;
  signals["concentracao"] =
    a.concentration && b.concentration ? "igual" : "faltando em um dos lados";
  if (a.volume_ml && b.volume_ml) score += 0.1;
  signals["volume"] = a.volume_ml && b.volume_ml ? "igual" : "faltando em um dos lados";
  if (sameBrand) score += 0.08;

  const sameImage = Boolean(
    a.image_signature && b.image_signature && a.image_signature === b.image_signature,
  );
  const sameImageUrl = Boolean(a.image_url && b.image_url && a.image_url === b.image_url);
  if (sameImage || sameImageUrl) {
    score += 0.2;
    signals["foto"] = "muito semelhante";
  } else if (a.image_signature && b.image_signature) {
    signals["foto"] = "diferente";
  } else {
    signals["foto"] = "sem comparação";
  }

  score = Math.min(1, Number(score.toFixed(3)));

  /**
   * Alta confiança = EXATAMENTE o mesmo perfume: mesma marca, mesmo nome/versão,
   * mesma concentração e mesmo volume (ambos informados). Se faltar volume ou
   * concentração em algum lado, vai para revisão — a foto sozinha não decide.
   */
  const sameVolume = Boolean(a.volume_ml && b.volume_ml && a.volume_ml === b.volume_ml);
  const sameConcentration = Boolean(
    a.concentration && b.concentration && a.concentration === b.concentration,
  );
  const high = sameName && sameBrand && sameVolume && sameConcentration;
  if (!high && (sameName || aliasHit)) {
    if (!sameVolume) signals["volume"] = "não confirmado nos dois lados";
    if (!sameConcentration) signals["concentracao"] = "não confirmada nos dois lados";
  }

  return {
    level: high ? "HIGH_CONFIDENCE_DUPLICATE" : score >= 0.6 ? "REVIEW_REQUIRED" : "NOT_DUPLICATE",
    score,
    signals,
  };
}

/** Assinatura da foto do frasco (hash do arquivo) — sinal adicional de duplicidade. */
export async function imageSignature(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 512) return null;
    return `${createHash("sha1").update(buf).digest("hex")}`;
  } catch {
    return null;
  }
}

/** Escolhe o melhor produto canônico do grupo (identidade travada, foto, dados e histórico). */
export function pickWinner(group: DupProduct[]): DupProduct {
  return [...group].sort((a, b) => {
    const lock = Number(!!b.canonical_identity_locked) - Number(!!a.canonical_identity_locked);
    if (lock) return lock;
    const verified = Number(!!b.identity_verified) - Number(!!a.identity_verified);
    if (verified) return verified;
    const img = Number(!!b.image_url) - Number(!!a.image_url);
    if (img) return img;
    const stock = Number(!!b.in_stock) - Number(!!a.in_stock);
    if (stock) return stock;
    const brand = Number(!!b.brand) - Number(!!a.brand);
    if (brand) return brand;
    const older = (a.created_at ?? "").localeCompare(b.created_at ?? "");
    if (older) return older;
    return a.id.localeCompare(b.id);
  })[0]!;
}

/**
 * Une o duplicado no produto canônico preservando tudo que é útil:
 * ofertas, custos, estoque, apelidos, histórico, visualizações, favoritos,
 * dados olfativos, pedidos, reposição e promoções.
 * Registra a unificação para a próxima sincronização não recriar o duplicado.
 */
export async function mergeInto(
  db: Db,
  keepId: string,
  dropId: string,
  meta: { score?: number; signals?: Record<string, unknown>; by?: string | null } = {},
) {
  if (keepId === dropId) return;

  const [{ data: keep }, { data: drop }] = await Promise.all([
    db.from("products").select("*").eq("id", keepId).maybeSingle(),
    db.from("products").select("*").eq("id", dropId).maybeSingle(),
  ]);
  if (!keep || !drop) return;

  // ofertas dos fornecedores: NUNCA apagadas, apenas reapontadas
  await db.from("supplier_products").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("restock_items").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("catalog_order_items").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("cart_items").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("product_views").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("product_identity_history").update({ product_id: keepId }).eq("product_id", dropId);
  await db
    .from("back_in_stock_subscriptions")
    .update({ product_id: keepId })
    .eq("product_id", dropId);
  await db
    .from("back_in_stock_notifications")
    .update({ product_id: keepId })
    .eq("product_id", dropId);

  // favoritos: mantém um por cliente
  const { data: dropFavs } = await db
    .from("favorites")
    .select("id, user_id, anonymous_id")
    .eq("product_id", dropId);
  for (const f of dropFavs ?? []) {
    // o dono pode ser uma conta ou o aparelho do visitante
    let q = db.from("favorites").select("id").eq("product_id", keepId);
    q = f.user_id ? q.eq("user_id", f.user_id) : q.eq("anonymous_id", f.anonymous_id ?? "");
    const { data: exists } = await q.maybeSingle();
    if (exists) await db.from("favorites").delete().eq("id", f.id);
    else await db.from("favorites").update({ product_id: keepId }).eq("id", f.id);
  }

  // dados olfativos: só migram se o vencedor não tiver
  const { data: keepDetails } = await db
    .from("fragrance_details")
    .select("product_id")
    .eq("product_id", keepId)
    .maybeSingle();
  const { data: keepNotes } = await db
    .from("fragrance_notes")
    .select("id")
    .eq("product_id", keepId)
    .limit(1);
  const { data: keepAccords } = await db
    .from("fragrance_accords")
    .select("id")
    .eq("product_id", keepId)
    .limit(1);
  if (!keepDetails)
    await db.from("fragrance_details").update({ product_id: keepId }).eq("product_id", dropId);
  else await db.from("fragrance_details").delete().eq("product_id", dropId);
  if (!(keepNotes ?? []).length)
    await db.from("fragrance_notes").update({ product_id: keepId }).eq("product_id", dropId);
  else await db.from("fragrance_notes").delete().eq("product_id", dropId);
  if (!(keepAccords ?? []).length)
    await db.from("fragrance_accords").update({ product_id: keepId }).eq("product_id", dropId);
  else await db.from("fragrance_accords").delete().eq("product_id", dropId);
  await db.from("fragrance_audit_log").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("fragrantica_import_logs").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("fragrantica_search_log").update({ product_id: keepId }).eq("product_id", dropId);
  await db.from("product_identity_suggestions").delete().eq("product_id", dropId);
  await db.from("product_duplicates").delete().or(`product_a.eq.${dropId},product_b.eq.${dropId}`);

  // preferências de preço: a do vencedor manda
  const { data: keepOverride } = await db
    .from("pricing_overrides")
    .select("id")
    .eq("product_id", keepId)
    .maybeSingle();
  if (keepOverride) await db.from("pricing_overrides").delete().eq("product_id", dropId);
  else await db.from("pricing_overrides").update({ product_id: keepId }).eq("product_id", dropId);

  // promoções apontando para o duplicado passam a apontar para o canônico
  const { data: promos } = await db
    .from("promotions")
    .select("id, product_ids")
    .contains("product_ids", [dropId]);
  for (const promo of promos ?? []) {
    const ids = Array.from(
      new Set(((promo.product_ids as string[]) ?? []).map((id) => (id === dropId ? keepId : id))),
    );
    await db.from("promotions").update({ product_ids: ids }).eq("id", promo.id);
  }
  const { data: coupons } = await db
    .from("coupons")
    .select("id, product_ids")
    .contains("product_ids", [dropId]);
  for (const c of coupons ?? []) {
    const ids = Array.from(
      new Set(((c.product_ids as string[]) ?? []).map((id) => (id === dropId ? keepId : id))),
    );
    await db.from("coupons").update({ product_ids: ids }).eq("id", c.id);
  }

  // complementa o vencedor com o que só o duplicado tinha
  const aliases = Array.from(
    new Set(
      [
        ...((keep.search_aliases as string[] | null) ?? []),
        ...((drop.search_aliases as string[] | null) ?? []),
        drop.canonical_name,
      ].filter(Boolean),
    ),
  ).slice(0, 16);

  await db
    .from("products")
    .update({
      search_aliases: aliases,
      image_url: keep.image_url ?? drop.image_url,
      image_urls: keep.image_url ? keep.image_urls : drop.image_urls,
      image_signature: keep.image_signature ?? drop.image_signature,
      concentration: keep.concentration ?? drop.concentration,
      volume_ml: keep.volume_ml ?? drop.volume_ml,
      flanker: keep.flanker ?? drop.flanker,
      brand: keep.brand ?? drop.brand,
      brand_id: keep.brand_id ?? drop.brand_id,
      stock_quantity:
        Math.max(Number(keep.stock_quantity ?? 0), Number(drop.stock_quantity ?? 0)) ||
        keep.stock_quantity,
      in_stock: Boolean(keep.in_stock || drop.in_stock),
      updated_at: new Date().toISOString(),
    })
    .eq("id", keepId);

  await db.from("product_merges").insert({
    merged_product_id: dropId,
    canonical_product_id: keepId,
    identity_key:
      drop.identity_key ??
      identityKeyOf({
        brand: drop.brand,
        name: drop.canonical_name,
        flanker: drop.flanker,
        concentration: drop.concentration,
        volumeMl: drop.volume_ml,
        productType: drop.product_type,
      }),
    dedupe_key: drop.dedupe_key,
    merged_slug: drop.slug,
    merged_name: drop.canonical_name,
    score: meta.score ?? 1,
    signals: (meta.signals ?? {}) as never,
    created_by: meta.by ?? null,
  });

  await db.from("product_costs").delete().eq("product_id", dropId);
  await db.from("products").delete().eq("id", dropId);
  await db.rpc("recompute_product_pricing", { p_product_id: keepId });
}

/** Diferença entre dois conjuntos de versões — quanto menor, mais parecido. */
const flankerDistance = (offerName: string, productName: string) => {
  const a = new Set(flankerTerms(offerName));
  const b = new Set(flankerTerms(productName));
  let d = 0;
  for (const t of a) if (!b.has(t)) d++;
  for (const t of b) if (!a.has(t)) d++;
  return d;
};

export type UnmergeResult = {
  ok: boolean;
  motivo?: string;
  restauradoId?: string;
  nome?: string;
  ofertasMovidas?: number;
};

/**
 * Desfaz uma unificação errada (Yara × Yara Elixir): recria o produto separado e
 * devolve para ele as ofertas dos fornecedores cujo título traz aquela versão.
 *
 * Nada é apagado: preços, estoque, fotos, favoritos, visualizações, pedidos e
 * dados olfativos do produto que ficou continuam intactos.
 */
export async function unmergeProduct(db: Db, mergeId: string): Promise<UnmergeResult> {
  const { data: merge } = await db
    .from("product_merges")
    .select("id, merged_product_id, canonical_product_id, merged_name, merged_slug, dedupe_key")
    .eq("id", mergeId)
    .maybeSingle();
  if (!merge) return { ok: false, motivo: "Unificação não encontrada." };

  const { data: keep } = await db
    .from("products")
    .select("*")
    .eq("id", merge.canonical_product_id)
    .maybeSingle();
  if (!keep) return { ok: false, motivo: "Produto principal não existe mais." };

  const restoredName = (merge.merged_name ?? "").trim();
  if (!restoredName) return { ok: false, motivo: "Sem nome para restaurar." };

  const { data: offers } = await db
    .from("supplier_products")
    .select("id, supplier_product_name, volume_ml, concentration, image_url, price")
    .eq("product_id", keep.id);

  // Cada oferta volta para o nome cuja versão combina com o título do fornecedor.
  const toRestore = (offers ?? []).filter((o) => {
    const title = o.supplier_product_name ?? "";
    return (
      flankerDistance(title, restoredName) < flankerDistance(title, keep.canonical_name as string)
    );
  });
  if (!toRestore.length)
    return { ok: false, motivo: "Nenhuma oferta de fornecedor corresponde ao produto separado." };
  if (toRestore.length === (offers ?? []).length)
    return { ok: false, motivo: "Todas as ofertas correspondem ao produto separado." };

  const slugBase = merge.merged_slug ?? null;
  const { data: slugTaken } = slugBase
    ? await db.from("products").select("id").eq("slug", slugBase).maybeSingle()
    : { data: null };
  const slug = slugBase && !slugTaken ? slugBase : `${keep.slug}-${Math.random().toString(36).slice(2, 8)}`;

  const first = toRestore[0]!;
  const { data: created, error } = await db
    .from("products")
    .insert({
      id: merge.merged_product_id,
      canonical_name: restoredName,
      slug,
      brand: keep.brand,
      brand_id: keep.brand_id,
      product_type: keep.product_type,
      gender_norm: keep.gender_norm,
      concentration: first.concentration ?? keep.concentration,
      volume_ml: first.volume_ml ?? keep.volume_ml,
      image_url: first.image_url ?? keep.image_url,
      decant_available: keep.decant_available,
      active: keep.active,
      catalog_eligible: keep.catalog_eligible,
      in_stock: false,
      identity_status: "REVIEW_REQUIRED",
      dedupe_key: merge.dedupe_key,
      identity_key: identityKeyOf({
        brand: keep.brand,
        name: restoredName,
        flanker: null,
        concentration: first.concentration ?? keep.concentration,
        volumeMl: first.volume_ml ?? keep.volume_ml,
        productType: keep.product_type,
      }),
    })
    .select("id")
    .maybeSingle();
  if (error || !created) return { ok: false, motivo: "Não foi possível recriar o produto." };

  for (const o of toRestore) {
    await db.from("supplier_products").update({ product_id: created.id }).eq("id", o.id);
  }

  // O nome separado sai dos apelidos do produto que ficou.
  const aliases = ((keep.search_aliases as string[] | null) ?? []).filter(
    (a) => nameKey(a, keep.brand) !== nameKey(restoredName, keep.brand),
  );
  await db
    .from("products")
    .update({ search_aliases: aliases, updated_at: new Date().toISOString() })
    .eq("id", keep.id);

  await db.from("product_merges").delete().eq("id", merge.id);
  await db.rpc("recompute_product_pricing", { p_product_id: created.id });
  await db.rpc("recompute_product_pricing", { p_product_id: keep.id });

  return {
    ok: true,
    restauradoId: created.id,
    nome: restoredName,
    ofertasMovidas: toRestore.length,
  };
}
