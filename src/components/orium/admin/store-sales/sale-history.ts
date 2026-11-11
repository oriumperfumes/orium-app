/**
 * Histórico de uma venda da loja em linguagem simples: transforma os eventos
 * de auditoria (criada, editada, cancelada, excluída) em linhas legíveis com o
 * que mudou — quantidade, preço, produto, pagamento, cliente, data e total.
 */
import { brl } from "@/lib/format";

type Event = { event: string; at: string; details: Record<string, any> | null };

type ItemSnap = {
  name?: string | null;
  variant?: string | null;
  decant_ml?: number | null;
  quantity?: number | null;
  unit_price?: number | null;
};

const PAYMENT_LABEL: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão", DINHEIRO: "Dinheiro" };

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · ${d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const label = (item: ItemSnap) => {
  const variant = item.variant === "DECANT" ? `decant ${item.decant_ml ?? "?"}ml` : "frasco";
  return `${item.name ?? "Perfume"} (${variant})`;
};

const key = (item: ItemSnap) => `${item.name ?? ""}|${item.variant ?? ""}|${item.decant_ml ?? 0}`;

function itemDiff(before: ItemSnap[], after: ItemSnap[]): string[] {
  const out: string[] = [];
  const beforeMap = new Map(before.map((i) => [key(i), i]));
  const afterMap = new Map(after.map((i) => [key(i), i]));

  for (const [k, b] of beforeMap) {
    const a = afterMap.get(k);
    if (!a) {
      out.push(`Item removido — ${label(b)} ${b.quantity ?? 0}x`);
      continue;
    }
    if ((a.quantity ?? 0) !== (b.quantity ?? 0)) {
      out.push(`Quantidade alterada — ${label(b)} ${b.quantity} → ${a.quantity}`);
    }
    if (Number(a.unit_price ?? 0) !== Number(b.unit_price ?? 0)) {
      out.push(`Preço alterado — ${label(b)} ${brl(Number(b.unit_price ?? 0))} → ${brl(Number(a.unit_price ?? 0))}`);
    }
  }
  for (const [k, a] of afterMap) {
    if (!beforeMap.has(k)) out.push(`Item adicionado — ${label(a)} ${a.quantity ?? 0}x`);
  }
  return out;
}

export function saleHistory(events: Event[]): Array<{ when: string; title: string; lines: string[] }> {
  return (events ?? []).map((e) => {
    const details = (e.details ?? {}) as any;
    if (e.event === "criada") {
      return {
        when: when(e.at),
        title: details.entry_method === "voice" ? "Venda registrada por voz" : "Venda registrada",
        lines: [],
      };
    }
    if (e.event === "cancelada") {
      return { when: when(e.at), title: "Venda cancelada", lines: details.reason ? [String(details.reason)] : [] };
    }
    if (e.event === "excluida") {
      return {
        when: when(e.at),
        title: "Venda excluída",
        lines: ["Estoque e financeiro revertidos", ...(details.reason ? [String(details.reason)] : [])],
      };
    }
    if (e.event === "editada") {
      const before = (details.before ?? {}) as any;
      const after = (details.after ?? {}) as any;
      const lines = itemDiff((before.items ?? []) as ItemSnap[], (after.items ?? []) as ItemSnap[]);

      if (before.payment_method !== after.payment_method) {
        lines.push(
          `Pagamento alterado — ${PAYMENT_LABEL[before.payment_method] ?? "não informado"} → ${
            PAYMENT_LABEL[after.payment_method] ?? "não informado"
          }`,
        );
      }
      if ((before.customer_name ?? null) !== (after.customer_name ?? null)) {
        lines.push(`Cliente alterado — ${before.customer_name ?? "sem cliente"} → ${after.customer_name ?? "sem cliente"}`);
      }
      if (Number(before.total ?? 0) !== Number(after.total ?? 0)) {
        lines.push(`Total alterado — ${brl(Number(before.total ?? 0))} → ${brl(Number(after.total ?? 0))}`);
      }
      if (before.sold_at && after.sold_at && new Date(before.sold_at).getTime() !== new Date(after.sold_at).getTime()) {
        lines.push(`Data alterada — ${when(before.sold_at)} → ${when(after.sold_at)}`);
      }
      if (details.cost_policy === "atual") lines.push("Custo usado: preço de custo atual");
      else if (details.cost_policy === "snapshot") lines.push("Custo usado: custo gravado na venda");
      else if (details.cost_policy === "misto") lines.push("Custo usado: gravado nos itens mantidos, atual nos alterados");

      return { when: when(e.at), title: "Venda editada", lines: lines.length ? lines : ["Sem mudanças nos itens"] };
    }
    return { when: when(e.at), title: e.event, lines: [] };
  });
}
