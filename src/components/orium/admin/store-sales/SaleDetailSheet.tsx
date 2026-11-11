/**
 * Detalhe de uma venda da loja: somente leitura. Editar e excluir vivem no
 * topo (⋯), e o histórico de alterações fica recolhido. Excluir reverte
 * estoque e financeiro no banco, preservando auditoria.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AdminConfirm, AdminKV, AdminMore, AdminTechDetails } from "@/components/orium/admin/AdminUI";
import { brl, fullDateTime } from "@/lib/format";
import { storeSaleCancel, storeSaleDelete, storeSaleDetail } from "@/lib/store-sales.functions";
import { saleHistory } from "./sale-history";

const PAYMENT_LABEL: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão", DINHEIRO: "Dinheiro" };

export function SaleDetailSheet({
  id,
  onClose,
  onEdit,
  onDeleted,
}: {
  id: string | null;
  onClose: () => void;
  onEdit?: (saleId: string) => void;
  onDeleted?: (saleId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["store-sale-detail", id],
    queryFn: () => storeSaleDetail({ data: { id: id! } }),
    enabled: !!id,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["store-sales"] });
    void queryClient.invalidateQueries({ queryKey: ["store-sale-detail", id] });
    void queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
  };

  const cancel = useMutation({
    mutationFn: () => storeSaleCancel({ data: { id: id! } }),
    onSuccess: () => {
      toast.success("Venda cancelada e estoque devolvido.");
      invalidate();
      setConfirmCancel(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui cancelar."),
  });

  const remove = useMutation({
    mutationFn: () => storeSaleDelete({ data: { id: id! } }),
    onSuccess: () => {
      toast.success("Venda excluída e movimentações revertidas.");
      invalidate();
      setConfirmDelete(false);
      const saleId = id;
      onClose();
      if (saleId) onDeleted?.(saleId);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui excluir a venda."),
  });

  const live = data && data.status !== "cancelada" && !data.deleted_at;
  const history = data ? saleHistory(data.events) : [];

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-3xl">
        <SheetHeader>
          <SheetTitle className="text-left">{data ? `Venda ${data.sale_number}` : "Venda"}</SheetTitle>
        </SheetHeader>

        {isLoading || !data ? (
          <div className="grid h-40 place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5 pb-6">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm text-muted-foreground">
                Loja física · {fullDateTime(data.sold_at)}
                {data.deleted_at ? " · Excluída" : data.status === "cancelada" ? " · Cancelada" : ""}
              </p>
              {live ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-full px-3"
                    onClick={() => {
                      const saleId = data.id;
                      onClose();
                      onEdit?.(saleId);
                    }}
                  >
                    <Pencil className="size-4" strokeWidth={1.75} />
                    Editar
                  </Button>
                  <AdminMore
                    actions={[
                      {
                        label: "Cancelar venda",
                        icon: <XCircle className="size-4" strokeWidth={1.75} />,
                        onSelect: () => setConfirmCancel(true),
                      },
                      {
                        label: "Excluir venda",
                        icon: <Trash2 className="size-4" strokeWidth={1.75} />,
                        danger: true,
                        separated: true,
                        onSelect: () => setConfirmDelete(true),
                      },
                    ]}
                    label="Ações da venda"
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              {data.items.map((item) => (
                <div key={item.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-card p-3">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name ?? ""} className="size-14 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-muted text-[10px] text-muted-foreground">
                      sem foto
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] tracking-wide text-muted-foreground uppercase">{item.brand ?? "—"}</p>
                    <p className="line-clamp-2 text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.variant === "DECANT" ? `Decant ${item.decant_ml}ml` : "Frasco"} · {item.quantity}x ·{" "}
                      {brl(item.unit_price)} cada
                    </p>
                  </div>
                  <p className="shrink-0 text-sm tabular-nums">{brl(item.subtotal)}</p>
                </div>
              ))}
            </div>

            <div className="space-y-1.5 rounded-2xl border border-border/60 bg-card p-4">
              <AdminKV label="Subtotal" value={brl(data.subtotal)} />
              {data.discount > 0 ? <AdminKV label="Desconto" value={`− ${brl(data.discount)}`} /> : null}
              <AdminKV label="Total pago" value={brl(data.total)} strong />
              <AdminKV label="Pagamento" value={PAYMENT_LABEL[data.payment_method ?? ""] ?? "—"} />
              <AdminKV
                label="Lucro bruto"
                value={data.cost_complete ? brl(data.gross_profit) : "Lucro pendente — custo ausente"}
              />
              <AdminKV label="Registro" value={data.entry_method === "voice" ? "Voz" : "Manual"} />
              {data.customer_name ? <AdminKV label="Cliente" value={data.customer_name} /> : null}
            </div>

            {data.transcript ? (
              <AdminTechDetails label="Ver transcrição">
                <p className="text-sm text-muted-foreground">“{data.transcript}”</p>
              </AdminTechDetails>
            ) : null}

            <div>
              <button
                type="button"
                className="press text-sm text-muted-foreground underline"
                onClick={() => setShowHistory((v) => !v)}
              >
                {showHistory ? "Ocultar histórico" : "Ver histórico"}
              </button>
              {showHistory ? (
                <ul className="mt-3 space-y-3">
                  {history.map((entry, i) => (
                    <li key={i} className="min-w-0 border-l-2 border-border/60 pl-3">
                      <p className="text-[11px] text-muted-foreground">{entry.when}</p>
                      <p className="text-sm font-medium">{entry.title}</p>
                      {entry.lines.map((line, j) => (
                        <p key={j} className="text-xs text-muted-foreground">
                          {line}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        )}

        <AdminConfirm
          open={confirmCancel}
          onOpenChange={setConfirmCancel}
          title="Cancelar esta venda?"
          description="O estoque volta como estava e a venda deixa de contar na receita e no lucro. O histórico é preservado."
          confirmLabel="Cancelar venda"
          onConfirm={() => cancel.mutate()}
          danger
        />

        <AdminConfirm
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Excluir esta venda?"
          description={
            data
              ? `Essa ação retira a venda dos relatórios, reverte o estoque, recalcula receita e lucro, atualiza os mais vendidos e remove os efeitos de reposição quando aplicável. Venda ${data.sale_number} · Total ${brl(data.total)}.`
              : ""
          }
          confirmLabel="Excluir venda"
          onConfirm={() => remove.mutate()}
          danger
        />
      </SheetContent>
    </Sheet>
  );
}
