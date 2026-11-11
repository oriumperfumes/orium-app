/**
 * Product Identity Engine — passada de normalização sobre o catálogo atual.
 *
 * O que faz em cada bloco:
 * 1. lê o produto canônico e os títulos brutos dos fornecedores (nunca apagados);
 * 2. calcula o nome público correto (linha, versão, siglas, sem letras separadas);
 * 3. corrige a marca quando a linha tem dona conhecida (conflito de marca);
 * 4. grava os apelidos de busca (as grafias antigas continuam pesquisáveis);
 * 5. manda para revisão o que ficou ambíguo.
 *
 * Nunca altera produto com identidade travada pelo dono (canonical_identity_locked).
 */
import { buildAliases, canonicalizeProductName, searchKey } from "./canonical";
import { ensureBrand, registerBrandAlias } from "./identity.server";
import { cleanText } from "@/lib/suppliers/normalize.server";

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export type NormalizeResult = {
  processed: number;
  renamed: number;
  aliases: number;
  conflicts: number;
  review: number;
  cursor: number;
  done: boolean;
  message: string;
};

const BATCH = 100;

export async function runNameNormalization(cursor = 0): Promise<NormalizeResult> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

  const { data: rows } = await db
    .from("products")
    .select(
      "id, canonical_name, raw_name, brand, brand_id, product_type, product_line, search_aliases, canonical_identity_locked, identity_status",
    )
    .eq("active", true)
    .order("created_at", { ascending: true })
    .range(cursor, cursor + BATCH - 1);

  const list = rows ?? [];
  if (!list.length) {
    return { processed: 0, renamed: 0, aliases: 0, conflicts: 0, review: 0, cursor, done: true, message: "Catálogo já revisado." };
  }

  const ids = list.map((p) => p.id);
  const { data: offers } = await db
    .from("supplier_products")
    .select("product_id, supplier_product_name, brand")
    .in("product_id", ids);

  const titlesByProduct = new Map<string, string[]>();
  for (const o of offers ?? []) {
    if (!o.product_id) continue;
    const arr = titlesByProduct.get(o.product_id) ?? [];
    arr.push(cleanText(o.supplier_product_name));
    titlesByProduct.set(o.product_id, arr);
  }

  let renamed = 0;
  let aliasCount = 0;
  let conflicts = 0;
  let review = 0;

  for (const p of list) {
    if (p.canonical_identity_locked) continue;

    const supplierTitles = titlesByProduct.get(p.id) ?? [];
    const c = canonicalizeProductName(p.canonical_name, { brand: p.brand });

    let brandName = p.brand;
    let brandId = p.brand_id;
    let conflict = false;

    // Linha com dona conhecida: marca divergente é conflito de identidade (só perfumes).
    if (c.lineBrand && p.product_type === "PERFUME" && searchKey(p.brand ?? "") !== searchKey(c.lineBrand)) {
      const ensured = await ensureBrand(db, c.lineBrand, "identity-engine");
      if (ensured?.id) {
        if (p.brand) await registerBrandAlias(db, ensured.id, p.brand, "conflito-de-marca").catch(() => undefined);
        brandName = ensured.name;
        brandId = ensured.id;
        conflict = true;
        conflicts++;
      }
    }

    const aliases = buildAliases(c.name, [
      p.canonical_name,
      ...supplierTitles,
      brandName ? `${brandName} ${c.name}` : null,
      c.line,
      p.raw_name,
    ]);

    const nameChanged = cleanText(c.name) !== cleanText(p.canonical_name);
    const needsReview = c.suspicious.length > 0 || c.needsVersion;
    if (needsReview) review++;

    await db
      .from("products")
      .update({
        canonical_name: c.name,
        product_line: c.line,
        brand: brandName,
        brand_id: brandId,
        raw_name: p.raw_name ?? supplierTitles[0] ?? p.canonical_name,
        search_aliases: aliases,
        brand_review_required: !brandId,
        ...(needsReview ? { identity_status: "revisar" } : {}),
        ...(conflict ? { identity_source: "identity-engine", identity_confidence: 0.95 } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", p.id);

    aliasCount += aliases.length;
    if (nameChanged || conflict) {
      renamed += nameChanged ? 1 : 0;
      await db.from("activity_logs").insert({
        action: "identidade-normalizada",
        entity: "products",
        entity_id: p.id,
        details: {
          antes: p.canonical_name,
          depois: c.name,
          marca_antes: p.brand,
          marca_depois: brandName,
          linha: c.line,
          motivos: c.suspicious,
          fonte: "Product Identity Engine",
        } as never,
      });
    }
  }

  const next = cursor + list.length;
  return {
    processed: list.length,
    renamed,
    aliases: aliasCount,
    conflicts,
    review,
    cursor: next,
    done: list.length < BATCH,
    message: `${list.length} produtos revisados · ${renamed} nomes corrigidos · ${conflicts} conflitos de marca · ${review} para conferir`,
  };
}

export type IdentityMetrics = {
  total: number;
  semMarcaPerfume: number;
  semMarcaCosmetico: number;
  aguardandoRevisao: number;
  nomesSuspeitos: number;
  buscasSemResultado: number;
};

/** Números da auditoria mostrados no Admin. */
export async function identityMetrics(): Promise<IdentityMetrics> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const base = () => db.from("products").select("id", { count: "exact", head: true }).eq("active", true);

  const total = (await base()).count ?? 0;
  const semMarcaPerfume = (await base().is("brand_id", null).eq("product_type", "PERFUME")).count ?? 0;
  const semMarcaCosmetico = (await base().is("brand_id", null).neq("product_type", "PERFUME")).count ?? 0;
  const aguardandoRevisao = (await base().eq("identity_status", "revisar")).count ?? 0;

  const { count: suspeitos } = await db
    .from("product_identity_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  const { count: misses } = await db
    .from("catalog_search_misses")
    .select("query_norm", { count: "exact", head: true });

  return {
    total,
    semMarcaPerfume,
    semMarcaCosmetico,
    aguardandoRevisao,
    nomesSuspeitos: suspeitos ?? 0,
    buscasSemResultado: misses ?? 0,
  };
}

/** Recoloca na fila do motor tudo que está sem marca (perfumes, hidratantes e cosméticos). */
export async function requeueBrandless(): Promise<number> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { data } = await db
    .from("products")
    .update({ identity_status: "pendente" })
    .eq("active", true)
    .is("brand_id", null)
    .neq("canonical_identity_locked", true)
    .select("id");
  return (data ?? []).length;
}
