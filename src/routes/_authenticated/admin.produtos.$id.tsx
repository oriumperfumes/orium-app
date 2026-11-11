import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FragrancePanel } from "@/components/orium/FragrancePanel";
import { FragranceEditor } from "@/components/orium/FragranceEditor";
import { AdminShell } from "@/components/orium/AdminShell";
import { OriumStockPanel } from "@/components/orium/admin/OriumStockPanel";
import { StockBadge } from "@/components/orium/badges";
import { brl, dateBR } from "@/lib/format";
import { OfferComparison } from "@/components/orium/admin/suppliers/OfferComparison";
import { getProductPricing } from "@/lib/pricing.functions";
import { getAdminProductRow } from "@/lib/admin-insight.functions";

export const Route = createFileRoute("/_authenticated/admin/produtos/$id")({
  head: () => ({ meta: [{ title: "Produto — Orium Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminProductDetail,
});

function AdminProductDetail() {
  const { id } = Route.useParams();
  const fetchProductRow = useServerFn(getAdminProductRow);

  const { data } = useQuery({
    queryKey: ["admin-product", id],
    queryFn: async () => {
      const [product, cost, offers, suppliers, settings] = await Promise.all([
        fetchProductRow({ data: { id } }),
        supabase.from("product_costs").select("*").eq("product_id", id).maybeSingle(),
        supabase.from("supplier_products").select("*").eq("product_id", id),
        supabase.from("suppliers").select("id, name"),
        supabase.from("pricing_settings").select("*").maybeSingle(),
      ]);
      const offerIds = (offers.data ?? []).map((o) => o.id);
      const history = offerIds.length
        ? (
            await supabase
              .from("supplier_price_history")
              .select("*")
              .in("supplier_product_id", offerIds)
              .order("recorded_at", { ascending: false })
              .limit(20)
          ).data ?? []
        : [];
      return {
        product,
        cost: cost.data,
        offers: offers.data ?? [],
        suppliers: suppliers.data ?? [],
        settings: settings.data,
        history,
      };
    },
  });

  const p = data?.product;
  const supplierName = (sid?: string | null) =>
    data?.suppliers.find((s) => s.id === sid)?.name ?? "—";

  return (
    <AdminShell title={p?.canonical_name ?? "Produto"} description={p?.brand ?? ""}>
      <Link
        to="/admin/produtos"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Produtos
      </Link>

      {p && (
        <>
          <OriumStockPanel productId={p.id} />
          <div className="mt-6 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Box label="Melhor custo" value={brl(data?.cost?.best_cost)} />
            <Box label="Fornecedor vencedor" value={supplierName(data?.cost?.best_supplier_id)} />
            <Box label="Preço-base varejo" value={brl(p.base_retail_price ?? p.retail_price)} />
            <Box label="Preço comercial varejo" value={brl(p.retail_price)} />
            <Box label="Preço-base atacado" value={brl(p.base_wholesale_price ?? p.wholesale_price)} />
            <Box label="Preço comercial atacado" value={brl(p.wholesale_price)} />
            <Box
              label="Margem efetiva varejo"
              value={
                data?.cost?.best_cost != null && p.retail_price != null
                  ? brl(Number(p.retail_price) - Number(data.cost.best_cost))
                  : "—"
              }
            />
            <Box
              label="Ajuste psicológico"
              value={
                p.base_retail_price != null && p.retail_price != null
                  ? `-${brl(Number(p.base_retail_price) - Number(p.retail_price))}`
                  : "—"
              }
            />
            <Box label="Margem-base varejo" value={brl(data?.settings?.retail_markup)} />
            <Box label="Margem-base atacado" value={brl(data?.settings?.wholesale_markup)} />
            <Box
              label="Volume / concentração"
              value={[p.volume_ml ? `${p.volume_ml}ml` : null, p.concentration]
                .filter(Boolean)
                .join(" • ")}
            />
            <div className="rounded-2xl border bg-card p-4 shadow-soft">
              <p className="text-xs text-muted-foreground">Disponibilidade</p>
              <div className="mt-2">
                <StockBadge inStock={p.in_stock} quantity={p.stock_quantity} />
              </div>
            </div>
          </div>

          <PriceExplain productId={id} />

          <DecantAdmin
            productId={id}
            isPerfume={p.product_type === "PERFUME"}
            available={p.decant_available}
            price2={p.decant_price_2ml}
            price5={p.decant_price_5ml}
            price10={p.decant_price_10ml}
          />

          <FragrancePanel productId={id} />

          <FragranceEditor productId={id} />



          <h2 className="mt-10 mb-3 text-sm font-medium text-muted-foreground">Fornecedores</h2>
          <div className="space-y-3">
            {(data?.offers ?? []).map((o) => (
              <div key={o.id} className="rounded-2xl border bg-card p-5 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{supplierName(o.supplier_id)}</p>
                    <p className="text-sm text-muted-foreground">{o.supplier_product_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">Custo: {brl(o.normalized_cost ?? o.price)}</p>
                    {o.raw_supplier_price != null && Number(o.raw_supplier_price) !== Number(o.normalized_cost ?? o.price) ? (
                      <p className="text-xs text-muted-foreground">
                        Anunciado {brl(o.raw_supplier_price)}
                        {o.cost_source ? ` · ${o.cost_source}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
                  <StockBadge inStock={o.in_stock} quantity={o.stock_quantity} />
                  <span>Atualizado {dateBR(o.cost_captured_at ?? o.last_synced_at)}</span>
                  {o.url ? (
                    <a
                      href={o.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      Abrir produto <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
            {(data?.offers ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma oferta vinculada ainda.</p>
            )}
          </div>

          <h2 className="mt-10 mb-3 text-sm font-medium text-muted-foreground">Comparação de fornecedores</h2>
          <OfferComparison productId={id} />

          <h2 className="mt-10 mb-3 text-sm font-medium text-muted-foreground">
            Histórico de preços
          </h2>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
            {(data?.history ?? []).map((h) => {
              const offer = data?.offers.find((o) => o.id === h.supplier_product_id);
              return (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                >
                  <span className="truncate text-muted-foreground">
                    {supplierName(offer?.supplier_id)} · {dateBR(h.recorded_at)}
                  </span>
                  <span className="font-medium">{brl(h.price)}</span>
                </div>
              );
            })}
            {(data?.history ?? []).length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">Sem histórico registrado.</p>
            )}
          </div>
        </>
      )}
    </AdminShell>
  );
}

/** Decants deste perfume: liga/desliga e preço próprio (em branco = preço oficial da Orium). */
function DecantAdmin({
  productId,
  isPerfume,
  available,
  price2,
  price5,
  price10,
}: {
  productId: string;
  isPerfume: boolean;
  available: boolean;
  price2: number | null;
  price5: number | null;
  price10: number | null;
}) {
  const qc = useQueryClient();
  const [on, setOn] = useState(available);
  const [p2, setP2] = useState(price2 == null ? "" : String(price2));
  const [p5, setP5] = useState(price5 == null ? "" : String(price5));
  const [p10, setP10] = useState(price10 == null ? "" : String(price10));
  const [busy, setBusy] = useState(false);

  const { data: global } = useQuery({
    queryKey: ["decant-settings"],
    queryFn: async () => (await supabase.from("decant_settings").select("*").maybeSingle()).data,
  });

  if (!isPerfume) return null;

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const values = { decant_available: on, decant_price_2ml: num(p2), decant_price_5ml: num(p5), decant_price_10ml: num(p10) };
      if (Object.values(values).some((v) => typeof v === "number" && !(v > 0))) throw new Error("Preço inválido.");
      const { error } = await supabase.from("products").update(values).eq("id", productId);
      if (error) throw error;
      toast.success("Decants atualizados.");
      qc.invalidateQueries({ queryKey: ["admin-product", productId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-6 rounded-2xl border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Decants</h2>
          <p className="text-xs text-muted-foreground">
            Preço oficial: {brl(global?.price_2ml)} · {brl(global?.price_5ml)} · {brl(global?.price_10ml)}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="size-4" />
          Disponível em decant
        </label>
      </div>
      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            ["d2", "2ml (R$)", p2, setP2],
            ["d5", "5ml (R$)", p5, setP5],
            ["d10", "10ml (R$)", p10, setP10],
          ] as Array<[string, string, string, (v: string) => void]>
        ).map(([id, label, value, set]) => (
          <div key={id} className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Input
              id={id}
              type="number"
              step="0.01"
              placeholder="preço oficial"
              value={value}
              onChange={(e) => set(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Em branco = usa o preço oficial da configuração.</p>
      <Button type="submit" disabled={busy} className="mt-4 h-11 rounded-xl px-6">
        {busy ? "Salvando..." : "Salvar decants"}
      </Button>
    </form>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-soft">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 font-semibold">{value}</p>
    </div>
  );
}

/** Mostra a conta do preço passo a passo: de onde vem o custo e como o preço foi formado. */
function PriceExplain({ productId }: { productId: string }) {
  const explain = useServerFn(getProductPricing);
  const { data, isLoading } = useQuery({
    queryKey: ["price-explain", productId],
    queryFn: () => explain({ data: { productId } }),
  });

  if (isLoading) return <div className="mt-6 h-32 animate-pulse rounded-2xl bg-muted" />;
  if (!data) return null;

  return (
    <section className="mt-6 rounded-2xl border bg-card p-5 shadow-soft">
      <h2 className="text-sm font-medium">Como este preço foi calculado</h2>
      <ol className="mt-3 space-y-1.5 text-sm text-muted-foreground">
        <li>
          1. Menor custo entre os fornecedores {data.usedOutOfStockCost ? "(nenhum com estoque agora)" : "com estoque"}:{" "}
          <span className="font-medium text-foreground">{brl(data.baseCost)}</span>
          {data.winningSupplierName ? ` — ${data.winningSupplierName}` : ""}
        </li>
        <li>
          2. Varejo = {brl(data.baseCost)} + margem {brl(data.retailMarkup)} ={" "}
          <span className="font-medium text-foreground">{brl(data.retailPrice)}</span>
        </li>
        <li>
          3. Atacado (a partir de {data.wholesaleMinQuantity} unidades) = {brl(data.baseCost)} + margem{" "}
          {brl(data.wholesaleMarkup)} = <span className="font-medium text-foreground">{brl(data.wholesalePrice)}</span>
        </li>
      </ol>
      <div className="mt-4 space-y-1 border-t pt-3 text-xs text-muted-foreground">
        {data.offers.map((o) => (
          <div key={o.supplierProductId} className="flex items-center justify-between gap-3">
            <span className="truncate">
              {o.supplierName ?? "Fornecedor"}
              {o.supplierId === data.winningSupplierId ? " · usado no preço" : ""}
              {o.inStock ? "" : " · sem estoque"}
            </span>
            <span className="tabular-nums">{brl(o.supplierPrice)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
