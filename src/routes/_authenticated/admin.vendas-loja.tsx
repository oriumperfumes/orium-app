/**
 * ADMIN → VENDAS DA LOJA
 *
 * Vendas presenciais: toque, fale, revise, confirme. Elas somam na receita, no
 * lucro bruto, no estoque e nos mais vendidos — e nunca entram no funil digital.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, Plus, Check, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { AdminBlock, AdminConfirm, AdminEmpty, AdminMore, AdminRowsSkeleton } from "@/components/orium/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCopilot } from "@/components/orium/copilot/CopilotPanel";
import { SaleComposer } from "@/components/orium/admin/store-sales/SaleComposer";
import { SaleDetailSheet } from "@/components/orium/admin/store-sales/SaleDetailSheet";
import { SaleEditSheet } from "@/components/orium/admin/store-sales/SaleEditSheet";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

import { storeSaleDelete, storeSaleList, type StoreSaleListItem } from "@/lib/store-sales.functions";


export const Route = createFileRoute("/_authenticated/admin/vendas-loja")({
  head: () => ({
    meta: [
      { title: "Vendas da loja — Orium Admin" },
      { name: "description", content: "Registro de vendas presenciais da Orium Perfumes, por voz ou manual." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { registrar?: "voz" | "manual" } =>
    search["registrar"] === "voz" || search["registrar"] === "manual" ? { registrar: search["registrar"] as "voz" | "manual" } : {},
  component: StoreSalesPage,
});

const PAYMENT_LABEL: Record<string, string> = { PIX: "Pix", CARTAO: "Cartão", DINHEIRO: "Dinheiro" };

const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  if (same) return "Hoje";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
};

function SaleRow({
  sale,
  onOpen,
  onEdit,
  onDelete,
  leaving,
}: {
  sale: StoreSaleListItem;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  leaving: boolean;
}) {
  const first = sale.items[0];
  const extra = sale.items.length - 1;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-2xl border border-border/60 bg-card p-3 transition-all duration-200",
        leaving && "-translate-y-1 scale-[0.98] opacity-0",
      )}
    >
      <button onClick={onOpen} className="press flex min-w-0 flex-1 items-center gap-3 text-left">
        {first?.image_url ? (
          <img src={first.image_url} alt={first.name ?? ""} className="size-14 shrink-0 rounded-xl object-cover" loading="lazy" />
        ) : (
          <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-muted text-[10px] text-muted-foreground">
            sem foto
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">
              {sale.sale_number} · {hour(sale.sold_at)}
            </span>
            {sale.entry_method === "voice" ? <Mic className="size-3 shrink-0" strokeWidth={2} /> : null}
          </p>
          <p className="line-clamp-2 text-sm font-medium">
            {sale.items.map((i) => `${i.quantity}x ${i.name ?? "Perfume"}`).slice(0, 2).join(" · ")}
            {extra > 1 ? ` +${extra - 1}` : ""}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {first ? (first.variant === "DECANT" ? `Decant ${first.decant_ml}ml` : "Frasco") : ""}
            {sale.payment_method ? ` · ${PAYMENT_LABEL[sale.payment_method] ?? sale.payment_method}` : ""}
            {sale.status === "cancelada" ? " · Cancelada" : ""}
          </p>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums">{brl(sale.total)}</p>
      </button>
      <AdminMore
        label={`Ações da venda ${sale.sale_number}`}
        actions={[
          { label: "Ver venda", onSelect: onOpen },
          { label: "Editar venda", icon: <Pencil className="size-4" strokeWidth={1.75} />, onSelect: onEdit },
          {
            label: "Excluir venda",
            icon: <Trash2 className="size-4" strokeWidth={1.75} />,
            danger: true,
            separated: true,
            onSelect: onDelete,
          },
        ]}
      />
    </div>
  );
}


function StoreSalesPage() {
  const queryClient = useQueryClient();
  const { registrar } = Route.useSearch();
  const [composer, setComposer] = useState<"manual" | null>(registrar === "manual" ? "manual" : null);
  const copilot = useCopilot();
  const speakToCopilot = () => {
    (window as any).__oriumListen = true;
    copilot.setOpen(true);
    setTimeout(() => window.dispatchEvent(new CustomEvent("orium:copilot-listen")), 380);
  };
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StoreSaleListItem | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: string; total: number } | null>(null);


  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    return { from: from.toISOString(), to: new Date(to.getTime() + 60_000).toISOString() };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["store-sales", range.from, range.to],
    queryFn: () => storeSaleList({ data: range }),
    staleTime: 30_000,
  });

  const groups = useMemo(() => {
    const out = new Map<string, StoreSaleListItem[]>();
    for (const sale of data?.sales ?? []) {
      const key = dayLabel(sale.sold_at);
      const list = out.get(key) ?? [];
      list.push(sale);
      out.set(key, list);
    }
    return Array.from(out.entries());
  }, [data]);

  const afterSave = (saleId: string) => {
    const total = data?.sales.find((s) => s.id === saleId)?.total ?? 0;
    setComposer(null);
    setSuccess({ id: saleId, total });
    void queryClient.invalidateQueries({ queryKey: ["store-sales"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
  };

  const afterEdit = (saleId: string) => {
    setEditId(null);
    toast.success("Alterações salvas — estoque e financeiro reconciliados.");
    void queryClient.invalidateQueries({ queryKey: ["store-sales"] });
    void queryClient.invalidateQueries({ queryKey: ["store-sale-detail", saleId] });
    void queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
  };

  const remove = useMutation({
    mutationFn: (saleId: string) => storeSaleDelete({ data: { id: saleId } }),
    onSuccess: (_res, saleId) => {
      toast.success("Venda excluída e movimentações revertidas.");
      setDeleting(null);
      setLeavingId(saleId);
      window.setTimeout(() => {
        setLeavingId(null);
        void queryClient.invalidateQueries({ queryKey: ["store-sales"] });
        void queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      }, 220);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui excluir a venda."),
  });



  return (
    <AdminShell title="Vendas da loja" description="Vendas presenciais: fale com o Copilot ou lance manualmente.">
      <div className="space-y-6">
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <Button className="h-14 w-full rounded-full text-base" onClick={speakToCopilot}>
            <Mic className="size-5" strokeWidth={1.75} />
            Registrar com Copilot
          </Button>
          <Button variant="outline" className="h-14 w-full rounded-full text-base" onClick={() => setComposer("manual")}>
            <Plus className="size-5" strokeWidth={1.75} />
            Nova venda
          </Button>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2">
          <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-4">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Vendas de hoje</p>
            <p className="mt-1 truncate text-xl font-semibold tabular-nums">{brl(data?.today.total ?? 0)}</p>
            <p className="text-xs text-muted-foreground">
              {(data?.today.count ?? 0) === 1 ? "1 venda" : `${data?.today.count ?? 0} vendas`}
            </p>
          </div>
          <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-4">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Últimos 30 dias</p>
            <p className="mt-1 truncate text-xl font-semibold tabular-nums">{brl(data?.period.total ?? 0)}</p>
            <p className="text-xs text-muted-foreground">
              Lucro bruto {brl(data?.period.profit ?? 0)}
            </p>
          </div>
        </div>

        {isLoading ? (
          <AdminRowsSkeleton rows={3} />
        ) : groups.length === 0 ? (
          <AdminEmpty>Nenhuma venda registrada na loja ainda.</AdminEmpty>
        ) : (
          groups.map(([label, sales]) => (
            <AdminBlock key={label} title={label}>
              <div className="space-y-2">
                {sales.map((sale) => (
                  <SaleRow
                    key={sale.id}
                    sale={sale}
                    leaving={leavingId === sale.id}
                    onOpen={() => setDetailId(sale.id)}
                    onEdit={() => setEditId(sale.id)}
                    onDelete={() => setDeleting(sale)}
                  />
                ))}

              </div>
            </AdminBlock>
          ))
        )}
      </div>

      <Sheet open={!!composer} onOpenChange={(open) => !open && setComposer(null)}>
        <SheetContent side="bottom" className="flex h-[94vh] flex-col gap-0 rounded-t-3xl p-0">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle className="text-left">
              Nova venda
            </SheetTitle>
          </SheetHeader>
          {composer ? <SaleComposer mode={composer} onClose={() => setComposer(null)} onSaved={afterSave} /> : null}
        </SheetContent>
      </Sheet>

      <Sheet open={!!success} onOpenChange={(open) => !open && setSuccess(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-gold/15 text-gold">
              <Check className="size-7" strokeWidth={2} />
            </span>
            <div>
              <h2 className="display text-2xl">Venda registrada</h2>
              <p className="mt-1 text-sm text-muted-foreground">Estoque, financeiro e lucro atualizados.</p>
            </div>
            <div className="flex w-full max-w-sm flex-col gap-2">
              <Button
                className="h-14 w-full rounded-full text-base"
                onClick={() => {
                  setSuccess(null);
                  speakToCopilot();
                }}
              >
                <Mic className="size-5" strokeWidth={1.75} />
                Registrar outra venda
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full rounded-full"
                onClick={() => {
                  const id = success?.id ?? null;
                  setSuccess(null);
                  setDetailId(id);
                }}
              >
                Ver venda
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <SaleDetailSheet
        id={detailId}
        onClose={() => setDetailId(null)}
        onEdit={(saleId) => setEditId(saleId)}
        onDeleted={(saleId) => {
          setLeavingId(saleId);
          window.setTimeout(() => setLeavingId(null), 220);
        }}
      />

      <SaleEditSheet id={editId} onClose={() => setEditId(null)} onSaved={afterEdit} />

      <AdminConfirm
        open={!!deleting}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title="Excluir esta venda?"
        description={
          deleting
            ? `O estoque volta como estava, receita e lucro são recalculados, os mais vendidos se ajustam e a venda sai dos relatórios. Venda ${deleting.sale_number} · Total ${brl(deleting.total)}.`
            : ""
        }
        confirmLabel="Excluir venda"
        danger
        onConfirm={() => { if (deleting && !remove.isPending) remove.mutate(deleting.id); }}
      />

    </AdminShell>
  );
}
