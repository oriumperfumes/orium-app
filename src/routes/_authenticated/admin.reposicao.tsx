import { ShipmentFreight } from "@/components/orium/admin/suppliers/ShipmentFreight";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, FileText, MessageCircle, Plus, Printer, Search, SlidersHorizontal, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/orium/AdminShell";
import { useCopilot } from "@/components/orium/copilot/CopilotPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { setRestockItemStatus } from "@/lib/orders.functions";
import { RestockConsultSheet, isSupplierInquiryEligible } from "@/components/orium/admin/SupplierQuoteSheet";
import { openRestockDocument, restockText, type ExportGroup } from "@/lib/restock-export";
import { AdminActionBar, AdminEmpty, AdminPrimaryAction, AdminRowsSkeleton, AdminSecondaryAction, type AdminAction } from "@/components/orium/admin/AdminUI";
import { ItemThumb } from "@/components/orium/admin/OrderItems";
import { RestockItemRow, type RestockRow } from "@/components/orium/admin/RestockItemRow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/admin/reposicao")({
  validateSearch: (search: Record<string, unknown>): RestockSearch =>
    typeof search["pedido"] === "string" ? { pedido: search["pedido"] } : {},
  head: () => ({
    meta: [{ title: "Reposição — Orium Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminRestock,
});

type RestockSearch = { pedido?: string };

/* ------------------------------------------------------------------ *
 * Reposição = lista de compras da loja.
 * Buscar → escolher fornecedor → quantidade → agrupar → copiar.
 * Nenhuma regra nova de negócio: fornecedor vencedor, custos e estoque
 * continuam vindo de product_costs / supplier_products / products.
 * ------------------------------------------------------------------ */

type Offer = { supplierId: string; supplier: string; cost: number; inStock: boolean; stock: number | null };

const norm = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const fuzzy = (haystack: string, query: string) => {
  const h = norm(haystack);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => h.includes(t) || (t.length > 3 && h.includes(t.slice(0, t.length - 1))));
};

function AdminRestock() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const { pedido } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { setOpen: openCopilot } = useCopilot();
  const setItemStatus = useServerFn(setRestockItemStatus);

  const [view, setView] = useState<"todos" | "fornecedor">("fornecedor");
  const [addOpen, setAddOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [swapId, setSwapId] = useState<string | null>(null);
  const [exportGroups, setExportGroups] = useState<ExportGroup[] | null>(null);
  const [withPrices, setWithPrices] = useState(true);
  const [consultOpen, setConsultOpen] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [fSupplier, setFSupplier] = useState<string | null>(null);
  const [fBrand, setFBrand] = useState<string | null>(null);
  const [fAvailable, setFAvailable] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["admin-restock"],
    queryFn: async () => {
      const list =
        (await supabase.from("restock_lists").select("*").eq("status", "aberta").limit(1).maybeSingle()).data ??
        (
          await supabase
            .from("restock_lists")
            .insert({ name: "Lista de reposição", created_by: session?.user.id ?? null })
            .select()
            .single()
        ).data;

      const [items, products, costs, suppliers, sources, orders] = await Promise.all([
        supabase.from("restock_items").select("*").eq("restock_list_id", list!.id),
        supabase
          .from("products")
          .select("id, canonical_name, brand, volume_ml, concentration, image_url, in_stock, stock_quantity")
          .eq("active", true),
        supabase.from("product_costs").select("*"),
        supabase.from("suppliers").select("id, name"),
        supabase.from("restock_item_sources").select("*"),
        supabase.from("catalog_orders").select("id, order_number, customer_name"),
      ]);

      const productIds = [...new Set((items.data ?? []).map((i: any) => i.product_id).filter(Boolean))];
      const offers = productIds.length
        ? (
            await supabase
              .from("supplier_products")
              .select("product_id, supplier_id, price, normalized_cost, in_stock, stock_quantity")
              .in("product_id", productIds)
          ).data ?? []
        : [];

      return {
        list: list!,
        items: items.data ?? [],
        products: products.data ?? [],
        costs: costs.data ?? [],
        suppliers: suppliers.data ?? [],
        sources: sources.data ?? [],
        orders: orders.data ?? [],
        offers,
      };
    },
  });

  const supplierName = (id?: string | null) =>
    (id ? data?.suppliers.find((s: any) => s.id === id)?.name : null) ?? "Sem fornecedor";

  /** Ofertas por produto, uma linha por fornecedor (a mais barata dele). */
  const offersByProduct = useMemo(() => {
    const out = new Map<string, Offer[]>();
    (data?.offers ?? []).forEach((o: any) => {
      const cost = Number(o.normalized_cost ?? o.price ?? 0);
      if (!(cost > 0)) return;
      const list = out.get(o.product_id) ?? [];
      const prev = list.find((x) => x.supplierId === o.supplier_id);
      if (prev) {
        if (cost < prev.cost) {
          prev.cost = cost;
          prev.inStock = o.in_stock !== false;
          prev.stock = o.stock_quantity ?? null;
        }
      } else {
        list.push({
          supplierId: o.supplier_id,
          supplier: supplierName(o.supplier_id),
          cost,
          inStock: o.in_stock !== false,
          stock: o.stock_quantity ?? null,
        });
      }
      out.set(o.product_id, list.sort((a, b) => a.cost - b.cost));
    });
    return out;
  }, [data]);

  /** Linhas prontas para a tela, já com custo, economia e origem. */
  const rows = useMemo(() => {
    const orderIds = pedido ? new Set([pedido]) : null;
    const perProduct = new Map<string, number>();
    (data?.items ?? []).forEach((i: any) => perProduct.set(i.product_id, (perProduct.get(i.product_id) ?? 0) + 1));

    const out: Array<RestockRow & { productId: string; raw: any }> = [];

    (data?.items ?? []).forEach((it: any) => {
      const itemSources = (data?.sources ?? []).filter((s: any) => s.restock_item_id === it.id);
      if (orderIds && !itemSources.some((s: any) => orderIds.has(s.order_id))) return;

      const product = data?.products.find((p: any) => p.id === it.product_id);
      const name = productTitle(product?.canonical_name ?? "Produto");
      const brand = product?.brand ? productTitle(product.brand) : null;
      const supplier = supplierName(it.supplier_id);

      if (listSearch.trim() && !fuzzy(`${brand ?? ""} ${name}`, listSearch)) return;
      if (fSupplier && (it.supplier_id ?? "sem") !== fSupplier) return;
      if (fBrand && (product?.brand ?? "") !== fBrand) return;

      const locked = it.cost_locked === true;
      const cost = Number(it.unit_cost ?? 0);
      const best = data?.costs.find((c: any) => c.product_id === it.product_id)?.best_cost;
      const fee = Number(it.extra_fee ?? 0);
      const unit = (locked ? cost : (best == null ? cost : Number(best))) + fee;

      const offers = offersByProduct.get(it.product_id) ?? [];
      const chosen = offers.find((o) => o.supplierId === it.supplier_id) ?? null;
      const unavailable = !!chosen && !chosen.inStock;
      if (fAvailable && unavailable) return;

      const alternatives = offers.filter((o) => o.inStock && o.supplierId !== it.supplier_id);
      const cheapest = alternatives[0] ?? null;
      const saving = cheapest ? (unit - fee - cheapest.cost) * Number(it.quantity ?? 1) : 0;

      out.push({
        id: it.id,
        productId: it.product_id,
        raw: it,
        name,
        brand,
        image: product?.image_url ?? null,
        supplier,
        supplierId: it.supplier_id ?? null,
        qty: Number(it.quantity ?? 1),
        unit,
        fee,
        status: it.status ?? "a comprar",
        manual: locked,
        stock: product?.stock_quantity ?? null,
        unavailable,
        cheaper:
          cheapest && (unavailable || saving > 1)
            ? {
                supplier: cheapest.supplier,
                supplierId: cheapest.supplierId,
                unit: cheapest.cost + fee,
                saving: Math.max(0, saving),
              }
            : null,
        duplicated: (perProduct.get(it.product_id) ?? 0) > 1,
        sources: itemSources.map((s: any) => {
          const order = data?.orders.find((o: any) => o.id === s.order_id);
          return { qty: Number(s.quantity), label: `Pedido #${order?.order_number ?? "—"}` };
        }),
      });
    });

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [data, offersByProduct, listSearch, fSupplier, fBrand, fAvailable, pedido]);

  const groups = useMemo(() => {
    const map = new Map<string, { supplier: string; rows: typeof rows }>();
    rows.forEach((r) => {
      const key = r.supplierId ?? "sem";
      const entry = map.get(key) ?? { supplier: r.supplier, rows: [] };
      entry.rows.push(r);
      map.set(key, entry);
    });
    return [...map.values()].sort((a, b) => a.supplier.localeCompare(b.supplier));
  }, [rows]);

  const totals = useMemo(() => {
    const units = rows.reduce((s, r) => s + r.qty, 0);
    const cost = rows.reduce((s, r) => s + r.qty * r.unit, 0);
    return { products: rows.length, units, suppliers: groups.length, cost };
  }, [rows, groups]);

  const toExport = (list: typeof groups): ExportGroup[] =>
    list.map((g) => ({
      supplier: g.supplier,
      items: g.rows.map((r) => ({
        name: [r.brand, r.name].filter(Boolean).join(" "),
        quantity: r.qty,
        unitCost: r.unit,
      })),
    }));

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-restock"] });

  /** Quantidade muda só a linha na tela; o banco confirma em seguida. */
  const setQty = async (id: string, qty: number) => {
    qc.setQueryData(["admin-restock"], (old: any) =>
      old ? { ...old, items: old.items.map((i: any) => (i.id === id ? { ...i, quantity: qty } : i)) } : old,
    );
    const { error } = await supabase.from("restock_items").update({ quantity: Math.max(1, qty) }).eq("id", id);
    if (error) {
      toast.error("Não foi possível atualizar a quantidade. Tente novamente.");
      invalidate();
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("restock_items").delete().eq("id", id);
    if (error) {
      toast.error("Não foi possível remover o produto. Tente novamente.");
      return;
    }
    toast.success("Produto removido.");
    invalidate();
  };

  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const clearAll = async () => {
    if (!data?.list?.id) return;
    setClearing(true);
    const { error } = await supabase.from("restock_items").delete().eq("restock_list_id", data.list.id);
    setClearing(false);
    if (error) {
      toast.error("Não foi possível limpar a reposição. Tente novamente.");
      return;
    }
    setClearOpen(false);
    toast.success("Reposição limpa.");
    invalidate();
  };

  /** Grava fornecedor escolhido à mão + custo real da compra. */
  const saveSupplier = async (id: string, supplierId: string | null, unitCost: number, extraFee: number) => {
    const { error } = await supabase
      .from("restock_items")
      .update({ supplier_id: supplierId, unit_cost: unitCost, extra_fee: extraFee, cost_locked: true } as never)
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível atualizar o fornecedor. Tente novamente.");
      return;
    }
    setSwapId(null);
    toast.success("Fornecedor atualizado.");
    invalidate();
  };

  /** Menor preço disponível — respeita quem já foi escolhido à mão. */
  const useCheapest = async () => {
    const targets = rows.filter((r) => !r.manual && r.cheaper);
    if (!targets.length) {
      toast.info("Todos os itens já estão no melhor custo disponível.");
      return;
    }
    for (const r of targets) {
      await supabase
        .from("restock_items")
        .update({ supplier_id: r.cheaper!.supplierId, unit_cost: r.cheaper!.unit - r.fee } as never)
        .eq("id", r.id);
    }
    toast.success(`${targets.length} ${targets.length === 1 ? "item" : "itens"} no menor preço.`);
    invalidate();
  };

  const markGroup = async (list: typeof rows, status: "a comprar" | "pedido feito" | "recebido") => {
    for (const r of list) await setItemStatus({ data: { itemId: r.id, status } });
    toast.success(status === "pedido feito" ? "Reposição marcada como enviada." : `Itens marcados como ${status}.`);
    invalidate();
  };

  const copy = async (list: typeof groups) => {
    await navigator.clipboard.writeText(restockText(toExport(list), withPrices));
    toast.success("Lista copiada.");
  };

  const rowActions = (r: (typeof rows)[number]): AdminAction[] => [
    { label: "Trocar fornecedor", onSelect: () => setSwapId(r.id) },
    { label: "Marcar pedido feito", onSelect: () => void markGroup([r], "pedido feito") },
    { label: "Marcar recebido", onSelect: () => void markGroup([r], "recebido") },
    { label: "Voltar para a comprar", onSelect: () => void markGroup([r], "a comprar") },
    {
      label: "Remover da reposição",
      danger: true,
      separated: true,
      icon: <Trash2 className="size-4" />,
      onSelect: () => void remove(r.id),
    },
  ];

  const brands = useMemo(
    () => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort() as string[],
    [rows],
  );

  const filtersOn = !!fSupplier || !!fBrand || fAvailable;

  return (
    <AdminShell
      title="Reposição"
      wide
      action={
        <>
          <AdminActionBar
            primary={
              <AdminPrimaryAction icon={<Plus />} onClick={() => setAddOpen(true)}>
                Adicionar produto
              </AdminPrimaryAction>
            }
            secondary={
              <AdminSecondaryAction icon={<MessageCircle />} onClick={() => setConsultOpen(true)}>
                Consultar fornecedores
              </AdminSecondaryAction>
            }
            complementary={
              <AdminSecondaryAction
                icon={<Trash2 />}
                className="text-destructive"
                onClick={() => (data?.items?.length ? setClearOpen(true) : toast("A reposição já está vazia."))}
              >
                Limpar tudo
              </AdminSecondaryAction>
            }
          />
          <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
            <AlertDialogContent className="rounded-3xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Apagar toda a reposição?</AlertDialogTitle>
                <AlertDialogDescription>
                  {data?.items?.length ?? 0} item(ns) serão removidos da lista. Pedidos, estoque e produtos não são
                  alterados. Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-full">Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={clearing}
                  onClick={(e) => {
                    e.preventDefault();
                    void clearAll();
                  }}
                >
                  {clearing ? "Apagando…" : "Apagar tudo"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      }
    >
      {pedido ? (
        <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3 text-sm">
          <span className="min-w-0">Mostrando apenas os itens deste pedido.</span>
          <Button size="sm" variant="ghost" className="rounded-full" onClick={() => navigate({ to: "/admin/reposicao", search: {} })}>
            Ver lista completa
          </Button>
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-start gap-5 @[1040px]/page:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] @[1040px]/page:gap-6">
        <div className="min-w-0">
          {/* resumo curto: só o que ajuda a decidir */}
          <div className="grid min-w-0 grid-cols-2 gap-2.5 @[760px]/page:grid-cols-4">
            <Metric label="Produtos" value={String(totals.products)} />
            <Metric label="Unidades" value={String(totals.units)} />
            <Metric label="Fornecedores" value={String(totals.suppliers)} />
            <Metric label="Custo total" value={brl(totals.cost)} />
          </div>

          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="Buscar na reposição"
                className="h-11 rounded-full pl-9 text-base"
              />
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className={cn(
                "press inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm",
                filtersOn ? "border-gold/40 bg-gold/10 text-gold" : "border-border/60",
              )}
            >
              <SlidersHorizontal className="size-4" /> Filtros
            </button>
          </div>

          <div className="mt-3 inline-flex rounded-full border border-border/60 p-0.5">
            {(["todos", "fornecedor"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "press rounded-full px-4 py-1.5 text-sm transition-colors duration-150",
                  view === v ? "bg-foreground text-background" : "text-muted-foreground",
                )}
              >
                {v === "todos" ? "Todos" : "Por fornecedor"}
              </button>
            ))}
          </div>

          {/* sem espaço para a coluna lateral, o resumo vira faixa antes da lista */}
          <div className="mt-4 @[1040px]/page:hidden">
            <SupplierTotals
              groups={groups}
              total={totals.cost}
              horizontal
              onCopy={() => void copy(groups)}
              onExport={() => setExportGroups(toExport(groups))}
              onCheapest={() => void useCheapest()}
            />
          </div>


          <div className="mt-4">
            {isPending ? (
              <AdminRowsSkeleton rows={4} height={84} />
            ) : rows.length === 0 ? (
              <AdminEmpty>Nada para comprar agora. Toque em “Adicionar produto”.</AdminEmpty>
            ) : view === "todos" ? (
              <div className="divide-y divide-border/50 rounded-2xl border border-border/60 bg-card px-4">
                {rows.map((r) => (
                  <RestockItemRow
                    key={r.id}
                    row={r}
                    onQty={(q) => void setQty(r.id, q)}
                    onSwap={() => setSwapId(r.id)}
                    actions={rowActions(r)}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {groups.map((g) => {
                  const units = g.rows.reduce((s, r) => s + r.qty, 0);
                  const subtotal = g.rows.reduce((s, r) => s + r.qty * r.unit, 0);
                  return (
                    <section key={g.supplier} className="@container/group min-w-0 rounded-2xl border border-border/60 bg-card">
                      <header className="flex min-w-0 flex-col gap-2 border-b border-border/50 px-4 py-3 @[560px]/group:flex-row @[560px]/group:items-center @[560px]/group:justify-between">
                        <div className="min-w-0">
                          <h2 className="truncate text-[11px] font-semibold tracking-[0.12em] uppercase">{g.supplier}</h2>
                          <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                            {units} {units === 1 ? "unidade" : "unidades"} · {brl(subtotal)}
                          </p>
                        </div>
                        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                          <Button size="sm" variant="outline" className="press rounded-full" onClick={() => void copy([g])}>
                            <Copy className="size-3.5" /> Copiar lista
                          </Button>
                          <Button size="sm" variant="ghost" className="press rounded-full" onClick={() => setExportGroups(toExport([g]))}>
                            <FileText className="size-3.5" /> Exportar
                          </Button>
                        </div>
                      </header>
                      <div className="min-w-0 divide-y divide-border/50 px-4 @[860px]/group:px-5">
                        {g.rows.map((r) => (
                          <RestockItemRow
                            key={r.id}
                            row={r}
                            onQty={(q) => void setQty(r.id, q)}
                            onSwap={() => setSwapId(r.id)}
                            actions={rowActions(r)}
                          />
                        ))}
                      </div>
                      {g.rows[0]?.supplierId ? (
                        <ShipmentFreight supplierId={g.rows[0].supplierId} lines={g.rows.map((r) => ({ key: r.id, qty: r.qty, unit: r.unit }))} />
                      ) : null}
                      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => void markGroup(g.rows, "pedido feito")}
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          Marcar pedido enviado
                        </button>
                        <button
                          type="button"
                          onClick={() => void markGroup(g.rows, "recebido")}
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          Marcar recebido
                        </button>
                      </footer>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* resumo por fornecedor: acompanha a rolagem só quando há coluna lateral */}
        <aside className="hidden min-w-0 @[1040px]/page:sticky @[1040px]/page:top-20 @[1040px]/page:block @[1040px]/page:self-start">
          <SupplierTotals
            groups={groups}
            total={totals.cost}
            onCopy={() => void copy(groups)}
            onExport={() => setExportGroups(toExport(groups))}
            onCheapest={() => void useCheapest()}
          />
        </aside>
      </div>

      <AddProductSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        products={data?.products ?? []}
        suppliers={data?.suppliers ?? []}
        costs={data?.costs ?? []}
        items={data?.items ?? []}
        listId={data?.list.id ?? null}
        onDone={invalidate}
      />

      <SwapSupplierSheet
        row={rows.find((r) => r.id === swapId) ?? null}
        offers={swapId ? (offersByProduct.get(rows.find((r) => r.id === swapId)?.productId ?? "") ?? []) : []}
        onClose={() => setSwapId(null)}
        onSave={saveSupplier}
      />

      <RestockConsultSheet
        open={consultOpen}
        onOpenChange={setConsultOpen}
        products={(data?.items ?? []).filter((it: any) => isSupplierInquiryEligible(it)).map((it: any) => {
          const p = data?.products.find((x: any) => x.id === it.product_id);
          return { key: it.product_id ?? it.id, name: productTitle(p?.canonical_name ?? "Produto") };
        })}
      />
      <Sheet open={!!exportGroups} onOpenChange={(v) => !v && setExportGroups(null)}>
        <SheetContent side="bottom" className="rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
          <SheetHeader className="px-0 text-left">
            <SheetTitle className="text-base">Exportar reposição</SheetTitle>
            <SheetDescription>Documento de compra pronto para salvar em PDF ou imprimir.</SheetDescription>
          </SheetHeader>

          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3">
              <Label className="text-sm">Incluir valores</Label>
              <Switch checked={withPrices} onCheckedChange={setWithPrices} />
            </div>

            <Button
              variant="outline"
              className="press h-12 w-full justify-start rounded-xl"
              onClick={async () => {
                await navigator.clipboard.writeText(restockText(exportGroups ?? [], withPrices));
                toast.success("Lista copiada.");
                setExportGroups(null);
              }}
            >
              <Copy className="size-4" /> Copiar pedido
            </Button>

            <Button
              className="press h-12 w-full justify-start rounded-xl"
              onClick={() => {
                if (!openRestockDocument(exportGroups ?? [], withPrices))
                  toast.error("Libere as janelas pop-up para gerar o documento.");
                setExportGroups(null);
              }}
            >
              <FileText className="size-4" /> Exportar documento
            </Button>

            <Button
              variant="ghost"
              className="press h-12 w-full justify-start rounded-xl text-muted-foreground"
              onClick={() => {
                if (!openRestockDocument(exportGroups ?? [], withPrices))
                  toast.error("Libere as janelas pop-up para imprimir.");
                setExportGroups(null);
              }}
            >
              <Printer className="size-4" /> Imprimir
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
          <SheetHeader className="px-0 text-left">
            <SheetTitle className="text-base">Filtros</SheetTitle>
          </SheetHeader>

          <div className="mt-3 space-y-5">
            <FilterChips
              title="Fornecedor"
              options={groups.map((g) => ({
                value: g.rows[0]?.supplierId ?? "sem",
                label: g.supplier,
              }))}
              value={fSupplier}
              onChange={setFSupplier}
            />
            <FilterChips
              title="Marca"
              options={brands.map((b) => ({ value: b, label: productTitle(b) }))}
              value={fBrand}
              onChange={setFBrand}
            />
            <div className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3">
              <Label className="text-sm">Só disponíveis</Label>
              <Switch checked={fAvailable} onCheckedChange={setFAvailable} />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="press h-11 flex-1 rounded-full"
                onClick={() => {
                  setFSupplier(null);
                  setFBrand(null);
                  setFAvailable(false);
                }}
              >
                Limpar
              </Button>
              <Button className="press h-11 flex-1 rounded-full" onClick={() => setFiltersOpen(false)}>
                Ver resultados
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </AdminShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-card px-3.5 py-3">
      <p className="truncate text-[10px] tracking-[0.1em] text-muted-foreground uppercase">{label}</p>
      <p
        key={value}
        className="admin-value-in mt-0.5 font-semibold whitespace-nowrap tabular-nums"
        style={{ fontSize: "clamp(0.95rem, 3.4vw, 1.25rem)" }}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Total por fornecedor. Na coluna lateral fica em pilha; sem espaço lateral,
 * vira faixa horizontal escaneável antes das listas.
 */
function SupplierTotals({
  groups,
  total,
  horizontal,
  onCopy,
  onExport,
  onCheapest,
}: {
  groups: Array<{ supplier: string; rows: Array<{ qty: number; unit: number }> }>;
  total: number;
  horizontal?: boolean;
  onCopy: () => void;
  onExport: () => void;
  onCheapest: () => void;
}) {
  const lines = groups.map((g) => ({
    supplier: g.supplier,
    units: g.rows.reduce((s, r) => s + r.qty, 0),
    subtotal: g.rows.reduce((s, r) => s + r.qty * r.unit, 0),
  }));

  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-4">
      <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        Total por fornecedor
      </h2>

      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum item na lista.</p>
      ) : (
        <ul
          className={cn(
            "mt-3 min-w-0",
            horizontal
              ? "grid grid-cols-2 gap-3 @[760px]/page:grid-cols-3 @[980px]/page:grid-cols-4"
              : "space-y-2.5",
          )}
        >
          {lines.map((l) => (
            <li
              key={l.supplier}
              className={cn(
                "min-w-0",
                horizontal
                  ? "rounded-xl border border-border/50 bg-muted/20 px-3 py-2"
                  : "flex items-baseline justify-between gap-3",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{l.supplier}</span>
                <span className="block text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {l.units} {l.units === 1 ? "unidade" : "unidades"}
                </span>
              </span>
              <strong
                className={cn(
                  "text-sm whitespace-nowrap tabular-nums",
                  horizontal ? "mt-1 block" : "shrink-0",
                )}
              >
                {brl(l.subtotal)}
              </strong>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border/50 pt-3">
        <span className="text-sm text-muted-foreground">Total geral</span>
        <strong key={total} className="admin-value-in text-base whitespace-nowrap tabular-nums">
          {brl(total)}
        </strong>
      </div>

      <div className={cn("mt-4 min-w-0", horizontal ? "flex flex-wrap gap-2" : "space-y-2")}>
        <Button
          variant="outline"
          className={cn("press h-11 rounded-full", horizontal ? "flex-1 min-w-[150px]" : "w-full")}
          onClick={onCopy}
        >
          <Copy className="size-4" /> Copiar tudo
        </Button>
        <Button
          variant="outline"
          className={cn("press h-11 rounded-full", horizontal ? "flex-1 min-w-[150px]" : "w-full")}
          onClick={onExport}
        >
          <FileText className="size-4" /> Exportar
        </Button>
        <Button
          variant="ghost"
          className={cn(
            "press h-11 rounded-full text-muted-foreground",
            horizontal ? "flex-1 min-w-[220px]" : "w-full",
          )}
          onClick={onCheapest}
        >
          <Wand2 className="size-4" /> Usar menor preço disponível
        </Button>
      </div>
    </div>
  );
}

function FilterChips({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Array<{ value: string; label: string }>;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(value === o.value ? null : o.value)}
            className={cn(
              "press max-w-full truncate rounded-full border px-3 py-1.5 text-sm",
              value === o.value ? "border-gold/40 bg-gold/10 text-gold" : "border-border/60 text-muted-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Adicionar produto: busca, ofertas visíveis por fornecedor e
 * quantidade — a folha continua aberta para o próximo perfume.
 * ------------------------------------------------------------------ */
function AddProductSheet({
  open,
  onOpenChange,
  products,
  suppliers,
  costs,
  items,
  listId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: any[];
  suppliers: any[];
  costs: any[];
  items: any[];
  listId: string | null;
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setPickedId(null);
      setSupplierId(null);
      setQty(1);
    }
  }, [open]);

  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    return products
      .filter((p) => fuzzy(`${p.brand ?? ""} ${p.canonical_name}`, q))
      .slice(0, 8);
  }, [products, q]);

  const { data: offers } = useQuery({
    queryKey: ["restock-add-offers", results.map((p) => p.id).join(",")],
    enabled: results.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("supplier_products")
        .select("product_id, supplier_id, price, normalized_cost, in_stock")
        .in(
          "product_id",
          results.map((p) => p.id),
        );
      return data ?? [];
    },
  });

  const offersFor = (productId: string): Offer[] => {
    const map = new Map<string, Offer>();
    (offers ?? []).forEach((o: any) => {
      if (o.product_id !== productId) return;
      const cost = Number(o.normalized_cost ?? o.price ?? 0);
      if (!(cost > 0)) return;
      const prev = map.get(o.supplier_id);
      if (prev && prev.cost <= cost) return;
      map.set(o.supplier_id, {
        supplierId: o.supplier_id,
        supplier: suppliers.find((s) => s.id === o.supplier_id)?.name ?? "Fornecedor",
        cost,
        inStock: o.in_stock !== false,
        stock: null,
      });
    });
    return [...map.values()].sort((a, b) => a.cost - b.cost);
  };

  const picked = results.find((p) => p.id === pickedId) ?? null;
  const pickedOffers = picked ? offersFor(picked.id) : [];
  const chosen = pickedOffers.find((o) => o.supplierId === supplierId) ?? null;

  const add = async () => {
    if (!picked || !listId) return;
    setSaving(true);
    try {
      const unitCost = chosen?.cost ?? Number(costs.find((c) => c.product_id === picked.id)?.best_cost ?? 0);
      const existing = items.find(
        (i) => i.product_id === picked.id && (i.supplier_id ?? null) === (supplierId ?? null),
      );
      if (existing) {
        // mesmo produto + mesmo fornecedor soma quantidade, nunca cria linha nova
        const { error } = await supabase
          .from("restock_items")
          .update({ quantity: Number(existing.quantity ?? 0) + qty } as never)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("restock_items").insert({
          restock_list_id: listId,
          product_id: picked.id,
          supplier_id: supplierId ?? null,
          unit_cost: unitCost,
          cost_locked: true,
          quantity: qty,
        } as never);
        if (error) throw error;
      }
      toast.success("Produto adicionado.");
      onDone();
      setPickedId(null);
      setSupplierId(null);
      setQty(1);
      setQ("");
      inputRef.current?.focus();
    } catch {
      toast.error("Não foi possível adicionar o produto. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88vh] overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
      >
        <SheetHeader className="px-0 text-left">
          <SheetTitle className="text-base">Adicionar produto</SheetTitle>
          <SheetDescription>Busque o perfume, escolha o fornecedor e a quantidade.</SheetDescription>
        </SheetHeader>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPickedId(null);
            }}
            placeholder="Buscar perfume ou produto"
            className="h-12 rounded-full pl-9 text-base"
          />
        </div>

        <div className="mt-3 space-y-2">
          {q.trim().length >= 2 && results.length === 0 ? (
            <AdminEmpty>Nenhum perfume encontrado.</AdminEmpty>
          ) : null}

          {results.map((p) => {
            const name = productTitle(p.canonical_name);
            const brand = p.brand ? productTitle(p.brand) : null;
            const list = offersFor(p.id);
            const isPicked = pickedId === p.id;
            return (
              <div
                key={p.id}
                className={cn(
                  "admin-row-in rounded-2xl border p-3 transition-colors duration-150",
                  isPicked ? "border-gold/40 bg-gold/5" : "border-border/60",
                )}
              >
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-3 text-left"
                  onClick={() => {
                    setPickedId(p.id);
                    setQty(1);
                    const best = list.find((o) => o.inStock) ?? list[0] ?? null;
                    setSupplierId(best?.supplierId ?? null);
                  }}
                >
                  <ItemThumb src={p.image_url} alt={name} size={52} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{name}</span>
                    {brand ? <span className="block truncate text-xs text-muted-foreground">{brand}</span> : null}
                    <span className="mt-1 block space-y-0.5">
                      {list.length === 0 ? (
                        <span className="block text-xs text-muted-foreground">Nenhum fornecedor com este produto</span>
                      ) : (
                        list.slice(0, 3).map((o, idx) => (
                          <span key={o.supplierId} className="flex min-w-0 items-center gap-2 text-xs">
                            <span className="min-w-0 truncate text-muted-foreground">{o.supplier}</span>
                            <span className="shrink-0 tabular-nums">{brl(o.cost)}</span>
                            <span className={cn("shrink-0", o.inStock ? "text-success" : "text-destructive")}>
                              {o.inStock ? "disponível" : "indisponível"}
                            </span>
                            {idx === 0 && o.inStock && list.length > 1 ? (
                              <span className="shrink-0 rounded-full border border-gold/30 bg-gold/10 px-1.5 text-[10px] text-gold">
                                melhor custo
                              </span>
                            ) : null}
                          </span>
                        ))
                      )}
                    </span>
                  </span>
                  {!isPicked ? <Plus className="size-4 shrink-0 text-muted-foreground" /> : null}
                </button>

                {isPicked ? (
                  <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
                    <div className="space-y-1.5">
                      {list.map((o) => (
                        <button
                          key={o.supplierId}
                          type="button"
                          onClick={() => setSupplierId(o.supplierId)}
                          className={cn(
                            "flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm",
                            supplierId === o.supplierId ? "border-foreground bg-accent" : "border-border/60",
                          )}
                        >
                          <span className="min-w-0 truncate">{o.supplier}</span>
                          <span className="shrink-0 tabular-nums">{brl(o.cost)}</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setSupplierId(null)}
                        className={cn(
                          "w-full rounded-xl border px-3 py-2.5 text-left text-sm",
                          supplierId === null ? "border-foreground bg-accent" : "border-border/60",
                        )}
                      >
                        Sem fornecedor definido
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Quantidade</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Menos"
                          onClick={() => setQty((n) => Math.max(1, n - 1))}
                          className="press grid size-9 place-items-center rounded-full border border-border/60 text-lg leading-none"
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-base tabular-nums">{qty}</span>
                        <button
                          type="button"
                          aria-label="Mais"
                          onClick={() => setQty((n) => n + 1)}
                          className="press grid size-9 place-items-center rounded-full border border-border/60 text-lg leading-none"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <Button className="press h-12 w-full rounded-full" disabled={saving} onClick={() => void add()}>
                      Adicionar à reposição
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * Trocar fornecedor e ajustar o custo real da compra.
 * ------------------------------------------------------------------ */
function SwapSupplierSheet({
  row,
  offers,
  onClose,
  onSave,
}: {
  row: (RestockRow & { productId: string }) | null;
  offers: Offer[];
  onClose: () => void;
  onSave: (id: string, supplierId: string | null, unitCost: number, extraFee: number) => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [cost, setCost] = useState("");
  const [fee, setFee] = useState("");

  useEffect(() => {
    if (!row) return;
    setSupplierId(row.supplierId);
    setCost(String(Math.max(0, row.unit - row.fee)));
    setFee(row.fee > 0 ? String(row.fee) : "");
  }, [row?.id]);

  return (
    <Sheet open={!!row} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[86vh] overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
      >
        <SheetHeader className="px-0 text-left">
          <SheetTitle className="text-base">Fornecedor e custo</SheetTitle>
          <SheetDescription>{row ? [row.brand, row.name].filter(Boolean).join(" · ") : ""}</SheetDescription>
        </SheetHeader>

        <div className="mt-3 space-y-4">
          <div className="space-y-1.5">
            {offers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/60 px-4 py-3 text-xs text-muted-foreground">
                Nenhum fornecedor cadastrado com este produto. Você pode manter sem fornecedor e informar o custo.
              </p>
            ) : null}
            {offers.map((o) => (
              <button
                key={o.supplierId}
                type="button"
                onClick={() => {
                  setSupplierId(o.supplierId);
                  setCost(String(o.cost));
                }}
                className={cn(
                  "flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm",
                  supplierId === o.supplierId ? "border-foreground bg-accent" : "border-border/60",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{o.supplier}</span>
                  <span className={cn("block text-xs", o.inStock ? "text-muted-foreground" : "text-destructive")}>
                    {o.inStock ? "disponível" : "indisponível"}
                  </span>
                </span>
                <strong className="shrink-0 tabular-nums">{brl(o.cost)}</strong>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSupplierId(null)}
              className={cn(
                "w-full rounded-xl border px-4 py-3 text-left text-sm",
                supplierId === null ? "border-foreground bg-accent" : "border-border/60",
              )}
            >
              Sem fornecedor definido
            </button>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Custo por unidade</Label>
            <Input
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0,00"
              className="h-12 rounded-xl text-base"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Taxa manual por unidade (opcional)</Label>
            <Input
              inputMode="decimal"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="0,00"
              className="h-12 rounded-xl text-base"
            />
          </div>

          <Button
            className="press h-12 w-full rounded-full"
            onClick={() => {
              if (!row) return;
              const c = Number(cost.replace(",", "."));
              const f = Number(fee.replace(",", "."));
              void onSave(
                row.id,
                supplierId,
                Number.isFinite(c) && c > 0 ? c : 0,
                Number.isFinite(f) && f > 0 ? f : 0,
              );
            }}
          >
            Salvar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
