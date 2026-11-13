import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Fornecedores "só consulta" (ex.: Rasha): o catálogo deles nunca vai para o
 * site. A equipe procura um perfume lá e, se quiser, coloca num pedido — aí
 * nasce um produto INTERNO (fora do site), ligado à oferta do fornecedor.
 */
async function assertStaff(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!data) throw new Error("Sem permissão.");
}

export const INTERNAL_REASON = "interno-consulta";

export type ConsultOffer = {
  id: string;
  name: string;
  brand: string | null;
  volumeMl: number | null;
  price: number | null;
  imageUrl: string | null;
  url: string | null;
  supplier: string;
  productId: string | null;
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const searchConsultOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q: string }) => {
    const q = String(d?.q ?? "").trim().slice(0, 60);
    return { q };
  })
  .handler(async ({ data, context }): Promise<ConsultOffer[]> => {
    await assertStaff(context);
    const words = norm(data.q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2).slice(0, 5);
    if (!words.length) return [];
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: sups } = await db.from("suppliers").select("id, name").eq("active", true).eq("use_for_pricing", false).eq("use_for_purchasing", false);
    if (!sups?.length) return [];
    const names = new Map(sups.map((s) => [s.id, s.name]));
    let query = db
      .from("supplier_products")
      .select("id, supplier_id, supplier_product_name, brand, volume_ml, price, image_url, url, product_id")
      .in("supplier_id", sups.map((s) => s.id))
      .eq("active", true);
    for (const w of words) query = query.ilike("normalized_name", `%${w}%`);
    const { data: rows } = await query.order("image_url", { ascending: true, nullsFirst: false }).limit(12);
    return (rows ?? []).map((r) => ({
      id: r.id,
      name: r.supplier_product_name,
      brand: r.brand,
      volumeMl: r.volume_ml,
      price: r.price == null ? null : Number(r.price),
      imageUrl: r.image_url,
      url: r.url,
      supplier: names.get(r.supplier_id) ?? "Fornecedor",
      productId: r.product_id,
    }));
  });

const slugify = (txt: string) =>
  norm(txt)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/** Nome limpo: sem a marca, sem "100ml", sem "EDP". */
function cleanName(raw: string, brand: string | null) {
  let n = ` ${raw} `;
  if (brand) {
    for (const w of [brand, ...brand.split(/\s+/).filter((x) => x.length > 3)]) {
      n = n.replace(new RegExp(`\\s${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s)`, "gi"), " ");
    }
  }
  n = n
    .replace(/\s\d{2,3}\s?ml\b/gi, " ")
    .replace(/\s(edp|edt|extrait|extrato|de|parfum|masculino|feminino|unissex)(?=\s)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n || raw.trim();
}

/** Usa a oferta num pedido: devolve o produto interno (cria se ainda não existe). */
export const productFromConsultOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { offerId: string; alsoIds?: string[] }) => {
    if (typeof d?.offerId !== "string" || d.offerId.length > 64) throw new Error("Oferta inválida.");
    const alsoIds = (Array.isArray(d.alsoIds) ? d.alsoIds : []).filter((x) => typeof x === "string" && x.length <= 64).slice(0, 10);
    return { offerId: d.offerId, alsoIds };
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const COLS =
      "id, canonical_name, brand, volume_ml, image_url, retail_price, wholesale_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, local_stock, gender_norm, catalog_eligibility_reason";
    const { data: offer } = await db
      .from("supplier_products")
      .select("id, supplier_id, supplier_product_name, brand, volume_ml, image_url, image_urls, product_id, suppliers(use_for_pricing)")
      .eq("id", data.offerId)
      .maybeSingle();
    if (!offer) throw new Error("Perfume não encontrado no fornecedor.");
    if ((offer as { suppliers?: { use_for_pricing?: boolean } | null }).suppliers?.use_for_pricing !== false)
      throw new Error("Este fornecedor não é de consulta.");

    if (offer.product_id) {
      const { data: p } = await db.from("products").select(COLS).eq("id", offer.product_id).maybeSingle();
      if (p) return p;
    }

    let brandId: string | null = null;
    let brandName: string | null = offer.brand ?? null;
    if (brandName) {
      const { data: b } = await db.from("brands").select("id, canonical_name").ilike("canonical_name", brandName).maybeSingle();
      if (b) {
        brandId = b.id;
        brandName = b.canonical_name;
      }
    }
    const name = cleanName(offer.supplier_product_name, brandName);
    const root = slugify(`${brandName ?? ""} ${name}`) || "perfume";
    let slug = `${root}-consulta`;
    for (let i = 2; i < 40; i++) {
      const { data: hit } = await db.from("products").select("id").eq("slug", slug).maybeSingle();
      if (!hit) break;
      slug = `${root}-consulta-${i}`;
    }
    const { data: created, error } = await db
      .from("products")
      .insert({
        canonical_name: name,
        raw_name: offer.supplier_product_name,
        brand: brandName,
        brand_id: brandId,
        volume_ml: offer.volume_ml,
        product_type: "PERFUME",
        // interno: nunca aparece no site (public_visible = active && catalog_eligible)
        catalog_eligible: false,
        catalog_eligibility_reason: INTERNAL_REASON,
        source: "supplier",
        visibility_status: "OCULTO",
        sale_mode: "FULL",
        manual_pricing: true,
        decant_available: false,
        image_url: offer.image_url ?? null,
        image_urls: offer.image_urls ?? (offer.image_url ? [offer.image_url] : []),
        identity_source: "fornecedor-consulta",
        canonical_identity_locked: true,
        slug,
      })
      .select(COLS)
      .single();
    if (error || !created) throw new Error(error?.message ?? "Não foi possível usar este perfume.");
    // o mesmo perfume nos outros fornecedores de consulta fica ligado ao mesmo item
    await db
      .from("supplier_products")
      .update({ product_id: created.id })
      .in("id", [offer.id, ...data.alsoIds])
      .is("product_id", null);
    return created;
  });
