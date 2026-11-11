import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "../normalize";
import { routeIntent } from "../router";
const r = (s: string) => { const n = normalizeTranscript(s); return { n, i: routeIntent(n.text, n.payment) }; };
describe("voice router", () => {
  it("venda aceitação", () => {
    const { i } = r("Vendi dois decantes de cinco ml do açaí bourbon e um frasco lacrado do lique de bran no picks");
    expect(i).toEqual({ type: "sale", payment: "PIX", items: [
      { query: "acai bourbon", quantity: 2, variant: "DECANT", decant_ml: 5 },
      { query: "lique de bran", quantity: 1, variant: "FULL", decant_ml: null },
    ] });
  });
  it("venda com 'de 5'", () => {
    const { i } = r("Vendi um Liquid Brun, dois Asad Bourbon de 5, um Hawas Black no dinheiro") as any;
    expect(i.items.map((x: any) => [x.query, x.quantity, x.decant_ml])).toEqual([["liquid brun",1,null],["asad bourbon",2,5],["hawas black",1,null]]);
    expect(i.payment).toBe("DINHEIRO");
  });
  it("estoque", () => {
    expect(r("Chegaram mais três Liquid Brun.").i).toEqual({ type: "stock", mode: "add", quantity: 3, query: "liquid brun" });
    expect(r("Tenho 3 Liquid Brun aqui").i).toEqual({ type: "stock", mode: "set", quantity: 3, query: "liquid brun" });
    expect(r("Coloca três em estoque").i).toEqual({ type: "stock", mode: "set", quantity: 3, query: null });
  });
  it("preço", () => {
    expect(r("Coloca Liquid Brun por 319 e 90").i).toEqual({ type: "price", price: 319.9, query: "liquid brun" });
    expect(r("Coloca ele a 319,90").i).toEqual({ type: "price", price: 319.9, query: null });
    expect(r("coloca o liquid brun a trezentos e vinte reais").i).toEqual({ type: "price", price: 320, query: "liquid brun" });
  });
  it("navegação e resumo", () => {
    expect(r("Abre pedidos feitos.").i).toEqual({ type: "navigate", destination: "pedidos", order_number: null });
    expect(r("Resumo de hoje").i).toEqual({ type: "summary", period: "today" });
    expect(r("Sim.").i).toEqual({ type: "confirm" });
  });
  it("reposição, comparação, pedido", () => {
    expect(r("Adiciona 3 Hawas Black na reposição").i).toEqual({ type: "restock", quantity: 3, query: "hawas black" });
    expect(r("Compara Hawas Black nos fornecedores").i).toEqual({ type: "compare", query: "hawas black" });
    expect(r("Marca o pedido 152 como entregue").i).toEqual({ type: "order_status", order_number: "152", status: "entregue" });
  });
  it("normaliza cupom e deixa para a IA", () => {
    const { n, i } = r("Cria um cupom ORIUM10 de dez por cento até domingo");
    expect(n.text).toContain("10%");
    expect(i).toBeNull();
  });
});
