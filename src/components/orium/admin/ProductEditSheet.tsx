import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminEmpty, AdminKV, AdminTechDetails } from "@/components/orium/admin/AdminUI";
import { Tag, ProductThumb } from "@/components/orium/admin/ProductBits";
import { FragranceEditor } from "@/components/orium/FragranceEditor";
import { brl, dateBR } from "@/lib/format";
import { getPaymentPricing } from "@/lib/payment-rule";
import { usePaymentSettings } from "@/lib/payment";
import { saveProductMaintenance, researchProductIdentity } from "@/lib/admin-catalog.functions";
import { getAdminProductRow } from "@/lib/admin-insight.functions";
import { ProductImagePicker } from "@/components/orium/admin/ProductImagePicker";
import { TYPE_LABEL, ALLOWED_TYPES, type ProductType, type Gender } from "@/lib/catalog/classify";
import { DECANT_SIZES, decantPrice, type DecantMl } from "@/lib/decants";
import { cn } from "@/lib/utils";
import { HistoryList, PricingTab, StockTab, SuppliersTab } from "@/components/orium/admin/ProductOps";

/* ------------------------------------------------------------------ *
 * Edição de produto em seções. Cada aba responde uma pergunta:
 * Geral (o que é), Venda (como vende), Olfativo, Fornecedores, Avançado.
 * ------------------------------------------------------------------ */

const TABS = ["Geral", "Venda", "Estoque", "Fornecedores", "Olfativo", "Avançado"] as const;
type Tab = (typeof TABS)[number];

const GENDER_OPTIONS: Array<{ value: Gender | "NOT_APPLICABLE"; label: string }> = [
  { value: "MALE", label: "Masculino" },
  { value: "FEMALE", label: "Feminino" },
  { value: "UNISEX", label: "Unissex" },
  { value: "UNKNOWN", label: "Indefinido" },
  { value: "NOT_APPLICABLE", label: "Não se aplica" },
];

const SALE_MODE_LABEL: Record<string, string> = {
  DECANT: "Somente decant",
  FULL: "Somente frasco",
  BOTH: "Decant e frasco",
};

export type EditableProduct = {
  id: string;
  canonical_name: string;
  raw_name: string | null;
  brand: string | null;
  brand_id: string | null;
  image_url: string | null;
  product_type: string | null;
  gender_norm: string | null;
  concentration: string | null;
  volume_ml: number | null;
  flanker: string | null;
  in_stock: boolean;
  stock_quantity: number | null;
  retail_price: number | null;
  wholesale_price: number | null;
  active: boolean;
  catalog_eligible: boolean;
  source: string | null;
  sale_mode: string | null;
  identity_status: string | null;
  identity_verified: boolean;
  canonical_identity_locked: boolean;
  search_aliases: string[] | null;
};

export function ProductEditSheet({
  product,
  brands,
  startTab = "Geral",
  onClose,
  onManualEdit,
}: {
  product: EditableProduct;
  brands: Array<{ id: string; canonical_name: string }>;
  startTab?: Tab;
  onClose: () => void;
  /** produto cadastrado à mão: abre o formulário completo de cadastro */
  onManualEdit: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveProductMaintenance);
  const research = useServerFn(researchProductIdentity);
  const fetchProductRow = useServerFn(getAdminProductRow);
  const payment = usePaymentSettings();
  const [tab, setTab] = useState<Tab>(startTab);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: product.canonical_name,
    brandId: product.brand_id ?? "",
    newBrandName: "",
    gender: (product.gender_norm as Gender | null) ?? "UNKNOWN",
    productType: (product.product_type as ProductType) ?? "UNKNOWN",
    outOfCatalog: !product.catalog_eligible,
    concentration: product.concentration ?? "",
    volumeMl: product.volume_ml ? String(product.volume_ml) : "",
    flanker: product.flanker ?? "",
  });
  const imageUrl: string | null | undefined = undefined;

  const [brandTerm, setBrandTerm] = useState("");
  const [suggestion, setSuggestion] = useState<{
    brand: string | null;
    name: string | null;
    confidence: number;
    sources: Array<{ title: string; url: string }>;
  } | null>(null);

  /** Detalhe pesado (custos, ofertas, decants, histórico) só quando a edição abre. */
  const { data: detail } = useQuery({
    queryKey: ["admin-product-edit", product.id],
    staleTime: 30_000,
    queryFn: async () => {
      const [row, cost, offers, suppliers, override, decants, history] = await Promise.all([
        // dedupe_key e identity_key são colunas internas: a linha vem pelo servidor (equipe confirmada).
        fetchProductRow({ data: { id: product.id } }).then((data) => ({ data })),
        supabase.from("product_costs").select("best_cost, best_supplier_id, updated_at").eq("product_id", product.id).maybeSingle(),
        supabase
          .from("supplier_products")
          .select("id, supplier_id, supplier_product_name, supplier_sku, price, in_stock, last_synced_at, url")
          .eq("product_id", product.id),
        supabase.from("suppliers").select("id, name"),
        supabase.from("pricing_overrides").select("fixed_retail_price, fixed_wholesale_price").eq("product_id", product.id).maybeSingle(),
        supabase.from("decant_settings").select("price_2ml, price_5ml, price_10ml").maybeSingle(),
        supabase
          .from("product_identity_history")
          .select("id, action, created_at, changed_by_email, before, after")
          .eq("product_id", product.id)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      return {
        row: row.data,
        cost: cost.data,
        offers: offers.data ?? [],
        suppliers: suppliers.data ?? [],
        override: override.data,
        decants: decants.data,
        history: history.data ?? [],
      };
    },
  });

  const supplierName = (id: string | null | undefined) =>
    detail?.suppliers.find((s) => s.id === id)?.name ?? "Fornecedor";

  const brandList = useMemo(() => {
    const found = brands.filter((b) => b.canonical_name.toLowerCase().includes(brandTerm.trim().toLowerCase()));
    // a marca atual sempre visível primeiro
    const current = found.filter((b) => b.id === form.brandId);
    return [...current, ...found.filter((b) => b.id !== form.brandId)].slice(0, 40);
  }, [brands, brandTerm, form.brandId]);


  const submit = async (confirmIdentity: boolean) => {
    setBusy(true);
    try {
      await save({
        data: {
          productId: product.id,
          name: form.name,
          brandId: form.brandId || null,
          newBrandName: form.newBrandName || null,
          gender: form.gender === "UNKNOWN" ? "UNKNOWN" : form.gender,
          productType: form.outOfCatalog ? "FORA" : form.productType,
          concentration: form.concentration || null,
          volumeMl: form.volumeMl ? Number(form.volumeMl) : null,
          flanker: form.flanker || null,
          ...(imageUrl === undefined ? {} : { imageUrl }),
          confirm: confirmIdentity,
        },
      });
      toast.success(confirmIdentity ? "Identidade confirmada." : "Produto atualizado.");
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  };

  const doResearch = async () => {
    setBusy(true);
    try {
      const res = await research({ data: { productId: product.id } });
      setSuggestion(res);
      if (!res.name) toast.info("A pesquisa não trouxe uma sugestão confiável.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível pesquisar agora.");
    } finally {
      setBusy(false);
    }
  };

  const bestOfferId = useMemo(() => {
    const withPrice = (detail?.offers ?? []).filter((o) => o.price != null);
    if (!withPrice.length) return null;
    return withPrice.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a)).id;
  }, [detail]);

  const pix = product.retail_price == null ? null : Number(product.retail_price);
  const card = pix == null ? null : getPaymentPricing(pix, payment).cardPrice;
  const saleMode = product.sale_mode ?? "BOTH";
  const manual = product.source === "manual";
  const customPrice = detail?.override?.fixed_retail_price != null;

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="top-0 left-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:top-[50%] sm:left-[50%] sm:h-auto sm:max-h-[92dvh] sm:w-full sm:max-w-xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-[24px] sm:border">
        <DialogHeader className="shrink-0 space-y-3 border-b border-border/60 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 text-left sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <ProductThumb src={product.image_url} alt={product.canonical_name} size={44} />
            <div className="min-w-0">
              <DialogTitle className="truncate text-left text-base">{product.canonical_name}</DialogTitle>
              <p className="truncate text-xs text-muted-foreground">{product.brand ?? "Marca não identificada"}</p>
            </div>
          </div>
          <div className="-mx-4 min-w-0 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <div className="flex w-max gap-2">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "press min-h-9 shrink-0 rounded-full border px-4 text-xs transition-colors",
                    tab === t ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>

        <div className="min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {tab === "Geral" ? (
            <>
              <ProductImagePicker productId={product.id} name={product.canonical_name} />

              <Field label="Nome" htmlFor="p-nome">
                <Input
                  id="p-nome"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="h-12 rounded-xl text-base"
                />
              </Field>

              <Field label="Marca">
                <Input
                  value={brandTerm}
                  onChange={(e) => setBrandTerm(e.target.value)}
                  placeholder="Pesquisar marca..."
                  className="h-12 rounded-xl text-base"
                />
                <div className="mt-2 max-h-44 overflow-y-auto overscroll-contain rounded-xl border border-border/60">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, brandId: "", newBrandName: "" })}
                    className={cn(
                      "flex min-h-11 w-full items-center px-3 text-left text-sm",
                      !form.brandId && !form.newBrandName ? "font-semibold" : "text-muted-foreground",
                    )}
                  >
                    Sem marca
                  </button>
                  {brandList.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setForm({ ...form, brandId: b.id, newBrandName: "" })}
                      className={cn(
                        "flex min-h-11 w-full items-center border-t border-border/50 px-3 text-left text-sm",
                        form.brandId === b.id ? "font-semibold" : "text-muted-foreground",
                      )}
                    >
                      <span className="truncate">{b.canonical_name}</span>
                    </button>
                  ))}
                </div>
                <Input
                  value={form.newBrandName}
                  onChange={(e) => setForm({ ...form, newBrandName: e.target.value, brandId: "" })}
                  placeholder="ou criar nova marca"
                  className="mt-2 h-12 rounded-xl text-base"
                />
              </Field>

              <Field label="Categoria">
                <div className="flex flex-wrap gap-2">
                  {ALLOWED_TYPES.map((t) => (
                    <Choice
                      key={t}
                      active={form.productType === t}
                      disabled={form.outOfCatalog}
                      onClick={() => setForm({ ...form, productType: t })}
                    >
                      {TYPE_LABEL[t]}
                    </Choice>
                  ))}
                </div>
              </Field>

              <Field label="Gênero">
                <div className="flex flex-wrap gap-2">
                  {GENDER_OPTIONS.map((g) => (
                    <Choice
                      key={g.value}
                      active={form.gender === g.value}
                      onClick={() => setForm({ ...form, gender: g.value as Gender })}
                    >
                      {g.label}
                    </Choice>
                  ))}
                </div>
              </Field>

              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Volume (ml)" htmlFor="p-vol">
                  <Input
                    id="p-vol"
                    inputMode="numeric"
                    value={form.volumeMl}
                    onChange={(e) => setForm({ ...form, volumeMl: e.target.value })}
                    className="h-12 rounded-xl text-base"
                  />
                </Field>
                <Field label="Concentração" htmlFor="p-conc">
                  <Input
                    id="p-conc"
                    value={form.concentration}
                    onChange={(e) => setForm({ ...form, concentration: e.target.value })}
                    className="h-12 rounded-xl text-base"
                  />
                </Field>
                <Field label="Versão" htmlFor="p-ver">
                  <Input
                    id="p-ver"
                    value={form.flanker}
                    onChange={(e) => setForm({ ...form, flanker: e.target.value })}
                    className="h-12 rounded-xl text-base"
                  />
                </Field>
              </div>

              <label className="flex min-h-11 items-center gap-3 text-sm">
                <Checkbox
                  checked={form.outOfCatalog}
                  onCheckedChange={(v) => setForm({ ...form, outOfCatalog: Boolean(v) })}
                />
                Oculto do catálogo (não aparece para clientes)
              </label>
              <p className="text-xs text-muted-foreground">
                Ocultar é reversível: nada de custo, fornecedor ou histórico é apagado.
              </p>
            </>
          ) : null}

          {tab === "Venda" ? (
            <>
              <p className="text-xs text-muted-foreground">
                Modo de venda: <span className="font-medium text-foreground">{SALE_MODE_LABEL[saleMode] ?? SALE_MODE_LABEL["BOTH"]}</span>
              </p>
              <PricingTab productId={product.id} />
              {product.source === "manual" ? (
                <Button
                  variant="outline"
                  className="press h-11 rounded-full text-xs"
                  onClick={() => {
                    onClose();
                    onManualEdit();
                  }}
                >
                  Editar cadastro manual
                </Button>
              ) : null}
            </>
          ) : null}

          {tab === "Estoque" ? <StockTab productId={product.id} /> : null}

          {tab === "Olfativo" ? (
            product.product_type === "PERFUME" ? (
              <FragranceEditor productId={product.id} defaultOpen />
            ) : (
              <AdminEmpty>Informações olfativas existem apenas para perfumes.</AdminEmpty>
            )
          ) : null}

          {tab === "Fornecedores" ? (
            <>
              <SuppliersTab productId={product.id} />
              <Button asChild variant="outline" className="press h-11 rounded-full text-xs">
                <Link to="/admin/produtos/$id" params={{ id: product.id }}>
                  Ver informações internas completas
                </Link>
              </Button>
            </>
          ) : null}

          {tab === "Avançado" ? (
            <>
              <HistoryList productId={product.id} />
              <div className="min-w-0 divide-y divide-border/50">
                <AdminKV label="Origem" value={product.source ?? "—"} />
                <AdminKV label="Identidade" value={product.identity_status ?? "—"} />
                <AdminKV label="Identidade travada" value={product.canonical_identity_locked ? "Sim" : "Não"} />
                <AdminKV label="Conferida" value={product.identity_verified ? "Sim" : "Não"} />
                <AdminKV label="Criado em" value={detail?.row?.created_at ? dateBR(detail.row.created_at) : "—"} />
              </div>

              <div className="min-w-0 rounded-2xl border border-border/60 p-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Pesquisar identidade</p>
                  <Button size="sm" variant="outline" className="h-10 rounded-full text-xs" disabled={busy} onClick={doResearch}>
                    <Sparkles className="size-3.5" /> Pesquisar
                  </Button>
                </div>
                {suggestion?.name ? (
                  <div className="mt-3 space-y-2 text-xs">
                    <p>
                      Marca sugerida: <span className="font-medium">{suggestion.brand ?? "—"}</span>
                    </p>
                    <p>
                      Nome sugerido: <span className="font-medium">{suggestion.name}</span>
                    </p>
                    <p className="text-muted-foreground">Confiança: {Math.round(suggestion.confidence * 100)}%</p>
                    {suggestion.sources.slice(0, 3).map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="block truncate underline">
                        {s.title || s.url}
                      </a>
                    ))}
                    <Button
                      size="sm"
                      className="mt-1 h-10 rounded-full text-xs"
                      onClick={() => {
                        setForm({
                          ...form,
                          name: suggestion.name ?? form.name,
                          newBrandName: suggestion.brand ?? form.newBrandName,
                          brandId: suggestion.brand ? "" : form.brandId,
                        });
                        setTab("Geral");
                      }}
                    >
                      <Check className="size-3.5" /> Usar sugestão
                    </Button>
                  </div>
                ) : null}
              </div>

              {(product.search_aliases ?? []).length ? (
                <AdminTechDetails label="Apelidos de busca">
                  {(product.search_aliases ?? []).join(" · ")}
                </AdminTechDetails>
              ) : null}

              <AdminTechDetails label="Identificadores">
                <p className="break-all">ID: {product.id}</p>
                <p className="break-all">Slug: {detail?.row?.slug ?? "—"}</p>
                <p className="break-all">Chave de identidade: {detail?.row?.identity_key ?? "—"}</p>
                <p className="break-all">Chave de duplicidade: {detail?.row?.dedupe_key ?? "—"}</p>
                <p className="break-all">Título do fornecedor: {product.raw_name ?? "—"}</p>
              </AdminTechDetails>

              <AdminTechDetails label="Histórico de alterações">
                {(detail?.history ?? []).length === 0 ? (
                  <p>Sem alterações registradas.</p>
                ) : (
                  <ul className="space-y-2">
                    {(detail?.history ?? []).map((h) => {
                      const before = (h.before ?? {}) as { canonical_name?: string; brand?: string | null };
                      const after = (h.after ?? {}) as { canonical_name?: string; brand?: string | null };
                      return (
                        <li key={h.id}>
                          <p>
                            {h.action} · {dateBR(h.created_at)} · {h.changed_by_email ?? "equipe"}
                          </p>
                          <p>
                            {before.canonical_name ?? "—"} / {before.brand ?? "sem marca"} → {after.canonical_name ?? "—"} /{" "}
                            {after.brand ?? "sem marca"}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </AdminTechDetails>
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border/60 bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
          <Button variant="ghost" className="press h-12 rounded-full" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="outline" className="press h-12 min-w-0 flex-1 rounded-full" disabled={busy} onClick={() => submit(false)}>
            <span className="truncate">Salvar</span>
          </Button>
          <Button className="press h-12 min-w-0 flex-1 rounded-full" disabled={busy} onClick={() => submit(true)}>
            <span className="truncate">Salvar e travar</span>
          </Button>

        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      {htmlFor ? (
        <Label htmlFor={htmlFor}>{label}</Label>
      ) : (
        <p className="text-sm font-medium">{label}</p>
      )}
      {children}
    </div>
  );
}

function Choice({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "press min-h-11 rounded-full border px-4 text-xs transition-colors disabled:opacity-50",
        active ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
