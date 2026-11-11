/**
 * PerfumeEnrichmentEngine — identifica MARCA e NOME OFICIAL do perfume a partir
 * do título bruto do fornecedor.
 *
 * Princípios:
 * - O título do fornecedor é RAW DATA: nunca é verdade canônica e nunca é sobrescrito.
 * - Marca só sai de dicionário/aliases/metadados — jamais "primeira palavra do nome".
 * - Alta confiança aplica sozinho; dúvida vira sugestão para revisão humana.
 * - Identidade travada pelo dono (canonical_identity_locked) nunca é alterada.
 *
 * Sobre bases externas (Fragrantica): a busca do site bloqueia acesso automático
 * (HTTP 403), então não existe scraping aqui. O enriquecimento externo usa uma
 * camada de conhecimento controlada (dicionário curado + modelo de linguagem),
 * sempre com pontuação de confiança e fila de revisão.
 */
import { brandKey, canonicalBrandName, cleanText } from "@/lib/suppliers/normalize.server";
import { extractConcentration, extractVolume, normalizeName, productTitle } from "@/lib/format";
import { classifyGender, type Gender } from "@/lib/catalog/classify";
import { buildAliases, canonicalizeProductName } from "@/lib/catalog/canonical";

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const AUTO_APPLY = 0.9;

/** Marcas canônicas + grafias que os fornecedores costumam usar. */
const SEED_BRANDS: Array<{ name: string; aliases?: string[] }> = [
  { name: "Al Wataniah", aliases: ["Al Watania", "Alwataniah", "Al Wataniah Perfumes", "Wataniah"] },
  { name: "Bidaya", aliases: ["Bidaya Perfumes", "Bidayah"] },
  { name: "Al Noble", aliases: ["A Noble", "Al Nobel", "Alnoble"] },
  { name: "Lattafa", aliases: ["Lattafa Perfumes", "Lattafa Pride"] },
  { name: "Maison Alhambra", aliases: ["Alhambra", "Maison Al Hambra"] },
  { name: "Armaf", aliases: ["Armaf Club de Nuit", "Armaf Perfumes"] },
  { name: "Al Haramain", aliases: ["Alharamain", "Al Haramain Perfumes"] },
  { name: "Rasasi" },
  { name: "Afnan" },
  { name: "Ard Al Zaafaran", aliases: ["Ard Al Zafaran", "Ardalzaafaran"] },
  { name: "Asdaaf" },
  { name: "Riiffs", aliases: ["Riffs"] },
  { name: "Fragrance World", aliases: ["Fragrance World Perfumes"] },
  { name: "Paris Corner" },
  { name: "Swiss Arabian" },
  { name: "Emper" },
  { name: "Zimaya" },
  { name: "Nusuk" },
  { name: "Bharara" },
  { name: "Orientica" },
  { name: "Khadlaj" },
  { name: "Ajmal" },
  { name: "Mawwal" },
  { name: "Chris Adams" },
  { name: "French Avenue" },
  { name: "Grandeur", aliases: ["Grandeur Elite"] },
  { name: "Milestone" },
  { name: "Naseem" },
  { name: "Anfar" },
  { name: "My Perfumes", aliases: ["Myperfumes"] },
  { name: "Dolce&Gabbana", aliases: ["Dolce Gabbana", "Dolce & Gabbana", "D&G"] },
  { name: "Victoria's Secret", aliases: ["Victorias Secret", "Victoria Secret"] },
  { name: "Carolina Herrera" },
  { name: "Versace" },
  { name: "Chanel" },
  { name: "Dior", aliases: ["Christian Dior"] },
];

/**
 * Fragrâncias conhecidas cuja casa produtora não aparece no título do fornecedor.
 * A chave é o nome normalizado (sem acento, espaço ou maiúscula) e aceita grafias
 * erradas apenas para ENCONTRAR o candidato — a grafia pública sai do nome oficial.
 */
const FRAGRANCE_HOUSE: Array<{ keys: string[]; brand: string; official: string; gender?: Gender }> = [
  { keys: ["elliur", "eliur", "elliour"], brand: "Bidaya", official: "Elliur" },
  { keys: ["aishaqueen", "aisaqueen"], brand: "Bidaya", official: "Aisha Queen", gender: "FEMALE" },
  { keys: ["attaralwesal", "attaralwezal", "attarwesal", "attarwezal"], brand: "Al Wataniah", official: "Attar Al Wesal" },
  { keys: ["attargold", "attaralwesalgold"], brand: "Al Wataniah", official: "Attar Gold" },
  { keys: ["ameeralarab", "ameeralarabe"], brand: "Al Wataniah", official: "Ameer Al Arab" },
];

/** Ruído comercial/SEO dos títulos — sai do nome canônico, mas o gênero é aproveitado. */
const NOISE_WORDS = new Set([
  "perfume",
  "perfumes",
  "perfumaria",
  "masculino",
  "feminino",
  "unissex",
  "unisex",
  "arabe",
  "arabes",
  "importado",
  "original",
  "lacrado",
  "novo",
  "oleo",
  "perfumado",
  "concentrado",
  "eau",
  "de",
  "du",
  "para",
  "spray",
  "edp",
  "edt",
  "edc",
  "parfum",
  "toilette",
  "cologne",
  "extrait",
  "intenso",
  "ml",
  "kit",
  "niche",
]);

/** Versões/flankers oficiais que NUNCA podem ser removidas do nome. */
const FLANKERS = [
  "Gold",
  "Intense",
  "Elixir",
  "Extrait",
  "Bourbon",
  "Noir",
  "Blanc",
  "Blue",
  "Sport",
  "Pink",
  "Extreme",
  "Private",
  "Nuit",
  "Silver",
  "White",
  "Black",
  "Rouge",
  "Oud",
  "Royal",
  "Absolute",
  "Legacy",
  "Edition",
];

const key = (s: string) =>
  cleanText(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

export type BrandDictionary = {
  /** chave normalizada → { id, name, words } */
  byKey: Map<string, { id: string | null; name: string; words: string[] }>;
  entries: Array<{ id: string | null; name: string; words: string[] }>;
};

/** Carrega marcas oficiais do banco + aliases + a lista curada. */
export async function loadBrandDictionary(db: Db): Promise<BrandDictionary> {
  const byKey = new Map<string, { id: string | null; name: string; words: string[] }>();
  const add = (name: string, id: string | null, aliasOf?: string) => {
    const canonical = aliasOf ?? name;
    const words = key(name).length ? cleanText(name).toLowerCase().split(/\s+/) : [];
    const k = key(name);
    if (!k) return;
    const prev = byKey.get(k);
    byKey.set(k, { id: id ?? prev?.id ?? null, name: canonical, words });
  };

  const { data: brands } = await db.from("brands").select("id, canonical_name");
  for (const b of brands ?? []) add(b.canonical_name, b.id);

  const { data: aliases } = await db.from("brand_aliases").select("alias, alias_key, brand_id, brands(canonical_name)");
  for (const a of aliases ?? []) {
    const canonical = (a as { brands?: { canonical_name?: string } }).brands?.canonical_name;
    if (!canonical) continue;
    byKey.set(a.alias_key, {
      id: a.brand_id,
      name: canonical,
      words: cleanText(a.alias).toLowerCase().split(/\s+/),
    });
  }

  for (const seed of SEED_BRANDS) {
    const existing = byKey.get(key(seed.name));
    add(seed.name, existing?.id ?? null);
    for (const alias of seed.aliases ?? []) add(alias, existing?.id ?? null, seed.name);
  }

  return { byKey, entries: Array.from(byKey.values()) };
}

/** Garante a marca no banco (com alias) e devolve o id. */
export async function ensureBrand(db: Db, rawName: string, source = "engine"): Promise<{ id: string | null; name: string } | null> {
  const canonical = canonicalBrandName(rawName);
  if (!canonical) return null;
  const k = brandKey(canonical);
  const slug =
    canonical
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || k;

  const { data: alias } = await db
    .from("brand_aliases")
    .select("brand_id, brands(canonical_name)")
    .eq("alias_key", k)
    .maybeSingle();
  if (alias?.brand_id) {
    const linked = (alias as { brands?: { canonical_name?: string } }).brands?.canonical_name;
    return { id: alias.brand_id, name: linked ?? canonical };
  }

  const { data: existing } = await db.from("brands").select("id, canonical_name").eq("slug", slug).maybeSingle();
  let id = existing?.id ?? null;
  if (!id) {
    const { data: inserted } = await db
      .from("brands")
      .insert({ canonical_name: canonical, slug, normalized_name: k })
      .select("id")
      .maybeSingle();
    id = inserted?.id ?? null;
  }
  if (!id) return { id: null, name: canonical };
  await db
    .from("brand_aliases")
    .upsert({ brand_id: id, alias: canonical, alias_key: k, source }, { onConflict: "alias_key" });
  return { id, name: existing?.canonical_name ?? canonical };
}

/** Registra grafias do fornecedor como alias da marca (para busca e futuras leituras). */
export async function registerBrandAlias(db: Db, brandId: string, alias: string, source = "supplier") {
  const k = brandKey(alias);
  if (!k) return;
  await db.from("brand_aliases").upsert({ brand_id: brandId, alias: cleanText(alias), alias_key: k, source }, { onConflict: "alias_key" });
}

export type IdentityInput = {
  title: string;
  supplierBrand?: string | null;
  url?: string | null;
  categories?: string[];
  ean?: string | null;
  /** nomes canônicos equivalentes já com marca (outro fornecedor) */
  siblings?: Array<{ name: string; brand: string | null }>;
};

export type Identity = {
  brandName: string | null;
  brandId: string | null;
  name: string;
  flanker: string | null;
  concentration: string | null;
  volumeMl: number | null;
  gender: Gender;
  genderConfidence: number;
  confidence: number;
  source: string;
  aliases: string[];
  needsReview: boolean;
};

const titleWords = (title: string) =>
  cleanText(title)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s&']/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Encontra a marca do dicionário dentro do título (casamento por sequência de palavras). */
function findBrandInTitle(dict: BrandDictionary, words: string[]) {
  let best: { name: string; id: string | null; at: number; len: number } | null = null;
  for (const entry of dict.entries) {
    const w = entry.words.filter(Boolean);
    if (!w.length) continue;
    // marcas de uma letra/duas letras exigem título curto para não gerar falso positivo
    if (key(entry.name).length < 4 && words.length > 3) continue;
    for (let i = 0; i + w.length <= words.length; i++) {
      const slice = words.slice(i, i + w.length).join(" ");
      if (key(slice) === key(w.join(" "))) {
        const cand = { name: entry.name, id: entry.id, at: i, len: w.length };
        if (!best || cand.len > best.len || (cand.len === best.len && cand.at < best.at)) best = cand;
      }
    }
  }
  return best;
}

const genderFromTitle = (title: string): Gender | null => {
  const s = key(title);
  if (s.includes("unissex") || s.includes("unisex")) return "UNISEX";
  if (s.includes("feminino") || s.includes("feminina")) return "FEMALE";
  if (s.includes("masculino") || s.includes("masculina")) return "MALE";
  return null;
};

const LEADING_FILLERS = new Set(["a", "o", "al", "el", "de", "da", "do", "the"]);
const uniqueLeading = (list: string[]) => list.length > 1 && LEADING_FILLERS.has(key(list[0] ?? ""));

/** Núcleo do motor: título bruto → marca + nome oficial + versão. */
export function resolveIdentity(dict: BrandDictionary, input: IdentityInput): Identity {
  const title = cleanText(input.title);
  const words = titleWords(title);
  const volumeMl = extractVolume(title);
  const concentration = extractConcentration(title);

  let brandName: string | null = null;
  let brandId: string | null = null;
  let brandWords: string[] = [];
  const brandVariantWords: string[] = [];
  let confidence = 0;
  let source = "titulo";
  let officialName: string | null = null;
  let dictGender: Gender | null = null;

  // 1) marca informada pelo fornecedor
  const supplierBrand = cleanText(input.supplierBrand ?? "");
  if (supplierBrand) {
    const hit = dict.byKey.get(key(supplierBrand));
    brandName = hit?.name ?? canonicalBrandName(supplierBrand);
    brandId = hit?.id ?? null;
    brandWords = cleanText(brandName ?? "").toLowerCase().split(/\s+/);
    brandVariantWords.push(...titleWords(supplierBrand));
    confidence = hit ? 0.97 : 0.9;
    source = hit ? "fornecedor+dicionario" : "fornecedor";
  }

  // 2) marca do dicionário dentro do título
  if (!brandName) {
    const inTitle = findBrandInTitle(dict, words);
    if (inTitle) {
      brandName = inTitle.name;
      brandId = inTitle.id;
      brandWords = cleanText(inTitle.name).toLowerCase().split(/\s+/);
      brandVariantWords.push(...words.slice(inTitle.at, inTitle.at + inTitle.len));
      confidence = inTitle.at <= 2 ? 0.95 : 0.9;
      source = "dicionario-de-marcas";
    }
  }

  // 3) fragrância conhecida (marca não aparece no título)
  const strippedKey = key(
    words.filter((w) => !NOISE_WORDS.has(w) && !/^\d+$/.test(w)).join(" "),
  );
  const houseHit = FRAGRANCE_HOUSE.find((h) => h.keys.some((k) => strippedKey.includes(k)));
  if (houseHit) {
    officialName = houseHit.official;
    dictGender = houseHit.gender ?? null;
    if (!brandName) {
      const hit = dict.byKey.get(key(houseHit.brand));
      brandName = hit?.name ?? houseHit.brand;
      brandId = hit?.id ?? null;
      brandWords = cleanText(brandName).toLowerCase().split(/\s+/);
      confidence = 0.93;
      source = "base-de-fragrancias";
    } else {
      confidence = Math.max(confidence, 0.93);
    }
  }

  // 4) endereço da página do fornecedor
  if (!brandName && input.url) {
    const slugWords = titleWords(input.url.replace(/[-/_.]/g, " "));
    const hit = findBrandInTitle(dict, slugWords);
    if (hit) {
      brandName = hit.name;
      brandId = hit.id;
      brandWords = cleanText(hit.name).toLowerCase().split(/\s+/);
      confidence = 0.86;
      source = "endereco-do-fornecedor";
    }
  }

  // 5) produto equivalente do outro fornecedor
  if (!brandName && input.siblings?.length) {
    const mine = normalizeName(title).replace(/\s/g, "");
    const twin = input.siblings.find(
      (s) => s.brand && normalizeName(s.name).replace(/\s/g, "").includes(mine.slice(0, 10)),
    );
    if (twin?.brand) {
      const hit = dict.byKey.get(key(twin.brand));
      brandName = hit?.name ?? canonicalBrandName(twin.brand);
      brandId = hit?.id ?? null;
      brandWords = cleanText(brandName ?? "").toLowerCase().split(/\s+/);
      confidence = 0.85;
      source = "produto-equivalente";
    }
  }

  // nome oficial: título sem marca, sem ruído comercial, sem volume/concentração
  const brandKeySet = new Set([...brandWords, ...brandVariantWords].map((w) => key(w)).filter(Boolean));

  const nameWords = [...words].filter(
    (w) => !brandKeySet.has(key(w)) && !NOISE_WORDS.has(w) && !/^\d+(ml|g)?$/.test(w),
  );
  // artigo solto no início, resto de grafias como "A noble Safeer"
  while (uniqueLeading(nameWords)) nameWords.shift();

  // remove palavras repetidas ("Asad Asad Zanzibar" -> "Asad Zanzibar")
  const seenWord = new Set<string>();
  const uniqueWords = nameWords.filter((w) => {
    const k = key(w);
    if (!k || seenWord.has(k)) return false;
    seenWord.add(k);
    return true;
  });
  let name = officialName ?? productTitle(uniqueWords.join(" "));
  if (!name.trim()) name = productTitle(words.filter((w) => !NOISE_WORDS.has(w)).join(" ")) || title;

  // grafia pública oficial da Orium (linha, siglas, sem letras separadas)
  const canonical = canonicalizeProductName(name, { brand: brandName });
  name = canonical.name || name;

  // a linha reconhecida entrega a marca quando o título não trazia nenhuma
  if (!brandName && canonical.lineBrand) {
    const hit = dict.byKey.get(key(canonical.lineBrand));
    brandName = hit?.name ?? canonical.lineBrand;
    brandId = hit?.id ?? null;
    confidence = Math.max(confidence, 0.93);
    source = "linha-de-produto";
  }

  const flanker = FLANKERS.find((f) => key(name).endsWith(key(f))) ?? null;

  const explicitGender = genderFromTitle(title);
  const guess = classifyGender(title, input.categories ?? [], `${input.url ?? ""}`);
  const gender: Gender = dictGender ?? explicitGender ?? guess.gender;
  const genderConfidence = dictGender || explicitGender ? 0.95 : guess.confidence;

  const aliases = buildAliases(name, [
    title,
    normalizeName(title),
    brandName ? `${brandName} ${name}` : null,
    canonical.line,
  ]);

  const ambiguous = canonical.needsVersion;
  const finalConfidence = brandName ? Math.min(0.99, ambiguous ? Math.min(confidence, 0.8) : confidence) : 0.4;
  return {
    brandName,
    brandId,
    name,
    flanker,
    concentration,
    volumeMl,
    gender,
    genderConfidence,
    confidence: Number(finalConfidence.toFixed(2)),
    source,
    aliases,
    needsReview: finalConfidence < AUTO_APPLY,
  };
}

/** Camada de enriquecimento externo controlada (conhecimento de perfumaria, sem scraping). */
export async function enrichWithKnowledge(
  titles: Array<{ id: string; title: string }>,
): Promise<Map<string, { brand: string | null; name: string | null; gender: Gender | null; confidence: number }>> {
  const out = new Map<string, { brand: string | null; name: string | null; gender: Gender | null; confidence: number }>();
  if (titles.length === 0) return out;

  const prompt = `Você identifica perfumes árabes e de nicho. Para cada item, informe a MARCA oficial (a casa produtora) e o NOME oficial da fragrância, sem palavras de marketing, sem volume e sem concentração. Preserve versões/flankers (ex.: Asad Bourbon ≠ Asad). Se não tiver certeza, use confidence baixa e brand null. Responda apenas JSON: {"items":[{"id":"...","brand":"...","name":"...","gender":"MALE|FEMALE|UNISEX|UNKNOWN","confidence":0.0}]}\n\nItens:\n${titles
    .map((t) => `- id=${t.id} | ${t.title}`)
    .join("\n")}`;

  try {
    const { aiJson } = await import("@/lib/ai/engine.server");
    const parsed = (await aiJson({ feature: "catalog_identity", profile: "copilot", prompt })) as {
      items?: Array<{ id?: string; brand?: string | null; name?: string | null; gender?: string; confidence?: number }>;
    };
    for (const item of parsed.items ?? []) {
      if (!item?.id) continue;
      const brand = cleanText(item.brand ?? "");
      // salvaguarda: marca precisa parecer marca (curta, textual)
      const plausible = brand.length >= 3 && brand.split(/\s+/).length <= 4 && /[a-zA-Z]/.test(brand);
      out.set(item.id, {
        brand: plausible ? canonicalBrandName(brand) : null,
        name: cleanText(item.name ?? "") || null,
        gender: (["MALE", "FEMALE", "UNISEX", "UNKNOWN"].includes(item.gender ?? "") ? item.gender : null) as Gender | null,
        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0))),
      });
    }
  } catch {
    return out;
  }
  return out;
}
