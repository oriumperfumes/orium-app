/**
 * Detalhe de uma venda da loja, na janela lateral do Admin (nasce do cartão
 * tocado). Somente leitura: editar, cancelar e excluir ficam no rodapé e no
 * ⋯. Excluir reverte estoque e financeiro no banco, preservando auditoria.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Gem, History, Mic, Pencil, Receipt, Sparkles, Trash2, TrendingUp, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AdminConfirm, AdminMore } from "@/components/orium/admin/AdminUI";
import { PanelHeader, SoftButton, StatusDot } from "@/components/orium/admin/PanelKit";
import { SidePanel } from "@/components/orium/admin/orders/model";
import { Collapse } from "@/components/orium/admin/motion";
import { brl, fullDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { storeSaleCancel, storeSaleDelete, storeSaleDetail } from "@/lib/store-sales.functions";
import { saleHistory } from "./sale-history";
import { PAYMENT_LABEL, PAYMENTS, SaleThumb, isShowcaseImage } from "./parts";

export function SaleDetailSheet({
  id,
  originEl,
  onClose,
  onEdit,
  onDeleted,
}: {
  id: string | null;
  originEl?: HTMLElement | null;
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
      toast.success("Venda cancelada", { description: "O estoque voltou e ela saiu da receita." });
      invalidate();
      setConfirmCancel(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui cancelar."),
  });

  const remove = useMutation({
    mutationFn: () => storeSaleDelete({ data: { id: id! } }),
    onSuccess: () => {
      toast.success("Venda excluída", { description: "Estoque e financeiro foram revertidos." });
      invalidate();
      setConfirmDelete(false);
      const saleId = id;
      onClose();
      if (saleId) onDeleted?.(saleId);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui excluir a venda."),
  });

  const live = !!data && data.status !== "cancelada" && !data.deleted_at;
  const history = data ? saleHistory(data.events) : [];
  const showcase = !!data && (data.transcript === "Mostruário da Negociação" || data.items.some((i) => isShowcaseImage(i.image_url)));
  const pay = PAYMENTS.find((p) => p.value === data?.payment_method);
  const margin = data && data.total > 0 && data.cost_complete ? Math.round((data.gross_profit / data.total) * 100) : null;

  return (
    <SidePanel open={!!id} onClose={onClose} label="Venda da loja" originEl={originEl}>
      <PanelHeader
        image={data?.items[0]?.image_url ?? (data ? null : undefined)}
        fallback={<Receipt className="size-5" />}
        title={data ? `Venda ${data.sale_number}` : "Venda"}
        subtitle={data ? fullDateTime(data.sold_at) : "Carregando…"}
        onClose={onClose}
        right={
          live ? (
            <AdminMore
              label="Ações da venda"
              actions={[
                { label: "Editar venda", icon: <Pencil className="size-4" />, onSelect: () => data && onEdit?.(data.id) },
                { label: "Cancelar venda", icon: <XCircle className="size-4" />, onSelect: () => setConfirmCancel(true) },
                { label: "Excluir venda", icon: <Trash2 className="size-4" />, danger: true, separated: true, onSelect: () => setConfirmDelete(true) },
              ]}
            />
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 lg:px-6">
        {isLoading || !data ? (
          <div className="space-y-3">
            <div className="admin-skeleton h-40 rounded-[28px]" />
            <div className="admin-skeleton h-24 rounded-[24px]" />
            <div className="admin-skeleton h-24 rounded-[24px]" />
          </div>
        ) : (
          <div className="ui-view-in space-y-3">
            {/* total em destaque */}
            <section className={cn("sale-total relative overflow-hidden rounded-[28px] p-5", live ? "bg-[#FFD599] text-[#15130F]" : "bg-[#1A1A1A]")}>
              <div className="flex items-start justify-between gap-3">
                <p className={cn("text-[14px] font-semibold", live ? "text-[#15130F]/65" : "text-[#8C8C8C]")}>
                  {data.deleted_at ? "Venda excluída" : data.status === "cancelada" ? "Venda cancelada" : "Total pago"}
                </p>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {showcase ? (
                    <span className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold", live ? "bg-[#15130F] text-[#FFD599]" : "bg-[#232323] text-[#FFD599]")}>
                      <Gem className="size-3.5" /> Mostruário
                    </span>
                  ) : null}
                  {data.entry_method === "voice" ? (
                    <span className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-bold", live ? "bg-[#15130F]/10" : "bg-[#232323]")}>
                      <Mic className="size-3.5" /> Por voz
                    </span>
                  ) : null}
                </div>
              </div>
              <p className={cn("mt-2 text-[44px] leading-none font-bold tracking-[-0.05em] tabular-nums", !live && "line-through decoration-2 opacity-60")}>{brl(data.total)}</p>
              <div className={cn("mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13.5px] font-semibold", live ? "text-[#15130F]/75" : "text-[#A9A9A9]")}>
                <span className="inline-flex items-center gap-1.5 [&_svg]:size-4">
                  {pay?.icon}
                  {PAYMENT_LABEL[data.payment_method ?? ""] ?? "Sem pagamento"}
                </span>
                {data.discount > 0 ? <span>Desconto de {brl(data.discount)}</span> : null}
              </div>
            </section>

            {/* lucro */}
            <section className="flex min-w-0 items-center gap-3 rounded-[24px] bg-[#1A1A1A] p-4">
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", data.cost_complete ? "bg-[#7FCF9F]/12 text-[#7FCF9F]" : "bg-[#232323] text-[#8C8C8C]")}>
                <TrendingUp className="size-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[#8C8C8C]">Lucro bruto</p>
                <p className="truncate text-[18px] font-bold tabular-nums">{data.cost_complete ? brl(data.gross_profit) : "Custo não cadastrado"}</p>
              </div>
              {margin != null ? <span className="rounded-full bg-[#232323] px-3 py-1 text-[13px] font-bold tabular-nums">{margin}%</span> : null}
            </section>

            {/* itens */}
            <section className="rounded-[24px] bg-[#1A1A1A] p-2">
              {data.items.map((item, i) => (
                <div key={item.id} className={cn("flex min-w-0 items-center gap-3 p-2.5", i > 0 && "border-t border-white/[0.05]")}>
                  <SaleThumb url={item.image_url} name={item.name} size={56} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-[#8C8C8C]">{item.brand ?? "—"}</p>
                    <p className="line-clamp-2 text-[15px] leading-snug font-bold">{item.name}</p>
                    <p className="text-[12.5px] text-[#A9A9A9]">
                      {item.variant === "DECANT" ? `Decant ${item.decant_ml}ml` : "Frasco"} · {item.quantity}× {brl(item.unit_price)}
                    </p>
                  </div>
                  <p className="shrink-0 text-[15px] font-bold tabular-nums">{brl(item.subtotal)}</p>
                </div>
              ))}
            </section>

            {/* informações */}
            <section className="grid grid-cols-2 gap-3">
              <div className="min-w-0 rounded-[22px] bg-[#1A1A1A] p-4">
                <UserRound className="size-[18px] text-[#8C8C8C]" />
                <p className="mt-2 text-[12.5px] font-semibold text-[#8C8C8C]">Cliente</p>
                <p className="truncate text-[15px] font-bold">{data.customer_name ?? "Não informado"}</p>
              </div>
              <div className="min-w-0 rounded-[22px] bg-[#1A1A1A] p-4">
                <Clock3 className="size-[18px] text-[#8C8C8C]" />
                <p className="mt-2 text-[12.5px] font-semibold text-[#8C8C8C]">Situação</p>
                <StatusDot tone={data.deleted_at ? "coral" : data.status === "cancelada" ? "off" : "ok"} className="text-[15px] font-bold">
                  {data.deleted_at ? "Excluída" : data.status === "cancelada" ? "Cancelada" : "Concluída"}
                </StatusDot>
              </div>
            </section>

            {data.transcript && !showcase ? (
              <section className="flex min-w-0 gap-3 rounded-[22px] bg-[#1A1A1A] p-4">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-[#FFD599]" />
                <p className="min-w-0 text-[14px] leading-relaxed text-[#BABABA]">“{data.transcript}”</p>
              </section>
            ) : null}

            {history.length ? (
              <section className="rounded-[22px] bg-[#1A1A1A] p-2">
                <button
                  type="button"
                  onClick={() => setShowHistory((v) => !v)}
                  className="press flex w-full items-center gap-3 rounded-[16px] p-2.5 text-left hover:bg-[#202020]"
                >
                  <History className="size-[18px] text-[#8C8C8C]" />
                  <span className="flex-1 text-[14.5px] font-semibold">Histórico</span>
                  <span className="rounded-full bg-[#232323] px-2.5 py-0.5 text-[12px] font-bold tabular-nums">{history.length}</span>
                </button>
                <Collapse open={showHistory}>
                  <ol className="relative mx-3 mt-1 mb-3 space-y-4 border-l border-white/[0.08] pl-5">
                    {history.map((entry, i) => (
                      <li key={i} className="relative min-w-0">
                        <span className="absolute top-1.5 -left-[25px] size-2 rounded-full bg-[#FFD599]" />
                        <p className="text-[12px] text-[#8C8C8C]">{entry.when}</p>
                        <p className="text-[14px] font-semibold">{entry.title}</p>
                        {entry.lines.map((line, j) => (
                          <p key={j} className="text-[12.5px] text-[#A9A9A9]">
                            {line}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ol>
                </Collapse>
              </section>
            ) : null}
          </div>
        )}
      </div>

      {live ? (
        <footer className="pk-footer flex shrink-0 items-center gap-2 border-t border-white/[0.06] bg-[#121212] px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:px-6 lg:pb-5">
          <SoftButton className="flex-1" icon={<Pencil />} onClick={() => data && onEdit?.(data.id)}>
            Editar venda
          </SoftButton>
          <SoftButton aria-label="Excluir venda" className="w-[52px] px-0 text-[#FF9A8A]" icon={<Trash2 />} onClick={() => setConfirmDelete(true)} />
        </footer>
      ) : null}

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
            ? `Sai dos relatórios, o estoque é revertido e receita e lucro são recalculados. Venda ${data.sale_number} · ${brl(data.total)}.`
            : ""
        }
        confirmLabel="Excluir venda"
        onConfirm={() => remove.mutate()}
        danger
      />
    </SidePanel>
  );
}
