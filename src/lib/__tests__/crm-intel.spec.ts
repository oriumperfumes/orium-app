import { describe, expect, it } from "vitest";
import { enrich, factsOf, nextAction, profileOf, scoreLead, segmentsOf, taskOf, type LeadRaw } from "../crm-intel";
import { buildMentionIndex, findMentions } from "../perfume-mentions";

const NOW = new Date("2026-11-23T15:00:00Z").getTime();
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const base = (p: Partial<LeadRaw> = {}): LeadRaw => ({
  id: "c1",
  name: "Ana Souza",
  phone: "21999999999",
  user_id: null,
  created_at: ago(60),
  first_source: null,
  lead_trigger: null,
  optin: false,
  orders_count: 0,
  spent: 0,
  first_order_at: null,
  last_order_at: null,
  avg_interval_days: null,
  decant_units: 0,
  bottle_units: 0,
  avg_bottle_price: null,
  avg_decant_price: null,
  max_item_price: null,
  promo_items: 0,
  total_items: 0,
  last_decant_at: null,
  top_brands: [],
  recent_items: [],
  views: null,
  cart: null,
  favorites: null,
  waiting: null,
  live: null,
  wa: null,
  ...p,
});

describe("crm-intel", () => {
  it("carrinho aberto hoje + visitas recentes = quente", () => {
    const r = base({
      cart: {
        id: "k",
        status: "active",
        items: 2,
        total: 640,
        last_at: ago(0.1),
        abandoned_at: null,
        names: ["Asad"],
      },
      views: { d7: 6, d30: 9, last_at: ago(0.2), top: [] },
    });
    expect(scoreLead(r, NOW).temp).toBe("quente");
    expect(segmentsOf(r, NOW)).toContain("carrinho");
    expect(nextAction(r, NOW).key).toBe("cart");
    expect(nextAction(r, NOW).message).toContain("Ana");
  });

  it("decant há 30 dias sem frasco = upgrade", () => {
    const r = base({
      orders_count: 1,
      spent: 85,
      last_order_at: ago(30),
      decant_units: 1,
      total_items: 1,
      last_decant_at: ago(30),
      recent_items: [{ product_id: "p1", name: "Khamrah", decant: true, at: ago(30) }],
    });
    expect(segmentsOf(r, NOW)).toContain("upgrade");
    expect(nextAction(r, NOW).key).toBe("upgrade");
  });

  it("mensagem sem resposta vem primeiro", () => {
    const r = base({
      wa: {
        jid: "x",
        stage: "novo",
        unread: 1,
        last_inbound_at: ago(0.05),
        last_outbound_at: null,
        last_from_me: false,
        preview: "oi",
      },
    });
    expect(segmentsOf(r, NOW)[0]).toBe("responder");
    expect(nextAction(r, NOW).key).toBe("reply");
  });

  it("perfil diz preferência por decant e faixa de preço", () => {
    const r = base({
      orders_count: 3,
      spent: 900,
      decant_units: 7,
      bottle_units: 1,
      avg_bottle_price: 300,
      max_item_price: 320,
      total_items: 8,
    });
    const p = profileOf(r, NOW).join(" | ");
    expect(p).toMatch(/Compra mais decant/);
    expect(p).toMatch(/Faixa confortável/);
  });
});

describe("análise da conversa", () => {
  const ins = (p: Record<string, unknown>) =>
    base({
      insight: {
        status: "interessado",
        chance: 65,
        motivo: "preco",
        resumo: "Quis o Khamrah mas achou caro.",
        analyzed_at: ago(1),
        data: { motivo_detalhe: "achou R$ 340 alto", mensagem_sugerida: "Oi! Consigo te mostrar o decant do Khamrah. Quer?", estilo: ["doce", "amadeirado"], orcamento: "até R$ 250" },
        ...p,
      },
    });

  it("achou caro vira tarefa de contornar preço com a mensagem da conversa", () => {
    const [l] = enrich([ins({})], NOW);
    expect(taskOf(l!)).toBe("price");
    expect(l!.action.message).toContain("decant");
    expect(l!.reasons.join(" ")).toMatch(/Achou caro: achou R\$ 340 alto/);
  });

  it("sumiu vira retomar conversa", () => {
    const [l] = enrich([ins({ motivo: "sumiu" })], NOW);
    expect(taskOf(l!)).toBe("revive");
  });

  it("estilo e orçamento entram no perfil e nos fatos", () => {
    const r = ins({});
    expect(profileOf(r, NOW).join(" | ")).toMatch(/Estilo: doce, amadeirado/);
    const [l] = enrich([r], NOW);
    expect(factsOf(l!, NOW).map((f) => f.label)).toEqual(expect.arrayContaining(["Estilo", "Orçamento", "Chance de compra"]));
  });

  it("análise velha (mais de 21 dias) não manda", () => {
    const [l] = enrich([ins({ analyzed_at: ago(30) })], NOW);
    expect(taskOf(l!)).not.toBe("price");
  });
});

describe("perfume-mentions", () => {
  const idx = buildMentionIndex([
    { id: "1", name: "Asad", brand: "Lattafa", terms: [], in_stock: true },
    { id: "2", name: "Asad Bourbon", brand: "Lattafa", terms: [], in_stock: true },
    { id: "3", name: "Pisa", brand: "Lattafa", terms: [], in_stock: true },
    { id: "4", name: "Khamrah", brand: "Lattafa", terms: ["kamrah"], in_stock: true },
  ]);

  it("prefere o nome mais longo", () => {
    expect(findMentions("tem o asad bourbon?", idx).map((m) => m.productId)).toEqual(["2"]);
  });
  it("aceita apelido e acento", () => {
    expect(findMentions("Quanto tá o kamrah??", idx)[0]?.productId).toBe("4");
  });
  it("palavra comum sozinha não vira perfume", () => {
    expect(findMentions("cuidado que ele pisa no pé", idx)).toEqual([]);
  });
  it("palavra comum com a marca vira perfume", () => {
    expect(findMentions("tem o lattafa pisa?", idx)[0]?.productId).toBe("3");
  });
});
