/**
 * VENDA E PAGAMENTO da peça da Negociação (aparece no painel quando a
 * situação é "Vendido").
 *
 * Responde, sem digitar muito: para quem foi vendido, por quanto, quanto já
 * pagou, como pagou e até quando o cliente combinou de pagar o restante.
 * Reaproveita os mesmos controles do Pedido (`PayAmount`: Nada · Metade ·
 * Tudo ou valor livre com "+50") e os de Vendas da loja (cliente do CRM,
 * valor, forma de pagamento). A conta de "quanto falta" não fica aqui: vive em
 * `src/lib/negotiation-sale.ts` (`saleSummary`) e é a que o cartão da vitrine
 * e o resumo "A receber" também usam.
 */
import { BadgeCheck } from "lucide-react";
import { PanelCard } from "@/components/orium/admin/PanelKit";
import { DateChips, PayAmount } from "@/components/orium/admin/orders/controls";
import {
  CustomerField,
  MoneyInput,
  PaymentPicker,
  SectionLabel,
} from "@/components/orium/admin/store-sales/parts";
import { saleSummary, type SaleDraft } from "@/lib/negotiation-sale";
import { brl } from "@/lib/format";

export function SaleCard({
  draft,
  onChange,
  savedPaid,
  itemName,
}: {
  draft: SaleDraft;
  onChange: (patch: Partial<SaleDraft>) => void;
  /** quanto já estava pago quando a venda foi aberta (permite "+50") */
  savedPaid: number;
  itemName: string;
}) {
  const s = saleSummary(draft, savedPaid);
  return (
    <PanelCard
      title="Venda e pagamento"
      hint={`Para quem foi vendido, por quanto e quanto já entrou${itemName ? ` — ${itemName}` : ""}.`}
      icon={<BadgeCheck />}
    >
      <div className="space-y-5">
        <div>
          <SectionLabel>Vendido para</SectionLabel>
          <CustomerField value={draft.customer} onChange={(customer) => onChange({ customer })} />
        </div>

        <div>
          <SectionLabel>Por quanto</SectionLabel>
          <MoneyInput size="md" value={draft.price} onChange={(price) => onChange({ price })} />
        </div>

        {s.price != null ? (
          <div className="ui-pop space-y-5">
            <PayAmount
              value={draft.pay}
              onChange={(pay) => onChange({ pay })}
              total={s.price}
              base={savedPaid}
            />

            <div>
              <SectionLabel>Forma de pagamento</SectionLabel>
              <PaymentPicker value={draft.method} onChange={(method) => onChange({ method })} />
            </div>

            {!s.settled && s.paid != null ? (
              <div>
                <SectionLabel>Combinado para pagar o restante ({brl(s.due ?? 0)})</SectionLabel>
                <DateChips
                  value={draft.due}
                  onChange={(due) => onChange({ due })}
                  clearLabel="Sem data"
                />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] text-[#8C8C8C]">
            Informe o valor da venda para controlar o pagamento.
          </p>
        )}

        <div>
          <SectionLabel>Observação</SectionLabel>
          <textarea
            value={draft.note}
            maxLength={300}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder="Ex.: combinou pagar o resto na sexta, retira na loja."
            className="pk-field min-h-[72px] w-full resize-none rounded-[16px] bg-[#232323] px-4 py-3 text-[15px] text-white outline-none transition-colors duration-200 placeholder:text-[#6F6F6F] hover:bg-[#262626] focus:bg-[#2A2A2A]"
          />
        </div>
      </div>
    </PanelCard>
  );
}
