import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { perfumeKey, plain, sameVariant, variantOf, type Variant } from "@/lib/perfume-key";

/**
 * De onde dá para comprar cada perfume, para o "Novo pedido":
 * - `byProduct`: ofertas de todos os fornecedores ligadas aos NOSSOS perfumes
 *   (KL, MRX, Smart, Rasha…). O card é um só; o fornecedor se escolhe no item.
 * - `extras`: perfumes que só existem nos fornecedores de consulta (Rasha,
 *   Amado). Aparecem na vitrine do pedido como um perfume normal, mas nunca no
 *   site. O mesmo perfume em dois fornecedores vira um card só.
 */

export type SupplyOption = {
  /** supplier_products.id */
  id: string;
  supplierId: string;
  supplier: string;
  cost: number | null;
  available: boolean;
  /** fornecedor só de consulta (preço de atacado, não entra no preço do site) */
  consult: boolean;
  url: string | null;
  /** nome e foto do perfume no fornecedor */
  name?: string;
  imageUrl?: string | null;
};

export type SupplyExtra = {
  key: string;
  name: string;
  brand: string | null;
  volumeMl: number | null;
  imageUrl: string | null;
  offers: SupplyOption[];
};

export type ComposerSupply = { byProduct: Record<string, SupplyOption[]>; extras: SupplyExtra[] };

async function assertStaff(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!data) throw new Error("Sem permissão.");
}

const NOT_A_BOTTLE = /\b(decant|decante|kit|miniatura|miniature|body|splash|mist|hidratante|creme|pasta|oleo|bakhoor|queimador|desodorante|refil|amostra)\b/;

/** "Art Of Universe EDP Lattafa Perfumes - Compartilhável 100ml" → "Art Of Universe" */
function displayName(raw: string, brand: string | null) {
  let n = raw.split(" - ")[0]!;
  if (brand) n = n.replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  n = n
    .replace(/\b(perfumes?|edp|edt|extrait|extrato|de parfum|eau de parfum|parfum|masculino|feminino|unissex|compartilh[aá]vel)\b/gi, " ")
    .replace(/\b\d{2,3}\s?ml\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n
    .split(" ")
    .map((w) => (w.length > 2 && w === w.toLowerCase() ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>) {
  const out: T[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await build(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const composerSupply = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ComposerSupply> => {
    await assertStaff(context as never);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: sups } = await db.from("suppliers").select("id, name, active, use_for_pricing, use_for_purchasing");
    const sup = new Map((sups ?? []).filter((s) => s.active).map((s) => [s.id, s]));
    const consult = (id: string) => {
      const s = sup.get(id);
      return !!s && s.use_for_pricing === false && s.use_for_purchasing === false;
    };
    const ids = [...sup.keys()];
    const cols = "id, supplier_id, product_id, supplier_product_name, brand, volume_ml, concentration, image_url, price, in_stock, availability_status, url, product_type";
    const rows = await all<any>((a, b) => db.from("supplier_products").select(cols).eq("active", true).in("supplier_id", ids).order("id").range(a, b));
    const { data: brands } = await db.from("brands").select("canonical_name");
    // nossos perfumes por chave: oferta de consulta com o mesmo nome vira opção do nosso card
    const ours = await all<any>((a, b) =>
      db.from("products").select("id, canonical_name, volume_ml, concentration").eq("active", true).eq("product_type", "PERFUME").order("id").range(a, b),
    );
    const ourByKey = new Map<string, Array<{ id: string; v: number | null; variant: Variant }>>();
    for (const p of ours) {
      const k = perfumeKey(p.canonical_name ?? "");
      if (k) (ourByKey.get(k) ?? ourByKey.set(k, []).get(k)!).push({ id: p.id, v: p.volume_ml, variant: variantOf(p.canonical_name, p.concentration) });
    }
    /**
     * Nosso perfume com o mesmo nome, mesma versão (EDT ≠ EDP ≠ Parfum) e mesmo ml.
     * Se a oferta não diz ml nem concentração e temos mais de uma versão, não chuta.
     */
    const ourMatch = (key: string, v: number | null, variant: Variant) => {
      const list = ourByKey.get(key);
      if (!list) return null;
      const same = list.filter((p) => (v == null || p.v == null || p.v === v) && sameVariant(variant, p.variant));
      if (!same.length) return null;
      const exact = same.find((p) => v != null && p.v === v);
      if (exact) return exact.id;
      if (same.length > 1 && v == null && !variant.conc) return null;
      return (same.find((p) => p.v === 100) ?? same[0]!).id;
    };
    const brandList = (brands ?? [])
      .map((b) => b.canonical_name as string)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    const option = (r: any): SupplyOption => ({
      id: r.id,
      supplierId: r.supplier_id,
      supplier: sup.get(r.supplier_id)?.name ?? "Fornecedor",
      cost: r.price == null ? null : Number(r.price),
      available: r.availability_status ? r.availability_status !== "UNAVAILABLE" : r.in_stock !== false,
      consult: consult(r.supplier_id),
      url: r.url ?? null,
      name: r.supplier_product_name ?? undefined,
      imageUrl: r.image_url ?? null,
    });
    const order = (a: SupplyOption, b: SupplyOption) =>
      Number(b.available) - Number(a.available) || Number(a.consult) - Number(b.consult) || (a.cost ?? 1e9) - (b.cost ?? 1e9);

    const byProduct: Record<string, SupplyOption[]> = {};
    const groups = new Map<string, SupplyExtra>();
    for (const r of rows) {
      if (r.product_id) {
        (byProduct[r.product_id] ??= []).push(option(r));
        continue;
      }
      if (!consult(r.supplier_id)) continue;
      if (r.product_type && r.product_type !== "PERFUME") continue;
      const name = String(r.supplier_product_name ?? "");
      if (NOT_A_BOTTLE.test(plain(name)) || (r.volume_ml != null && r.volume_ml < 25)) continue;
      const lower = plain(name);
      const brand = r.brand ?? brandList.find((b) => lower.includes(plain(b))) ?? null;
      const key = perfumeKey(name);
      if (!key) continue;
      const mine = ourMatch(key, r.volume_ml ?? null, variantOf(name, r.concentration));
      if (mine) {
        (byProduct[mine] ??= []).push(option(r));
        continue;
      }
      const g = groups.get(key);
      if (g) {
        g.offers.push(option(r));
        g.imageUrl ??= r.image_url ?? null;
        g.brand ??= brand;
        g.volumeMl ??= r.volume_ml ?? null;
      } else {
        groups.set(key, {
          key,
          name: displayName(name, brand),
          brand,
          volumeMl: r.volume_ml ?? null,
          imageUrl: r.image_url ?? null,
          offers: [option(r)],
        });
      }
    }
    for (const list of Object.values(byProduct)) list.sort(order);
    const extras = [...groups.values()];
    extras.forEach((e) => e.offers.sort(order));
    extras.sort((a, b) => Number(!!b.imageUrl) - Number(!!a.imageUrl) || a.name.localeCompare(b.name));
    return { byProduct, extras };
  });

/** Procura o perfume em qualquer fornecedor para ligar ao nosso (ex.: Black Exposed na Rasha). */
export const searchSupplierOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q: string }) => ({ q: String(d?.q ?? "").trim().slice(0, 60) }))
  .handler(async ({ data, context }): Promise<Array<SupplyOption & { name: string; linkedTo: string | null }>> => {
    await assertStaff(context as never);
    const words = plain(data.q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2).slice(0, 5);
    if (!words.length) return [];
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: sups } = await db.from("suppliers").select("id, name, use_for_pricing, use_for_purchasing").eq("active", true);
    const sup = new Map((sups ?? []).map((s) => [s.id, s]));
    let q = db
      .from("supplier_products")
      .select("id, supplier_id, product_id, supplier_product_name, price, in_stock, availability_status, url, image_url, products(canonical_name)")
      .eq("active", true)
      .in("supplier_id", [...sup.keys()]);
    for (const w of words) q = q.ilike("normalized_name", `%${w}%`);
    const { data: rows } = await q.limit(30);
    return (rows ?? []).map((r: any) => {
      const s = sup.get(r.supplier_id);
      return {
        id: r.id,
        supplierId: r.supplier_id,
        supplier: s?.name ?? "Fornecedor",
        cost: r.price == null ? null : Number(r.price),
        available: r.availability_status ? r.availability_status !== "UNAVAILABLE" : r.in_stock !== false,
        consult: s?.use_for_pricing === false && s?.use_for_purchasing === false,
        url: r.url ?? null,
        name: r.supplier_product_name,
        imageUrl: r.image_url ?? null,
        linkedTo: r.product_id ? (r.products?.canonical_name ?? "outro perfume") : null,
      };
    });
  });

/** Liga a oferta de um fornecedor ao nosso perfume (só se ela ainda estiver solta). */
export const linkOfferToProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { offerId: string; productId: string }) => {
    if (typeof d?.offerId !== "string" || typeof d?.productId !== "string") throw new Error("Dados inválidos.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context as never);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: o } = await db.from("supplier_products").select("id, product_id").eq("id", data.offerId).maybeSingle();
    if (!o) throw new Error("Oferta não encontrada.");
    if (o.product_id && o.product_id !== data.productId) throw new Error("Essa oferta já é de outro perfume.");
    if (!o.product_id) {
      const { error } = await db.from("supplier_products").update({ product_id: data.productId }).eq("id", data.offerId).is("product_id", null);
      if (error) throw new Error("Não foi possível ligar este fornecedor.");
    }
    return { ok: true as const };
  });
