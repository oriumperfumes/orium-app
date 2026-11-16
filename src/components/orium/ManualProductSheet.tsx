import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Droplet, FlaskConical, Layers, Loader2, MessageCircle, Trash2 } from "lucide-react";

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
import { FragranceEditor } from "@/components/orium/FragranceEditor";
import { AdminConfirm } from "@/components/orium/admin/AdminUI";
import { SidePanel } from "@/components/orium/admin/orders/model";
import {
  BrandPicker,
  ChoiceCards,
  Field,
  GoldButton,
  PanelCard,
  PanelFooter,
  PanelHeader,
  PhotoField,
  QuickChips,
  Segmented,
  SoftButton,
  TextArea,
  TextInput,
  ToggleRow,
} from "@/components/orium/admin/PanelKit";
import { optimizePhoto } from "@/lib/image-optimize";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DECANT_SIZES, decantPrice, type DecantMl } from "@/lib/decants";
import { useDecantSettings } from "@/lib/use-decant-settings";
import {
  deleteManualProduct,
  getManualProduct,
  listBrandOptions,
  saveManualProduct,
  uploadProductPhoto,
  type SaleModeInput,
  type VisibilityInput,
} from "@/lib/manual-product.functions";
import { refreshSaleModes } from "@/lib/sale-mode";

/**
 * CADASTRO DE PERFUME (Admin → Produtos → Adicionar produto).
 *
 * Janela grande que nasce do botão: no computador, à esquerda a foto e a
 * prévia ao vivo do cartão da loja (com o que falta); à direita o cadastro em
 * blocos numerados — o perfume, como vende, preço, estoque e vitrine, texto e
 * notas. No celular vira uma coluna só. O produto entra no catálogo normal e
 * "Decant / Frasco / Ambos" define como ele é vendido em todo o site.
 */

type Draft = {
  id: string | null;
  name: string;
  brandId: string | null;
  newBrandName: string;
  volume: string;
  concentration: string;
  gender: string;
  description: string;
  saleMode: SaleModeInput;
  visibility: VisibilityInput;
  stock: string;
  manualPricing: boolean;
  cost: string;
  retailPrice: string;
  wholesalePrice: string;
  imageUrl: string | null;
  fragranticaUrl: string;
  pinned: boolean;
  pinnedNew: boolean;
  /** Preço próprio de cada decant; vazio = usa o preço global da Orium. */
  decant2: string;
  decant5: string;
  decant10: string;
  /** Preço sob consulta: o site mostra "Consultar no WhatsApp" em vez do preço. */
  priceOnRequest: boolean;
};

export type ManualProductPrefill = Partial<Pick<Draft, "name" | "newBrandName" | "volume" | "concentration" | "imageUrl" | "priceOnRequest">>;

const emptyDraft: Draft = {
  id: null,
  name: "",
  brandId: null,
  newBrandName: "",
  volume: "",
  concentration: "",
  gender: "",
  description: "",
  saleMode: "BOTH",
  visibility: "ATIVO",
  stock: "1",
  manualPricing: true,
  cost: "",
  retailPrice: "",
  wholesalePrice: "",
  imageUrl: null,
  fragranticaUrl: "",
  pinned: false,
  pinnedNew: false,
  decant2: "",
  decant5: "",
  decant10: "",
  priceOnRequest: false,
};

const SALE_MODES: Array<{ value: SaleModeInput; label: string; hint: string; icon: ReactNode }> = [
  { value: "DECANT", label: "Decant", hint: "Só 2, 5 e 10 ml", icon: <Droplet /> },
  { value: "FULL", label: "Frasco", hint: "Só o frasco fechado", icon: <FlaskConical /> },
  { value: "BOTH", label: "Os dois", hint: "O cliente escolhe", icon: <Layers /> },
];

const VISIBILITIES: Array<{ value: VisibilityInput; label: string }> = [
  { value: "ATIVO", label: "À venda" },
  { value: "INDISPONIVEL", label: "Indisponível" },
  { value: "OCULTO", label: "Oculto" },
];

const CONCENTRATIONS = ["EDP", "EDT", "Parfum", "Extrait", "Cologne"];
const GENDERS = [
  { value: "MASCULINO", label: "Masculino" },
  { value: "FEMININO", label: "Feminino" },
  { value: "UNISSEX", label: "Unissex" },
];

const money = (txt: string) => txt.replace(/[^\d.,]/g, "").replace(",", ".");
const toNumber = (txt: string) => {
  const value = Number(money(txt));
  return Number.isFinite(value) && value > 0 ? value : null;
};

export function ManualProductSheet({
  open,
  productId,
  onClose,
  onSaved,
  prefill,
}: {
  open: boolean;
  productId?: string | null;
  onClose: () => void;
  onSaved?: () => void;
  /** Cadastro a partir de um perfume de fornecedor (ex.: Rasha, sob consulta). */
  prefill?: ManualProductPrefill | null;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  /** último estado salvo/carregado: fechar com algo diferente pede confirmação */
  const [baseline, setBaseline] = useState<string>(JSON.stringify(emptyDraft));
  const [askDiscard, setAskDiscard] = useState(false);
  const [loading, setLoading] = useState(false);
  const dirty = !loading && JSON.stringify(draft) !== baseline;
  const requestClose = () => (dirty ? setAskDiscard(true) : onClose());
  const load = useServerFn(getManualProduct);

  useEffect(() => {
    if (!open) return;
    if (!productId) {
      const start = { ...emptyDraft, ...(prefill ?? {}), ...(prefill?.priceOnRequest ? { saleMode: "FULL" as SaleModeInput } : {}) };
      setDraft(start);
      setBaseline(JSON.stringify(start));
      return;
    }
    setLoading(true);
    void load({ data: { id: productId } })
      .then((res) => {
        const p = res.product as Record<string, unknown> | null;
        if (!p) {
          toast.error("Produto não encontrado.");
          onClose();
          return;
        }
        const num = (key: string) => {
          const value = p[key];
          return value == null ? "" : String(value);
        };
        const loaded: Draft = {
          id: String(p["id"]),
          name: String(p["canonical_name"] ?? ""),
          brandId: (p["brand_id"] as string | null) ?? null,
          newBrandName: p["brand_id"] ? "" : String(p["brand"] ?? ""),
          volume: num("volume_ml"),
          concentration: String(p["concentration"] ?? ""),
          gender: String(p["gender"] ?? p["gender_norm"] ?? ""),
          description: String(res.details?.description ?? ""),
          saleMode: ((p["sale_mode"] as SaleModeInput) ?? "BOTH") || "BOTH",
          visibility: ((p["visibility_status"] as VisibilityInput) ?? "ATIVO") || "ATIVO",
          stock: num("stock_quantity") || "0",
          manualPricing: p["manual_pricing"] !== false,
          cost: num("manual_cost"),
          retailPrice: num("retail_price"),
          wholesalePrice: num("wholesale_price"),
          imageUrl: (p["image_url"] as string | null) ?? null,
          fragranticaUrl: String(res.details?.fragrantica_url ?? ""),
          pinned: p["pinned_at"] != null,
          pinnedNew: p["pinned_new"] === true,
          decant2: num("decant_price_2ml"),
          decant5: num("decant_price_5ml"),
          decant10: num("decant_price_10ml"),
          priceOnRequest: p["price_on_request"] === true,
        };
        setDraft(loaded);
        setBaseline(JSON.stringify(loaded));
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  return (
    <>
      <SidePanel open={open} onClose={requestClose} label={draft.id ? "Editar produto" : "Adicionar produto"} wide>
        {loading ? (
          <div className="grid flex-1 place-items-center text-[#8C8C8C]">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : (
          <ManualProductForm
            draft={draft}
            setDraft={setDraft}
            onSaved={onSaved}
            onPersisted={(d) => setBaseline(JSON.stringify(d))}
            onClose={onClose}
            requestClose={requestClose}
          />
        )}
      </SidePanel>
      <AdminConfirm
        open={askDiscard}
        onOpenChange={setAskDiscard}
        title="Sair sem salvar?"
        description="O que você preencheu neste perfume ainda não foi salvo."
        confirmLabel="Sair sem salvar"
        danger
        onConfirm={onClose}
      />
    </>
  );
}

function ManualProductForm({
  draft,
  setDraft,
  onSaved,
  onPersisted,
  onClose,
  requestClose,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  onSaved?: (() => void) | undefined;
  onPersisted: (d: Draft) => void;
  onClose: () => void;
  requestClose: () => void;
}) {
  const save = useServerFn(saveManualProduct);
  const upload = useServerFn(uploadProductPhoto);
  const remove = useServerFn(deleteManualProduct);
  const brandsFn = useServerFn(listBrandOptions);

  const [brands, setBrands] = useState<Array<{ id: string; canonical_name: string }>>([]);
  const [busy, setBusy] = useState<null | "photo" | "save" | "delete">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const decantSettings = useDecantSettings();
  const [customDecant, setCustomDecant] = useState(!!(draft.decant2 || draft.decant5 || draft.decant10));

  useEffect(() => {
    void brandsFn()
      .then((r) => setBrands(r.brands))
      .catch(() => setBrands([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const sellsBottle = draft.saleMode !== "DECANT" || draft.priceOnRequest;
  const sellsDecant = draft.saleMode !== "FULL" && !draft.priceOnRequest;
  const brandName = brands.find((b) => b.id === draft.brandId)?.canonical_name ?? (draft.brandId ? "" : draft.newBrandName);
  /** Preço geral daquele tamanho, para servir de referência. */
  const globalDecant = (ml: DecantMl) => decantPrice(null, decantSettings, ml);

  const retail = toNumber(draft.retailPrice);
  const cost = toNumber(draft.cost);
  const profit = retail != null && cost != null ? retail - cost : null;

  const needsPrice = !draft.priceOnRequest && draft.saleMode !== "DECANT" && draft.manualPricing;
  const checklist = [
    { ok: !!draft.imageUrl, label: "Foto" },
    { ok: !!draft.name.trim(), label: "Nome" },
    { ok: !!(draft.brandId || draft.newBrandName.trim()), label: "Marca" },
    ...(needsPrice ? [{ ok: retail != null, label: "Preço do frasco" }] : []),
  ];
  const canSave = !!draft.name.trim() && !!(draft.brandId || draft.newBrandName.trim());

  const pickPhoto = async (file: File) => {
    setBusy("photo");
    try {
      const optimized = await optimizePhoto(file);
      const res = await upload({
        data: { base64: optimized.main, contentType: "image/webp", cardBase64: optimized.card, thumbBase64: optimized.thumb },
      });
      set({ imageUrl: res.url });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy("save");
    try {
      const res = await save({
        data: {
          id: draft.id,
          name: draft.name.trim(),
          brandId: draft.brandId,
          newBrandName: draft.brandId ? null : draft.newBrandName.trim() || null,
          volumeMl: draft.volume ? Number(draft.volume) : null,
          concentration: draft.concentration || null,
          gender: draft.gender || null,
          description: draft.description,
          saleMode: draft.saleMode,
          visibility: draft.visibility,
          stockQuantity: draft.stock ? Number(draft.stock) : 0,
          manualPricing: draft.manualPricing,
          cost: toNumber(draft.cost),
          retailPrice: toNumber(draft.retailPrice),
          wholesalePrice: toNumber(draft.wholesalePrice),
          imageUrl: draft.imageUrl,
          fragranticaUrl: draft.fragranticaUrl.trim() || null,
          pinned: draft.pinned,
          pinnedNew: draft.pinned && draft.pinnedNew,
          decantPrice2ml: toNumber(draft.decant2),
          decantPrice5ml: toNumber(draft.decant5),
          decantPrice10ml: toNumber(draft.decant10),
          priceOnRequest: draft.priceOnRequest,
        },
      });
      const isNew = !draft.id;
      set({ id: res.id });
      onPersisted({ ...draft, id: res.id });
      refreshSaleModes();
      onSaved?.();
      toast.success(isNew ? "Perfume no catálogo! Agora, se quiser, complete as notas no fim." : "Produto atualizado.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** mantém o campo tocado visível acima do teclado do celular */
  const onFieldFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    window.setTimeout(() => target.scrollIntoView({ block: "center", behavior: "smooth" }), 320);
  };

  const conc = draft.concentration.trim();
  const pinMode = draft.pinned ? (draft.pinnedNew ? "novo" : "topo") : "nao";

  return (
    <>
      <PanelHeader
        title={draft.id ? draft.name || "Editar produto" : "Novo perfume no catálogo"}
        subtitle={draft.id ? "Cadastro manual · as mudanças valem para todo o site" : "Preencha de cima para baixo. Só nome e marca são obrigatórios."}
        onClose={requestClose}
      />

      <div onFocus={onFieldFocus} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 lg:px-6">
        <div className="ui-view-in grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-6">
          {/* esquerda: foto, prévia do cartão e o que falta */}
          <aside className="min-w-0 space-y-3 lg:sticky lg:top-0 lg:self-start">
            <PanelCard className="max-lg:mx-auto max-lg:w-full max-lg:max-w-[300px]">
              <PhotoField url={draft.imageUrl} busy={busy === "photo"} onFile={(f) => void pickPhoto(f)} onRemove={() => set({ imageUrl: null })} />
            </PanelCard>

            <PanelCard title="Assim fica na loja" className="max-lg:hidden">
              <StorePreview draft={draft} brandName={brandName} globalDecant={globalDecant} />
            </PanelCard>

            <PanelCard className="max-lg:hidden">
              <p className="mb-3 text-[13px] font-semibold text-[#A9A9A9]">Para publicar</p>
              <ul className="space-y-2">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-2.5 text-[14px]">
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-300",
                        c.ok ? "bg-[#7FCF9F] text-[#0F1F15]" : "bg-[#232323] text-transparent ring-1 ring-white/15",
                      )}
                    >
                      <Check className={cn("size-3.5", c.ok && "pk-check-on")} strokeWidth={3} />
                    </span>
                    <span className={c.ok ? "text-white" : "text-[#8C8C8C]"}>{c.label}</span>
                  </li>
                ))}
              </ul>
            </PanelCard>
          </aside>

          {/* direita: o cadastro */}
          <div className="min-w-0 space-y-3">
            <Step n={1} title="O perfume">
              <div className="space-y-4">
                <Field label="Nome">
                  <TextInput value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Khamrah" autoFocus={!draft.id && !draft.name} />
                </Field>
                <Field label="Marca" hint={!draft.brandId && draft.newBrandName.trim() ? `A marca “${draft.newBrandName.trim()}” será criada ao salvar.` : undefined}>
                  <BrandPicker brands={brands} brandId={draft.brandId} newBrandName={draft.newBrandName} onChange={(v) => set(v)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                  <Field label="Volume">
                    <TextInput inputMode="numeric" suffix="ml" value={draft.volume} onChange={(e) => set({ volume: e.target.value.replace(/\D/g, "") })} placeholder="100" />
                  </Field>
                  <Field label="Concentração">
                    <QuickChips options={CONCENTRATIONS} value={draft.concentration} onPick={(v) => set({ concentration: conc.toLowerCase() === v.toLowerCase() ? "" : v })} />
                  </Field>
                </div>
                <Field label="Para quem">
                  <Segmented full options={GENDERS} value={draft.gender || null} onChange={(v) => set({ gender: v })} />
                </Field>
              </div>
            </Step>

            <Step n={2} title="Como vende">
              <ToggleRow
                icon={<MessageCircle />}
                label="Preço sob consulta"
                hint={draft.priceOnRequest ? "No site aparece “Consultar no WhatsApp” no lugar do preço. Não entra na sacola." : "Ligue para não mostrar preço e atender pelo WhatsApp."}
                checked={draft.priceOnRequest}
                onChange={(v) => set(v ? { priceOnRequest: true, saleMode: "FULL" } : { priceOnRequest: false })}
              />
              {!draft.priceOnRequest ? (
                <div className="adm-pop mt-3">
                  <ChoiceCards options={SALE_MODES} value={draft.saleMode} onChange={(v) => set({ saleMode: v })} />
                </div>
              ) : null}
            </Step>

            {!draft.priceOnRequest ? (
              <Step n={3} title="Preço">
                <div className="space-y-5">
                  {sellsBottle ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[14.5px] font-bold">Frasco</p>
                        <Segmented
                          options={[
                            { value: "manual", label: "Eu defino" },
                            { value: "auto", label: "Automático" },
                          ]}
                          value={draft.manualPricing ? "manual" : "auto"}
                          onChange={(v) => set({ manualPricing: v === "manual" })}
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Custo" hint="Opcional">
                          <TextInput prefix="R$" inputMode="decimal" value={draft.cost} onChange={(e) => set({ cost: money(e.target.value) })} placeholder="0,00" />
                        </Field>
                        {draft.manualPricing ? (
                          <>
                            <Field label="Preço no Pix">
                              <TextInput prefix="R$" inputMode="decimal" value={draft.retailPrice} onChange={(e) => set({ retailPrice: money(e.target.value) })} placeholder="0,00" />
                            </Field>
                            <Field label="Atacado" hint="Opcional">
                              <TextInput prefix="R$" inputMode="decimal" value={draft.wholesalePrice} onChange={(e) => set({ wholesalePrice: money(e.target.value) })} placeholder="0,00" />
                            </Field>
                          </>
                        ) : (
                          <p className="self-center text-[13px] leading-snug text-[#8C8C8C] sm:col-span-2">O preço sai do custo mais a margem configurada em Precificação.</p>
                        )}
                      </div>
                      {draft.manualPricing && retail != null && profit != null ? (
                        <div className={cn("adm-pop flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[16px] px-4 py-3 text-[13.5px]", profit < 0 ? "bg-[#2A1A18] text-[#FF9A8A]" : "bg-[#17251C] text-[#7FCF9F]")}>
                          <span className="font-bold">
                            {profit < 0 ? "Abaixo do custo" : "Lucro"} {brl(Math.abs(profit))}
                          </span>
                          <span>margem {((profit / retail) * 100).toFixed(1).replace(".", ",")}%</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {sellsDecant ? (
                    <div className={cn("space-y-4", sellsBottle && "border-t border-white/[0.06] pt-5")}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[14.5px] font-bold">Decants</p>
                        <Segmented
                          options={[
                            { value: "padrao", label: "Preço padrão" },
                            { value: "proprio", label: "Só deste" },
                          ]}
                          value={customDecant ? "proprio" : "padrao"}
                          onChange={(v) => {
                            setCustomDecant(v === "proprio");
                            if (v === "padrao") set({ decant2: "", decant5: "", decant10: "" });
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2.5">
                        {DECANT_SIZES.map((ml) => {
                          const key = (ml === 2 ? "decant2" : ml === 5 ? "decant5" : "decant10") as "decant2" | "decant5" | "decant10";
                          return customDecant ? (
                            <Field key={ml} label={`${ml} ml`}>
                              <TextInput
                                prefix="R$"
                                inputMode="decimal"
                                value={draft[key]}
                                onChange={(e) => set({ [key]: money(e.target.value) } as Partial<Draft>)}
                                placeholder={globalDecant(ml).toFixed(2).replace(".", ",")}
                              />
                            </Field>
                          ) : (
                            <div key={ml} className="rounded-[18px] bg-[#232323] px-4 py-3">
                              <p className="text-[12.5px] font-semibold text-[#8C8C8C]">{ml} ml</p>
                              <p className="mt-0.5 text-[16px] font-bold tabular-nums">{brl(globalDecant(ml))}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Step>
            ) : null}

            <Step n={draft.priceOnRequest ? 3 : 4} title="Estoque e vitrine">
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                  <Field label="Frascos na loja">
                    <TextInput inputMode="numeric" suffix="un." value={draft.stock} onChange={(e) => set({ stock: e.target.value.replace(/\D/g, "") })} placeholder="1" />
                  </Field>
                  <Field label="No site">
                    <Segmented full options={VISIBILITIES} value={draft.visibility} onChange={(v) => set({ visibility: v })} />
                  </Field>
                </div>
                <Field label="Destaque no catálogo" hint="Fixado aparece no começo do catálogo.">
                  <Segmented
                    full
                    options={[
                      { value: "nao", label: "Normal" },
                      { value: "topo", label: "Fixar no topo" },
                      { value: "novo", label: "Topo + “Novidade”" },
                    ]}
                    value={pinMode}
                    onChange={(v) => set({ pinned: v !== "nao", pinnedNew: v === "novo" })}
                  />
                </Field>
              </div>
            </Step>

            <Step n={draft.priceOnRequest ? 4 : 5} title="Descrição">
              <div className="space-y-4">
                <TextArea value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Em poucas linhas, o que faz esse perfume valer a pena." />
                <Field label="Link da Fragrantica" hint="Opcional. Ajuda a puxar acordes e notas depois.">
                  <TextInput value={draft.fragranticaUrl} onChange={(e) => set({ fragranticaUrl: e.target.value })} placeholder="https://www.fragrantica.com/perfume/…" />
                </Field>
              </div>
            </Step>

            {draft.id ? (
              <section className="min-w-0 rounded-[24px] bg-[#1A1A1A] p-2 sm:p-3">
                <FragranceEditor productId={draft.id} defaultOpen allowCopyFromCatalog />
              </section>
            ) : (
              <PanelCard tone="flat" title="Notas e acordes" hint="Depois de salvar, abre aqui o mesmo editor do catálogo: Fragrantica, acordes e pirâmide." />
            )}
          </div>
        </div>
      </div>

      <PanelFooter>
        {draft.id ? (
          <SoftButton aria-label="Excluir produto" icon={<Trash2 className="text-[#FF9A8A]" />} className="w-[52px] px-0" onClick={() => setConfirmDelete(true)} />
        ) : null}
        <p className="mr-auto hidden min-w-0 truncate text-[13px] text-[#8C8C8C] lg:block">
          {checklist.every((c) => c.ok) ? "Tudo pronto para publicar." : `Falta: ${checklist.filter((c) => !c.ok).map((c) => c.label.toLowerCase()).join(", ")}.`}
        </p>
        {draft.id ? (
          <SoftButton className="flex-1 lg:flex-none lg:px-6" onClick={requestClose}>
            Concluir
          </SoftButton>
        ) : null}
        <GoldButton className="flex-[1.6] lg:min-w-[240px] lg:flex-none" loading={busy === "save"} disabled={!canSave || busy === "photo"} onClick={() => void submit()}>
          {draft.id ? "Salvar alterações" : "Adicionar ao catálogo"}
        </GoldButton>
      </PanelFooter>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="max-w-[min(92vw,26rem)] rounded-[28px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este produto?</AlertDialogTitle>
            <AlertDialogDescription>O perfume sai do catálogo, dos favoritos e dos carrinhos. Pedidos antigos continuam intactos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-full">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy === "delete"}
              className="h-11 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!draft.id) return;
                setBusy("delete");
                try {
                  await remove({ data: { id: draft.id } });
                  refreshSaleModes();
                  onSaved?.();
                  toast.success("Produto excluído.");
                  onClose();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(null);
                  setConfirmDelete(false);
                }
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Bloco numerado do cadastro. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[13px] font-bold text-[#15130F] tabular-nums">{n}</span>
        <h3 className="text-[17px] leading-tight font-bold tracking-[-0.01em]">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/** Prévia do cartão da loja, atualizada a cada letra. */
function StorePreview({ draft, brandName, globalDecant }: { draft: Draft; brandName: string; globalDecant: (ml: DecantMl) => number }) {
  const retail = toNumber(draft.retailPrice);
  const from = draft.saleMode !== "FULL" ? Math.min(...DECANT_SIZES.map((ml) => toNumber(draft[`decant${ml}` as "decant2"]) ?? globalDecant(ml))) : null;
  return (
    <div className="overflow-hidden rounded-[20px] bg-[#101010] p-2">
      <div className="relative aspect-square overflow-hidden rounded-[16px] bg-[#232323]">
        {draft.imageUrl ? <img src={draft.imageUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-[13px] text-[#6F6F6F]">sem foto</div>}
        {draft.pinned && draft.pinnedNew ? <span className="absolute top-2 left-2 rounded-full bg-[#FFD599] px-2 py-0.5 text-[11px] font-bold text-[#15130F]">Novidade</span> : null}
        {draft.visibility !== "ATIVO" ? (
          <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">{draft.visibility === "OCULTO" ? "Oculto" : "Indisponível"}</span>
        ) : null}
      </div>
      <div className="px-1.5 pt-2.5 pb-1.5">
        <p className="truncate text-[11px] font-semibold tracking-[0.06em] text-[#8C8C8C] uppercase">{brandName || "Marca"}</p>
        <p className="mt-0.5 truncate text-[15px] font-bold">{draft.name || "Nome do perfume"}</p>
        <p className="truncate text-[12px] text-[#8C8C8C]">{[draft.volume ? `${draft.volume} ml` : null, draft.concentration || null].filter(Boolean).join(" · ") || " "}</p>
        <p className="mt-2 text-[15px] font-bold tabular-nums">
          {draft.priceOnRequest ? (
            <span className="text-[#FFD599]">Consultar no WhatsApp</span>
          ) : draft.saleMode === "DECANT" ? (
            from != null ? `a partir de ${brl(from)}` : "—"
          ) : retail != null ? (
            brl(retail)
          ) : draft.manualPricing ? (
            <span className="text-[#6F6F6F]">R$ —</span>
          ) : (
            <span className="text-[13px] font-semibold text-[#8C8C8C]">preço automático</span>
          )}
        </p>
      </div>
    </div>
  );
}
