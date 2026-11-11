import { describe, expect, it } from "vitest";
import { allocateFreight, buildSupplyPackages, marginOf } from "../freight";

describe("allocateFreight", () => {
  it("rateia por unidades sem duplicar o frete", () => {
    const r = allocateFreight(50, Array.from({ length: 10 }, (_, i) => ({ key: `p${i}`, qty: 1, unitPrice: 200 })), "units");
    expect(r.lines.every((l) => l.total === 5)).toBe(true);
    expect(r.lines.reduce((s, l) => s + l.total, 0)).toBe(50);
  });
  it("soma exata em centavos com resto", () => {
    const r = allocateFreight(10, [{ key: "a", qty: 1, unitPrice: 1 }, { key: "b", qty: 1, unitPrice: 1 }, { key: "c", qty: 1, unitPrice: 1 }]);
    expect(Math.round(r.lines.reduce((s, l) => s + l.total, 0) * 100)).toBe(1000);
  });
  it("rateia por valor", () => {
    const r = allocateFreight(30, [{ key: "a", qty: 1, unitPrice: 100 }, { key: "b", qty: 1, unitPrice: 200 }], "value");
    expect(r.lines.map((l) => l.total)).toEqual([10, 20]);
  });
  it("peso sem dado confiável volta para unidades", () => {
    const r = allocateFreight(20, [{ key: "a", qty: 1, unitPrice: 100, unitWeightG: 400 }, { key: "b", qty: 1, unitPrice: 100 }], "weight");
    expect(r.method).toBe("units");
  });
});

describe("buildSupplyPackages", () => {
  it("pede dados que faltam em vez de inventar", () => {
    const r = buildSupplyPackages({}, 10);
    expect(r.ok).toBe(false);
  });
  it("divide em volumes", () => {
    const r = buildSupplyPackages({ pkg_height_cm: 20, pkg_width_cm: 20, pkg_length_cm: 30, unit_weight_g: 400, units_per_package: 6 }, 10);
    expect(r.ok && r.packages.length).toBe(2);
    expect(r.ok && r.totalWeightKg).toBe(4);
  });
});

describe("RJ x SP", () => {
  it("retirada RJ mais barata que SP com frete para 1 unidade", () => {
    const mrx = 240 + 0;
    const amado = 210 + allocateFreight(35, [{ key: "x", qty: 1, unitPrice: 210 }]).lines[0]!.total;
    expect(amado).toBe(245);
    expect(mrx < amado).toBe(true);
    expect(marginOf(300, amado)! < 0.25).toBe(true);
  });
});
