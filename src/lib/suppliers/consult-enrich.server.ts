/**
 * Fornecedores só de consulta (Rasha, Amado): liga cada perfume ao nosso
 * catálogo e completa a foto — automático e sem custo (só dados que já estão
 * no banco, nenhuma requisição paga):
 *
 * 1. Liga a oferta ao NOSSO perfume com o mesmo nome (e mesmo volume).
 * 2. Foto que falta, em ordem: o mesmo item em outro fornecedor (KL, MRX,
 *    Smart, Amado…) → o mesmo item no NOSSO catálogo (foto da loja) → o índice
 *    Fragrantica já salvo (`fragrantica_index`, foto oficial em fimgs.net).
 *    Kits, body splash, pastas, óleos etc. também ganham foto, mas só de um item
 *    do mesmo tipo (fornecedor ou catálogo) — nunca da Fragrantica, que só tem frascos.
 *
 * Roda sozinho pelo agendamento `consult-enrich` (marca nova às :05, ligação e
 * fotos às :35 de cada hora) — ver /api/public/hooks/consult-enrich.
 */
import { makeKeyIndex, perfumeKey, plain, sameVariant, variantOf } from "@/lib/perfume-key";

type Db = any;

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: unknown }>) {
  const out: T[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await build(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/* paginar SEMPRE com .order("id"): sem ordem fixa, o banco pode devolver linhas
   repetidas ou pular linhas entre uma página e outra. */

/** grava em lotes de 25 ao mesmo tempo (centenas de linhas sem estourar o tempo do servidor) */
async function inBatches<T>(list: T[], run: (x: T) => PromiseLike<unknown>) {
  for (let i = 0; i < list.length; i += 25) await Promise.all(list.slice(i, i + 25).map(run));
}

const sameVolume = (a: number | null, b: number | null) => a == null || b == null || a === b;

/** marcas compatíveis: uma contém a outra ("Lattafa" × "Lattafa Perfumes") ou alguma é desconhecida */
function sameBrand(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return true;
  const x = plain(a).replace(/[^a-z0-9]+/g, " ").trim();
  const y = plain(b).replace(/[^a-z0-9]+/g, " ").trim();
  return x.includes(y) || y.includes(x) || x.split(" ")[0] === y.split(" ")[0];
}

/** "…/perfume/Lattafa/Black-Exposed-12345.html" → foto oficial 375×500 */
export function fragranticaImage(url: string | null | undefined) {
  const id = String(url ?? "").match(/-(\d+)\.html/)?.[1];
  return id ? `https://fimgs.net/mdimg/perfume/375x500.${id}.jpg` : null;
}

const NOT_A_BOTTLE = /\b(decant|decante|kit|miniatura|miniature|body|splash|mist|hidratante|creme|pasta|oleo|bakhoor|queimador|desodorante|refil|amostra)\b/;

/**
 * Lê na Fragrantica a página de UMA marca que ainda falta no índice (cache de
 * 7 dias). Fica separado da ligação/fotos para cada chamada caber no tempo do servidor.
 */
export async function learnOneConsultBrand(db: Db) {
  const { data: sups } = await db.from("suppliers").select("id, active, use_for_pricing, use_for_purchasing");
  const ids = (sups ?? []).filter((s: any) => s.active && s.use_for_pricing === false && s.use_for_purchasing === false).map((s: any) => s.id);
  if (!ids.length) return { brand: null };
  const rows = await all<any>((a, b) =>
    db.from("supplier_products").select("brand").in("supplier_id", ids).eq("active", true).is("image_url", null).not("brand", "is", null).order("id").range(a, b),
  );
  const brands = [...new Set(rows.map((r) => r.brand as string))];
  const { data: known } = await db.from("fragrantica_brand_pages").select("brand_norm");
  const { brandCandidates, norm } = await import("@/lib/catalog/fragrantica-search.server");
  const done = new Set((known ?? []).map((k: any) => k.brand_norm));
  const next = brands.find((b) => !done.has(norm(b)));
  if (!next) return { brand: null };
  const r = await brandCandidates(db, next);
  return { brand: next, found: r.candidates.length };
}

export async function enrichConsultOffers(db: Db): Promise<{ linked: number; photos: number; without?: number }> {
  const { data: sups } = await db.from("suppliers").select("id, active, use_for_pricing, use_for_purchasing");
  const consultIds = (sups ?? [])
    .filter((s: any) => s.active && s.use_for_pricing === false && s.use_for_purchasing === false)
    .map((s: any) => s.id as string);
  if (!consultIds.length) return { linked: 0, photos: 0 };

  const offers = await all<any>((a, b) =>
    db
      .from("supplier_products")
      .select("id, supplier_id, product_id, supplier_product_name, brand, volume_ml, concentration, image_url, product_type")
      .eq("active", true)
      .order("id").range(a, b),
  );
  const consult = new Set(consultIds);
  const isBottle = (o: any) => (!o.product_type || o.product_type === "PERFUME") && !NOT_A_BOTTLE.test(plain(o.supplier_product_name ?? ""));
  const everything = offers.filter((o) => consult.has(o.supplier_id));
  // ligar ao nosso perfume: só frascos
  const mine = everything.filter(isBottle);

  // 1) ligar ao nosso perfume
  const products = await all<any>((a, b) =>
    db
      .from("products")
      .select("id, canonical_name, brand, volume_ml, concentration, image_url, catalog_eligibility_reason")
      .eq("active", true)
      .eq("product_type", "PERFUME")
      .order("id").range(a, b),
  );
  const ours = makeKeyIndex(
    products
      .filter((p) => p.catalog_eligibility_reason !== "excluido-manualmente")
      .map((p) => ({ key: perfumeKey(p.canonical_name ?? ""), item: p })),
  );
  const links: Array<{ id: string; product: string }> = [];
  const vOf = (o: any) => variantOf(o.supplier_product_name ?? o.canonical_name ?? o.name, o.concentration);
  for (const o of mine) {
    if (o.product_id) continue;
    const key = perfumeKey(o.supplier_product_name ?? "");
    const ov = vOf(o);
    const fits = (p: any) => sameVolume(o.volume_ml, p.volume_ml) && sameBrand(o.brand, p.brand) && sameVariant(ov, vOf(p));
    const hit = ours.best(key, 0.8, fits);
    // ambíguo (ex.: "Club de Nuit Intense Man" sem ml nem concentração, e temos EDT, EDP e Parfum): não chuta
    if (hit && o.volume_ml == null && !ov.conc && ours.exact(key).filter(fits).length > 1) continue;
    if (hit) {
      links.push({ id: o.id, product: hit.item.id });
      o.product_id = hit.item.id;
    }
  }
  await inBatches(links, (l) => db.from("supplier_products").update({ product_id: l.product }).eq("id", l.id).is("product_id", null));

  // 2) fotos que faltam (frascos e também kits, body splash, pastas…)
  const withPhoto = makeKeyIndex(offers.filter((o) => o.image_url).map((o) => ({ key: perfumeKey(o.supplier_product_name ?? ""), item: o })));
  // fotos do nosso catálogo (qualquer tipo), com a marca no nome para a chave bater com "Nome Marca"
  const shopPhotos = await all<any>((a, b) =>
    db.from("products").select("id, canonical_name, brand, volume_ml, concentration, image_url").eq("active", true).not("image_url", "is", null).order("id").range(a, b),
  );
  const shopIndex = makeKeyIndex(shopPhotos.map((p) => ({ key: perfumeKey(p.canonical_name ?? ""), item: p })));
  // foto da loja servida por rota relativa: o Admin abre no mesmo endereço
  const shopUrl = (u: string) => u;

  const frag = await all<any>((a, b) => db.from("fragrantica_index").select("url, brand, name, year").order("id").range(a, b));
  const fragIndex = makeKeyIndex(frag.map((f) => ({ key: perfumeKey(f.name ?? ""), item: f })));

  const updates: Array<{ id: string; url: string }> = [];
  for (const o of everything) {
    if (o.image_url) continue;
    const key = perfumeKey(o.supplier_product_name ?? "");
    if (!key) continue;
    let url: string | null = null;
    const ov = vOf(o);
    const other = withPhoto.best(key, 0.8, (x) => x.id !== o.id && sameVolume(o.volume_ml, x.volume_ml) && sameBrand(o.brand, x.brand) && sameVariant(ov, vOf(x)));
    if (other) url = other.item.image_url;
    if (!url) {
      const shop = shopIndex.best(key, 0.8, (p) => sameVolume(o.volume_ml, p.volume_ml) && sameBrand(o.brand, p.brand) && sameVariant(ov, vOf(p)));
      if (shop) url = shopUrl(shop.item.image_url);
    }
    if (!url && isBottle(o)) {
      const f = fragIndex.best(key, 0.8, (x) => sameBrand(o.brand, x.brand) && sameVariant(ov, variantOf(x.name)));
      if (f) url = fragranticaImage(f.item.url);
    }
    if (url) {
      updates.push({ id: o.id, url });
      o.image_url = url;
    }
  }
  await inBatches(updates, (u) => db.from("supplier_products").update({ image_url: u.url, image_urls: [u.url] }).eq("id", u.id).is("image_url", null));
  const photos = updates.length;

  return { linked: links.length, photos, without: everything.filter((o) => !o.image_url).length };
}
