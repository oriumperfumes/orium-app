import { describe, expect, it } from "vitest";
import {
  dailyTotals,
  groupByDay,
  matches,
  payState,
  saleKind,
  saleTitle,
  summarize,
  type LedgerSale,
} from "./sales-ledger";

const NOW = new Date(2026, 10, 26, 15, 0, 0);
const at = (daysAgo: number, h = 12) => new Date(2026, 10, 26 - daysAgo, h, 0, 0).toISOString();

const sale = (p: Partial<LedgerSale>): LedgerSale => ({
  source: "store",
  id: Math.random().toString(36),
  sold_at: at(0),
  channel: "balcao",
  ref: null,
  customer_name: null,
  total: 100,
  paid: 100,
  due: 0,
  profit: null,
  payment_method: "PIX",
  status: null,
  counted: true,
  due_date: null,
  items: [{ name: "Amnia", image_url: null, variant: "FULL", decant_ml: null, quantity: 1 }],
  ...p,
});

describe("summarize", () => {
  it("soma hoje, ontem e período; pedido a confirmar fica fora", () => {
    const s = summarize(
      [
        sale({ total: 100, profit: 40 }),
        sale({ total: 50, channel: "whatsapp", source: "order", sold_at: at(0, 9) }),
        sale({ total: 80, sold_at: at(1) }),
        sale({ total: 999, counted: false, channel: "site", source: "order" }),
      ],
      NOW,
    );
    expect(s.today).toEqual({ total: 150, count: 2 });
    expect(s.yesterday).toBe(80);
    expect(s.period.total).toBe(230);
    expect(s.period.count).toBe(3);
    expect(s.period.profit).toBe(40);
    expect(s.period.withProfit).toBe(1);
    expect(s.toConfirm).toBe(1);
    expect(s.byChannel.map((c) => c.channel)).toEqual(["balcao", "whatsapp"]);
    expect(s.byChannel[0]!.total).toBe(180);
  });
});

describe("filtros e textos", () => {
  it("A receber só pega venda que conta e tem saldo", () => {
    expect(matches(sale({ due: 50, paid: 50 }), "due")).toBe(true);
    expect(matches(sale({ due: 50, counted: false }), "due")).toBe(false);
    expect(matches(sale({ due: 0 }), "due")).toBe(false);
    expect(matches(sale({ channel: "negociacao" }), "negociacao")).toBe(true);
    expect(matches(sale({ channel: "site" }), "balcao")).toBe(false);
  });

  it("título e tipo", () => {
    expect(saleTitle(sale({}))).toBe("Amnia");
    expect(
      saleTitle(
        sale({
          items: [{ name: "Amnia", image_url: null, variant: "DECANT", decant_ml: 5, quantity: 2 }],
        }),
      ),
    ).toBe("2× Amnia");
    expect(
      saleTitle(
        sale({
          items: [
            { name: "A", image_url: null, variant: "FULL", decant_ml: null, quantity: 1 },
            { name: "B", image_url: null, variant: "FULL", decant_ml: null, quantity: 2 },
          ],
        }),
      ),
    ).toBe("A + 1");
    expect(
      saleKind(
        sale({
          items: [{ name: "A", image_url: null, variant: "DECANT", decant_ml: 5, quantity: 1 }],
        }),
      ),
    ).toBe("Decant 5ml");
    expect(saleKind(sale({ channel: "negociacao" }))).toBe("Peça da Negociação");
  });

  it("situação do pagamento", () => {
    expect(payState(sale({})).label).toBe("Pago");
    expect(payState(sale({ paid: 30, due: 70 })).label).toBe("Falta");
    expect(payState(sale({ paid: 0, due: 100 })).label).toBe("Não pagou");
    expect(payState(sale({ counted: false })).label).toBe("A confirmar");
  });
});

describe("dias", () => {
  it("barras por dia e grupos", () => {
    const list = [
      sale({ total: 10 }),
      sale({ total: 5, sold_at: at(2) }),
      sale({ total: 7, sold_at: at(9) }),
    ];
    const bars = dailyTotals(list, 7, NOW);
    expect(bars).toHaveLength(7);
    expect(bars[6]).toMatchObject({ total: 10, today: true });
    expect(bars[4]!.total).toBe(5);
    expect(bars.reduce((n, b) => n + b.total, 0)).toBe(15);
    const groups = groupByDay(list, NOW);
    expect(groups[0]).toMatchObject({ label: "Hoje", total: 10 });
    expect(groups).toHaveLength(3);
  });
});
