import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setPriceView } from "@/lib/decant-size";
import { canFullBottle } from "@/lib/decants";
import { track } from "@/lib/analytics";
import { brl } from "@/lib/format";
import { priceUnit } from "@/lib/promotions";
import { usePromotions } from "@/lib/use-promotions";
import { usePricesOnRequestAll } from "@/lib/price-on-request";
import { cn } from "@/lib/utils";
import { Bottle3D, type Bottle3DModel } from "@/components/orium/home/bottles/Bottle3D";

/**
 * Frascos em 3D de verdade (modelados com as medidas do frasco real e
 * iluminados pelo estúdio do card). Para pôr outro frasco: um modelo em
 * bottles/ + uma linha aqui — preço e nome vêm do banco. `still` é um render
 * do próprio modelo, para aparelhos sem WebGL.
 */
const SPIN_BOTTLES: {
  slug: string;
  model: Bottle3DModel;
  still: string;
  name: string;
  brand: string;
}[] = [
  {
    slug: "armaf-club-de-nuit-intense-man-edt-5920f9",
    model: "club-de-nuit",
    still: "/3d/club-de-nuit-intense-man.webp",
    name: "Club de Nuit Intense Man",
    brand: "Armaf",
  },
];

const COLUMNS =
  "id, slug, canonical_name, brand, volume_ml, retail_price, in_stock, stock_quantity, sale_mode, full_bottle_available, product_type, decant_available, price_on_request";

type Row = {
  id: string;
  slug: string;
  canonical_name: string | null;
  brand: string | null;
  volume_ml: number | null;
  retail_price: number | null;
  in_stock: boolean | null;
  stock_quantity: number | null;
  sale_mode: string | null;
  full_bottle_available: boolean | null;
  product_type: string | null;
  decant_available: boolean | null;
  price_on_request: boolean | null;
};

/** troca sozinho de frasco depois deste tempo sem ninguém mexer */
const AUTO_NEXT_MS = 9000;

/**
 * Card "Frascos" da Home: o frasco girando no dedo, nome, preço real do catálogo
 * e "Ver frascos". Com mais de um frasco, os pontinhos trocam (e troca sozinho
 * quando ninguém está mexendo). Sem nenhum frasco disponível, devolve `fallback`.
 */
export function FrascosSpinCard({
  onExplore,
  total,
  style,
  fallback,
}: {
  onExplore: () => void;
  total?: number | undefined;
  style?: React.CSSProperties;
  fallback: React.ReactNode;
}) {
  const slugs = useMemo(() => SPIN_BOTTLES.map((b) => b.slug), []);
  const { data: rows, isPending } = useQuery({
    queryKey: ["home-spin-bottles", slugs],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(COLUMNS)
        .in("slug", slugs)
        .eq("active", true);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });
  const promotions = usePromotions();
  const onRequestAll = usePricesOnRequestAll();

  // só frascos que existem e estão à venda (enquanto carrega, mostra todos)
  const bottles = useMemo(
    () =>
      SPIN_BOTTLES.map((b) => ({ ...b, row: rows?.find((r) => r.slug === b.slug) ?? null })).filter(
        (b) => isPending || (b.row && canFullBottle(b.row)),
      ),
    [rows, isPending],
  );

  const [index, setIndex] = useState(0);
  const [touched, setTouched] = useState(false);
  const lastTouch = useRef(0);
  const cur = bottles[Math.min(index, Math.max(0, bottles.length - 1))];

  // troca automática (só com 2+ frascos, ninguém mexendo e sem "reduzir movimento")
  useEffect(() => {
    if (bottles.length < 2) return;
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => {
      if (performance.now() - lastTouch.current < AUTO_NEXT_MS * 1.5) return;
      setIndex((i) => (i + 1) % bottles.length);
    }, AUTO_NEXT_MS);
    return () => window.clearInterval(id);
  }, [bottles.length]);

  if (!isPending && !bottles.length) return <>{fallback}</>;
  if (!cur) return <>{fallback}</>;

  const row = cur.row;
  // loja (ou este perfume) em "preços sob consulta": igual ao card de produto
  const consult = !!row && (onRequestAll || row.price_on_request === true);
  const priced =
    row && !onRequestAll && !row.price_on_request && row.retail_price != null
      ? priceUnit(Number(row.retail_price), promotions, { productId: row.id, variant: "FULL" })
      : null;

  return (
    <section
      style={style}
      aria-label="Frascos completos"
      className="home-card relative flex flex-col items-center overflow-hidden rounded-[28px] bg-[#0C0C0C] px-5 pt-9 pb-6 text-center text-white ring-1 ring-white/[0.06] tab:rounded-[32px]"
    >
      <h2 className="text-[36px] leading-[1.04] font-bold tracking-[-0.035em]">Frascos</h2>
      <p className="mt-3 max-w-[290px] text-[16.5px] leading-[1.4] text-[#A9A9A9]">
        A fragrância completa.{total ? <span className="value-in"> {total} perfumes.</span> : null}
      </p>

      <div
        className="relative mt-2 h-[340px] w-full max-w-[380px] tab:h-[360px]"
        onPointerDown={() => {
          setTouched(true);
          lastTouch.current = performance.now();
        }}
      >
        {bottles.map((b, i) => {
          const on = b.slug === cur.slug;
          const before = i < bottles.indexOf(cur);
          return (
            <div
              key={b.slug}
              aria-hidden={!on}
              className={cn(
                "absolute inset-0 transition-[opacity,transform] duration-[640ms] ease-[var(--ease-orium)]",
                on
                  ? "translate-x-0 scale-100 opacity-100"
                  : cn(
                      "pointer-events-none scale-[0.96] opacity-0",
                      before ? "-translate-x-10" : "translate-x-10",
                    ),
              )}
            >
              <Bottle3D
                model={b.model}
                still={b.still}
                alt={`${b.brand} ${b.name} em 3D. Arraste para girar.`}
                active={on}
                className="h-full w-full"
              />
            </div>
          );
        })}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-1 text-[12px] font-medium text-[#6E6E6E] transition-opacity duration-500",
            touched && "opacity-0",
          )}
        >
          Arraste para girar
        </span>
      </div>

      {/* nome e preço: tocar abre o perfume */}
      <Link
        key={cur.slug}
        to="/perfume/$slug"
        params={{ slug: cur.slug }}
        onClick={() =>
          track("discovery_clicked", { meta: { card: "frascos_360", slug: cur.slug } })
        }
        className="value-in press mt-2 flex flex-col items-center rounded-2xl px-3 py-1"
      >
        <span className="text-[13px] font-medium tracking-[0.02em] text-[#8C8C8C]">
          {row?.brand ?? cur.brand}
        </span>
        <span className="mt-0.5 text-[17px] leading-tight font-semibold text-white">
          {cur.name}
        </span>
        <span className="mt-1.5 flex items-baseline gap-2 text-[14px] text-[#A9A9A9]">
          {priced ? (
            <>
              {priced.promotion && priced.basePrice > priced.finalPrice ? (
                <s className="tabular-nums">{brl(priced.basePrice)}</s>
              ) : null}
              <strong className="text-[16px] font-bold text-white tabular-nums">
                {brl(priced.finalPrice)}
              </strong>
            </>
          ) : consult ? (
            <strong className="text-[16px] font-bold text-[#FFD599]">Sob consulta</strong>
          ) : null}
          {row?.volume_ml ? (
            <span>
              {priced || consult ? "· " : ""}
              {row.volume_ml} ml
            </span>
          ) : null}
        </span>
      </Link>

      {bottles.length > 1 ? (
        <div role="tablist" aria-label="Escolher frasco" className="mt-3 flex items-center gap-1.5">
          {bottles.map((b, i) => (
            <button
              key={b.slug}
              type="button"
              role="tab"
              aria-selected={b.slug === cur.slug}
              aria-label={b.name}
              onClick={() => {
                setIndex(i);
                lastTouch.current = performance.now();
              }}
              className="flex h-6 items-center px-0.5"
            >
              <span
                className={cn(
                  "block h-1.5 rounded-full transition-all duration-300 ease-[var(--ease-orium)]",
                  b.slug === cur.slug ? "w-5 bg-white" : "w-1.5 bg-[#3A3A3A]",
                )}
              />
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setPriceView("frasco");
          track("discovery_clicked", { meta: { card: "frascos" } });
          onExplore();
        }}
        className="press mt-5 inline-flex h-[46px] items-center rounded-full bg-[#FFD599] px-6 text-[15px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]"
      >
        Ver frascos
      </button>
    </section>
  );
}
