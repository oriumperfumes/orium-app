import { flankerDifference } from "@/lib/catalog/flankers";
/**
 * Motor de sincronização: lê o catálogo do fornecedor em lotes, grava as ofertas,
 * detecta variações suspeitas de preço e liga cada oferta ao perfume canônico.
 *
 * Princípios:
 * - Nada é apagado quando o fornecedor falha ou fica offline.
 * - Preços com variação absurda entram em quarentena (mantém o último válido).
 * - Só produtos realmente idênticos (mesmo volume e concentração) são unificados.
 * - Imagens só entram no catálogo depois de verificadas.
 */
import { getAdapter, pickBestImage, type RawOffer } from "./adapters.server";
import { KlAdapterError } from "./kl-cosmeticos.server";
import { brandKey, canonicalBrandName, cleanText } from "./normalize.server";
import { matchScore, normalizeName, extractVolume, extractConcentration } from "@/lib/format";
import { classifyType, classifyGender } from "@/lib/catalog/classify";
import { loadBrandDictionary, resolveIdentity, AUTO_APPLY, type BrandDictionary } from "@/lib/catalog/identity.server";
import { identityKeyOf } from "@/lib/catalog/dedupe.server";

const BUDGET_MS = 18_000;
const LOCK_MS = 5 * 60 * 1000;
const AUTO_MATCH = 0.88;
const REVIEW_MATCH = 0.8;
const ANOMALY_RATIO = 0.6;
/** Abaixo disso o catálogo lido é considerado incompleto e nada é marcado como sumido. */
const CATALOG_MIN_RATIO = 0.6;

export type SyncResult = {
  status: "ok" | "parcial" | "erro" | "bloqueado" | "sem-integracao";
  supplierId: string;
  supplierName: string;
  found: number;
  created: number;
  updated: number;
  unchanged: number;
  anomalies: number;
  withoutImage: number;
  pages: number;
  nextCursor: number | null;
  throttled: boolean;
  catalogIncomplete: boolean;
  message: string | null;
};

const hashOf = (o: RawOffer) =>
  [o.name, o.price ?? "", o.availabilityStatus ?? (o.inStock ? "AVAILABLE" : "UNAVAILABLE"), o.stock ?? "", o.images[0] ?? "", o.categories.join(",")].join("|");

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70);

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** Garante uma marca oficial única (sem duplicar por acento, hífen ou maiúscula). */
async function resolveBrand(
  db: Db,
  cache: Map<string, string>,
  rawBrand: string | null,
  supplierId: string,
): Promise<{ id: string | null; name: string | null }> {
  const canonical = canonicalBrandName(rawBrand);
  if (!canonical) return { id: null, name: null };
  const key = brandKey(canonical);
  const cached = cache.get(key);
  if (cached) return { id: cached, name: canonical };

  const { data: alias } = await db
    .from("brand_aliases")
    .select("brand_id, brands(canonical_name)")
    .eq("alias_key", key)
    .maybeSingle();
  if (alias?.brand_id) {
    cache.set(key, alias.brand_id);
    const linked = (alias as { brands?: { canonical_name?: string } }).brands?.canonical_name;
    return { id: alias.brand_id, name: linked ?? canonical };
  }

  const slug = slugify(canonical) || key;
  const { data: existing } = await db.from("brands").select("id, canonical_name").eq("slug", slug).maybeSingle();
  let brandId = existing?.id ?? null;
  if (!brandId) {
    const { data: inserted } = await db
      .from("brands")
      .insert({ canonical_name: canonical, slug })
      .select("id")
      .maybeSingle();
    brandId = inserted?.id ?? null;
  }
  if (!brandId) return { id: null, name: canonical };

  cache.set(key, brandId);
  await db
    .from("brand_aliases")
    .upsert(
      { brand_id: brandId, alias: cleanText(rawBrand), alias_key: key, supplier_id: supplierId },
      { onConflict: "alias_key" },
    );
  return { id: brandId, name: existing?.canonical_name ?? canonical };
}

const HUB_STOP = new Set(["edp", "edt", "edc", "eau", "de", "du", "parfum", "perfume", "perfumes", "toilette", "cologne", "ml", "masculino", "feminino", "unissex", "unisex", "compartilhavel", "al", "el", "the", "pour", "tradicional", "original"]);
const hubTokens = (v: string) =>
  v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’'`´]/g, "").replace(/\d+(?:[.,]\d+)?\s*ml\b/g, " ").split(/[^a-z0-9]+/).filter((t) => t && !HUB_STOP.has(t));

/** Mesmo perfume? Todos os termos significativos precisam coincidir (marca ignorada) e o volume também. */
export function strictSameProduct(offerName: string, p: { canonical_name: string | null; brand?: string | null; volume_ml?: number | null; flanker?: string | null }): boolean {
  const title = offerName.includes(" - ") ? offerName.slice(0, offerName.lastIndexOf(" - ")) : offerName;
  const brand = new Set(hubTokens(p.brand ?? ""));
  const a = new Set(hubTokens(title).filter((t) => !brand.has(t)));
  const b = new Set(hubTokens(`${p.canonical_name ?? ""} ${p.flanker ?? ""}`).filter((t) => !brand.has(t)));
  // Tokens de marca que sobraram no título (ex.: "Lattafa") não contam.
  for (const t of [...a]) if (!b.has(t) && /^(lattafa|armaf|rasasi|wataniah|alhambra|maison|asdaaf|afnan|ajmal|haramain|orientica|premium|paris|corner|french|avenue|rayhaan|zimaya)$/.test(t)) a.delete(t);
  if (a.size !== b.size || [...a].some((t) => !b.has(t))) return false;
  const vol = offerName.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i)?.[1];
  if (vol && p.volume_ml && Number(vol.replace(",", ".")) !== Number(p.volume_ml)) return false;
  return true;
}

export async function runSupplierSync(supplierId: string, cursor = 0): Promise<SyncResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin;
  const startedAt = new Date();
  const t0 = Date.now();

  const { data: supplier } = await db.from("suppliers").select("*").eq("id", supplierId).maybeSingle();
  if (!supplier) throw new Error("Fornecedor não encontrado.");

  const base = {
    supplierId,
    supplierName: supplier.name,
    found: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    anomalies: 0,
    withoutImage: 0,
    pages: 0,
    catalogIncomplete: false,
  };
  const isKl = supplier.slug === "kl";

  if (isKl && supplier.circuit_open_until && Date.parse(supplier.circuit_open_until) > Date.now() && cursor === 0) {
    return { ...base, status: "bloqueado", nextCursor: null, throttled: false, message: `Sincronização automática pausada até ${new Date(supplier.circuit_open_until).toLocaleString("pt-BR")}. Use Testar conexão para verificar a fonte.` };
  }

  const locked = supplier.sync_locked_at ? Date.now() - Date.parse(supplier.sync_locked_at) < LOCK_MS : false;
  if (locked && cursor === 0) {
    return {
      ...base,
      status: "bloqueado",
      nextCursor: null,
      throttled: false,
      message: "Já existe uma sincronização em andamento.",
    };
  }

  const adapter = getAdapter(supplier);
  if (!adapter) {
    await db
      .from("suppliers")
      .update({
        last_sync_at: startedAt.toISOString(),
        sync_status: "sem-integracao",
        sync_message: "Ainda não há leitor automático para esta loja. Os preços atuais foram mantidos.",
      })
      .eq("id", supplierId);
    return {
      ...base,
      status: "sem-integracao",
      nextCursor: null,
      throttled: false,
      message: "Ainda não há leitor automático para esta loja. Nenhum dado foi alterado.",
    };
  }

  // Início do ciclo completo (usado para saber o que sumiu do catálogo ao final)
  const runStartedAt =
    cursor === 0 || !supplier.sync_run_started_at ? startedAt.toISOString() : supplier.sync_run_started_at;

  let runId = supplier.current_sync_run_id as string | null;
  if (cursor === 0 || !runId) {
    if (runId) {
      await db.from("sync_runs").update({ status: "erro", stage: "IMPORT", error_code: "INTERRUPTED", error_message: "Execução anterior interrompida antes da conclusão.", finished_at: startedAt.toISOString() }).eq("id", runId).is("finished_at", null);
    }
    const { data: run } = await db.from("sync_runs").insert({ supplier_id: supplierId, status: "sincronizando", stage: "FETCH", started_at: startedAt.toISOString(), details: { cursor: 0, baseline: !supplier.last_successful_sync_at } }).select("id").single();
    runId = run?.id ?? null;
  }

  const event = async (stage: string, message: string, counters: Record<string, unknown> = {}, level = "info", code: string | null = null, responseMeta: Record<string, unknown> | null = null) => {
    if (!runId) return;
    await db.from("supplier_sync_events").insert({ run_id: runId, supplier_id: supplierId, stage, message, counters: counters as never, level, code, response_meta: responseMeta as never });
  };
  await event("FETCH", cursor === 0 ? "Coleta iniciada." : `Coleta retomada no item ${cursor}.`, { cursor });

  await db
    .from("suppliers")
    .update({
      sync_locked_at: startedAt.toISOString(),
      sync_status: "sincronizando",
      sync_cursor: cursor,
      sync_run_started_at: runStartedAt,
      current_sync_run_id: runId,
      sync_stage: "FETCH",
      sync_error_code: null,
    })
    .eq("id", supplierId);

  const fail = async (message: string, code = "NETWORK_ERROR", stage = "FETCH", responseMeta: Record<string, unknown> | null = null) => {
    const failures = Number(supplier.consecutive_sync_failures ?? 0) + 1;
    const circuit = isKl && failures >= 3 ? new Date(Date.now() + 60 * 60_000).toISOString() : null;
    const runPayload = {
      status: "erro",
      stage,
      error_code: code,
      products_processed: 0,
      duration_ms: Date.now() - t0,
      error_message: message,
      error_count: 1,
      response_meta: responseMeta as never,
      finished_at: new Date().toISOString(),
    };
    if (runId) await db.from("sync_runs").update(runPayload).eq("id", runId);
    else await db.from("sync_runs").insert({ supplier_id: supplierId, started_at: startedAt.toISOString(), ...runPayload });
    await event(stage, message, {}, "error", code, responseMeta);
    await db
      .from("suppliers")
      .update({
        last_sync_at: new Date().toISOString(),
        sync_status: "erro",
        sync_message: message,
        sync_stage: stage,
        sync_error_code: code,
        sync_locked_at: null,
        sync_cursor: null,
        sync_run_started_at: null,
        current_sync_run_id: null,
        consecutive_sync_failures: failures,
        circuit_open_until: circuit,
      })
      .eq("id", supplierId);
    return { ...base, status: "erro" as const, nextCursor: null, throttled: false, message };
  };

  let batch;
  try {
    batch = await adapter.fetchBatch(cursor, BUDGET_MS);
  } catch (e) {
    const known = e instanceof KlAdapterError ? e : null;
    return fail(`${known?.code ?? "NETWORK_ERROR"}: ${e instanceof Error ? e.message : "erro desconhecido"} Os preços e a disponibilidade válidos anteriores foram mantidos.`, known?.code ?? "NETWORK_ERROR", "FETCH", known?.responseMeta ?? null);
  }

  await event("DISCOVERY", `${batch.total ?? batch.items.length} itens localizados na fonte.`, { endpoints: 1, raw: Number(batch.diagnostics?.["raw_products"] ?? batch.total ?? batch.items.length), unique: Number(batch.diagnostics?.["unique_products"] ?? batch.total ?? batch.items.length), cursor }, "info", null, batch.diagnostics ?? null);

  if (batch.items.length === 0 && batch.throttled) {
    await db
      .from("suppliers")
      .update({ sync_status: "parcial", sync_cursor: batch.nextCursor, sync_locked_at: new Date().toISOString() })
      .eq("id", supplierId);
    return {
      ...base,
      status: "parcial",
      nextCursor: batch.nextCursor,
      throttled: true,
      message: "A loja pediu para diminuir o ritmo. Continuando em instantes.",
    };
  }

  if (batch.items.length === 0 && cursor === 0) {
    return fail("PARSER_FAILED: a fonte respondeu, mas nenhum produto real foi encontrado. Os dados válidos anteriores foram mantidos.", "NO_PRODUCTS_FOUND", "PARSE", batch.diagnostics ?? null);
  }

  // Lote vazio depois do primeiro = fim do catálogo: segue para a conclusão normal.
  await event("NORMALIZE", `${batch.items.length} produtos normalizados neste lote.`, { parsed: batch.items.length, cursor });
  await db.from("suppliers").update({ sync_stage: "MATCH" }).eq("id", supplierId);

  // Categorias originais da loja, guardadas como vieram
  // Desconto de pagamento praticado pela loja: fica registrado no fornecedor
  // para o Admin conferir de onde vem o custo.
  if (typeof batch.paymentDiscountPercent === "number") {
    await db
      .from("suppliers")
      .update({ payment_discount_percent: batch.paymentDiscountPercent })
      .eq("id", supplierId);
  }

  for (const c of batch.categories ?? []) {
    if (!c.name) continue;
    await db
      .from("supplier_categories")
      .upsert(
        { supplier_id: supplierId, name: c.name, external_id: c.externalId, url: c.url },
        { onConflict: "supplier_id,name" },
      );
  }

  // Ofertas já conhecidas deste fornecedor
  const { data: existingRows } = await db
    .from("supplier_products")
    .select(
      "id, supplier_sku, url, supplier_product_name, price, price_anomaly, data_hash, product_id, in_stock, image_url, catalog_eligibility_reason, catalog_excluded_manually",
    )
    .eq("supplier_id", supplierId);
  const existing = existingRows ?? [];
  const bySku = new Map(existing.filter((r) => r.supplier_sku).map((r) => [r.supplier_sku as string, r]));
  const byUrl = new Map(existing.filter((r) => r.url).map((r) => [r.url as string, r]));
  const byName = new Map(existing.map((r) => [normalizeName(r.supplier_product_name), r]));

  // Catálogo canônico para o motor de identificação
  const { data: productRows } = await db
    .from("products")
    .select("id, canonical_name, brand, flanker, concentration, volume_ml, product_type, identity_key")
    .neq("product_type", "NEGOCIACAO") // fichas de Negociação nunca recebem oferta de fornecedor
    .neq("source", "manual"); // produto cadastrado à mão é controlado só pelo painel
  const products = productRows ?? [];
  // Índice de identidade: o mesmo perfume nunca nasce duas vezes.
  const byIdentity = new Map<string, string>();
  for (const p of products) {
    const key =
      p.identity_key ??
      identityKeyOf({
        brand: p.brand,
        name: p.canonical_name,
        flanker: p.flanker,
        concentration: p.concentration,
        volumeMl: p.volume_ml,
        productType: p.product_type,
      });
    if (!byIdentity.has(key)) byIdentity.set(key, p.id);
  }
  // Unificações já feitas: a chave do duplicado aponta para o produto canônico.
  // Identity Engine V3: decisões manuais de separação são autoridade — a sync não religa.
  const { data: separatedRows } = await db
    .from("identity_mappings")
    .select("supplier_product_id")
    .in("state", ["MANUALLY_SEPARATED", "BLOCKED"]);
  const separatedOffers = new Set((separatedRows ?? []).map((r) => r.supplier_product_id));
  const v3 = await import("@/lib/identity-v3/engine");
  const { data: merges } = await db.from("product_merges").select("identity_key, canonical_product_id");
  for (const m of merges ?? []) {
    if (m.identity_key && !byIdentity.has(m.identity_key)) byIdentity.set(m.identity_key, m.canonical_product_id);
  }

  /**
   * Excluídos definitivamente no painel: o fornecedor pode continuar
   * anunciando, mas o produto NUNCA volta a nascer na Orium. O bloqueio pode
   * ser liberado depois em Admin → Produtos.
   */
  const { data: blockRows } = await db
    .from("permanent_catalog_blocklist")
    .select("identity_key, normalized_name, supplier_id, supplier_sku, supplier_url");
  const blockedIdentities = new Set(
    (blockRows ?? []).map((b) => b.identity_key).filter(Boolean) as string[],
  );
  const blockedSupplierKeys = new Set<string>();
  for (const b of blockRows ?? []) {
    if (b.supplier_id !== supplierId) continue;
    if (b.supplier_sku) blockedSupplierKeys.add(`sku:${b.supplier_sku}`);
    if (b.supplier_url) blockedSupplierKeys.add(`url:${b.supplier_url}`);
    if (b.normalized_name) blockedSupplierKeys.add(`nome:${b.normalized_name}`);
  }
  const isBlockedOffer = (it: { sku?: string | null; url?: string | null; name: string }) =>
    (it.sku && blockedSupplierKeys.has(`sku:${it.sku}`)) ||
    (it.url && blockedSupplierKeys.has(`url:${it.url}`)) ||
    blockedSupplierKeys.has(`nome:${normalizeName(it.name)}`);

  const now = new Date().toISOString();
  const brandCache = new Map<string, string>();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let anomalies = 0;
  let withoutImage = 0;
  let blocked = 0;
  let matched = 0;
  const changes: Array<{ supplier_id: string; run_id: string | null; supplier_product_id: string; kind: string; product_name: string | null; old_price: number | null; new_price: number | null }> = [];
  let review = 0;

  const identityDict: BrandDictionary = await loadBrandDictionary(db);

  for (const item of batch.items) {
    if (!item.name) continue;
    if (isBlockedOffer(item)) {
      // Produto apagado de propósito: a sincronização apenas o ignora.
      blocked++;
      continue;
    }
    const prev =
      (item.sku ? bySku.get(item.sku) : undefined) ??
      (item.url ? byUrl.get(item.url) : undefined) ??
      byName.get(normalizeName(item.name));


    const hash = hashOf(item);
    // Preço antigo travado por "anomalia" e agora confirmado: não pula, corrige.
    const staleLockedPrice = !!(prev?.price_anomaly && item.priceConfirmed);
    if (!staleLockedPrice && prev && prev.data_hash === hash && prev.product_id && prev.image_url && prev.catalog_eligibility_reason) {
      unchanged++;
      const unchangedAvailability = item.availabilityStatus ?? (item.inStock ? "AVAILABLE" : "UNAVAILABLE");
      await db
        .from("supplier_products")
        .update({
          last_synced_at: now,
          missing_since: null,
          missing_sync_count: 0,
          in_stock: unchangedAvailability === "UNKNOWN" ? prev.in_stock : item.inStock,
          availability_status: unchangedAvailability,
          stock_quantity: item.stock,
          active: true,
        })
        .eq("id", prev.id);
      continue;
    }

    // Preço zerado/ausente não é preço válido: a oferta não entra no cálculo.
    let price = item.price && item.price > 0 ? item.price : null;
    let anomaly = false;
    if (!item.priceConfirmed && prev?.price && price && Math.abs(price - prev.price) / prev.price > ANOMALY_RATIO) {
      anomaly = true;
      anomalies++;
      price = prev.price;
    }

    // Imagem: só guardamos o que carrega de verdade, preferindo a maior resolução.
    const checkedImages = isKl || supplier.adapter === "kyte-connector" ? { best: item.images[0] ?? null, valid: item.images.slice(0, 2) } : await pickBestImage(item.images);
    const { best: image, valid: gallery } = checkedImages;
    const finalImage = image ?? prev?.image_url ?? null;
    if (!finalImage) withoutImage++;

    const brand = await resolveBrand(db, brandCache, item.brand, supplierId);

    // Classificação do segmento: nada entra no catálogo sem indício de perfumaria.
    const extraSignals = `${item.url ?? ""}`.replace(/[-/_]/g, " ");
    const kind = classifyType(item.name, item.categories ?? [], `${extraSignals} ${brand.name ?? ""}`);
    const genderGuess =
      kind.type === "PERFUME"
        ? classifyGender(item.name, item.categories ?? [], extraSignals)
        : { gender: "UNKNOWN" as const, confidence: 0 };

    const payload = {
      supplier_id: supplierId,
      supplier_product_name: item.name,
      normalized_name: normalizeName(item.name),
      supplier_sku: item.sku,
      url: item.url,
      image_url: finalImage,
      image_urls: gallery.length ? gallery : finalImage ? [finalImage] : [],
      image_checked_at: now,
      brand: brand.name,
      brand_id: brand.id,
      categories: item.categories,
      product_type: kind.type,
      catalog_eligible: kind.eligible,
      catalog_eligibility_reason: kind.reason,
      volume_ml: extractVolume(item.name),
      concentration: extractConcentration(item.name),
      price,
      // Auditoria do custo: preço bruto anunciado, custo usado e quando foi lido.
      raw_supplier_price: item.rawPrice ?? item.price ?? null,
      normalized_cost: price,
      cost_source: item.costSource ?? null,
      cost_captured_at: now,
      previous_price: prev?.price ?? null,
      price_anomaly: anomaly,
      stock_quantity: item.stock,
      // UNKNOWN não é indisponível: preserva o último estado válido quando existir.
      in_stock:
        item.availabilityStatus === "UNKNOWN"
          ? (prev?.in_stock ?? false)
          : item.inStock && price !== null,
      active: true,
      data_hash: hash,
      source_updated_at: item.sourceUpdatedAt,
      availability_status: item.availabilityStatus ?? (item.inStock ? "AVAILABLE" : "UNAVAILABLE"),
      supplier_promotional_price: item.promotionalPrice ?? null,
      raw_data: (item.rawData ?? null) as never,
      raw_payload_hash: item.rawPayloadHash ?? null,
      offer_source: "auto",
      last_synced_at: now,
      missing_since: null,
      missing_sync_count: 0,
      // Exclusão manual feita no painel vence a classificação automática.
      catalog_excluded_manually: prev?.catalog_excluded_manually ?? false,
      ...(prev?.catalog_excluded_manually
        ? { catalog_eligible: false, catalog_eligibility_reason: "excluido-manualmente" }
        : {}),
    };

    let offerId = prev?.id ?? null;
    if (prev) {
      // NOVIDADES: `first_seen_at` nunca é reescrito. Preço, estoque, imagem ou
      // nome novo não transformam um produto antigo em novidade.
      await db.from("supplier_products").update(payload).eq("id", prev.id);
      if (offerId && price != null && Number(prev.price ?? 0) !== price) {
        changes.push({ supplier_id: supplierId, run_id: runId, supplier_product_id: offerId, kind: "price_changed", product_name: item.name, old_price: prev.price ?? null, new_price: price });
        await db.from("supplier_price_history").insert({ supplier_product_id: offerId, price, in_stock: payload.in_stock, source: "auto" });
      }
      updated++;
    } else {
      // Primeira vez que a Orium vê este produto no catálogo do fornecedor.
      const { data: inserted } = await db
        .from("supplier_products")
        .insert({ ...payload, first_seen_at: now, first_seen_source: isKl && !supplier.last_successful_sync_at ? "baseline" : "detected" })
        .select("id")
        .maybeSingle();
      offerId = inserted?.id ?? null;
      if (offerId) changes.push({ supplier_id: supplierId, run_id: runId, supplier_product_id: offerId, kind: "new", product_name: item.name, old_price: null, new_price: price });
      if (offerId && price != null) {
        await db.from("supplier_price_history").insert({ supplier_product_id: offerId, price, in_stock: payload.in_stock, source: "auto" });
      }
      created++;
    }

    // Identificação: liga a oferta ao perfume canônico
    if (offerId && prev?.catalog_excluded_manually) {
      // Produto excluído na mão: não volta ao catálogo nem gera novo cadastro.
    } else if (offerId && separatedOffers.has(offerId)) {
      // Separada manualmente na revisão de identidade: fica sem vínculo.
    } else if (offerId && !prev?.product_id) {
      // Identidade: separa MARCA do NOME oficial. O título do fornecedor fica preservado
      // em supplier_product_name; aqui nasce o nome público do perfume.
      const identity = resolveIdentity(identityDict, {
        title: item.name,
        supplierBrand: item.brand ?? brand.name,
        url: item.url,
        categories: item.categories ?? [],
      });
      const identityBrandName = identity.brandName ?? brand.name;
      let identityBrandId = identity.brandId ?? brand.id;
      if (identityBrandName && !identityBrandId) {
        const resolved = await resolveBrand(db, brandCache, identityBrandName, supplierId);
        identityBrandId = resolved.id;
      }
      const canonical = identity.confidence >= AUTO_APPLY ? identity.name : item.name.trim();
      const identityKey = identityKeyOf({
        brand: identityBrandName,
        name: canonical,
        flanker: identity.flanker,
        concentration: identity.concentration ?? extractConcentration(item.name),
        volumeMl: identity.volumeMl ?? extractVolume(item.name),
        productType: kind.type,
      });

      if (blockedIdentities.has(identityKey)) {
        // Mesmo perfume excluído definitivamente: a oferta fica fora do catálogo.
        blocked++;
        await db
          .from("supplier_products")
          .update({
            catalog_excluded_manually: true,
            catalog_eligible: false,
            catalog_eligibility_reason: "excluido-manualmente",
          })
          .eq("id", offerId);
        continue;
      }

      // 1) Mesma identidade (marca + nome + versão + concentração + volume) ou
      //    identidade já unificada: a oferta entra no produto que já existe.
      const known = byIdentity.get(identityKey);
      let best: { id: string; score: number } | null = known ? { id: known, score: 1 } : null;


      // 2) Sem identidade conhecida: tenta o nome muito parecido, como antes.
      if (!best) {
        for (const p of products) {
          // Versão/flanker diferente nunca se liga sozinho (Yara ≠ Yara Elixir).
          let score = flankerDifference(item.name, p.canonical_name).length ? 0 : matchScore(item.name, p.canonical_name);
          // Veto V3: flanker/edição/base diferentes nunca se ligam pelo nome parecido.
          if (score >= REVIEW_MATCH) {
            const verdict = v3.compare(
              v3.extractAttributes({ title: item.name, brand: identityBrandName }),
              v3.extractAttributes({ title: p.canonical_name, brand: p.brand, flanker: p.flanker, concentration: p.concentration, volumeMl: p.volume_ml }),
            ).verdict;
            if (verdict === "DIFFERENT") score = 0;
          }
          if (!best || score > best.score) best = { id: p.id, score };
        }
      }

      // Central de Fornecedores: vínculo automático só quando nome-base e volume batem
      // exatamente (Attar Al Wesal ≠ Attar Al Wesal Elixir; 50ml ≠ 100ml). Dúvida → revisão.
      if (best && best.score >= AUTO_MATCH && supplier.creates_catalog_products === false) {
        const target = products.find((p) => p.id === best!.id);
        if (!target || !strictSameProduct(item.name, target)) best = { id: best.id, score: Math.min(best.score, REVIEW_MATCH) };
      }
      if (best && best.score >= AUTO_MATCH) {
        await db.from("supplier_products").update({ product_id: best.id }).eq("id", offerId);
        matched++;
        if (finalImage) {
          await db
            .from("products")
            .update({ image_url: finalImage, image_urls: gallery })
            .eq("id", best.id)
            .is("image_url", null);
        }
      } else {
        // Fornecedores da Central (ex.: só referência) nunca criam produtos públicos:
        // a oferta fica no catálogo interno aguardando revisão de vínculo.
        if (isKl || supplier.creates_catalog_products === false) {
          review++;
          await db.from("supplier_products").update({ product_id: null, catalog_eligible: false, catalog_eligibility_reason: "identity-review-required" }).eq("id", offerId);
          continue;
        }
        // Semelhança intermediária: registra a revisão manual, mas NUNCA deixa o
        // produto invisível. Flanker/concentração diferentes não são mesclados
        // automaticamente; o perfume nasce publicado e o painel decide depois.
        if (best && best.score >= REVIEW_MATCH) {
          const { data: sibling } = await db
            .from("supplier_products")
            .select("id")
            .eq("product_id", best.id)
            .neq("id", offerId)
            .limit(1)
            .maybeSingle();
          if (sibling) {
            await db.from("product_matches").insert({
              supplier_product_a: offerId,
              supplier_product_b: sibling.id,
              match_score: best.score,
              status: "pending",
            });
          }
        }

        // Publicação NÃO é decidida aqui: o gatilho de elegibilidade do banco
        // aplica marca (Árabe/Designer/Nicho/Desconhecida) + categoria.
        const slug = `${slugify(`${identityBrandName ?? ""} ${canonical}`) || slugify(canonical)}-${offerId.slice(0, 6)}`;
        const { data: newProduct, error: newProductError } = await db
          .from("products")
          .insert({
            canonical_name: canonical,
            brand: identityBrandName,
            brand_id: identityBrandId,
            slug,
            identity_key: identityKey,
            flanker: identity.flanker,
            volume_ml: identity.volumeMl ?? extractVolume(item.name),
            concentration: identity.concentration ?? extractConcentration(item.name),
            image_url: finalImage,
            image_urls: gallery,
            active: true,
            product_type: kind.type,
            // Decant só existe para perfume (regra do banco).
            decant_available: kind.type === "PERFUME",

            catalog_eligible: kind.eligible,
            catalog_eligibility_reason: kind.reason,
            gender_norm: identity.gender !== "UNKNOWN" ? identity.gender : genderGuess.gender,
            gender_confidence: identity.gender !== "UNKNOWN" ? identity.genderConfidence : genderGuess.confidence,
            brand_review_required: !identityBrandId,
            identity_source: identity.source,
            identity_confidence: identity.confidence,
            identity_status: identity.confidence >= AUTO_APPLY ? "confirmada" : "revisar",
            search_aliases: identity.aliases,
          })
          .select("id, canonical_name, brand, flanker, concentration, volume_ml, product_type, identity_key")
          .maybeSingle();
        if (newProductError) {
          // Diagnóstico: sem isso um cadastro recusado pelo banco ficaria invisível.
          console.error("[sync] falha ao criar produto", item.name, newProductError.message);
        }
        if (newProduct) {
          products.push(newProduct);
          byIdentity.set(identityKey, newProduct.id);
          await db.from("supplier_products").update({ product_id: newProduct.id }).eq("id", offerId);
        }
      }

    } else if (offerId && prev?.product_id && finalImage) {
      // Mantém a foto do perfume em dia quando o produto ainda não tem imagem.
      await db
        .from("products")
        .update({ image_url: finalImage, image_urls: gallery })
        .eq("id", prev.product_id)
        .is("image_url", null);
    }
  }

  const complete = batch.nextCursor === null;
  let catalogIncomplete = false;
  const flushChanges = async () => {
    for (let i = 0; i < changes.length; i += 200) await db.from("supplier_sync_changes").insert(changes.slice(i, i + 200) as never);
    changes.length = 0;
  };
  await flushChanges();

  // Fim do ciclo completo: itens não vistos ficam indisponíveis (nunca apagados).
  if (complete) {
    const { count: seen } = await db
      .from("supplier_products")
      .select("id", { count: "exact", head: true })
      .eq("supplier_id", supplierId)
      .gte("last_synced_at", runStartedAt);
    const seenCount = seen ?? 0;
    const previousSize = supplier.last_catalog_size ?? 0;
    catalogIncomplete = previousSize > 0 && seenCount < previousSize * CATALOG_MIN_RATIO;

    if (!catalogIncomplete) {
      const { data: missing } = await db
        .from("supplier_products")
        .select("id, missing_sync_count")
        .eq("supplier_id", supplierId)
        .lt("last_synced_at", runStartedAt);
      for (const row of missing ?? []) {
        const times = (row.missing_sync_count ?? 0) + 1;
        if (times === 1) changes.push({ supplier_id: supplierId, run_id: runId, supplier_product_id: row.id, kind: "not_found", product_name: null, old_price: null, new_price: null });
        await db
          .from("supplier_products")
          .update({
            in_stock: false,
              availability_status: "UNAVAILABLE",
            stock_quantity: null,
            missing_since: now,
            missing_sync_count: times,
            // Só sai do catálogo depois de sumir em três leituras completas seguidas.
            active: times < 3,
          })
          .eq("id", row.id);
      }
    }
  }

  await flushChanges();
  const status = complete && !catalogIncomplete ? "ok" : "parcial";
  const processed = created + updated + unchanged;

  const previousDetails = (supplier.ingestion_stats as Record<string, number> | null) ?? {};
  const cycle = cursor === 0 ? { raw: 0, parsed: 0, matched: 0, review: 0, created: 0, updated: 0, ignored: 0, errors: 0, pages: 0 } : previousDetails;
  const totals = {
    raw: Number(batch.diagnostics?.["raw_products"] ?? batch.total ?? cycle["raw"] ?? batch.items.length),
    parsed: Number(cycle["parsed"] ?? 0) + batch.items.length,
    matched: Number(cycle["matched"] ?? 0) + matched + unchanged,
    review: Number(cycle["review"] ?? 0) + review,
    created: Number(cycle["created"] ?? 0) + created,
    updated: Number(cycle["updated"] ?? 0) + updated,
    ignored: Number(cycle["ignored"] ?? 0) + blocked,
    errors: Number(cycle["errors"] ?? 0),
    pages: Number(cycle["pages"] ?? 0) + batch.pages,
  };
  // Elegibilidade do catálogo (fora do catálogo por marca NÃO é falha).
  let elig = { eligible: 0, hidden: 0, review: 0 };
  if (runId && complete) {
    const { data: offerRows } = await db
      .from("supplier_products")
      .select("product_id, products(catalog_eligible, catalog_eligibility_reason)")
      .eq("supplier_id", supplier.id)
      .eq("active", true)
      .not("product_id", "is", null)
      .limit(5000);
    for (const r of (offerRows ?? []) as any[]) {
      const reason = r.products?.catalog_eligibility_reason;
      if (reason === "marca-designer-fora-do-posicionamento" || reason === "marca-nicho-fora-do-posicionamento") elig.hidden++;
      else if (reason === "marca-em-revisao") elig.review++;
      else if (r.products?.catalog_eligible) elig.eligible++;
    }
  }
  if (runId) await db.from("sync_runs").update({
    status,
    ...(complete ? { eligible_count: elig.eligible, hidden_segment_count: elig.hidden, brand_review_count: elig.review } : {}),
    stage: complete ? "IMPORT" : "MATCH",
    products_processed: totals.parsed,
    products_found: totals.parsed,
    products_new: totals.created,
    products_updated: totals.updated,
    products_unchanged: Math.max(0, totals.matched - totals.created - totals.updated),
    products_without_image: withoutImage,
    catalog_incomplete: catalogIncomplete,
    anomalies,
    pages_fetched: totals.pages,
    raw_products: totals.raw,
    parsed_products: totals.parsed,
    unique_products: Number(batch.diagnostics?.["unique_products"] ?? batch.total ?? totals.parsed),
    matched_products: totals.matched,
    review_products: totals.review,
    ignored_products: totals.ignored,
    duration_ms: Date.now() - t0,
    finished_at: complete ? new Date().toISOString() : null,
    details: {
      cursor,
      nextCursor: batch.nextCursor,
      total: batch.total,
      categories: (batch.categories ?? []).length,
    },
  }).eq("id", runId);

  const { count: catalogSize } = complete
    ? await db
        .from("supplier_products")
        .select("id", { count: "exact", head: true })
        .eq("supplier_id", supplierId)
        .gte("last_synced_at", runStartedAt)
    : { count: null };

  await db
    .from("suppliers")
    .update({
      last_sync_at: new Date().toISOString(),
      ...(complete && !catalogIncomplete ? { last_successful_sync_at: new Date().toISOString() } : {}),
      ...(complete && !catalogIncomplete && catalogSize ? { last_catalog_size: catalogSize } : {}),
      sync_status: catalogIncomplete ? "atencao" : status,
      sync_message: catalogIncomplete
        ? "A loja devolveu bem menos itens do que o normal. Nada foi retirado do catálogo."
        : complete
          ? `${processed} itens conferidos · ${created} novos · ${updated} atualizados${blocked ? ` · ${blocked} bloqueados` : ""}${withoutImage ? ` · ${withoutImage} sem foto` : ""}${anomalies ? ` · ${anomalies} preços em revisão` : ""}`
          : `Sincronizando… ${processed} itens conferidos até agora.`,
      sync_locked_at: complete ? null : new Date().toISOString(),
      sync_cursor: batch.nextCursor,
      sync_run_started_at: complete ? null : runStartedAt,
      current_sync_run_id: complete ? null : runId,
      sync_stage: complete ? "IMPORT" : "MATCH",
      sync_error_code: catalogIncomplete ? "CATALOG_INCOMPLETE" : null,
      consecutive_sync_failures: complete ? 0 : supplier.consecutive_sync_failures,
      circuit_open_until: complete ? null : supplier.circuit_open_until,
      ingestion_stats: { ...totals, total: batch.total, at: now, source: "auto", baseline: !supplier.last_successful_sync_at } as never,
    })
    .eq("id", supplierId);

  await event(complete ? "IMPORT" : "MATCH", complete ? `Ciclo concluído com ${totals.parsed} itens processados.` : `Lote concluído; próximo item ${batch.nextCursor}.`, totals);

  return {
    ...base,
    status,
    found: batch.items.length,
    created,
    updated,
    unchanged,
    anomalies,
    withoutImage,
    pages: batch.pages,
    nextCursor: batch.nextCursor,
    throttled: Boolean(batch.throttled),
    catalogIncomplete,
    message: catalogIncomplete
      ? "A loja devolveu bem menos itens do que o normal. Nada foi retirado do catálogo."
      : null,
  };
}

/** Revalida as fotos de um perfume (ou de todos sem foto) a partir das ofertas dos fornecedores. */
export async function reprocessImages(productId?: string): Promise<{ fixed: number; checked: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin;

  const query = db.from("products").select("id").eq("active", true);
  const { data: targets } = productId ? await query.eq("id", productId) : await query.is("image_url", null).limit(60);

  let fixed = 0;
  let checked = 0;
  for (const p of targets ?? []) {
    checked++;
    const { data: offers } = await db
      .from("supplier_products")
      .select("image_url, image_urls")
      .eq("product_id", p.id)
      .not("image_url", "is", null);
    const candidates = Array.from(
      new Set(
        (offers ?? []).flatMap((o) => [
          ...((o.image_urls as string[] | null) ?? []),
          ...(o.image_url ? [o.image_url] : []),
        ]),
      ),
    );
    const { best, valid } = await pickBestImage(candidates);
    if (best) {
      await db.from("products").update({ image_url: best, image_urls: valid }).eq("id", p.id);
      fixed++;
    }
  }
  return { fixed, checked };
}
