/**
 * IDENTIDADE DO PERFUME FALADO — do som ouvido ao produto real do catálogo.
 *
 * A transcrição é só uma hipótese. Aqui ela é comparada com TODO o vocabulário da
 * loja (nome canônico, marca, apelidos, nomes de fornecedor e apelidos de voz já
 * confirmados) usando texto + fonética do português falado.
 *
 * REGRA ABSOLUTA: flankers nunca se misturam. "Yara" não é "Yara Elixir", "Asad"
 * não é "Asad Bourbon", "Club de Nuit Intense" não é "Iconic" nem "Milestone".
 * Em dúvida, devolvemos candidatos — ninguém escolhe em silêncio.
 *
 * Os IDs SEMPRE vêm do banco: a IA só entrega termos falados.
 */
import { contentTokens, flat, nameAffinity, phoneticKey, wordAffinity } from "@/lib/store-sales-phonetics";

export type MatchCandidate = {
  product_id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  retail_price: number | null;
  decant_available: boolean;
  decant_price_2ml: number | null;
  decant_price_5ml: number | null;
  decant_price_10ml: number | null;
  volume_ml: number | null;
  in_stock: boolean;
  stock_quantity: number | null;
  sale_mode: string | null;
  product_type: string | null;
  /** 0–1 */
  score: number;
};

const COLUMNS =
  "id, canonical_name, brand, image_url, retail_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, volume_ml, in_stock, stock_quantity, sale_mode, product_type";

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

type IndexRow = {
  id: string;
  name: string;
  brand: string | null;
  in_stock: boolean;
  /** nome + apelidos: todas as formas pelas quais esse perfume pode ser chamado */
  terms: string[];
  voice: Array<{ text: string; count: number }>;
};

type CatalogIndex = { rows: IndexRow[]; at: number };

let cache: CatalogIndex | null = null;
const TTL_MS = 3 * 60 * 1000;

/** Vocabulário da loja (curto o bastante para caber em memória: nome + apelidos). */
async function loadIndex(db: { from: (t: string) => any }): Promise<IndexRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;

  const { data: products } = await db
    .from("products")
    .select("id, canonical_name, brand, in_stock")
    .eq("active", true)
    .limit(5000);

  const rows = new Map<string, IndexRow>();
  for (const p of (products ?? []) as Array<{ id: string; canonical_name: string | null; brand: string | null; in_stock: boolean | null }>) {
    if (!p.id || !p.canonical_name) continue;
    rows.set(p.id, {
      id: p.id,
      name: p.canonical_name,
      brand: p.brand,
      in_stock: p.in_stock === true,
      terms: [p.canonical_name],
      voice: [],
    });
  }

  // Apelidos ficam no registro de identidade (sem vínculo direto ao produto): ligamos pelo nome canônico.
  const byName = new Map<string, IndexRow[]>();
  for (const r of rows.values()) {
    const k = flat(r.name);
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const { data: aliases, error: aliasErr } = await db
    .from("perfume_aliases")
    .select("alias, perfume_identity_registry(canonical_name)")
    .limit(20000);
  if (aliasErr) console.error("[store-sales-match] perfume_aliases:", aliasErr.message);
  for (const a of (aliases ?? []) as Array<{ alias: string | null; perfume_identity_registry: { canonical_name: string | null } | null }>) {
    const name = a.perfume_identity_registry?.canonical_name;
    if (!a.alias || !name) continue;
    for (const row of byName.get(flat(name)) ?? []) row.terms.push(a.alias);
  }

  const { data: voice } = await db
    .from("voice_product_aliases")
    .select("canonical_product_id, transcript_normalized, confirmation_count")
    .limit(20000);
  for (const v of (voice ?? []) as Array<{ canonical_product_id: string; transcript_normalized: string | null; confirmation_count: number | null }>) {
    const row = rows.get(v.canonical_product_id);
    if (row && v.transcript_normalized) {
      row.voice.push({ text: v.transcript_normalized, count: Math.max(1, Number(v.confirmation_count) || 1) });
      row.terms.push(v.transcript_normalized);
    }
  }

  const list = Array.from(rows.values());
  cache = { rows: list, at: Date.now() };
  return list;
}

/** Usado depois de aprender um apelido novo, para valer já na próxima fala. */
export function forgetCatalogIndex() {
  cache = null;
}

function brandBonus(spokenBrand: string | null, row: IndexRow, spokenTokens: string[]): number {
  const brand = row.brand ?? "";
  if (!brand) return 0;
  if (spokenBrand) {
    const a = nameAffinity(contentTokens(spokenBrand), brand);
    return a.score >= 0.7 ? 0.08 : -0.1;
  }
  // a marca pode aparecer solta na fala ("lattafa asad bourbon")
  const brandTokens = contentTokens(brand);
  const hit = brandTokens.some((b) => spokenTokens.some((s) => wordAffinity(s, b) >= 0.85));
  return hit ? 0.05 : 0;
}

function scoreRow(spoken: string, spokenBrand: string | null, row: IndexRow): number {
  const spokenTokens = contentTokens(spoken);
  if (spokenTokens.length === 0) return 0;

  const spokenFlat = flat(spoken);
  const spokenPhon = phoneticKey(spoken);

  // apelido de voz já confirmado: atalho forte (quanto mais confirmações, mais peso)
  let learned = 0;
  for (const v of row.voice) {
    if (flat(v.text) === spokenFlat) learned = Math.max(learned, 0.97 + Math.min(0.03, v.count * 0.01));
    else if (phoneticKey(v.text) === spokenPhon) learned = Math.max(learned, 0.93);
  }

  let best = 0;
  for (const term of row.terms) {
    const a = nameAffinity(spokenTokens, term);
    if (a.score > best) best = a.score;
  }

  let score = Math.max(best, learned);
  if (score <= 0) return 0;
  score += brandBonus(spokenBrand, row, spokenTokens);
  if (row.in_stock) score += 0.02;
  return Math.max(0, Math.min(1, score));
}

/**
 * Candidatos reais para um nome falado. No máximo 5, ordenados.
 * A escolha final é da interface: só pré-selecionamos com confiança alta.
 */
export async function resolveProductCandidates(
  db: { from: (t: string) => any },
  spokenName: string,
  spokenBrand?: string | null,
): Promise<MatchCandidate[]> {
  const spokenTokens = contentTokens(spokenName);
  if (spokenTokens.length === 0) return [];

  const index = await loadIndex(db);
  const scored = index
    .map((row) => ({ row, score: scoreRow(spokenName, spokenBrand ?? null, row) }))
    .filter((x) => x.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (scored.length === 0) return [];

  const { data: rows } = await db
    .from("products")
    .select(COLUMNS)
    .in("id", scored.map((s) => s.row.id));

  const byId = new Map<string, any>();
  for (const r of (rows ?? []) as any[]) byId.set(r.id, r);

  return scored
    .map(({ row, score }) => {
      const r = byId.get(row.id);
      if (!r) return null;
      return {
        product_id: r.id,
        name: r.canonical_name ?? "Perfume",
        brand: r.brand,
        image_url: r.image_url,
        retail_price: num(r.retail_price),
        decant_available: r.decant_available === true,
        decant_price_2ml: num(r.decant_price_2ml),
        decant_price_5ml: num(r.decant_price_5ml),
        decant_price_10ml: num(r.decant_price_10ml),
        volume_ml: r.volume_ml,
        in_stock: r.in_stock === true,
        stock_quantity: r.stock_quantity,
        sale_mode: r.sale_mode,
        product_type: r.product_type,
        score: Number(score.toFixed(3)),
      } satisfies MatchCandidate;
    })
    .filter((c): c is MatchCandidate => c != null);
}

/** Um único produto real, pelo ID (usado quando o item já foi confirmado). */
export async function candidateById(db: { from: (t: string) => any }, id: string): Promise<MatchCandidate | null> {
  const { data: r } = await db.from("products").select(COLUMNS).eq("id", id).maybeSingle();
  if (!r) return null;
  return {
    product_id: r.id,
    name: r.canonical_name ?? "Perfume",
    brand: r.brand,
    image_url: r.image_url,
    retail_price: num(r.retail_price),
    decant_available: r.decant_available === true,
    decant_price_2ml: num(r.decant_price_2ml),
    decant_price_5ml: num(r.decant_price_5ml),
    decant_price_10ml: num(r.decant_price_10ml),
    volume_ml: r.volume_ml,
    in_stock: r.in_stock === true,
    stock_quantity: r.stock_quantity,
    sale_mode: r.sale_mode,
    product_type: r.product_type,
    score: 1,
  };
}

/**
 * Confiança do item: alta preenche direto, média pede confirmação,
 * baixa pergunta qual produto é.
 */
export function confidenceOf(candidates: MatchCandidate[]): "high" | "medium" | "low" {
  const best = candidates[0];
  if (!best) return "low";
  const second = candidates[1];
  const gap = best.score - (second?.score ?? 0);
  if (best.score >= 0.86 && (gap >= 0.08 || !second)) return "high";
  if (best.score >= 0.68) return "medium";
  if (best.score >= 0.5 && !second) return "medium";
  return "low";
}

export { phoneticKey };

/** Aquece o índice em paralelo com a transcrição (a busca final já encontra tudo em memória). */
export async function warmCatalogIndex(db: { from: (t: string) => any }) {
  await loadIndex(db);
}
