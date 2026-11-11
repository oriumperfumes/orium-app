import { describe, expect, it } from "vitest";
import { classifySegment, decideEligibility, suggestRealBrand, type SegmentRule } from "./eligibility";

const rules: SegmentRule[] = [
  { rule_key: "dior", label: "Dior", kind: "brand", segment: "DESIGNER", target_brand: null },
  { rule_key: "chanel", label: "Chanel", kind: "brand", segment: "DESIGNER", target_brand: null },
  { rule_key: "lattafa", label: "Lattafa", kind: "brand", segment: "ARABIC", target_brand: null },
  { rule_key: "maisonalhambra", label: "Maison Alhambra", kind: "brand", segment: "ARABIC", target_brand: null },
  { rule_key: "line:212", label: "212", kind: "line", segment: "DESIGNER", target_brand: "Carolina Herrera" },
  { rule_key: "line:allure", label: "allure", kind: "line", segment: "DESIGNER", target_brand: "Chanel" },
];

describe("elegibilidade do catálogo Orium", () => {
  it("1. Dior Sauvage perfume designer não aparece", () => {
    expect(decideEligibility("PERFUME", classifySegment("Dior", rules).segment)).toBe("OCULTAR");
  });
  it("2. Chanel Bleu perfume designer não aparece", () => {
    expect(decideEligibility("PERFUME", classifySegment("CHANEL", rules).segment)).toBe("OCULTAR");
  });
  it("3. Lattafa Asad aparece", () => {
    expect(decideEligibility("PERFUME", classifySegment("Lattafa", rules).segment)).toBe("PUBLICAR");
  });
  it("4. Maison Alhambra continua árabe", () => {
    expect(classifySegment("Maison Alhambra", rules).segment).toBe("ARABIC");
  });
  it("5. marca desconhecida vai para revisão", () => {
    const s = classifySegment("Marca Nova Qualquer", rules).segment;
    expect(s).toBe("UNKNOWN");
    expect(decideEligibility("PERFUME", s)).toBe("REVISAR");
  });
  it("pista fraca não publica sozinha", () => {
    expect(classifySegment("Al Qualquer", rules).segment).toBe("UNKNOWN");
  });
  it("body splash de marca designer não é afetado", () => {
    expect(decideEligibility("BODY_SPLASH", "DESIGNER")).toBe("PUBLICAR");
  });
  it("nicho oculta perfume", () => {
    expect(decideEligibility("PERFUME", "NICHE")).toBe("OCULTAR");
  });
  it("marca errada '212 Vi' sugere Carolina Herrera", () => {
    expect(suggestRealBrand("212 Vi", "212 VIP Black", rules)?.targetBrand).toBe("Carolina Herrera");
    expect(suggestRealBrand("Allure", "Allure Homme Sport", rules)?.targetBrand).toBe("Chanel");
    expect(suggestRealBrand("Lattafa", "Asad", rules)).toBeNull();
  });
});
