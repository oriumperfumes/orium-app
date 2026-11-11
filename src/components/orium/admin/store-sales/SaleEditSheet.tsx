/**
 * EDIÇÃO DE UMA VENDA DA LOJA
 *
 * Abre a venda já preenchida no mesmo compositor do registro. Nada muda no
 * estoque ou no financeiro antes de "Salvar alterações": o banco estorna o
 * impacto antigo e aplica o novo na mesma transação.
 */
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SaleComposer, type SaleComposerInitial } from "./SaleComposer";
import { storeSaleDetail, storeSaleItemCandidates } from "@/lib/store-sales.functions";
import type { DecantMl } from "@/lib/decants";

export function SaleEditSheet({
  id,
  onClose,
  onSaved,
}: {
  id: string | null;
  onClose: () => void;
  onSaved: (saleId: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["store-sale-edit", id],
    queryFn: async (): Promise<{ initial: SaleComposerInitial; number: string }> => {
      const sale = await storeSaleDetail({ data: { id: id! } });
      const ids = Array.from(new Set(sale.items.map((i) => i.product_id).filter(Boolean))) as string[];
      const { results } = ids.length ? await storeSaleItemCandidates({ data: { ids } }) : { results: [] };
      const byId = new Map(results.map((c) => [c.product_id, c]));

      return {
        number: sale.sale_number,
        initial: {
          sale_id: sale.id,
          expected_seq: sale.edit_seq,
          entry_method: sale.entry_method === "voice" ? "voice" : "manual",
          payment_method: sale.payment_method,
          customer: { id: sale.customer_id, name: sale.customer_name },
          total: sale.discount > 0 ? sale.total : null,
          sold_at: sale.sold_at,
          transcript: sale.transcript,
          items: sale.items.map((item, index) => {
            const candidate = item.product_id ? byId.get(item.product_id) : undefined;
            const variant = item.variant === "DECANT" ? "DECANT" : "FULL";
            return {
              key: `${item.id}-${index}`,
              spoken_name: candidate?.name ?? item.name ?? "",
              product_id: item.product_id,
              name: candidate?.name ?? item.name ?? "Perfume",
              brand: candidate?.brand ?? item.brand ?? null,
              image_url: candidate?.image_url ?? item.image_url ?? null,
              variant: variant as "FULL" | "DECANT",
              decant_ml: (item.decant_ml ?? null) as DecantMl | null,
              quantity: item.quantity,
              unit_price: item.unit_price,
              // preço praticado na venda: nunca sobrescrito em silêncio
              price_source: "spoken" as const,
              confidence: "high" as const,
              candidates: candidate ? [candidate] : [],
              needs_variant: false,
              needs_size: variant === "DECANT" && !item.decant_ml,
            };
          }) as SaleComposerInitial["items"],
        },
      };
    },
    enabled: !!id,
    staleTime: 0,
    gcTime: 0,
  });

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="flex h-[94vh] flex-col gap-0 rounded-t-3xl p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="text-left">{data ? `Editar venda ${data.number}` : "Editar venda"}</SheetTitle>
        </SheetHeader>
        {isLoading || !data ? (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <SaleComposer mode="edit" initial={data.initial} onClose={onClose} onSaved={onSaved} />
        )}
      </SheetContent>
    </Sheet>
  );
}
