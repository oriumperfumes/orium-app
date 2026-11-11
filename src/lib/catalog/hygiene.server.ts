/**
 * Limpeza do catálogo em duas frentes:
 *
 * 1. Duplicados: agrupa candidatos por marca + primeira palavra do nome
 *    (blocking, sem comparar todos contra todos), compara com todos os sinais,
 *    une automaticamente só ALTA confiança e manda o resto para revisão.
 * 2. Posicionamento: perfumes de marcas designer saem do catálogo. Body splash,
 *    cremes, pastas e hidratantes nunca são afetados por esta regra.
 */
import { brandKey } from "@/lib/suppliers/normalize.server";
import { classifyBrandSegment, DESIGNER_REASON, segmentKey } from "./brand-segment";
import {
  compareProducts,
  identityKeyOf,
  imageSignature,
  mergeInto,
  nameKey,
  pickWinner,
  type DupProduct,
} from "./dedupe.server";

type Db = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const FIELDS =
  "id, canonical_name, brand, brand_id, flanker, concentration, volume_ml, product_type, image_url, image_signature, search_aliases, identity_key, dedupe_key, created_at, in_stock, canonical_identity_locked, identity_verified, active";

/** Lê todos os produtos ativos em páginas (o catálogo é pequeno o bastante). */
async function loadProducts(db: Db): Promise<DupProduct[]> {
  const all: DupProduct[] = [];
  for (let page = 0; page < 20; page++) {
    const { data } = await db
      .from("products")
      .select(FIELDS)
      .neq("product_type", "NEGOCIACAO") // fichas da área Negociação nunca entram na limpeza
      .range(page * 500, page * 500 + 499)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as unknown as DupProduct[];
    all.push(...rows);
    if (rows.length < 500) break;
  }
  return all;
}

/** Preenche identity_key onde falta, para a sincronização reconhecer o produto. */
export async function backfillIdentityKeys(db: Db) {
  const products = await loadProducts(db);
  let filled = 0;
  for (const p of products) {
    const key = identityKeyOf({
      brand: p.brand,
      name: p.canonical_name,
      flanker: p.flanker,
      concentration: p.concentration,
      volumeMl: p.volume_ml,
      productType: p.product_type,
    });
    if (p.identity_key !== key) {
      await db.from("products").update({ identity_key: key }).eq("id", p.id);
      filled++;
    }
  }
  return { total: products.length, filled };
}

export type DuplicateRunResult = {
  analisados: number;
  gruposCandidatos: number;
  unificados: number;
  paraRevisar: number;
  fotosComparadas: number;
  done: boolean;
};

/** Auditoria completa de duplicados sobre o catálogo atual. */
export async function runDuplicateAudit(
  db: Db,
  opts: { maxMerges?: number; maxImageFetches?: number; by?: string | null } = {},
): Promise<DuplicateRunResult> {
  const maxMerges = opts.maxMerges ?? 120;
  const maxImages = opts.maxImageFetches ?? 80;

  const products = await loadProducts(db);
  const alive = new Map(products.map((p) => [p.id, p]));

  // blocking: marca + primeira palavra significativa do nome + tipo
  const blocks = new Map<string, DupProduct[]>();
  for (const p of products) {
    const nk = nameKey(p.canonical_name, p.brand);
    if (!nk) continue;
    const first = nk.split(" ")[0] ?? "";
    const key = `${p.product_type}|${brandKey(p.brand ?? "") || "sem-marca"}|${first.slice(0, 6)}`;
    const list = blocks.get(key) ?? [];
    list.push(p);
    blocks.set(key, list);
  }

  let unificados = 0;
  let paraRevisar = 0;
  let fotos = 0;
  let candidatos = 0;

  for (const [, group] of blocks) {
    if (group.length < 2) continue;
    candidatos++;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        let a = alive.get(group[i]!.id);
        let b = alive.get(group[j]!.id);
        if (!a || !b) continue;

        let verdict = compareProducts(a, b);
        if (verdict.level === "NOT_DUPLICATE") continue;

        // Foto só é buscada quando o texto já indicou possível duplicado.
        if (verdict.level !== "HIGH_CONFIDENCE_DUPLICATE" && fotos < maxImages) {
          for (const p of [a, b]) {
            if (!p.image_signature && p.image_url) {
              const sig = await imageSignature(p.image_url);
              fotos++;
              if (sig) {
                await db.from("products").update({ image_signature: sig }).eq("id", p.id);
                p.image_signature = sig;
              }
            }
          }
          a = alive.get(a.id)!;
          b = alive.get(b.id)!;
          verdict = compareProducts(a, b);
        }

        if (verdict.level === "HIGH_CONFIDENCE_DUPLICATE" && unificados < maxMerges) {
          const winner = pickWinner([a, b]);
          const loser = winner.id === a.id ? b : a;
          // Identidade confirmada na mão nunca é apagada.
          if (loser.canonical_identity_locked || loser.identity_verified) {
            await upsertReview(
              db,
              winner.id,
              loser.id,
              verdict.score,
              verdict.signals,
              "REVIEW_REQUIRED",
            );
            paraRevisar++;
            continue;
          }
          await mergeInto(db, winner.id, loser.id, {
            score: verdict.score,
            signals: verdict.signals,
            by: opts.by ?? null,
          });
          alive.delete(loser.id);
          unificados++;
        } else if (verdict.level === "REVIEW_REQUIRED") {
          const created = await upsertReview(
            db,
            a.id,
            b.id,
            verdict.score,
            verdict.signals,
            "REVIEW_REQUIRED",
          );
          if (created) paraRevisar++;
        }
      }
    }
  }

  await backfillIdentityKeys(db);

  return {
    analisados: products.length,
    gruposCandidatos: candidatos,
    unificados,
    paraRevisar,
    fotosComparadas: fotos,
    done: unificados < maxMerges,
  };
}

/** Fila de revisão: nunca duplica o par nem reabre decisão já tomada. */
async function upsertReview(
  db: Db,
  a: string,
  b: string,
  score: number,
  signals: Record<string, unknown>,
  level: string,
) {
  const [x, y] = [a, b].sort();
  const { data: existing } = await db
    .from("product_duplicates")
    .select("id, status")
    .or(`and(product_a.eq.${x},product_b.eq.${y}),and(product_a.eq.${y},product_b.eq.${x})`)
    .limit(1)
    .maybeSingle();
  if (existing) {
    if (existing.status === "pending") {
      await db
        .from("product_duplicates")
        .update({ score, signals: signals as never, level, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return false;
  }
  await db.from("product_duplicates").insert({
    product_a: x!,
    product_b: y!,
    score,
    status: "pending",
    level,
    signals: signals as never,
  });
  return true;
}

export type BrandRunResult = {
  marcas: number;
  classificadas: number;
  designer: number;
  ocultados: number;
  restaurados: number;
  semClassificacao: number;
};

/** Classifica marcas e aplica a regra de posicionamento SOMENTE em perfumes. */
export async function runBrandSegmentation(db: Db): Promise<BrandRunResult> {
  // A publicação é decidida pelo gatilho de elegibilidade do banco; aqui só
  // classificamos marcas (regras do banco + base), nunca pistas fracas.
  const { classifySegment } = await import("@/lib/identity-v3/eligibility");
  const [{ data: brands }, { data: rules }] = await Promise.all([
    db.from("brands").select("id, canonical_name, segment, segment_reviewed_by"),
    (db as any).from("brand_segment_rules").select("rule_key, label, kind, segment, target_brand"),
  ]);
  const list = brands ?? [];
  let classificadas = 0;
  for (const b of list) {
    if (b.segment_reviewed_by) continue; // decisão manual nunca é sobrescrita
    const g = classifySegment(b.canonical_name, (rules ?? []) as never);
    if (g.segment === "UNKNOWN" || g.segment === b.segment) continue;
    await db
      .from("brands")
      .update({ segment: g.segment, segment_source: g.source, segment_updated_at: new Date().toISOString() })
      .eq("id", b.id);
    classificadas++;
  }
  const head = { count: "exact" as const, head: true };
  const { count: ocultados } = await db.from("products").select("id", head).eq("catalog_eligibility_reason", DESIGNER_REASON);
  const { data: after } = await db.from("brands").select("segment");
  return {
    marcas: list.length,
    classificadas,
    designer: (after ?? []).filter((b) => b.segment === "DESIGNER").length,
    ocultados: ocultados ?? 0,
    restaurados: 0,
    semClassificacao: (after ?? []).filter((b) => b.segment === "UNKNOWN").length,
  };
}

/** Números para o painel de higiene do catálogo. */
export async function hygieneMetrics(db: Db) {
  const head = { count: "exact" as const, head: true };
  const [perfumes, ativos, ocultos, pendentes, unificados, brands] = await Promise.all([
    db.from("products").select("id", head).eq("product_type", "PERFUME"),
    db.from("products").select("id", head).eq("active", true),
    db.from("products").select("id", head).eq("catalog_eligibility_reason", DESIGNER_REASON),
    db.from("product_duplicates").select("id", head).eq("status", "pending"),
    db.from("product_merges").select("id", head),
    db.from("brands").select("segment"),
  ]);

  return {
    perfumes: perfumes.count ?? 0,
    ativos: ativos.count ?? 0,
    ocultosDesigner: ocultos.count ?? 0,
    pendentes: pendentes.count ?? 0,
    unificados: unificados.count ?? 0,
    marcasDesigner: (brands.data ?? []).filter((b) => b.segment === "DESIGNER").length,
    marcasSemClassificacao: (brands.data ?? []).filter((b) => b.segment === "UNKNOWN").length,
  };
}
