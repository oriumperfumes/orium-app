import { describe, it, expect } from "vitest";
import { strictSameProduct as s } from "@/lib/suppliers/engine.server";
import { parseKyteName, kyteToOffer } from "@/lib/suppliers/kyte-connector.server";
describe("strict", () => {
  it("cases", () => {
    expect(s("Attar Al Wesal Elixir EDP Al Wataniah - Masculino 100ml", { canonical_name: "Attar Al Wesal", brand: "Al Wataniah", volume_ml: 100 })).toBe(false);
    expect(s("Attar Al Wesal EDP Al Wataniah - Compartilhável 100ml", { canonical_name: "Attar Al Wesal", brand: "Al Wataniah", volume_ml: 100 })).toBe(true);
    expect(s("Asad Bourbon EDP Lattafa Perfumes - Masculino 100ml", { canonical_name: "Asad", brand: "Lattafa", volume_ml: 100 })).toBe(false);
    expect(s("Asad Bourbon EDP Lattafa Perfumes - Masculino 100ml", { canonical_name: "Asad Bourbon", brand: "Lattafa", volume_ml: 100 })).toBe(true);
    expect(s("Yara Elixir Lattafa - Feminino 100ml", { canonical_name: "Yara", brand: "Lattafa", volume_ml: 100 })).toBe(false);
    expect(s("Club de Nuit Intense Man EDT Armaf - Masculino 105ml", { canonical_name: "Club de Nuit Intense Man EDT", brand: "Armaf", volume_ml: 105 })).toBe(true);
    expect(s("Khamrah Dukhan EDP Lattafa Perfumes - Masculino 50ml", { canonical_name: "Khamrah Dukhan", brand: "Lattafa", volume_ml: 100 })).toBe(false);
    expect(s("Ameer Al Arab Imperium EDP Asdaaf - Masculino 100ml", { canonical_name: "Ameer Al Arab", brand: "Asdaaf", volume_ml: 100 })).toBe(false);
    expect(s("Club de Nuit Intense Man Armaf - Masculino 105ml", { canonical_name: "Club de Nuit Man", brand: "Armaf", volume_ml: 105 })).toBe(false);
  });
  it("kyte name", () => {
    const p = parseKyteName("Al Noble Ameer EDP Lattafa Perfumes - Compartilhável 100ml");
    expect(p).toMatchObject({ volumeMl: 100, concentration: "EDP", gender: "compartilhável", brand: null });
    expect(parseKyteName("Yara - Lattafa").brand).toBe("Lattafa");
    const o = kyteToOffer({ _id: "x1", name: "Asad Bourbon EDP Lattafa Perfumes - Masculino 100ml", salePrice: 269, salePromotionalPrice: null, stockActive: false, stockStatus: "NOT_CONTROLLED", image: "/u%2Fa.jpg?alt=media", category: { name: "Perfumes Árabes " } }, "https://amadofragrance.kyte.site");
    expect(o?.price).toBe(269);
    expect(o?.availabilityStatus).toBe("UNKNOWN");
    expect(o?.categories).toEqual(["Perfumes Árabes"]);
    expect(o?.images[0]).toContain("firebasestorage");
  });
});
