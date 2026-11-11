/**
 * PEÇAS DO PEDIDO — usadas no "Novo pedido" e no "Editar pedido":
 * vitrine com foto, linha do item (tamanho, quantidade, preço vendido),
 * seletor com pílula deslizante e a animação da foto voando até o pedido.
 */
import { useQuery } from "@tanstack/react-query";
import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Check, Plus, RotateCcw, Search, Trash2, Minus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { decantPrice, decantUnitCost, type DecantMl } from "@/lib/decants";
import { useServerFn } from "@tanstack/react-start";
import { productCosts } from "@/lib/orders-control.functions";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { imgVariant } from "@/lib/product-img";
import { brl, productTitle } from "@/lib/format";
import { cn } from "@/lib/utils";

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
};

export type Size = "FULL" | DecantMl;
/**
 * price = preço fixado pelo Admin (null = automático);
 * orig = preço que já estava no pedido (edição), usado enquanto ninguém mexe.
 */
export type Line = { key: string; product: Product; size: Size; qty: number; price: number | null; orig?: number | null; lineId?: string | null };

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
            "id, canonical_name, brand, volume_ml, image_url, retail_price, wholesale_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, local_stock, gender_norm",
          )
          .eq("active", true)
          .eq("catalog_eligible", true)
          .order("canonical_name")
          .limit(3000)
      ).data ?? []) as Product[],
  });
}

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
export function useOrderLines(initial: Line[] = []) {
  const settings = useDecantSettings();
  const [lines, setLines] = useState<Line[]>(initial);
  const bottles = lines.filter((l) => l.size === "FULL").reduce((s, l) => s + l.qty, 0);
  const wholesale = bottles >= WHOLESALE_MIN;
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

  const add = (p: Product, size: Size) =>
    setLines((prev) => {
      const key = lineKeyOf(p.id, size);
      const hit = prev.find((l) => l.key === key);
      if (hit) return prev.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { key, product: p, size, qty: 1, price: null }];
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

  return { lines, setLines, add, patch, remove, inCart, wholesale, suggested, reference, unit, total, count, settings };
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
  onAdd: (p: Product, s: Size) => void;
  onFly: (img: HTMLElement | null) => void;
  count: number;
  total: number;
  bump: number;
  mobTarget: RefObject<HTMLSpanElement | null>;
  onOpenOrder: () => void;
  autoFocus?: boolean;
}) {
  const settings = useDecantSettings();
  const { data: products, isPending } = useCatalogProducts();
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
  const add = onAdd;
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
                      <Tile p={p} i={i} qty={inCart.get(p.id) ?? 0} decantFrom={settings === undefined ? null : decantPrice(p as never, settings as never, 2)} wholesale={wholesale} onAdd={add} onFly={fly} />
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
        </section>
  );
}

/** Cartão da vitrine: foto grande; ao tocar, escolhe frasco ou decant. */
function Tile({
  p,
  i,
  qty,
  decantFrom,
  wholesale,
  onAdd,
  onFly,
}: {
  p: Product;
  i: number;
  qty: number;
  decantFrom: number | null;
  wholesale: boolean;
  onAdd: (p: Product, s: Size) => void;
  onFly: (img: HTMLElement | null) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const [flash, setFlash] = useState(false);
  const img = imgVariant(p.image_url, "card") ?? p.image_url;
  const bottle = Number((wholesale ? (p.wholesale_price ?? p.retail_price) : p.retail_price) ?? 0);
  const pick = (s: Size) => {
    onFly(imgRef.current);
    onAdd(p, s);
    setChoosing(false);
    setFlash(true);
    setTimeout(() => setFlash(false), 900);
  };
  return (
    <div className="ord-tile ord-in relative flex h-full flex-col overflow-hidden p-2" style={{ ["--i" as string]: i % 24 }}>
      <button
        type="button"
        onClick={() => (p.decant_available ? setChoosing(true) : pick("FULL"))}
        className="relative block aspect-square w-full overflow-hidden rounded-[18px] bg-white"
        aria-label={`Adicionar ${nameOf(p)}`}
      >
        {img ? <img ref={imgRef} src={img} alt="" loading="lazy" decoding="async" className="ord-tile-img size-full object-contain p-3" /> : null}
        {Number(p.local_stock ?? 0) > 0 ? (
          <span className="absolute top-2 left-2 rounded-full bg-[#15130F] px-2 py-0.5 text-[10.5px] font-bold text-[#FFD599]">Na loja · {p.local_stock}</span>
        ) : null}
        <span
          className={cn(
            "absolute right-2 bottom-2 grid size-9 place-items-center rounded-full text-[#15130F] transition-[background-color,transform] duration-300",
            flash ? "scale-110 bg-[#7FCF9F]" : qty ? "bg-[#FFD599]" : "bg-[#15130F] text-white",
          )}
        >
          {flash ? <Check className="size-[18px]" strokeWidth={3} /> : qty ? <span className="text-[13px] font-bold">{qty}</span> : <Plus className="size-[18px]" strokeWidth={2.6} />}
        </span>
      </button>
      <div className="flex flex-1 flex-col px-1.5 pt-2.5 pb-1">
        {p.brand ? <p className="truncate text-[11.5px] font-semibold text-[#8C8C8C]">{p.brand}</p> : null}
        <p className="line-clamp-2 text-[14px] leading-snug font-bold">{nameOf(p)}</p>
        <p className="mt-auto pt-2 text-[14px] font-bold tabular-nums">
          {bottle ? brl(bottle) : "—"}
          {p.volume_ml ? <span className="text-[12px] font-semibold text-[#8C8C8C]"> · {p.volume_ml}ml</span> : null}
        </p>
        {p.decant_available && decantFrom ? <p className="text-[12px] text-[#8C8C8C] tabular-nums">decant a partir de {brl(decantFrom)}</p> : null}
      </div>

      {choosing ? (
        <div className="adm-fade absolute inset-0 z-10 flex flex-col bg-[#15130F]/95 p-3" onClick={() => setChoosing(false)}>
          <p className="line-clamp-2 px-1 pt-1 text-[13.5px] leading-snug font-bold">{nameOf(p)}</p>
          <div className="mt-auto grid gap-1.5" onClick={(e) => e.stopPropagation()}>
            {SIZES.map((s) => (
              <button
                key={String(s)}
                type="button"
                onClick={() => pick(s)}
                className={cn(
                  "press adm-pop flex h-11 items-center justify-between rounded-full px-4 text-[13.5px] font-bold transition-colors",
                  s === "FULL" ? "bg-[#FFD599] text-[#15130F] hover:bg-[#FFDDAA]" : "bg-[#2A2A2A] text-white hover:bg-[#333]",
                )}
              >
                {sizeLabel(s, p)}
                <Plus className="size-4" strokeWidth={2.6} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
}: {
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

