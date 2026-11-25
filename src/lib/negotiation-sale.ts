/**
 * Regras da venda de uma peça da Negociação (sem interface): rascunho do
 * painel, "quanto falta" e o que vai para o servidor. É a única conta de
 * pagamento da Negociação — o painel, o cartão da vitrine e o resumo
 * "A receber" usam estas funções.
 */
import { draftFrom, resolvePaid, type PayDraft } from "@/components/orium/admin/orders/controls";
import { parseMoney } from "@/components/orium/admin/store-sales/parts";
import type { NegotiationSale, NegotiationSalePayInput } from "@/lib/negotiation.functions";
import { brl } from "@/lib/format";

export type SaleDraft = {
  customer: { id: string | null; name: string | null };
  /** valor combinado, como o Admin digita ("1.234,56") */
  price: string;
  pay: PayDraft;
  method: string | null;
  /** AAAA-MM-DD do restante */
  due: string | null;
  note: string;
};

export const emptySale = (): SaleDraft => ({
  customer: { id: null, name: null },
  price: "",
  pay: { mode: "none", text: "" },
  method: null,
  due: null,
  note: "",
});

const moneyText = (n: number) =>
  (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");

/** Venda já salva → rascunho editável. Sem venda: rascunho vazio. */
export function saleToDraft(s: NegotiationSale | null | undefined): SaleDraft {
  if (!s) return emptySale();
  return {
    customer: { id: s.customer_id, name: s.customer_name },
    price: moneyText(s.sale_price),
    pay: draftFrom(s.amount_paid, s.sale_price),
    method: s.payment_method,
    due: s.payment_due_date,
    note: s.note ?? "",
  };
}

/**
 * Números da venda a partir do rascunho. `paid` é o total acumulado
 * (`null` quando o texto digitado é inválido); `due` é quanto falta.
 */
export function saleSummary(d: SaleDraft, savedPaid = 0) {
  const price = parseMoney(d.price);
  const total = price != null && price > 0 ? price : 0;
  const paid = total > 0 ? resolvePaid(d.pay, total, savedPaid) : 0;
  const due = paid == null ? null : Math.max(0, Math.round((total - paid) * 100) / 100);
  return {
    price: total > 0 ? total : null,
    paid,
    due,
    settled: total > 0 && due != null && due <= 0.009,
  };
}

/** Rascunho → o que vai para o servidor (ou `null` se ainda falta algo). */
export function salePayload(
  itemId: string,
  d: SaleDraft,
  savedPaid = 0,
): NegotiationSalePayInput | null {
  const s = saleSummary(d, savedPaid);
  if (s.price == null || s.paid == null) return null;
  return {
    itemId,
    customerId: d.customer.id,
    customerName: d.customer.name,
    price: s.price,
    paid: s.paid,
    paymentMethod: (d.method as NegotiationSalePayInput["paymentMethod"]) ?? null,
    dueDate: s.settled ? null : d.due,
    note: d.note,
  };
}

/** Texto curto do pagamento para cartões e listas ("Pago", "Falta R$ 125"). */
export function saleStatusText(s: Pick<NegotiationSale, "sale_price" | "amount_paid">) {
  const due = Math.round((Number(s.sale_price) - Number(s.amount_paid)) * 100) / 100;
  if (due <= 0.009) return { label: "Pago", tone: "ok" as const, due: 0 };
  if (Number(s.amount_paid) > 0) return { label: `Falta ${brl(due)}`, tone: "gold" as const, due };
  return { label: `Não pagou · ${brl(due)}`, tone: "coral" as const, due };
}
