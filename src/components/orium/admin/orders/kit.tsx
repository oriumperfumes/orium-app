/**
 * PEÇAS DO PEDIDO — usadas no "Novo pedido" e no "Editar pedido":
 * vitrine com foto, linha do item (tamanho, quantidade, preço vendido),
 * seletor com pílula deslizante e a animação da foto voando até o pedido.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Check, Loader2, Plus, RotateCcw, Search, Trash2, Minus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { decantPrice, decantUnitCost, type DecantMl } from "@/lib/decants";
import { useServerFn } from "@tanstack/react-start";
import { productCosts } from "@/lib/orders-control.functions";
import { INTERNAL_REASON, productFromConsultOffer } from "@/lib/consult-offers.functions";
import { Collapse } from "@/components/orium/admin/motion";
import { composerSupply, linkOfferToProduct, searchSupplierOffers, type ComposerSupply, type SupplyOption } from "@/lib/composer-supply.functions";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { imgVariant } from "@/lib/product-img";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type Product = {
  id: string;
  canonical_name: string;
  brand: string | null;
  volume_ml: number | null;
  image_url: string | null;
  retail_price: number | null;
  wholesale_price: number | null;
  decant_available: boolean;
  decant_price_2ml: number | null;
  decant_price_5ml: number | null;
  decant_price_10ml: number | null;
  local_stock: number | null;
  gender_norm: string | null;
  /** "interno-consulta" = veio de fornecedor só de consulta; nunca vai ao site. */
  catalog_eligibility_reason?: string | null;
  /** perfume que só existe nos fornecedores de consulta: vira item interno ao entrar no pedido */
  virtualOffers?: SupplyOption[];
};

export type Size = "FULL" | DecantMl;
/**
 * price = preço fixado pelo Admin (null = automático);
 * orig = preço que já estava no pedido (edição), usado enquanto ninguém mexe.
 */
export type Line = {
  key: string;
  product: Product;
  size: Size;
  qty: number;
  price: number | null;
  orig?: number | null;
  lineId?: string | null;
  /** fornecedor escolhido na mão (supplier_products.id); sem ele vale o melhor custo */
  supplierProductId?: string | null;
};

export const WHOLESALE_MIN = 6;
export const SIZES: Size[] = ["FULL", 2, 5, 10];
export const sizeLabel = (s: Size, p?: Product) => (s === "FULL" ? `Frasco${p?.volume_ml ? ` ${p.volume_ml}ml` : ""}` : `${s} ml`);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const nameOf = (p: Product) => productTitle(p.canonical_name);

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "stock", label: "Na loja" },
  { key: "decant", label: "Com decant" },
  { key: "masc", label: "Masculino" },
  { key: "fem", label: "Feminino" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export const lineKeyOf = (productId: string, size: Size) => `${productId}:${size}`;

export function useCatalogProducts() {
  return useQuery({
    queryKey: ["composer-products"],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      ((
        await supabase
          .from("products")
          .select(
            "id, canonical_name, brand, volume_ml, image_url, retail_price, wholesale_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, local_stock, gender_norm, catalog_eligibility_reason",
          )
          .eq("active", true)
          .or(`catalog_eligible.eq.true,catalog_eligibility_reason.eq.${INTERNAL_REASON}`)
          .order("canonical_name")
          .limit(3000)
      ).data ?? []) as Product[],
  });
}

/** De onde comprar cada perfume + perfumes que só existem nos fornecedores de consulta. */
export function useComposerSupply() {
  const load = useServerFn(composerSupply);
  return useQuery<ComposerSupply>({ queryKey: ["composer-supply"], staleTime: 10 * 60_000, queryFn: () => load() });
}

/** Opções de fornecedor de um perfume (já ordenadas: disponível, compra normal, mais barato). */
export const supplyOptionsOf = (supply: ComposerSupply | undefined, p: Product) => p.virtualOffers ?? supply?.byProduct[p.id] ?? [];

/**
 * Custo atual de cada linha (frasco = custo do frasco; decant = parte do
 * frasco + frasquinho). null = custo desconhecido (não bloqueia nada).
 */
export function useLineCost() {
  const load = useServerFn(productCosts);
  const { data } = useQuery({ queryKey: ["product-costs"], queryFn: () => load(), staleTime: 5 * 60_000 });
  return (l: Line): number | null => {
    const bottle = data?.[l.product.id];
    if (!bottle) return null;
    return l.size === "FULL" ? bottle : decantUnitCost(bottle, l.product.volume_ml, l.size);
  };
}

/** Itens do pedido + preços sugeridos (varejo/atacado e decant por tamanho). */
export function useOrderLines(initial: Line[] = [], initialForce = false) {
  const settings = useDecantSettings();
  const [lines, setLines] = useState<Line[]>(initial);
  const bottles = lines.filter((l) => l.size === "FULL").reduce((s, l) => s + l.qty, 0);
  /** atacado automático (6+ frascos) */
  const autoWholesale = bottles >= WHOLESALE_MIN;
  /** atacado combinado na mão (ex.: 2 ou 3 frascos para revender) */
  const [forceWholesale, setForceWholesale] = useState(initialForce);
  const wholesale = autoWholesale || forceWholesale;
  const suggested = (p: Product, s: Size) =>
    s === "FULL"
      ? Number((wholesale ? (p.wholesale_price ?? p.retail_price) : p.retail_price) ?? 0)
      : settings === undefined
        ? 0
        : decantPrice(p as never, settings as never, s);
  /** preço de referência da linha: o que já estava no pedido, ou o sugerido */
  const reference = (l: Line) => l.orig ?? suggested(l.product, l.size);
  const unit = (l: Line) => l.price ?? reference(l);
  const total = lines.reduce((s, l) => s + unit(l) * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);

  /** supplierProductId = fornecedor escolhido na telinha (só frasco) */
  const add = (p: Product, size: Size, supplierProductId?: string | null) =>
    setLines((prev) => {
      const key = lineKeyOf(p.id, size);
      const sp = size === "FULL" ? (supplierProductId ?? undefined) : undefined;
      const hit = prev.find((l) => l.key === key);
      if (hit) return prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1, ...(sp !== undefined ? { supplierProductId: sp } : {}) } : l));
      return [...prev, { key, product: p, size, qty: 1, price: null, supplierProductId: sp ?? null }];
    });
  const patch = (key: string, p: Partial<Line>) =>
    setLines((prev) => {
      const next = prev.map((l) => (l.key === key ? { ...l, ...p } : l));
      // trocou o tamanho: vira outra linha (ou junta com a que já existe)
      const changed = next.find((l) => l.key === key)!;
      const nk = lineKeyOf(changed.product.id, changed.size);
      if (nk !== key) {
        const twin = next.find((l) => l.key === nk);
        if (twin) return next.filter((l) => l.key !== key).map((l) => (l.key === nk ? { ...l, qty: l.qty + changed.qty } : l));
        return next.map((l) => (l.key === key ? { ...l, key: nk, price: null, orig: null, lineId: null } : l));
      }
      return next;
    });
  const remove = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));
  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    lines.forEach((l) => m.set(l.product.id, (m.get(l.product.id) ?? 0) + l.qty));
    return m;
  }, [lines]);

  return { lines, setLines, add, patch, remove, inCart, wholesale, autoWholesale, forceWholesale, setForceWholesale, suggested, reference, unit, total, count, settings };
}

/** A foto do perfume "voa" da vitrine até o contador do pedido (computador ou celular). */
export function useFly() {
  const [bump, setBump] = useState(0);
  const deskTarget = useRef<HTMLSpanElement>(null);
  const mobTarget = useRef<HTMLSpanElement>(null);
  const fly = (img: HTMLElement | null) => {
    const target = (window.matchMedia("(min-width: 64rem)").matches ? deskTarget : mobTarget).current;
    if (!img || !target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setBump((x) => x + 1);
      return;
    }
    const a = img.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const ghost = img.cloneNode(true) as HTMLElement;
    ghost.style.cssText = `position:fixed;left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px;z-index:95;pointer-events:none;border-radius:18px;background:#fff;object-fit:contain;padding:10px`;
    document.body.appendChild(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = ghost.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1, borderRadius: "18px" },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 90}px) scale(0.55) rotate(-8deg)`, opacity: 1, offset: 0.5, borderRadius: "40px" },
        { transform: `translate(${dx}px, ${dy}px) scale(0.12) rotate(-14deg)`, opacity: 0.2, borderRadius: "999px" },
      ],
      { duration: 720, easing: "cubic-bezier(0.45, 0, 0.2, 1)" },
    );
    anim.onfinish = () => {
      ghost.remove();
      setBump((x) => x + 1);
    };
  };
  return { fly, bump, deskTarget, mobTarget };
}

/**
 * Vitrine: busca, filtros, grade de fotos e (no celular) a barra dourada
 * que leva ao pedido.
 */
export function Vitrine({
  hidden,
  inCart,
  wholesale,
  onAdd,
  onFly,
  count,
  total,
  bump,
  mobTarget,
  onOpenOrder,
  autoFocus = true,
}: {
  hidden: boolean;
  inCart: Map<string, number>;
  wholesale: boolean;
  onAdd: (p: Product, s: Size, supplierProductId?: string | null) => void;
  onFly: (img: HTMLElement | null) => void;
  count: number;
  total: number;
  bump: number;
  mobTarget: RefObject<HTMLSpanElement | null>;
  onOpenOrder: () => void;
  autoFocus?: boolean;
}) {
  const settings = useDecantSettings();
  const { data: ours, isPending } = useCatalogProducts();
  const { data: supply } = useComposerSupply();
  const toProduct = useServerFn(productFromConsultOffer);
  const qc = useQueryClient();
  // nossos perfumes + os que só existem nos fornecedores de consulta (fora do site)
  const products = useMemo(() => {
    const extra: Product[] = (supply?.extras ?? []).map((e) => ({
      id: `v:${e.key}`,
      canonical_name: e.name,
      brand: e.brand,
      volume_ml: e.volumeMl,
      image_url: e.imageUrl,
      retail_price: null,
      wholesale_price: null,
      decant_available: false,
      decant_price_2ml: null,
      decant_price_5ml: null,
      decant_price_10ml: null,
      local_stock: 0,
      gender_norm: null,
      virtualOffers: e.offers,
    }));
    return ours ? [...ours, ...extra] : undefined;
  }, [ours, supply]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [limit, setLimit] = useState(48);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus && window.matchMedia("(min-width: 64rem)").matches) setTimeout(() => searchRef.current?.focus(), 380);
  }, [autoFocus]);
  const filtered = useMemo(() => {
    const term = norm(q.trim());
    const words = term.split(/\s+/).filter(Boolean);
    return (products ?? []).filter((p) => {
      if (filter === "stock" && !(Number(p.local_stock ?? 0) > 0)) return false;
      if (filter === "decant" && !p.decant_available) return false;
      if (filter === "masc" && !/masc|male|homem|men/.test(p.gender_norm ?? "")) return false;
      if (filter === "fem" && !/fem|female|mulher|women/.test(p.gender_norm ?? "")) return false;
      if (!words.length) return true;
      const hay = norm(`${p.brand ?? ""} ${p.canonical_name}`);
      return words.every((w) => hay.includes(w));
    });
  }, [products, q, filter]);
  /** perfume só do fornecedor: cria o item interno (uma vez) e põe no pedido */
  const add = async (p: Product, s: Size, sp: string | null) => {
    if (!p.virtualOffers) return onAdd(p, s, sp);
    const chosen = p.virtualOffers.find((o) => o.id === sp) ?? p.virtualOffers[0]!;
    const rest = p.virtualOffers.filter((o) => o.id !== chosen.id);
    const real = (await toProduct({ data: { offerId: chosen.id, alsoIds: rest.map((o) => o.id) } })) as Product;
    onAdd(real, "FULL", sp ?? chosen.id);
    qc.invalidateQueries({ queryKey: ["composer-products"] });
    qc.invalidateQueries({ queryKey: ["composer-supply"] });
  };
  const [open, setOpen] = useState<{ p: Product; img: HTMLElement | null } | null>(null);
  const fly = onFly;
  const step = hidden ? "pedido" : "vitrine";
  const setStep = (_: "pedido") => onOpenOrder();

  return (
        <section className={cn("flex min-h-0 flex-col", step === "pedido" && "max-lg:hidden")} aria-label="Perfumes">
          <div className="shrink-0 px-5 pt-4 lg:px-7 lg:pt-5">
            <label className="flex h-[54px] items-center gap-3 rounded-full bg-[#1F1F1F] px-5 focus-within:ring-2 focus-within:ring-[#FFD599]/50">
              <Search className="size-5 shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
              <input data-slot="input-group-control"
                ref={searchRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setLimit(48);
                }}
                placeholder="Procurar perfume ou marca"
                className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#6F6F6F]"
              />
              {q ? (
                <button type="button" onClick={() => setQ("")} aria-label="Limpar" className="press grid size-8 place-items-center rounded-full bg-[#2E2E2E]">
                  <X className="size-4" />
                </button>
              ) : null}
            </label>
            <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:px-0">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "press h-10 shrink-0 rounded-full px-4 text-[14px] font-semibold transition-colors",
                    filter === f.key ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-[#A9A9A9] hover:text-white",
                  )}
                >
                  {f.label}
                </button>
              ))}
              <span className="ml-auto hidden shrink-0 self-center pl-3 text-[13px] text-[#6F6F6F] tabular-nums sm:block">
                {isPending ? "" : `${filtered.length} perfumes`}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-3 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:px-7 lg:pb-7">
            {isPending ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="admin-skeleton aspect-[3/4] rounded-[24px]" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="grid min-h-[260px] place-items-center text-center">
                <div>
                  <p className="text-[17px] font-bold">Nenhum perfume com “{q}”.</p>
                  <p className="mt-1 text-[14px] text-[#8C8C8C]">Tente só a marca ou parte do nome.</p>
                </div>
              </div>
            ) : (
              <>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {filtered.slice(0, limit).map((p, i) => (
                    <li key={p.id}>
                      <Tile
                        p={p}
                        i={i}
                        qty={inCart.get(p.id) ?? 0}
                        decantFrom={settings === undefined || !p.decant_available ? null : decantPrice(p as never, settings as never, 2)}
                        wholesale={wholesale}
                        onOpen={(img) => setOpen({ p, img })}
                      />
                    </li>
                  ))}
                </ul>
                {filtered.length > limit ? (
                  <button
                    type="button"
                    onClick={() => setLimit((l) => l + 48)}
                    className="press mx-auto mt-5 flex h-11 items-center rounded-full bg-[#1F1F1F] px-6 text-[14px] font-bold text-[#D4D4D4] hover:text-white"
                  >
                    Mostrar mais {Math.min(48, filtered.length - limit)}
                  </button>
                ) : null}
              </>
            )}
          </div>

          {/* celular: barra para ir ao pedido */}
          <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden">
            <button
              type="button"
              onClick={() => setStep("pedido")}
              className="press flex h-[60px] w-full items-center gap-3 rounded-full bg-[#FFD599] pr-6 pl-2 text-[#15130F]"
            >
              <span ref={mobTarget} key={bump} className={cn("grid size-11 place-items-center rounded-full bg-[#15130F] text-[15px] font-bold text-[#FFD599] tabular-nums", bump && "ord-bump")}>
                {count}
              </span>
              <span className="text-[16px] font-bold">{count ? "Ver pedido" : "Pedido vazio"}</span>
              <span className="ml-auto text-[16px] font-bold tabular-nums">{brl(total)}</span>
            </button>
          </div>

          {open ? (
            <SupplySheet
              p={open.p}
              options={supplyOptionsOf(supply, open.p)}
              wholesale={wholesale}
              settings={settings}
              onClose={() => setOpen(null)}
              onPick={async (size, sp) => {
                await add(open.p, size, sp);
                fly(open.img);
              }}
            />
          ) : null}
        </section>
  );
}

/** Cartão da vitrine: foto grande; ao tocar, abre a telinha de fornecedores. */
function Tile({
  p,
  i,
  qty,
  decantFrom,
  wholesale,
  onOpen,
}: {
  p: Product;
  i: number;
  qty: number;
  decantFrom: number | null;
  wholesale: boolean;
  onOpen: (img: HTMLElement | null) => void;
}) {
  const outside = !!p.virtualOffers || p.catalog_eligibility_reason === INTERNAL_REASON;
  const imgRef = useRef<HTMLImageElement>(null);
  const img = imgVariant(p.image_url, "card") ?? p.image_url;
  const bottle = Number((wholesale ? (p.wholesale_price ?? p.retail_price) : p.retail_price) ?? 0);
  return (
    <div className="ord-tile ord-in relative flex h-full flex-col overflow-hidden p-2" style={{ ["--i" as string]: i % 24 }}>
      <button
        type="button"
        onClick={() => onOpen(imgRef.current)}
        className="relative block aspect-square w-full overflow-hidden rounded-[18px] bg-white"
        aria-label={`Adicionar ${nameOf(p)}`}
      >
        {img ? (
          <img ref={imgRef} src={img} alt="" loading="lazy" decoding="async" className="ord-tile-img size-full object-contain p-3" />
        ) : (
          <Monogram p={p} className="size-16 text-[18px]" />
        )}
        {Number(p.local_stock ?? 0) > 0 ? (
          <span className="absolute top-2 left-2 rounded-full bg-[#15130F] px-2 py-0.5 text-[10.5px] font-bold text-[#FFD599]">Na loja · {p.local_stock}</span>
        ) : outside ? (
          <span className="absolute top-2 left-2 rounded-full bg-[#15130F] px-2 py-0.5 text-[10.5px] font-bold text-white">Fora do site</span>
        ) : null}
        <span
          className={cn(
            "absolute right-2 bottom-2 grid size-9 place-items-center rounded-full transition-colors duration-300",
            qty ? "bg-[#FFD599] text-[#15130F]" : "bg-[#15130F] text-white",
          )}
        >
          {qty ? <span className="text-[13px] font-bold">{qty}</span> : <Plus className="size-[18px]" strokeWidth={2.6} />}
        </span>
      </button>
      <div className="flex flex-1 flex-col px-1.5 pt-2.5 pb-1">
        {p.brand ? <p className="truncate text-[11.5px] font-semibold text-[#8C8C8C]">{p.brand}</p> : null}
        <p className="line-clamp-2 text-[14px] leading-snug font-bold">{nameOf(p)}</p>
        <p className="mt-auto pt-2 text-[14px] font-bold tabular-nums">
          {bottle ? brl(bottle) : <span className="text-[#D4D4D4]">Preço livre</span>}
          {p.volume_ml ? <span className="text-[12px] font-semibold text-[#8C8C8C]"> · {p.volume_ml}ml</span> : null}
        </p>
        {p.virtualOffers ? (
          <p className="truncate text-[12px] text-[#8C8C8C]">{[...new Set(p.virtualOffers.map((o) => o.supplier.split(" ")[0]))].join(" · ")}</p>
        ) : null}
        {p.decant_available && decantFrom ? <p className="text-[12px] text-[#8C8C8C] tabular-nums">decant a partir de {brl(decantFrom)}</p> : null}
      </div>
    </div>
  );
}

/** Iniciais da marca no lugar da foto (fundo claro, como a foto do frasco). */
function Monogram({ p, className }: { p: Product; className?: string }) {
  const initials = (p.brand ?? nameOf(p))
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span className="grid size-full place-items-center">
      <span className={cn("grid place-items-center rounded-full bg-[#F2EFEA] font-bold tracking-wide text-[#15130F]", className)}>{initials}</span>
    </span>
  );
}

/**
 * Telinha ao tocar no perfume: de onde vem o FRASCO (cada fornecedor com foto,
 * custo e se tem, ou a loja quando há estoque). Um toque já põe no pedido.
 * Decant sai do frasco da loja física: troca-se o tamanho no item do pedido.
 */
function SupplySheet({
  p,
  options,
  wholesale,
  settings,
  onClose,
  onPick,
}: {
  p: Product;
  options: SupplyOption[];
  wholesale: boolean;
  settings: ReturnType<typeof useDecantSettings>;
  onClose: () => void;
  onPick: (size: Size, supplierProductId: string | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const qc = useQueryClient();
  // fecha com a animação de saída (fundo some, painel desce)
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(onClose, 210);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const go = async (key: string, size: Size, sp: string | null) => {
    if (busy) return;
    setBusy(key);
    try {
      await onPick(size, sp);
      close();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível colocar este perfume.");
      setBusy(null);
    }
  };
  const img = imgVariant(p.image_url, "card") ?? p.image_url;
  const bottle = Number((wholesale ? (p.wholesale_price ?? p.retail_price) : p.retail_price) ?? 0);
  const stock = Number(p.local_stock ?? 0);
  const cheapest = options.filter((o) => o.available && o.cost != null).sort((a, b) => a.cost! - b.cost!)[0]?.id;

  return (
    <div
      className={cn("fixed inset-0 z-[80] flex items-end justify-center sm:items-center", leaving && "ui-leaving pointer-events-none")}
      role="dialog"
      aria-modal="true"
      aria-label={`De onde vem o ${nameOf(p)}`}
    >
      <button type="button" aria-label="Fechar" onClick={close} className="adm-fade absolute inset-0 bg-black/60" />
      <div className="adm-pop relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-[#1A1A1A] sm:max-w-[520px] sm:rounded-[28px]">
        <div className="flex items-start gap-4 p-5 pb-4">
          <span className="grid size-[84px] shrink-0 place-items-center overflow-hidden rounded-[20px] bg-white">
            {img ? <img src={img} alt="" className="size-full object-contain p-2" /> : <Monogram p={p} className="size-12 text-[15px]" />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            {p.brand ? <p className="truncate text-[12.5px] font-semibold text-[#8C8C8C]">{p.brand}</p> : null}
            <p className="line-clamp-2 text-[19px] leading-tight font-bold">{nameOf(p)}</p>
            <p className="mt-1 text-[14px] font-bold tabular-nums text-[#D4D4D4]">
              {bottle ? `${brl(bottle)} no site` : "Preço livre · você define no pedido"}
              {p.volume_ml ? <span className="font-semibold text-[#8C8C8C]"> · {p.volume_ml}ml</span> : null}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Fechar" className="press -mt-1 -mr-1 grid size-10 shrink-0 place-items-center rounded-full bg-[#262626] text-[#D4D4D4] hover:text-white">
            <X className="size-[18px]" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <p className="mb-2 text-[13px] font-bold text-[#A9A9A9]">De onde vem o frasco</p>
          <ul className="ui-cascade space-y-2">
            {stock > 0 ? (
              <li>
                <button
                  type="button"
                  onClick={() => go("loja", "FULL", null)}
                  className="press flex w-full items-center gap-3 rounded-[20px] bg-[#222] p-2.5 pr-4 text-left hover:bg-[#262626]"
                >
                  <span className="grid size-14 shrink-0 place-items-center rounded-[14px] bg-[#15130F] text-[13px] font-bold text-[#FFD599]">Loja</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">Já tenho na loja</span>
                    <span className="block text-[12.5px] text-[#8C8C8C]">{stock} {stock === 1 ? "frasco" : "frascos"} no estoque</span>
                  </span>
                  {busy === "loja" ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5 text-[#D4D4D4]" strokeWidth={2.4} />}
                </button>
              </li>
            ) : null}
            {options.map((o, i) => {
              const oimg = o.imageUrl ?? p.image_url;
              return (
                <li key={o.id} style={{ ["--i" as string]: i + 1 }}>
                  <button
                    type="button"
                    onClick={() => go(o.id, "FULL", o.id)}
                    className={cn("press flex w-full items-center gap-3 rounded-[20px] bg-[#222] p-2.5 pr-4 text-left hover:bg-[#262626]", !o.available && "opacity-60")}
                  >
                    <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-white">
                      {oimg ? <img src={imgVariant(oimg, "thumb") ?? oimg} alt="" loading="lazy" className="size-full object-contain p-1" /> : <Monogram p={p} className="size-9 text-[12px]" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-bold">{o.supplier}</span>
                        {o.id === cheapest && options.length > 1 ? (
                          <span className="shrink-0 rounded-full bg-[#2A2418] px-2 py-0.5 text-[10.5px] font-bold text-[#FFD599]">mais barato</span>
                        ) : null}
                      </span>
                      {o.name ? <span className="block truncate text-[12px] text-[#8C8C8C]">{o.name}</span> : null}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[15px] font-bold tabular-nums">{o.cost != null ? brl(o.cost) : "—"}</span>
                      <span className={cn("block text-[11.5px] font-semibold", o.available ? "text-[#7FCF9F]" : "text-[#FF9A8A]")}>
                        {o.available ? "Disponível" : "Esgotado"}
                      </span>
                    </span>
                    {busy === o.id ? <Loader2 className="size-5 shrink-0 animate-spin" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {!options.length && stock <= 0 ? <p className="rounded-[20px] bg-[#222] px-4 py-4 text-[14px] text-[#A9A9A9]">Nenhum fornecedor ligado a este perfume ainda.</p> : null}

          {!p.virtualOffers ? (
            <>
              <Collapse open={finding}>
                <SupplierFinder
                  productId={p.id}
                  name={nameOf(p)}
                  taken={new Set(options.map((o) => o.id))}
                  onPicked={async (o) => {
                    await qc.invalidateQueries({ queryKey: ["composer-supply"] });
                    await go(o.id, "FULL", o.id);
                  }}
                />
              </Collapse>
              {!finding ? (
                <button type="button" onClick={() => setFinding(true)} className="press mt-2 flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-[#222] text-[13.5px] font-bold text-[#D4D4D4] hover:text-white">
                  <Search className="size-4" /> Procurar em outro fornecedor
                </button>
              ) : null}
            </>
          ) : null}

          {!p.virtualOffers ? (
            <button type="button" onClick={() => go("auto", "FULL", null)} className="press mx-auto mt-4 block text-[13px] font-semibold text-[#8C8C8C] hover:text-white">
              {busy === "auto" ? "Colocando…" : "Pôr no pedido sem escolher (melhor custo)"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Linha do pedido: foto, tamanho, quantidade e o preço vendido (editável). */
export function LineRow({
  l,
  suggested,
  unit,
  onPatch,
  onRemove: removeNow,
  refLabel = "Preço sugerido da loja",
  resetLabel = "Voltar ao sugerido",
  cost = null,
  supply,
}: {
  /** de qual fornecedor comprar este frasco (só aparece quando há opções) */
  supply?: { options: SupplyOption[]; value: string | null; onChange: (id: string) => void };
  /** custo da unidade; preço abaixo dele fica vermelho */
  cost?: number | null;
  l: Line;
  suggested: number;
  unit: number;
  onPatch: (p: Partial<Line>) => void;
  onRemove: () => void;
  refLabel?: string;
  resetLabel?: string;
}) {
  // sai encolhendo antes de sumir da lista
  const [leaving, setLeaving] = useState(false);
  const onRemove = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(removeNow, 320);
  };
  const [text, setText] = useState(() => fmtInput(unit));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(fmtInput(unit));
  }, [unit]);
  const img = imgVariant(l.product.image_url, "thumb") ?? l.product.image_url;
  const sizes: Size[] = l.product.decant_available ? SIZES : ["FULL"];
  const changed = l.price != null && Math.abs(l.price - suggested) >= 0.01;
  const loss = cost != null && unit < cost - 0.009;
  const profit = cost != null ? (unit - cost) * l.qty : null;

  return (
    <li className={cn("ord-line grid", leaving && "is-leaving")}>
      <div className="min-h-0 overflow-hidden">
    <div className="ord-slide rounded-[22px] bg-[#1F1F1F] p-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-[60px] shrink-0 place-items-center overflow-hidden rounded-[16px] bg-white">
          {img ? <img src={img} alt="" className="size-full object-contain p-1.5" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-[#8C8C8C]">{l.product.brand}</p>
          <p className="line-clamp-2 text-[14.5px] leading-snug font-bold">{nameOf(l.product)}</p>
        </div>
        <button type="button" onClick={onRemove} aria-label="Tirar do pedido" className="press -mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-full text-[#8C8C8C] hover:bg-white/[0.06] hover:text-[#FF9A8A]">
          <Trash2 className="size-4" />
        </button>
      </div>

      {sizes.length > 1 ? (
        <Seg small className="mt-3" value={l.size} onChange={(v) => onPatch({ size: v })} options={sizes.map((x) => ({ v: x, label: x === "FULL" ? "Frasco" : `${x}ml` }))} />
      ) : (
        <p className="mt-2.5 text-[12.5px] font-semibold text-[#A9A9A9]">{sizeLabel("FULL", l.product)}</p>
      )}

      {supply && l.size === "FULL" ? <SupplierPick {...supply} productId={l.product.id} name={nameOf(l.product)} /> : null}

      <div className="mt-3 flex items-center gap-2.5">
        <div className="flex h-11 items-center rounded-full bg-[#141414] p-1">
          <button type="button" onClick={() => (l.qty > 1 ? onPatch({ qty: l.qty - 1 }) : onRemove())} aria-label="Menos um" className="press grid size-9 place-items-center rounded-full hover:bg-white/[0.06]">
            <Minus className="size-4" strokeWidth={2.4} />
          </button>
          <span className="w-7 text-center text-[15px] font-bold tabular-nums">{l.qty}</span>
          <button type="button" onClick={() => onPatch({ qty: l.qty + 1 })} aria-label="Mais um" className="press grid size-9 place-items-center rounded-full hover:bg-white/[0.06]">
            <Plus className="size-4" strokeWidth={2.4} />
          </button>
        </div>
        <label className={cn("flex h-11 min-w-0 flex-1 items-center gap-1 rounded-full bg-[#141414] px-4 focus-within:ring-2 focus-within:ring-[#FFD599]/50", changed && "ring-1 ring-[#FFD599]/40", loss && "bg-[#2A1A18] ring-2 ring-[#FF9A8A]/70")}>
          <span className="text-[13px] font-semibold text-[#8C8C8C]">R$</span>
          <input data-slot="input-group-control"
            inputMode="decimal"
            value={text}
            aria-label="Preço vendido por unidade"
            onFocus={(e) => {
              editing.current = true;
              e.currentTarget.select();
            }}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d,.]/g, "");
              setText(v);
              const n = parseBR(v);
              onPatch({ price: n == null ? null : n });
            }}
            onBlur={() => {
              editing.current = false;
              setText(fmtInput(unit));
            }}
            className="min-w-0 flex-1 bg-transparent text-right text-[16px] font-bold tabular-nums outline-none"
          />
          <span className="text-[12px] text-[#8C8C8C]">cada</span>
        </label>
      </div>
      <div className="mt-2 flex items-center justify-between px-1 text-[12.5px]">
        {changed ? (
          <button type="button" onClick={() => onPatch({ price: null })} className="press inline-flex items-center gap-1 font-semibold text-[#FFD599]">
            <RotateCcw className="size-3.5" strokeWidth={2.4} /> {resetLabel} {brl(suggested)}
          </button>
        ) : (
          <span className="text-[#6F6F6F]">{refLabel}</span>
        )}
        <span className="font-bold tabular-nums">{brl(unit * l.qty)}</span>
      </div>
      {profit != null ? (
        <p
          className={cn(
            "mt-2 flex items-center gap-1.5 rounded-[12px] px-3 py-1.5 text-[12px] font-semibold transition-colors duration-300",
            loss ? "bg-[#2A1A18] text-[#FF9A8A]" : profit < (cost ?? 0) * 0.15 * l.qty ? "bg-[#2A2418] text-[#FFD599]" : "bg-[#17251C] text-[#7FCF9F]",
          )}
        >
          {loss ? (
            <>Abaixo do custo! Custa {brl(cost)} · prejuízo de {brl(-profit)}</>
          ) : (
            <>
              Lucro {brl(profit)} · custo {brl(cost)}
              {profit < (cost ?? 0) * 0.15 * l.qty ? " · margem baixa" : ""}
            </>
          )}
        </p>
      ) : null}
    </div>
      </div>
    </li>
  );
}

/**
 * "Comprar de": um botão por fornecedor, com o custo; o escolhido fica branco.
 * "Outro" procura o perfume em qualquer fornecedor e liga ao nosso (fica salvo).
 */
function SupplierPick({
  options,
  value,
  onChange,
  productId,
  name,
}: {
  options: SupplyOption[];
  value: string | null;
  onChange: (id: string) => void;
  productId: string;
  name: string;
}) {
  const [finding, setFinding] = useState(false);
  const qc = useQueryClient();
  return (
    <div className="mt-3">
      <p className="px-1 text-[12px] font-semibold text-[#8C8C8C]">Comprar de</p>
      <div className="-mx-1 mt-1.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {options.slice(0, 8).map((o) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.id)}
              className={cn(
                "press flex h-10 shrink-0 flex-col items-start justify-center rounded-[14px] px-3 text-left transition-colors",
                on ? "bg-white text-[#15130F]" : "bg-[#141414] text-[#D4D4D4] hover:text-white",
                !o.available && !on && "opacity-50",
              )}
            >
              <span className="text-[12.5px] leading-tight font-bold">{o.supplier.split(" ")[0]}</span>
              <span className={cn("text-[11px] leading-tight tabular-nums", on ? "text-[#5A5A5A]" : "text-[#8C8C8C]")}>
                {!o.available ? "esgotado" : o.cost != null ? brl(o.cost) : "a consultar"}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={finding}
          onClick={() => setFinding((v) => !v)}
          className={cn(
            "press flex h-10 shrink-0 items-center gap-1 rounded-[14px] px-3 text-[12.5px] font-bold transition-colors",
            finding ? "bg-[#2A2418] text-[#FFD599]" : "bg-[#141414] text-[#A9A9A9] hover:text-white",
          )}
        >
          <Plus className="size-3.5" strokeWidth={2.6} />
          {options.length ? "Outro" : "Escolher fornecedor"}
        </button>
      </div>
      <Collapse open={finding}>
        <SupplierFinder
          productId={productId}
          name={name}
          taken={new Set(options.map((o) => o.id))}
          onPicked={async (o) => {
            await qc.invalidateQueries({ queryKey: ["composer-supply"] });
            onChange(o.id);
            setFinding(false);
          }}
        />
      </Collapse>
    </div>
  );
}

/** Procura o perfume em qualquer fornecedor e liga a oferta ao nosso perfume. */
function SupplierFinder({
  productId,
  name,
  taken,
  onPicked,
}: {
  productId: string;
  name: string;
  /** ofertas já ligadas a este perfume */
  taken: Set<string>;
  onPicked: (o: SupplyOption) => Promise<void> | void;
}) {
  const [q, setQ] = useState(name);
  const [term, setTerm] = useState(name);
  const [linking, setLinking] = useState<string | null>(null);
  const search = useServerFn(searchSupplierOffers);
  const link = useServerFn(linkOfferToProduct);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data: found, isFetching } = useQuery({
    queryKey: ["supplier-offer-search", term],
    enabled: term.length >= 2,
    staleTime: 60_000,
    queryFn: () => search({ data: { q: term } }),
  });
  const pick = async (o: SupplyOption) => {
    setLinking(o.id);
    try {
      if (!taken.has(o.id)) await link({ data: { offerId: o.id, productId } });
      await onPicked(o);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível ligar este fornecedor.");
    } finally {
      setLinking(null);
    }
  };
  return (
    <div className="mt-2 rounded-[18px] bg-[#141414] p-2">
      <label className="flex h-10 items-center gap-2 rounded-full bg-[#1F1F1F] px-3.5 focus-within:ring-2 focus-within:ring-[#FFD599]/50">
        <Search className="size-4 shrink-0 text-[#8C8C8C]" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome no fornecedor"
          aria-label="Procurar o perfume nos fornecedores"
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[#6F6F6F]"
        />
      </label>
      <ul className="mt-1.5 max-h-[240px] overflow-y-auto">
        {isFetching && !found ? <li className="px-2 py-3 text-[13px] text-[#8C8C8C]">Procurando…</li> : null}
        {found && !found.length ? <li className="px-2 py-3 text-[13px] text-[#8C8C8C]">Nada com esse nome nos fornecedores.</li> : null}
        {(found ?? []).map((o) => {
          const other = !!o.linkedTo && !taken.has(o.id);
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={other || linking != null}
                onClick={() => pick(o)}
                className="press flex w-full items-center gap-2.5 rounded-[12px] px-2 py-2 text-left hover:bg-white/[0.04] disabled:opacity-45"
              >
                <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white">
                  {o.imageUrl ? <img src={o.imageUrl} alt="" loading="lazy" className="size-full object-contain p-0.5" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{o.name}</span>
                  <span className="block truncate text-[11.5px] text-[#8C8C8C]">
                    {o.supplier}
                    {other ? ` · já é de ${o.linkedTo}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] font-bold tabular-nums text-[#D4D4D4]">
                  {linking === o.id ? <Loader2 className="size-4 animate-spin" /> : !o.available ? "esgotado" : o.cost != null ? brl(o.cost) : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Chave "Preço de atacado": liga o atacado mesmo com menos de 6 frascos. */
export function WholesaleToggle({ auto, on, onChange }: { auto: boolean; on: boolean; onChange: (v: boolean) => void }) {
  const active = auto || on;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={auto}
      onClick={() => onChange(!on)}
      title={auto ? `Atacado automático: ${WHOLESALE_MIN}+ frascos` : "Usar preço de atacado neste pedido"}
      className={cn(
        "press flex h-8 shrink-0 items-center gap-2 rounded-full pr-1 pl-3 text-[12.5px] font-bold transition-colors",
        active ? "bg-[#2A2418] text-[#FFD599]" : "bg-[#1F1F1F] text-[#A9A9A9] hover:text-white",
        auto && "cursor-default",
      )}
    >
      {auto ? `Atacado · ${WHOLESALE_MIN}+ frascos` : "Preço de atacado"}
      <span className={cn("relative h-6 w-10 rounded-full transition-colors", active ? "bg-[#FFD599]" : "bg-[#3A3A3A]")}>
        <span className={cn("absolute top-1 size-4 rounded-full bg-[#15130F] transition-[left] duration-200", active ? "left-5" : "left-1")} />
      </span>
    </button>
  );
}

export const fmtInput = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function parseBR(v: string): number | null {
  if (!v.trim()) return null;
  const s = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export const Field = forwardRef<HTMLDivElement, { title: string; children: ReactNode; pulse?: boolean; done?: boolean }>(function Field({ title, children, pulse, done }, ref) {
  return (
    <div ref={ref} className={cn("rounded-[26px] transition-shadow duration-500", pulse && "ord-pulse")}>
      <h3 className="mb-2.5 flex items-center gap-2 text-[17px] font-bold">
        {title}
        <span
          aria-hidden
          className={cn(
            "grid size-5 place-items-center rounded-full transition-[transform,background-color,opacity] duration-500",
            done ? "scale-100 bg-[#7FCF9F] text-[#15130F] opacity-100" : "scale-50 bg-[#2E2E2E] opacity-0",
          )}
        >
          <Check className="size-3" strokeWidth={3.2} />
        </span>
      </h3>
      {children}
    </div>
  );
});

/** Seletor com uma pílula branca que desliza até a opção escolhida. */
export function Seg<T extends string | number>({
  value,
  onChange,
  options,
  className,
  small,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ v: T; label: string }>;
  className?: string;
  small?: boolean;
}) {
  const n = options.length;
  const idx = Math.max(0, options.findIndex((o) => o.v === value));
  return (
    <div className={cn("relative grid rounded-full p-1", small ? "bg-[#141414]" : "bg-[#1F1F1F]", className)} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-1 rounded-full bg-white"
        style={{ width: `calc((100% - 8px) / ${n})`, transform: `translateX(${idx * 100}%)`, transition: "transform 520ms cubic-bezier(0.2, 0.9, 0.1, 1)" }}
      />
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "press relative truncate rounded-full px-2 font-bold transition-colors duration-300",
            small ? "h-8 text-[12.5px]" : "h-10 text-[13.5px]",
            value === o.v ? "text-[#15130F]" : "text-[#A9A9A9] hover:text-white",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}


