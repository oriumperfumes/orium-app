/**
 * ORIUM — CATALOG ELIGIBILITY (etapa depois da identidade).
 *
 * IDENTITY ENGINE  → "que produto é este?"
 * BRAND CLASSIFIER → "que tipo de marca é?"   (classifySegment)
 * ELIGIBILITY      → "pertence ao catálogo?"  (decideEligibility)
 *
 * Funções puras — o banco aplica a mesma regra num gatilho, então nenhuma
 * sincronização consegue publicar Designer/Nicho de volta.
 */
import { classifyBrandSegment, segmentKey, type BrandSegment } from "@/lib/catalog/brand-segment";

export type SegmentRule = {
  rule_key: string;
  label: string;
  kind: "brand" | "line";
  segment: BrandSegment;
  target_brand: string | null;
};

export type SegmentDecision = { segment: BrandSegment; source: string; confidence: number };

/** Classifica a marca: regras do banco primeiro, depois a base do código. */
export function classifySegment(brandName: string | null | undefined, rules: SegmentRule[]): SegmentDecision {
  const key = segmentKey(brandName);
  if (!key) return { segment: "UNKNOWN", source: "sem-marca", confidence: 0 };
  const exact = rules.find((r) => r.kind === "brand" && r.rule_key === key);
  if (exact) return { segment: exact.segment, source: "regra", confidence: 0.99 };
  const g = classifyBrandSegment(brandName ?? "");
  // Pista fraca (“parece árabe”) não basta para publicar nem para esconder.
  if (g.confidence < 0.9) return { segment: "UNKNOWN", source: g.source, confidence: g.confidence };
  return { segment: g.segment, source: g.source, confidence: g.confidence };
}

/**
 * Marca cadastrada errada: "212 Vi", "Acqua", "Allure" são linhas designer.
 * Só sugere — o Admin confirma a marca real.
 */
export function suggestRealBrand(brandName: string | null | undefined, productName: string | null | undefined, rules: SegmentRule[]) {
  const bk = segmentKey(brandName);
  const pk = segmentKey(productName);
  const lines = rules.filter((r) => r.kind === "line" && r.target_brand).sort((a, b) => b.rule_key.length - a.rule_key.length);
  for (const r of lines) {
    const lk = r.rule_key.replace(/^line:/, "");
    if (lk.length < 3) continue;
    if ((bk && (bk === lk || (bk.length >= 3 && lk.startsWith(bk)) || bk.startsWith(lk))) || pk.startsWith(lk)) {
      return { targetBrand: r.target_brand!, line: r.label, segment: r.segment };
    }
  }
  return null;
}

export type Eligibility = "PUBLICAR" | "OCULTAR" | "REVISAR";

/** Regra oficial. Cosméticos nunca são afetados pelo segmento. */
export function decideEligibility(productType: string | null | undefined, segment: BrandSegment): Eligibility {
  if (productType !== "PERFUME") return "PUBLICAR";
  if (segment === "DESIGNER" || segment === "NICHE") return "OCULTAR";
  if (segment === "UNKNOWN") return "REVISAR";
  return "PUBLICAR";
}
