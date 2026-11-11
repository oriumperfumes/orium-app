import { describe, expect, it } from "vitest";
import { parseBrazilianPrice } from "../kl-cosmeticos.server";

describe("KL Brazilian prices", () => {
  it.each([
    ["R$ 249,90", 249.9],
    ["249,90", 249.9],
    ["1.249,90", 1249.9],
    [249.9, 249.9],
  ])("parses %s exactly", (input, expected) => {
    expect(parseBrazilianPrice(input)).toBe(expected);
  });

  it("rejects missing prices", () => {
    expect(parseBrazilianPrice("")).toBeNull();
    expect(parseBrazilianPrice(null)).toBeNull();
  });
});