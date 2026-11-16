import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowUpRight, Check, ClipboardEdit, Eye, Fingerprint, Loader2, Package, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminConfirm, AdminKV, AdminTechDetails } from "@/components/orium/admin/AdminUI";
import { FragranceEditor } from "@/components/orium/FragranceEditor";
import { saveProductMaintenance, researchProductIdentity } from "@/lib/admin-catalog.functions";
import { getAdminProductRow } from "@/lib/admin-insight.functions";
import { ProductImagePicker } from "@/components/orium/admin/ProductImagePicker";
import { TYPE_LABEL, ALLOWED_TYPES, type ProductType, type Gender } from "@/lib/catalog/classify";
import { HistoryList, PricingTab, StockTab, SuppliersTab, useProductState } from "@/components/orium/admin/ProductOps";
import { SidePanel } from "@/components/orium/admin/orders/model";
import {
  BrandPicker,
  Field,
  GoldButton,
  MiniStat,
  PanelCard,
  PanelFooter,
  PanelHeader,
  PanelScroll,
  PanelTabs,
  QuickChips,
  Segmented,
  SoftButton,
  TextInput,
  ToggleRow,
} from "@/components/orium/admin/PanelKit";
import { brl, dateBR } from "@/lib/format";
import { imgVariant } from "@/lib/product-img";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * EDITAR PERFUME — janela que nasce do cartão (como o painel do pedido).
 *
 * Topo: foto, nome e três números (preço, venda, site) que levam à aba certa.
 * Quatro abas, cada uma responde uma pergunta:
 *   Perfume          — o que é (foto, nome, marca, volume, gênero, site)
 *   Preço e estoque  — por quanto e quanto tem (salva sozinho)
 *   Notas            — acordes e pirâmide (mesmo editor do catálogo)
 *   Mais             — fornecedores, histórico e detalhes técnicos
 * Só a aba Perfume tem "Salvar"; as outras salvam ao confirmar cada ação.
 * ------------------------------------------------------------------ */

export type EditTab = "perfume" | "preco" | "olfativo" | "mais";

const TABS: Array<{ key: EditTab; label: string }> = [
  { key: "perfume", label: "Perfume" },
  { key: "preco", label: "Preço e estoque" },
  { key: "olfativo", label: "Notas" },
  { key: "mais", label: "Mais" },
];

const GENDERS: Array<{ value: Gender | "NOT_APPLICABLE"; label: string }> = [
  { value: "MALE", label: "Masculino" },
  { value: "FEMALE", label: "Feminino" },
  { value: "UNISEX", label: "Unissex" },
  { value: "UNKNOWN", label: "Não sei" },
];
const CONCENTRATIONS = ["EDP", "EDT", "Parfum", "Extrait", "Cologne"];

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
  originEl,
  brands,
  startTab = "perfume",
  onClose,
  onManualEdit,
}: {
  product: EditableProduct | null;
  /** cartão de onde a janela nasce (e para onde volta) */
  originEl?: HTMLElement | null;
  brands: Array<{ id: string; canonical_name: string }>;
  startTab?: EditTab;
  onClose: () => void;
  /** produto cadastrado à mão: abre o cadastro completo */
  onManualEdit: (id: string) => void;
}) {
  // mantém o produto enquanto a janela anima a saída
  const [last, setLast] = useState(product);
  if (product && product !== last) setLast(product);
  const p = product ?? last;
  const [askDiscard, setAskDiscard] = useState(false);
  const [dirty, setDirty] = useState(false);
  const close = () => (dirty ? setAskDiscard(true) : onClose());

  return (
    <>
      <SidePanel open={!!product} onClose={close} label="Editar produto" originEl={originEl ?? null}>
        {p ? (
          <EditBody
            key={p.id}
            product={p}
            brands={brands}
            startTab={startTab}
            onClose={onClose}
            requestClose={close}
            onDirty={setDirty}
            onManualEdit={onManualEdit}
          />
        ) : null}
      </SidePanel>
      <AdminConfirm
        open={askDiscard}
        onOpenChange={setAskDiscard}
        title="Sair sem salvar?"
        description="As mudanças na aba Perfume ainda não foram salvas."
        confirmLabel="Sair sem salvar"
        danger
        onConfirm={() => {
          setDirty(false);
          onClose();
        }}
      />
    </>
  );
}

function EditBody({
  product,
  brands,
  startTab,
  onClose,
  requestClose,
  onDirty,
  onManualEdit,
}: {
  product: EditableProduct;
  brands: Array<{ id: string; canonical_name: string }>;
  startTab: EditTab;
  onClose: () => void;
  requestClose: () => void;
  onDirty: (v: boolean) => void;
  onManualEdit: (id: string) => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveProductMaintenance);
  const research = useServerFn(researchProductIdentity);
  const fetchProductRow = useServerFn(getAdminProductRow);
  const state = useProductState(product.id).data;
  const [tab, setTab] = useState<EditTab>(startTab);
  const [busy, setBusy] = useState<null | "save" | "research">(null);

  const initial = useMemo(
    () => ({
      name: product.canonical_name,
      brandId: product.brand_id ?? "",
      newBrandName: "",
      gender: ((product.gender_norm as Gender | null) ?? "UNKNOWN") as Gender | "NOT_APPLICABLE",
      productType: ((product.product_type as ProductType) ?? "UNKNOWN") as ProductType,
      visible: product.catalog_eligible,
      concentration: product.concentration ?? "",
      volumeMl: product.volume_ml ? String(product.volume_ml) : "",
      flanker: product.flanker ?? "",
      verified: product.identity_verified,
    }),
    [product],
  );
  const [form, setFormState] = useState(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const setForm = (patch: Partial<typeof form>) => {
    setFormState((f) => {
      const next = { ...f, ...patch };
      onDirty(JSON.stringify(next) !== JSON.stringify(initial));
      return next;
    });
  };

  const [suggestion, setSuggestion] = useState<{
    brand: string | null;
    name: string | null;
    confidence: number;
    sources: Array<{ title: string; url: string }>;
  } | null>(null);

  /** detalhes técnicos e histórico de identidade só quando a aba "Mais" abre */
  const { data: detail } = useQuery({
    queryKey: ["admin-product-edit", product.id],
    enabled: tab === "mais",
    staleTime: 30_000,
    queryFn: async () => {
      const [row, history] = await Promise.all([
        fetchProductRow({ data: { id: product.id } }),
        supabase
          .from("product_identity_history")
          .select("id, action, created_at, changed_by_email, before, after")
          .eq("product_id", product.id)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      return { row, history: history.data ?? [] };
    },
  });

  const submit = async () => {
    setBusy("save");
    try {
      await save({
        data: {
          productId: product.id,
          name: form.name,
          brandId: form.brandId || null,
          newBrandName: form.newBrandName || null,
          gender: form.gender,
          productType: form.visible ? form.productType : "FORA",
          concentration: form.concentration || null,
          volumeMl: form.volumeMl ? Number(form.volumeMl) : null,
          flanker: form.flanker || null,
          confirm: form.verified,
        },
      });
      toast.success("Perfume salvo.");
      onDirty(false);
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(null);
    }
  };

  const doResearch = async () => {
    setBusy("research");
    try {
      const res = await research({ data: { productId: product.id } });
      setSuggestion(res);
      if (!res.name) toast.info("A pesquisa não trouxe uma sugestão confiável.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível pesquisar agora.");
    } finally {
      setBusy(null);
    }
  };

  const isPerfume = (form.productType ?? product.product_type) === "PERFUME";
  const manual = product.source === "manual";
  const sellLabel = state
    ? state.inStock
      ? state.source === "supplier"
        ? "Sob encomenda"
        : `Pronta${state.localStock ? ` · ${state.localStock}` : ""}`
      : "Indisponível"
    : "…";
  const brandName = brands.find((b) => b.id === form.brandId)?.canonical_name ?? (form.newBrandName || product.brand);

  return (
    <>
      <PanelHeader
        image={imgVariant(product.image_url, "thumb")}
        title={form.name || product.canonical_name}
        subtitle={[brandName ?? "Sem marca", form.volumeMl ? `${form.volumeMl} ml` : null, form.concentration || null].filter(Boolean).join(" · ")}
        onClose={requestClose}
      >
        <div className="mt-4 flex gap-2">
          <MiniStat label="Preço no Pix" value={state ? (state.retail != null ? brl(state.retail) : "Sem preço") : "…"} tone="gold" onClick={() => setTab("preco")} />
          <MiniStat label="Venda" value={sellLabel} onClick={() => setTab("preco")} />
          <MiniStat label="No site" value={form.visible ? "Visível" : "Oculto"} onClick={() => setTab("perfume")} />
        </div>
        <PanelTabs className="mt-4" tabs={TABS} value={tab} onChange={setTab} />
      </PanelHeader>

      <PanelScroll swapKey={tab}>
        {tab === "perfume" ? (
          <>
            <PanelCard>
              <ProductImagePicker productId={product.id} name={product.canonical_name} />
            </PanelCard>

            <PanelCard title="Identidade" hint="Como o perfume aparece na loja e na busca.">
              <div className="space-y-4">
                <Field label="Nome" htmlFor="pe-nome">
                  <TextInput id="pe-nome" value={form.name} onChange={(e) => setForm({ name: e.target.value })} />
                </Field>
                <Field label="Marca">
                  <BrandPicker
                    brands={brands}
                    brandId={form.brandId || null}
                    newBrandName={form.newBrandName}
                    allowEmpty
                    onChange={(v) => setForm({ brandId: v.brandId ?? "", newBrandName: v.newBrandName })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Volume" htmlFor="pe-vol">
                    <TextInput
                      id="pe-vol"
                      inputMode="numeric"
                      suffix="ml"
                      value={form.volumeMl}
                      onChange={(e) => setForm({ volumeMl: e.target.value.replace(/\D/g, "") })}
                      placeholder="100"
                    />
                  </Field>
                  <Field label="Versão" htmlFor="pe-ver">
                    <TextInput id="pe-ver" value={form.flanker} onChange={(e) => setForm({ flanker: e.target.value })} placeholder="Ex.: Intense" />
                  </Field>
                </div>
                <Field label="Concentração">
                  <QuickChips options={CONCENTRATIONS} value={form.concentration} onPick={(v) => setForm({ concentration: form.concentration === v ? "" : v })} />
                  {form.concentration && !CONCENTRATIONS.some((c) => c.toLowerCase() === form.concentration.toLowerCase()) ? (
                    <TextInput className="mt-2" value={form.concentration} onChange={(e) => setForm({ concentration: e.target.value })} />
                  ) : null}
                </Field>
              </div>
            </PanelCard>

            <PanelCard title="Tipo e público">
              <div className="space-y-4">
                <Field label="Categoria">
                  <div className="flex flex-wrap gap-1.5">
                    {ALLOWED_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={form.productType === t}
                        onClick={() => setForm({ productType: t, ...(t !== "PERFUME" && form.gender === "UNKNOWN" ? { gender: "NOT_APPLICABLE" as const } : {}) })}
                        className={cn(
                          "press h-10 rounded-full px-4 text-[13.5px] font-semibold transition-colors duration-200",
                          form.productType === t ? "bg-white text-[#15130F]" : "bg-[#232323] text-[#A9A9A9] hover:bg-[#2A2A2A] hover:text-white",
                        )}
                      >
                        {TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Gênero">
                  <Segmented
                    full
                    options={isPerfume ? GENDERS : [...GENDERS, { value: "NOT_APPLICABLE" as const, label: "Não se aplica" }]}
                    value={form.gender}
                    onChange={(v) => setForm({ gender: v })}
                  />
                </Field>
              </div>
            </PanelCard>

            <PanelCard title="Na loja">
              <ToggleRow
                icon={<Eye />}
                label="Mostrar no site"
                hint={form.visible ? "Os clientes veem e podem comprar." : "Fica escondido. Nada de custo, fornecedor ou histórico é apagado."}
                checked={form.visible}
                onChange={(v) => setForm({ visible: v })}
              />
              <div className="my-1 h-px bg-white/[0.06]" />
              <ToggleRow
                icon={<ShieldCheck />}
                label="Identidade conferida"
                hint="Nome e marca certos. A sincronização dos fornecedores não muda mais."
                checked={form.verified}
                onChange={(v) => setForm({ verified: v })}
              />
            </PanelCard>
          </>
        ) : null}

        {tab === "preco" ? (
          <>
            <div className="ui-stagger space-y-3">
              <PricingTab productId={product.id} />
              <StockTab productId={product.id} />
            </div>
            {manual ? (
              <SoftButton icon={<ClipboardEdit />} className="w-full" onClick={() => (onClose(), onManualEdit(product.id))}>
                Abrir o cadastro completo
              </SoftButton>
            ) : null}
          </>
        ) : null}

        {tab === "olfativo" ? (
          isPerfume ? (
            <section className="min-w-0 rounded-[24px] bg-[#1A1A1A] p-2 sm:p-3">
              <FragranceEditor productId={product.id} defaultOpen />
            </section>
          ) : (
            <PanelCard icon={<Sparkles />} title="Só para perfumes" hint="Notas e acordes existem apenas para produtos da categoria Perfume." />
          )
        ) : null}

        {tab === "mais" ? (
          <>
            <SuppliersTab productId={product.id} />

            <PanelCard
              icon={<Fingerprint />}
              title="Conferir nome e marca"
              hint="Pesquisa na internet e sugere o nome e a marca certos."
              right={
                <button
                  type="button"
                  disabled={busy === "research"}
                  onClick={() => void doResearch()}
                  className="press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-[#232323] px-4 text-[13px] font-semibold hover:bg-[#2C2C2C] disabled:opacity-50"
                >
                  {busy === "research" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Pesquisar
                </button>
              }
            >
              {suggestion?.name ? (
                <div className="adm-pop space-y-3 rounded-[18px] bg-[#232323] p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[12px] text-[#8C8C8C]">Nome sugerido</p>
                      <p className="text-[15px] font-bold">{suggestion.name}</p>
                    </div>
                    <div>
                      <p className="text-[12px] text-[#8C8C8C]">Marca sugerida</p>
                      <p className="text-[15px] font-bold">{suggestion.brand ?? "—"}</p>
                    </div>
                  </div>
                  <p className="text-[12.5px] text-[#8C8C8C]">Confiança {Math.round(suggestion.confidence * 100)}%</p>
                  {suggestion.sources.slice(0, 3).map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 truncate text-[13px] text-[#D4D4D4] underline-offset-4 hover:underline">
                      <ArrowUpRight className="size-3.5 shrink-0" /> <span className="truncate">{s.title || s.url}</span>
                    </a>
                  ))}
                  <GoldButton
                    icon={<Check className="size-[18px]" />}
                    className="h-11 w-full"
                    onClick={() => {
                      const match = suggestion.brand ? brands.find((b) => b.canonical_name.toLowerCase() === suggestion.brand!.toLowerCase()) : null;
                      setForm({
                        name: suggestion.name ?? form.name,
                        ...(suggestion.brand ? (match ? { brandId: match.id, newBrandName: "" } : { brandId: "", newBrandName: suggestion.brand }) : {}),
                      });
                      setTab("perfume");
                    }}
                  >
                    Usar sugestão
                  </GoldButton>
                </div>
              ) : null}
            </PanelCard>

            <HistoryList productId={product.id} />

            <PanelCard icon={<Package />} title="Detalhes técnicos">
              <div className="min-w-0 divide-y divide-white/[0.06]">
                <AdminKV label="Origem" value={product.source ?? "—"} />
                <AdminKV label="Identidade" value={product.identity_status ?? "—"} />
                <AdminKV label="Travada contra sincronização" value={product.canonical_identity_locked ? "Sim" : "Não"} />
                <AdminKV label="Criado em" value={detail?.row?.created_at ? dateBR(detail.row.created_at) : "—"} />
              </div>
              <div className="mt-3 space-y-2">
                {(product.search_aliases ?? []).length ? (
                  <AdminTechDetails label="Apelidos de busca">{(product.search_aliases ?? []).join(" · ")}</AdminTechDetails>
                ) : null}
                <AdminTechDetails label="Identificadores">
                  <p className="break-all">ID: {product.id}</p>
                  <p className="break-all">Slug: {detail?.row?.slug ?? "—"}</p>
                  <p className="break-all">Chave de identidade: {detail?.row?.identity_key ?? "—"}</p>
                  <p className="break-all">Chave de duplicidade: {detail?.row?.dedupe_key ?? "—"}</p>
                  <p className="break-all">Título do fornecedor: {product.raw_name ?? "—"}</p>
                </AdminTechDetails>
                <AdminTechDetails label="Histórico de nome e marca">
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
                              {before.canonical_name ?? "—"} / {before.brand ?? "sem marca"} → {after.canonical_name ?? "—"} / {after.brand ?? "sem marca"}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </AdminTechDetails>
              </div>
              <Link
                to="/admin/produtos/$id"
                params={{ id: product.id }}
                className="press mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-[#232323] px-4 text-[13.5px] font-semibold hover:bg-[#2C2C2C]"
              >
                Informações internas completas <ArrowUpRight className="size-4" />
              </Link>
            </PanelCard>
          </>
        ) : null}
      </PanelScroll>

      {tab === "perfume" ? (
        <PanelFooter>
          {dirty ? (
            <>
              <SoftButton className="flex-1 sm:flex-none sm:px-6" onClick={requestClose}>
                Cancelar
              </SoftButton>
              <GoldButton className="adm-pop flex-[1.6]" loading={busy === "save"} disabled={!form.name.trim()} onClick={() => void submit()}>
                Salvar alterações
              </GoldButton>
            </>
          ) : (
            <SoftButton className="flex-1" onClick={requestClose}>
              Fechar
            </SoftButton>
          )}
        </PanelFooter>
      ) : null}
    </>
  );
}
