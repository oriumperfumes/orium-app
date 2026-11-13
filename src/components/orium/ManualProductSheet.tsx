import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, ImagePlus, Loader2, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useVisualViewport } from "@/hooks/use-visual-viewport";
import { optimizePhoto } from "@/lib/image-optimize";
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
 * Cadastro manual de perfumes (Admin → Produtos → Adicionar produto).
 *
 * Uma coluna, painel inferior e teclado tratado pelo visual viewport, como na
 * Negociação. O produto entra no catálogo normal e a escolha "Decant / Frasco /
 * Ambos" define como ele é vendido em todo o site.
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

const SALE_MODES: Array<{ value: SaleModeInput; label: string; hint: string }> = [
  { value: "DECANT", label: "Decant", hint: "Só frações de 2ml, 5ml e 10ml." },
  { value: "FULL", label: "Frasco", hint: "Só o frasco completo." },
  { value: "BOTH", label: "Ambos", hint: "O cliente escolhe decant ou frasco." },
];

const VISIBILITIES: Array<{ value: VisibilityInput; label: string }> = [
  { value: "ATIVO", label: "Ativo" },
  { value: "OCULTO", label: "Oculto" },
  { value: "INDISPONIVEL", label: "Indisponível" },
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
  const [loading, setLoading] = useState(false);
  const load = useServerFn(getManualProduct);
  const vv = useVisualViewport(open);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    if (!productId) {
      setDraft({ ...emptyDraft, ...(prefill ?? {}), ...(prefill?.priceOnRequest ? { saleMode: "FULL" as SaleModeInput } : {}) });
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
        setDraft({
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
        });
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  const style: React.CSSProperties = vv.supported
    ? vv.isKeyboardOpen
      ? { height: vv.height, maxHeight: vv.height, top: vv.offsetTop, bottom: "auto" }
      : { maxHeight: Math.round(vv.height * 0.92) }
    : {};

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      repositionInputs={false}
      dismissible={!vv.isKeyboardOpen}
    >
      <DrawerContent
        style={style}
        className={cn("flex min-h-0 flex-col overflow-hidden", !vv.supported && "max-h-[92dvh]")}
      >
        <DrawerHeader className="shrink-0 pb-2">
          <DrawerTitle>{draft.id ? "Editar produto" : "Adicionar produto"}</DrawerTitle>
        </DrawerHeader>
        {loading ? (
          <div className="grid flex-1 place-items-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <ManualProductForm
            draft={draft}
            setDraft={setDraft}
            keyboardOpen={vv.isKeyboardOpen}
            onSaved={onSaved}
            onClose={onClose}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function ManualProductForm({
  draft,
  setDraft,
  keyboardOpen,
  onSaved,
  onClose,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  keyboardOpen: boolean;
  onSaved?: (() => void) | undefined;
  onClose: () => void;
}) {
  const save = useServerFn(saveManualProduct);
  const upload = useServerFn(uploadProductPhoto);
  const remove = useServerFn(deleteManualProduct);
  const brandsFn = useServerFn(listBrandOptions);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [brands, setBrands] = useState<Array<{ id: string; canonical_name: string }>>([]);
  const [brandQuery, setBrandQuery] = useState("");
  const [busy, setBusy] = useState<null | "photo" | "save" | "delete">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const decantSettings = useDecantSettings();
  const [customDecant, setCustomDecant] = useState(
    !!(draft.decant2 || draft.decant5 || draft.decant10),
  );

  /** Preço geral daquele tamanho, já formatado, para servir de referência. */
  const globalDecant = (ml: DecantMl) =>
    decantPrice(null, decantSettings, ml).toFixed(2).replace(".", ",");

  useEffect(() => {
    void brandsFn().then((r) => setBrands(r.brands)).catch(() => setBrands([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const sellsBottle = draft.saleMode !== "DECANT";

  const brandName =
    brands.find((b) => b.id === draft.brandId)?.canonical_name ?? (draft.brandId ? "" : draft.newBrandName);
  const suggestions = brandQuery.trim()
    ? brands
        .filter((b) => b.canonical_name.toLowerCase().includes(brandQuery.trim().toLowerCase()))
        .slice(0, 6)
    : [];

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
      set({ id: res.id });
      refreshSaleModes();
      onSaved?.();
      toast.success(
        draft.id ? "Produto atualizado." : "Produto criado. Complete as informações olfativas abaixo.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onFieldFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    window.setTimeout(() => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const field = target.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      const targetTop = scroller.scrollTop + field.top - viewport.top - (viewport.height - field.height) / 2;
      scroller.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    }, 320);
  };

  return (
    <div
      ref={scrollRef}
      onFocus={onFieldFocus}
      data-vaul-no-drag=""
      className={cn(
        "min-h-0 flex-1 touch-pan-y space-y-5 overflow-x-hidden overflow-y-auto overscroll-contain px-4 [scrollbar-gutter:stable]",
        keyboardOpen ? "pb-6" : "pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
      )}
    >
      {/* Foto: câmera ou galeria, otimizada antes de enviar */}
      <div>
        <Label className="text-sm">Foto do perfume</Label>
        <div className="mt-2 flex items-center gap-3">
          <div className="size-24 shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-surface-3">
            {draft.imageUrl ? (
              <img src={draft.imageUrl} alt="Foto do perfume" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-muted-foreground">
                <ImagePlus className="size-5" />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="press h-10 rounded-full px-4 text-xs"
                disabled={busy === "photo"}
                onClick={() => cameraRef.current?.click()}
              >
                {busy === "photo" ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                Tirar foto
              </Button>
              <Button
                type="button"
                variant="outline"
                className="press h-10 rounded-full px-4 text-xs"
                disabled={busy === "photo"}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="size-4" />
                Galeria
              </Button>
            </div>
            {draft.imageUrl ? (
              <Button
                type="button"
                variant="ghost"
                className="press h-9 self-start rounded-full px-4 text-xs text-muted-foreground"
                onClick={() => set({ imageUrl: null })}
              >
                <X className="size-3.5" /> Remover foto
              </Button>
            ) : null}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void pickPhoto(file);
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void pickPhoto(file);
          }}
        />
      </div>

      <Field label="Nome do perfume">
        <Input
          className="h-11"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Ex.: Khamrah"
        />
      </Field>

      <Field label="Marca">
        <Input
          className="h-11"
          value={brandQuery || brandName}
          onChange={(e) => {
            setBrandQuery(e.target.value);
            set({ brandId: null, newBrandName: e.target.value });
          }}
          placeholder="Ex.: Lattafa"
        />
        {suggestions.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((b) => (
              <button
                key={b.id}
                type="button"
                className="press h-9 rounded-full border border-border/70 px-3 text-xs text-muted-foreground"
                onClick={() => {
                  set({ brandId: b.id, newBrandName: "" });
                  setBrandQuery("");
                }}
              >
                {b.canonical_name}
              </button>
            ))}
          </div>
        ) : null}
        {!draft.brandId && draft.newBrandName.trim() ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Nova marca “{draft.newBrandName.trim()}” será criada se ainda não existir.
          </p>
        ) : null}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Volume (ml)">
          <Input
            className="h-11"
            inputMode="numeric"
            value={draft.volume}
            onChange={(e) => set({ volume: e.target.value.replace(/\D/g, "") })}
            placeholder="100"
          />
        </Field>
        <Field label="Concentração">
          <Input
            className="h-11"
            value={draft.concentration}
            onChange={(e) => set({ concentration: e.target.value })}
            placeholder="EDP"
            list="orium-concentracoes"
          />
          <datalist id="orium-concentracoes">
            {CONCENTRATIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="Gênero">
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <Chip key={g.value} active={draft.gender === g.value} onClick={() => set({ gender: g.value })}>
              {g.label}
            </Chip>
          ))}
        </div>
      </Field>

      {/* Preço no site: normal ou sob consulta (WhatsApp) */}
      <Field label="Preço no site">
        <div className="flex flex-wrap gap-2">
          <Chip active={!draft.priceOnRequest} onClick={() => set({ priceOnRequest: false })}>
            Mostrar preço
          </Chip>
          <Chip active={draft.priceOnRequest} onClick={() => set({ priceOnRequest: true, saleMode: "FULL" })}>
            Sob consulta (WhatsApp)
          </Chip>
        </div>
        {draft.priceOnRequest ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No site aparece <b>“Consultar no WhatsApp”</b> no lugar do preço, e o cliente fala direto com a Orium sobre este perfume. Não entra no carrinho.
          </p>
        ) : null}
      </Field>

      {draft.priceOnRequest ? null : (
      <>
      {/* Como este produto será vendido */}
      <Field label="Como este produto será vendido?">
        <div className="flex flex-wrap gap-2">
          {SALE_MODES.map((m) => (
            <Chip key={m.value} active={draft.saleMode === m.value} onClick={() => set({ saleMode: m.value })}>
              {m.label}
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {SALE_MODES.find((m) => m.value === draft.saleMode)?.hint}
        </p>
      </Field>

      {sellsBottle ? (
        <div className="space-y-4 rounded-2xl border border-border/60 bg-surface-2 p-4">
          <p className="text-sm font-medium">Frasco completo</p>

          <div className="flex flex-wrap gap-2">
            <Chip active={draft.manualPricing} onClick={() => set({ manualPricing: true })}>
              Preço manual
            </Chip>
            <Chip active={!draft.manualPricing} onClick={() => set({ manualPricing: false })}>
              Precificação automática
            </Chip>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Custo (opcional)">
              <Input
                className="h-11"
                inputMode="decimal"
                value={draft.cost}
                onChange={(e) => set({ cost: money(e.target.value) })}
                placeholder="0,00"
              />
            </Field>
            <Field label="Estoque (unidades)">
              <Input
                className="h-11"
                inputMode="numeric"
                value={draft.stock}
                onChange={(e) => set({ stock: e.target.value.replace(/\D/g, "") })}
                placeholder="1"
              />
            </Field>
          </div>

          {draft.manualPricing ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Preço de venda">
                <Input
                  className="h-11"
                  inputMode="decimal"
                  value={draft.retailPrice}
                  onChange={(e) => set({ retailPrice: money(e.target.value) })}
                  placeholder="0,00"
                />
              </Field>
              <Field label="Preço no atacado">
                <Input
                  className="h-11"
                  inputMode="decimal"
                  value={draft.wholesalePrice}
                  onChange={(e) => set({ wholesalePrice: money(e.target.value) })}
                  placeholder="opcional"
                />
              </Field>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              O preço será calculado pelo custo mais a margem configurada em Precificação.
            </p>
          )}
        </div>
      ) : null}

      {draft.saleMode !== "FULL" ? (
        <div className="space-y-3 rounded-2xl border border-border/60 bg-surface-2 p-4">
          <p className="text-sm font-medium">Decants</p>

          <div className="flex flex-wrap gap-2">
            <Chip
              active={!customDecant}
              onClick={() => {
                setCustomDecant(false);
                set({ decant2: "", decant5: "", decant10: "" });
              }}
            >
              Preço padrão
            </Chip>
            <Chip active={customDecant} onClick={() => setCustomDecant(true)}>
              Preço só deste perfume
            </Chip>
          </div>

          {customDecant ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {DECANT_SIZES.map((ml) => {
                  const key = ml === 2 ? "decant2" : ml === 5 ? "decant5" : "decant10";
                  return (
                    <Field key={ml} label={`${ml}ml`}>
                      <Input
                        className="h-11"
                        inputMode="decimal"
                        value={draft[key as "decant2" | "decant5" | "decant10"]}
                        onChange={(e) => set({ [key]: money(e.target.value) } as Partial<Draft>)}
                        placeholder={globalDecant(ml)}
                      />
                    </Field>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Deixe vazio para usar o preço padrão daquele tamanho.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Usa os preços gerais da Orium:{" "}
              {DECANT_SIZES.map((ml) => `${ml}ml R$ ${globalDecant(ml)}`).join(" · ")}
            </p>
          )}
        </div>
      ) : null}
      </>
      )}

      <Field label="Disponibilidade">
        <div className="flex flex-wrap gap-2">
          {VISIBILITIES.map((v) => (
            <Chip key={v.value} active={draft.visibility === v.value} onClick={() => set({ visibility: v.value })}>
              {v.label}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Destaque no catálogo">
        <div className="flex flex-wrap gap-2">
          <Chip
            active={draft.pinned && !draft.pinnedNew}
            onClick={() => set({ pinned: true, pinnedNew: false })}
          >
            Fixar no topo
          </Chip>
          <Chip
            active={draft.pinned && draft.pinnedNew}
            onClick={() => set({ pinned: true, pinnedNew: true })}
          >
            Fixar com selo de novidade
          </Chip>
          <Chip active={!draft.pinned} onClick={() => set({ pinned: false, pinnedNew: false })}>
            Sem destaque
          </Chip>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Fixado aparece no começo do catálogo. O selo "Novidade" é opcional.
        </p>
      </Field>

      <Field label="Descrição">
        <Textarea
          rows={4}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Conte em poucas linhas o que faz esse perfume valer a pena."
        />
      </Field>

      <Field label="Link do Fragrantica">
        <Input
          className="h-11"
          value={draft.fragranticaUrl}
          onChange={(e) => set({ fragranticaUrl: e.target.value })
          }
          placeholder="https://www.fragrantica.com/perfume/..."
        />
      </Field>

      {/* Informações olfativas: mesmo sistema dos perfumes do catálogo */}
      {draft.id ? (
        <FragranceEditor productId={draft.id} defaultOpen allowCopyFromCatalog />
      ) : (
        <div className="rounded-2xl border border-border/60 bg-surface-2 p-4">
          <p className="text-sm font-medium">Informações olfativas</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Salve o produto primeiro. Depois abre aqui o mesmo bloco dos perfumes do catálogo:
            Fragrantica, acordes e pirâmide.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Button
          className="press h-12 w-full rounded-full text-sm font-semibold"
          disabled={busy === "save" || !draft.name.trim() || !(draft.brandId || draft.newBrandName.trim())}
          onClick={() => void submit()}
        >
          {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null} Salvar produto
        </Button>
        {draft.id ? (
          <>
            <Button variant="outline" className="press h-11 w-full rounded-full text-sm" onClick={onClose}>
              Concluir
            </Button>
            <Button
              variant="ghost"
              className="press h-11 w-full rounded-full text-sm text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" /> Excluir produto
            </Button>
          </>
        ) : null}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este produto?</AlertDialogTitle>
            <AlertDialogDescription>
              O perfume sai do catálogo, dos favoritos e dos carrinhos. Pedidos antigos continuam
              intactos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy === "delete"}
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
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "press h-10 rounded-full border px-4 text-xs " +
        (active
          ? "border-foreground bg-foreground text-background"
          : "border-border/70 text-muted-foreground")
      }
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-sm">{label}</Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
