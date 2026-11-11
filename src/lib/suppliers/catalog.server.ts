/**
 * Catálogo público por oferta de fornecedor. As decisões vivem em
 * supplier_offer_catalog, que a sincronização nunca escreve; o trigger
 * recalcula a disponibilidade só do produto afetado.
 */
const PAGE = 50;

export function offerIsPublic(mode: string | null | undefined, decision: string | null | undefined) {
  if (decision === "allow") return true;
  if (decision === "deny") return false;
  return (mode ?? "all") === "all";
}

export async function listCatalogOffers(db: any, q: { supplierId: string; search?: string; filter?: "all" | "public" | "hidden" | "linked"; page?: number }) {
  const { data: sup } = await db.from("suppliers").select("id, name, catalog_mode, sync_status, sync_error_code, sync_message, last_successful_sync_at").eq("id", q.supplierId).maybeSingle();
  if (!sup) throw new Error("Fornecedor não encontrado.");
  const page = Math.max(0, q.page ?? 0);
  let query = db
    .from("supplier_products")
    .select("id, supplier_product_name, brand, volume_ml, image_url, price, availability_status, in_stock, product_id, supplier_offer_catalog(decision), products(canonical_name, brand, image_url, in_stock, local_stock)", { count: "exact" })
    .eq("supplier_id", q.supplierId)
    .eq("active", true)
    .order("supplier_product_name")
    .range(page * PAGE, page * PAGE + PAGE - 1);
  const s = (q.search ?? "").trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (s) query = query.ilike("supplier_product_name", `%${s}%`);
  if (q.filter === "linked") query = query.not("product_id", "is", null);
  // Filtros público/oculto dependem do modo do fornecedor + decisão individual.
  if (q.filter === "public" || q.filter === "hidden") {
    const want = q.filter === "public";
    const modeDefault = sup.catalog_mode === "all";
    const opposite = want ? "deny" : "allow";
    if (modeDefault === want) {
      // inherit conta; exclui só quem tem decisão contrária
      const { data: ex } = await db.from("supplier_offer_catalog").select("supplier_product_id").eq("supplier_id", q.supplierId).eq("decision", opposite).limit(5000);
      const ids = (ex ?? []).map((r: any) => r.supplier_product_id);
      if (ids.length) query = query.not("id", "in", `(${ids.join(",")})`);
    } else {
      const { data: inc } = await db.from("supplier_offer_catalog").select("supplier_product_id").eq("supplier_id", q.supplierId).eq("decision", want ? "allow" : "deny").limit(5000);
      const ids = (inc ?? []).map((r: any) => r.supplier_product_id);
      query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
  }
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((o: any) => {
    const dec = (Array.isArray(o.supplier_offer_catalog) ? o.supplier_offer_catalog[0] : o.supplier_offer_catalog)?.decision ?? null;
    return {
      id: o.id as string,
      name: o.supplier_product_name as string,
      brand: (o.brand ?? o.products?.brand ?? null) as string | null,
      volume_ml: o.volume_ml != null ? Number(o.volume_ml) : null,
      image_url: (o.image_url ?? null) as string | null,
      product_image_url: (o.products?.image_url ?? null) as string | null,
      price: o.price != null ? Number(o.price) : null,
      availability: o.availability_status ?? (o.in_stock ? "AVAILABLE" : "UNAVAILABLE"),
      product_id: o.product_id as string | null,
      product_name: o.products?.canonical_name ?? null,
      product_public: o.products ? !!o.products.in_stock : null,
      local_stock: o.products?.local_stock ?? 0,
      decision: dec as "allow" | "deny" | null,
      offer_public: offerIsPublic(sup.catalog_mode, dec),
    };
  });
  return { supplier: sup, rows, total: count ?? rows.length, page, pageSize: PAGE };
}

export async function applyOfferDecision(db: any, supplierId: string, offerIds: string[], decision: "allow" | "deny" | "inherit", userId: string) {
  const ids = [...new Set(offerIds)];
  if (!ids.length) return { changed: 0 };
  // só ofertas deste fornecedor
  const { data: owned } = await db.from("supplier_products").select("id").eq("supplier_id", supplierId).in("id", ids);
  const valid = (owned ?? []).map((r: any) => r.id);
  if (decision === "inherit") {
    const { error } = await db.from("supplier_offer_catalog").delete().in("supplier_product_id", valid);
    if (error) throw new Error(error.message);
  } else {
    const rows = valid.map((id: string) => ({ supplier_product_id: id, supplier_id: supplierId, decision, created_by: userId, updated_at: new Date().toISOString() }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from("supplier_offer_catalog").upsert(rows.slice(i, i + 200), { onConflict: "supplier_product_id" });
      if (error) throw new Error(error.message);
    }
  }
  return { changed: valid.length };
}
