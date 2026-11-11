/**
 * Operações reversíveis do Identity Engine V3: mesclar, desfazer mesclagem, separar e vincular.
 * Pedidos e vendas da loja guardam snapshot de nome/preço — nunca são reescritos.
 */
import { ENGINE_VERSION, pairKey } from "./engine";

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const ids = async (db: Db, table: string, productId: string) => {
  const { data } = await (db.from(table as never) as any).select("id").eq("product_id", productId).limit(10000);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
};

export async function addNegativePair(db: Db, a: string, b: string, reason: string, by: string | null) {
  if (a === b) return;
  const [x, y] = a < b ? [a, b] : [b, a];
  await db.from("identity_negative_pairs").upsert({ product_a: x, product_b: y, reason, decided_by: by }, { onConflict: "product_a,product_b" });
}

/** Mescla duplicado REAL, registrando tudo para poder desfazer. */
export async function mergeProductsV3(db: Db, keepId: string, dropId: string, meta: { by: string | null; reason: string; score?: number }) {
  if (keepId === dropId) throw new Error("Produtos iguais.");
  const { data: neg } = await db
    .from("identity_negative_pairs")
    .select("id")
    .eq("product_a", keepId < dropId ? keepId : dropId)
    .eq("product_b", keepId < dropId ? dropId : keepId)
    .maybeSingle();
  if (neg) throw new Error("Estes produtos já foram marcados como diferentes.");

  const { data: drop } = await db.from("products").select("*").eq("id", dropId).maybeSingle();
  const { data: keep } = await db.from("products").select("id").eq("id", keepId).maybeSingle();
  if (!drop || !keep) throw new Error("Produto não encontrado.");

  const tables = ["supplier_products", "restock_items", "catalog_order_items", "cart_items", "product_views", "back_in_stock_subscriptions", "back_in_stock_notifications", "product_identity_history"];
  const moved: Record<string, string[]> = {};
  for (const t of tables) moved[t] = await ids(db, t, dropId);

  const [{ data: favs }, { data: det }, { data: notes }, { data: accords }, { data: override }, { data: costs }, { data: promos }, { data: coupons }, keepHas] = await Promise.all([
    db.from("favorites").select("*").eq("product_id", dropId),
    db.from("fragrance_details").select("*").eq("product_id", dropId),
    db.from("fragrance_notes").select("*").eq("product_id", dropId),
    db.from("fragrance_accords").select("*").eq("product_id", dropId),
    db.from("pricing_overrides").select("*").eq("product_id", dropId),
    db.from("product_costs").select("*").eq("product_id", dropId),
    db.from("promotions").select("id, product_ids").contains("product_ids", [dropId]),
    db.from("coupons").select("id, product_ids").contains("product_ids", [dropId]),
    Promise.all([
      db.from("fragrance_details").select("product_id").eq("product_id", keepId).maybeSingle(),
      db.from("fragrance_notes").select("id").eq("product_id", keepId).limit(1),
      db.from("fragrance_accords").select("id").eq("product_id", keepId).limit(1),
      db.from("pricing_overrides").select("id").eq("product_id", keepId).maybeSingle(),
    ]),
  ]);

  const payload = {
    engineVersion: ENGINE_VERSION,
    dropProduct: drop,
    moved,
    favorites: favs ?? [],
    fragrance: { details: det ?? [], notes: notes ?? [], accords: accords ?? [] },
    keepHad: { details: !!keepHas[0].data, notes: !!(keepHas[1].data ?? []).length, accords: !!(keepHas[2].data ?? []).length, override: !!keepHas[3].data },
    override: override ?? [],
    costs: costs ?? [],
    promotions: promos ?? [],
    coupons: coupons ?? [],
  };

  const { mergeInto } = await import("@/lib/catalog/dedupe.server");
  await mergeInto(db as never, keepId, dropId, { score: meta.score ?? 1, signals: { engine: ENGINE_VERSION, reason: meta.reason }, by: meta.by });

  // ofertas movidas passam a ter vínculo manual persistente
  for (const sp of moved["supplier_products"] ?? []) {
    await db.from("identity_mappings").upsert(
      { supplier_product_id: sp, product_id: keepId, state: "MANUALLY_MATCHED", engine_version: ENGINE_VERSION, decided_by: meta.by, updated_at: new Date().toISOString(), signals: { via: "merge" } as never },
      { onConflict: "supplier_product_id" },
    );
  }
  const { data: log } = await db
    .from("identity_merge_log")
    .insert({ action: "merge", source_product_ids: [dropId], target_product_id: keepId, reason: meta.reason, score: meta.score ?? null, payload: payload as never, created_by: meta.by })
    .select("id")
    .single();
  return { logId: log?.id };
}

/** Desfaz uma mesclagem V3 restaurando o produto e tudo que foi movido. */
export async function undoMergeV3(db: Db, logId: string, by: string | null) {
  const { data: log } = await db.from("identity_merge_log").select("*").eq("id", logId).maybeSingle();
  if (!log || log.action !== "merge") throw new Error("Mesclagem não encontrada.");
  if (log.reverted_at) return { already: true };
  const p = log.payload as any;
  const dropId = log.source_product_ids[0]!;
  const keepId = log.target_product_id!;

  const { error } = await db.from("products").insert(p.dropProduct);
  if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);

  for (const [table, list] of Object.entries(p.moved as Record<string, string[]>)) {
    for (let i = 0; i < list.length; i += 200)
      await (db.from(table as never) as any).update({ product_id: dropId }).in("id", list.slice(i, i + 200));
  }
  // favoritos: restaura os originais (os que foram removidos por já existirem no vencedor voltam)
  for (const f of p.favorites ?? []) {
    const { data: exists } = await db.from("favorites").select("id").eq("id", f.id).maybeSingle();
    if (exists) await db.from("favorites").update({ product_id: dropId }).eq("id", f.id);
    else await db.from("favorites").insert(f);
  }
  // dados olfativos
  const restore = async (table: "fragrance_details" | "fragrance_notes" | "fragrance_accords", rows: any[], keepHad: boolean) => {
    if (!rows.length) return;
    if (!keepHad) await db.from(table).delete().eq("product_id", keepId);
    await (db.from(table) as any).upsert(rows);
  };
  await restore("fragrance_details", p.fragrance.details, p.keepHad.details);
  await restore("fragrance_notes", p.fragrance.notes, p.keepHad.notes);
  await restore("fragrance_accords", p.fragrance.accords, p.keepHad.accords);
  if ((p.override ?? []).length) {
    if (!p.keepHad.override) await db.from("pricing_overrides").delete().eq("product_id", keepId);
    await (db.from("pricing_overrides") as any).upsert(p.override);
  }
  if ((p.costs ?? []).length) await (db.from("product_costs") as any).upsert(p.costs);
  for (const pr of p.promotions ?? []) await db.from("promotions").update({ product_ids: pr.product_ids }).eq("id", pr.id);
  for (const c of p.coupons ?? []) await db.from("coupons").update({ product_ids: c.product_ids }).eq("id", c.id);

  await db.from("product_merges").delete().eq("merged_product_id", dropId).eq("canonical_product_id", keepId);
  for (const sp of p.moved["supplier_products"] ?? [])
    await db.from("identity_mappings").update({ product_id: dropId, state: "MANUALLY_MATCHED", decided_by: by, updated_at: new Date().toISOString() }).eq("supplier_product_id", sp);
  await addNegativePair(db, keepId, dropId, "Mesclagem desfeita", by);
  await db.rpc("recompute_product_pricing", { p_product_id: keepId });
  await db.rpc("recompute_product_pricing", { p_product_id: dropId });
  await db.from("identity_merge_log").update({ reverted_at: new Date().toISOString(), reverted_by: by }).eq("id", logId);
  await db.from("identity_merge_log").insert({ action: "undo", source_product_ids: [dropId], target_product_id: keepId, reason: `Desfez ${logId}`, created_by: by });
  return { ok: true };
}

/** Separa ofertas misturadas em um novo produto canônico (ex.: Yara + Yara Elixir). */
export async function splitProductV3(
  db: Db,
  input: { productId: string; offerIds: string[]; name: string; flanker?: string | null; by: string | null },
) {
  if (!input.offerIds.length) throw new Error("Escolha ao menos uma oferta.");
  const { data: src } = await db.from("products").select("*").eq("id", input.productId).maybeSingle();
  if (!src) throw new Error("Produto não encontrado.");
  const { count } = await db.from("supplier_products").select("id", { count: "exact", head: true }).eq("product_id", src.id);
  if ((count ?? 0) <= input.offerIds.length) throw new Error("Deixe ao menos uma oferta no produto original.");

  const { data: firstOffer } = await db.from("supplier_products").select("image_url, volume_ml, concentration").eq("id", input.offerIds[0]!).maybeSingle();
  const slug = `${String(src.slug).slice(0, 60)}-${Math.random().toString(36).slice(2, 7)}`;
  const { data: created, error } = await db
    .from("products")
    .insert({
      canonical_name: input.name.trim(),
      slug,
      brand: src.brand,
      brand_id: src.brand_id,
      product_type: src.product_type,
      gender_norm: src.gender_norm,
      flanker: input.flanker ?? null,
      concentration: firstOffer?.concentration ?? src.concentration,
      volume_ml: firstOffer?.volume_ml ?? src.volume_ml,
      image_url: firstOffer?.image_url ?? null,
      decant_available: src.decant_available,
      active: src.active,
      catalog_eligible: src.catalog_eligible,
      in_stock: false,
      identity_status: "confirmada",
      canonical_identity_locked: true,
    } as never)
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Não foi possível criar o produto separado.");

  await db.from("supplier_products").update({ product_id: created.id, link_locked: true }).in("id", input.offerIds);
  const now = new Date().toISOString();
  for (const o of input.offerIds)
    await db.from("identity_mappings").upsert({ supplier_product_id: o, product_id: created.id, state: "MANUALLY_MATCHED", engine_version: ENGINE_VERSION, decided_by: input.by, updated_at: now, signals: { via: "split" } as never }, { onConflict: "supplier_product_id" });
  const { data: rest } = await db.from("supplier_products").select("id").eq("product_id", src.id);
  for (const o of rest ?? [])
    await db.from("identity_mappings").upsert({ supplier_product_id: o.id, product_id: src.id, state: "MANUALLY_MATCHED", engine_version: ENGINE_VERSION, decided_by: input.by, updated_at: now, signals: { via: "split" } as never }, { onConflict: "supplier_product_id" });
  await db.from("products").update({ canonical_identity_locked: true }).eq("id", src.id);
  await addNegativePair(db, src.id, created.id, "Separação manual", input.by);
  await db.from("product_field_provenance").upsert([
    { product_id: created.id, field: "canonical_name", source: "manual", locked: true, value: input.name as never, updated_by: input.by },
    { product_id: src.id, field: "canonical_name", source: "manual", locked: true, value: src.canonical_name as never, updated_by: input.by },
  ]);
  await db.rpc("recompute_product_pricing", { p_product_id: src.id });
  await db.rpc("recompute_product_pricing", { p_product_id: created.id });
  await db.from("identity_merge_log").insert({
    action: "split", source_product_ids: [src.id], target_product_id: created.id, reason: `Separado: ${input.name}`,
    payload: { offerIds: input.offerIds } as never, created_by: input.by,
  });
  return { newProductId: created.id };
}

/** Vínculo manual oferta → produto (autoridade sobre a sync). Aprende alias do fornecedor. */
export async function linkOfferV3(db: Db, offerId: string, productId: string, by: string | null) {
  const { data: offer } = await db.from("supplier_products").select("id, product_id, supplier_id, supplier_product_name").eq("id", offerId).maybeSingle();
  if (!offer) throw new Error("Oferta não encontrada.");
  await db.from("supplier_products").update({ product_id: productId, link_locked: true }).eq("id", offerId);
  await db.from("identity_mappings").upsert(
    { supplier_product_id: offerId, product_id: productId, state: "MANUALLY_MATCHED", engine_version: ENGINE_VERSION, decided_by: by, updated_at: new Date().toISOString(), signals: { previous: offer.product_id } as never },
    { onConflict: "supplier_product_id" },
  );
  if (offer.supplier_product_name) {
    const { key } = await import("./engine");
    const k = key(offer.supplier_product_name);
    const { data: existing } = await db.from("catalog_aliases").select("id, confirmations").eq("alias_type", "supplier").eq("alias_key", k).eq("product_id", productId).maybeSingle();
    if (existing) await db.from("catalog_aliases").update({ confirmations: existing.confirmations + 1 }).eq("id", existing.id);
    else await db.from("catalog_aliases").insert({ alias_type: "supplier", alias: offer.supplier_product_name, alias_key: k, product_id: productId, supplier_id: offer.supplier_id, source: "revisao" });
  }
  await db.rpc("recompute_product_pricing", { p_product_id: productId });
  await db.from("identity_merge_log").insert({ action: "link", target_product_id: productId, reason: "Vínculo manual", payload: { offerId, previous: offer.product_id } as never, created_by: by });
}

export async function separateOfferV3(db: Db, offerId: string, rejectedProductId: string | null, by: string | null) {
  await db.from("supplier_products").update({ link_locked: true }).eq("id", offerId);
  await db.from("identity_mappings").upsert(
    { supplier_product_id: offerId, product_id: null, state: "MANUALLY_SEPARATED", engine_version: ENGINE_VERSION, decided_by: by, updated_at: new Date().toISOString(), signals: { rejected: rejectedProductId } as never },
    { onConflict: "supplier_product_id" },
  );
}

export { pairKey };
