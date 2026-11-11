import { describe, expect, it } from "vitest";
import { CandidateIndex, compare, decideOffer, extractAttributes, key, validEan, type BrandDict } from "../engine";

const dict: BrandDict = {
  byKey: new Map(
    [
      ["Lattafa", "Lattafa"], ["Armaf", "Armaf"], ["Rasasi", "Rasasi"], ["Afnan", "Afnan"],
      ["Maison Alhambra", "Maison Alhambra"], ["Al Haramain", "Al Haramain"], ["Rayhaan", "Rayhaan"],
      ["Rayhaa", "Rayhaan"], ["Al Wataniah", "Al Wataniah"],
    ].map(([k, v]) => [key(k!), v!]),
  ),
};
const A = (title: string, extra: Record<string, unknown> = {}) => extractAttributes({ title, ...extra }, dict);
const verdict = (a: string, b: string, ea = {}, eb = {}) => compare(A(a, ea), A(b, eb)).verdict;

describe("extração", () => {
  it("separa marca, base, flanker, concentração e volume", () => {
    const a = A("Lattafa Asad Bourbon Eau de Parfum 100ml");
    expect(a.brand).toBe("Lattafa");
    expect(a.base).toEqual(["asad"]);
    expect(a.flankers).toEqual(["bourbon"]);
    expect(a.concentration).toBe("EDP");
    expect(a.volumeMl).toBe(100);
  });
  it("não destrói identidade", () => {
    expect(A("Club de Nuit Iconic").flankers).toEqual(["iconic"]);
    expect(A("Yara Elixir").flankers).toEqual(["elixir"]);
  });
  it("marca no meio do título e alias de marca", () => {
    expect(A("HAWAS BLACK RASASI 100ML").brand).toBe("Rasasi");
    expect(A("Rayhaa Aquatica 100ml").brand).toBe("Rayhaan");
    expect(A("MAISON AL HAMBRA Jean Lowe").brand).toBe("Maison Alhambra");
  });
  it("normaliza onças", () => {
    expect(A("Hawas 3.4 oz").volumeMl).toBe(100);
  });
  it("valida EAN", () => {
    expect(validEan("6291108735411")).toBe("6291108735411");
    expect(validEan("6291108735412")).toBeNull();
  });
});

describe("devem ser o MESMO produto", () => {
  it("Club de Nuit Intense Man (3 grafias)", () => {
    const x = A("Club de Nuit Intense Man EDT 105ml", { brand: "Armaf" });
    const y = A("Club Nuit Intense Man 105 ML EDT", { brand: "Armaf" });
    const z = A("ARMAF CDN Intense Man EDT 105ml");
    expect(compare(x, y).verdict).toBe("SAME");
    expect(compare(x, z).verdict).toBe("SAME");
  });
  it("Hawas Black nos 3 fornecedores", () => {
    const kl = A("HAWAS BLACK RASASI 100ML EDP");
    const mrx = A("Hawas Black EDP 100 ml", { brand: "Rasasi" });
    const smart = A("RASASI HAWAS BLACK 100ML EDP");
    expect(compare(kl, mrx).verdict).toBe("SAME");
    expect(compare(mrx, smart).verdict).toBe("SAME");
  });
});

describe("NUNCA o mesmo produto", () => {
  const pairs: Array<[string, string]> = [
    ["Lattafa Yara 100ml", "Lattafa Yara Elixir 100ml"],
    ["Lattafa Yara", "Lattafa Yara Tous"],
    ["Lattafa Yara", "Lattafa Yara Moi"],
    ["Lattafa Yara Tous", "Lattafa Yara Moi"],
    ["Lattafa Yara", "Lattafa Yara Candy"],
    ["Lattafa Asad", "Lattafa Asad Bourbon"],
    ["Lattafa Asad", "Lattafa Asad Zanzibar"],
    ["Lattafa Asad Bourbon", "Lattafa Asad Elixir"],
    ["Rasasi Hawas", "Rasasi Hawas Black"],
    ["Rasasi Hawas Black", "Rasasi Hawas Elixir"],
    ["Rasasi Hawas", "Rasasi Hawas Kobra"],
    ["Lattafa Fakhar Black", "Lattafa Fakhar Rose"],
    ["Lattafa Fakhar Black", "Lattafa Fakhar Gold"],
    ["Lattafa Khamrah", "Lattafa Khamrah Qahwa"],
    ["Lattafa Khamrah Qahwa", "Lattafa Khamrah Dukhan"],
    ["Lattafa Khamrah", "Lattafa Khamrah Waha"],
    ["Armaf Club de Nuit Intense Man", "Armaf Club de Nuit Iconic"],
    ["Armaf Club de Nuit Iconic", "Armaf Club de Nuit Sillage"],
    ["Armaf Club de Nuit Intense Man", "Armaf Club de Nuit Milestone"],
    ["Armaf Club de Nuit Sillage", "Armaf Club de Nuit Precieux"],
    ["Armaf Club de Nuit Intense Man", "Armaf Club de Nuit Woman"],
    ["Armaf Club de Nuit Woman", "Armaf Club de Nuit Maleka"],
    ["Afnan Turathi Blue", "Afnan Turathi Electric"],
    ["Maison Alhambra Spectre Ghost", "Maison Alhambra Spectre Wraith"],
    ["Lattafa Yara", "Lattafa Yara Limited Edition"],
  ];
  for (const [a, b] of pairs) it(`${a} ≠ ${b}`, () => expect(verdict(a, b)).toBe("DIFFERENT"));
});

describe("apresentação e marca", () => {
  it("100ml vs 200ml nunca é a mesma apresentação", () => {
    const c = compare(A("Rasasi Hawas Black 100ml"), A("Rasasi Hawas Black 200ml"));
    expect(c.samePresentation).toBe(false);
    expect(c.verdict).not.toBe("SAME");
  });
  it("EDT vs Parfum não auto-mescla", () => {
    expect(verdict("Armaf Club de Nuit Intense Man EDT 105ml", "Armaf Club de Nuit Intense Man Parfum 105ml")).not.toBe("SAME");
  });
  it("tester vs lacrado não é a mesma apresentação", () => {
    const c = compare(A("Rasasi Hawas Black 100ml tester"), A("Rasasi Hawas Black 100ml lacrado"));
    expect(c.samePresentation).toBe(false);
  });
  it("mesmo nome, marca diferente → não auto-merge", () => {
    expect(verdict("Lattafa Oud Mood 100ml", "Al Haramain Oud Mood 100ml")).not.toBe("SAME");
  });
});

describe("decisão de oferta", () => {
  const idx = new CandidateIndex<{ id: string }>();
  idx.add({ id: "yara" }, A("Lattafa Yara EDP 100ml"));
  idx.add({ id: "yara-elixir" }, A("Lattafa Yara Elixir EDP 100ml"));
  idx.add({ id: "hawas-black" }, A("Rasasi Hawas Black EDP 100ml"));

  it("Yara Elixir da KL vai para Yara Elixir, nunca para Yara", () => {
    const d = decideOffer(A("YARA ELIXIR LATTAFA 100ML EDP"), idx);
    expect(d.state).toBe("AUTO_MATCHED");
    expect(d.productId).toBe("yara-elixir");
  });
  it("oferta sem candidato vira NEW_CANONICAL", () => {
    expect(decideOffer(A("Lattafa Ana Abiyedh 60ml"), idx).state).toBe("NEW_CANONICAL");
  });
  it("respeita par bloqueado (separação manual)", () => {
    const d = decideOffer(A("Rasasi Hawas Black EDP 100ml"), idx, { blocked: (id) => id === "hawas-black" });
    expect(d.productId).not.toBe("hawas-black");
  });
});
