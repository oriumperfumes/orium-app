/**
 * Procurar (Figma) — a única tela com busca no app.
 *
 * Vazia: título, campo, sugestões (buscas recentes ou perfumes e marcas) e
 * "Mais procurados". Digitando: chips de filtro e a grade de cards.
 * A busca é por perfume e marca — sem notas.
 * A visibilidade vem do `open` do contexto de
 * busca, então o gesto/botão de voltar do celular também fecha a tela.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Search, X } from "lucide-react";
import { useSearchUI, SEARCH_MIN_CHARS } from "./search-context";
import { useThemeColor } from "@/hooks/use-theme-color";
import { ProductCard, ProductCardSkeleton, type CatalogProduct } from "@/components/orium/ProductCard";
import { useTopViewed } from "@/lib/product-views";
import { rememberProductPreview } from "@/lib/product-preview";
import { brl, productTitle } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useAdminInsightView } from "@/lib/use-admin-insight-view";
import { getAdminCatalogInsight } from "@/lib/admin-insight.functions";
import { cn } from "@/lib/utils";

const DEFAULT_SUGGESTIONS = ["Asad", "Lattafa", "9PM", "Club de Nuit", "Afnan", "Armaf"];

type Filter = "MALE" | "FEMALE" | "UNISEX" | "UP300" | null;
const FILTERS: Array<{ k: Exclude<Filter, null>; l: string }> = [
  { k: "MALE", l: "Masculino" },
  { k: "FEMALE", l: "Feminino" },
  { k: "UNISEX", l: "Unissex" },
  { k: "UP300", l: "Até R$ 300" },
];

export function SearchScreen({
  requestOpen,
  onClosed,
  onChoose,
  minQty,
}: {
  /** pedido de abertura vindo do "Procurar" da barra inferior */
  requestOpen: boolean;
  onClosed: () => void;
  onChoose: (p: CatalogProduct) => void;
  minQty: number;
}) {
  const s = useSearchUI();
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState<Filter>(null);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => setMounted(true), []);

  // "Procurar" tocado → abre; fechou (voltar, ✕, buscar tudo) → avisa a página
  useEffect(() => {
    if (requestOpen && !s.open) s.setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestOpen]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !s.open) onClosed();
    wasOpen.current = s.open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.open]);

  // tela aberta: trava a página, sinaliza a barra inferior e abre o teclado
  useEffect(() => {
    if (!s.open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    html.dataset.searchOpen = "1";
    window.dispatchEvent(new Event("orium:hero-change"));
    const t = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 80);
    // computador: Esc fecha a pesquisa
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") s.close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prev;
      delete html.dataset.searchOpen;
      window.dispatchEvent(new Event("orium:hero-change"));
      window.clearTimeout(t);
    };
  }, [s.open]);

  useEffect(() => setFilter(null), [s.query]);
  // "Início" na barra inferior fecha a busca
  useEffect(() => {
    const close = () => s.close();
    window.addEventListener("orium:close-search", close);
    return () => window.removeEventListener("orium:close-search", close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a barra de status acompanha o fundo da Procurar
  useThemeColor("#101010", s.open);

  const typing = s.term.trim().length >= SEARCH_MIN_CHARS;
  const filtered = useMemo(() => {
    if (!filter) return s.results;
    return s.results.filter((p) =>
      filter === "UP300" ? Number(p.retail_price ?? 0) > 0 && Number(p.retail_price) <= 300 : p.gender_norm === filter,
    );
  }, [s.results, filter]);

  // camada interna da equipe também nos resultados da busca
  const { isStaff } = useAuth();
  const { visible } = useAdminInsightView();
  const showAdmin = isStaff && visible;
  const loadInsight = useServerFn(getAdminCatalogInsight);
  const ids = s.results.map((p) => p.id);
  const { data: insight } = useQuery({
    queryKey: ["admin-insight-search", ids.join(",")],
    enabled: showAdmin && ids.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: () => loadInsight({ data: { productIds: ids } }).catch(() => []),
  });
  const insightById = useMemo(() => new Map((insight ?? []).map((i) => [i.productId, i])), [insight]);

  const openProduct = (p: { slug: string } & Record<string, unknown>) => {
    rememberProductPreview(p);
    s.rememberSearch(s.term);
    s.keepQuery(s.term);
    s.closeForNavigation();
  };

  if (!mounted || !s.open) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Procurar" className="search-page fixed inset-0 z-[45] flex flex-col bg-[#101010] text-white">
      <div className="header-safe min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-xl px-5 pt-4 pb-[calc(8rem+env(safe-area-inset-bottom))] tab:max-w-3xl tab:px-8 tab:pt-10 lg:max-w-[1120px] lg:px-10 lg:pt-14">
          <div className="flex items-center justify-between">
            <h1 className="text-[40px] leading-[1.15] font-bold tracking-[-0.035em] text-white">Procurar</h1>
            <button type="button" onClick={s.close} aria-label="Fechar a pesquisa" className="o-pop-close press">
              <X className="size-4" />
            </button>
          </div>

          {/* campo */}
          <form
            role="search"
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (s.term.trim()) s.submit(s.term);
            }}
          >
            <label
              className={cn(
                "flex h-[58px] items-center gap-3 rounded-full border bg-[#141414] pr-2 pl-5 transition-colors duration-200",
                s.term ? "border-[#FFD599]/70" : "border-white/10 focus-within:border-white/25",
              )}
            >
              <Search className={cn("size-5 shrink-0", s.term ? "text-[#FFD599]" : "text-[#8C8C8C]")} strokeWidth={2.2} />
              <input
                ref={input}
                value={s.term}
                onChange={(e) => s.setTerm(e.target.value)}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                placeholder="Nome do perfume ou marca"
                aria-label="Nome do perfume ou marca"
                className="min-w-0 flex-1 bg-transparent text-[18px] text-white outline-none placeholder:text-[#7A7A7A] [&::-webkit-search-cancel-button]:hidden"
              />
              {s.term ? (
                <button
                  type="button"
                  onClick={() => {
                    s.clear();
                    input.current?.focus();
                  }}
                  aria-label="Apagar"
                  className="o-pop-close press"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </label>
          </form>

          {typing ? (
            <>
              <div className="scrollbar-none -mx-5 mt-4 flex gap-2.5 overflow-x-auto px-5">
                {FILTERS.map((f) => (
                  <button
                    key={f.k}
                    type="button"
                    aria-pressed={filter === f.k}
                    onClick={() => setFilter(filter === f.k ? null : f.k)}
                    className={cn(
                      "press h-11 shrink-0 rounded-full px-5 text-[15px] font-semibold whitespace-nowrap transition-colors duration-200",
                      filter === f.k ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-white hover:bg-[#2A2A2A]",
                    )}
                  >
                    {f.l}
                  </button>
                ))}
              </div>

              {s.loading ? (
                <div className="mt-5">
                  <div className="product-grid">
                    <ProductCardSkeleton />
                    <ProductCardSkeleton />
                  </div>
                </div>
              ) : s.error ? (
                <EmptyState
                  title="Não conseguimos buscar agora"
                  text="Verifique a conexão e tente de novo."
                  action={{ label: "Tentar de novo", onClick: s.retry }}
                />
              ) : filtered.length === 0 ? (
                <EmptyState
                  title={`Nada encontrado para “${s.term.trim()}”`}
                  text={filter ? "Tire o filtro ou tente outra palavra." : "Tente só a marca ou outra grafia do nome."}
                  action={filter ? { label: "Tirar filtro", onClick: () => setFilter(null) } : undefined}
                />
              ) : (
                <div key={s.query + (filter ?? "")} className="search-results">
                  <p className="mt-5 text-[14px] text-[#8C8C8C]">
                    {filtered.length === 1 ? "1 resultado" : `${filtered.length} resultados`}
                  </p>
                  <div className="mt-3 product-grid">
                      {filtered.map((p, i) => (
                        <div
                          key={p.id}
                          onClickCapture={(e) => {
                            // só o toque que abre o perfume fecha a busca (o "Adicionar" não)
                            if ((e.target as HTMLElement).closest("a[href]")) openProduct(p as never);
                          }}
                        >
                          <ProductCard
                            product={p}
                            index={i}
                            minQty={minQty}
                            onChoose={onChoose}
                            adminInsight={showAdmin ? (insightById.get(p.id) ?? null) : null}
                          />
                        </div>
                      ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => s.submit(s.term)}
                    className="press mt-8 flex h-[54px] w-full items-center justify-center gap-1.5 rounded-full bg-[#1F1F1F] text-[16px] font-bold text-white"
                  >
                    Ver todos os resultados <ChevronRight className="size-5" strokeWidth={2.4} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <IdleState onPick={(q) => s.setTerm(q)} recent={s.recent} onOpen={openProduct} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function IdleState({
  onPick,
  recent,
  onOpen,
}: {
  onPick: (q: string) => void;
  recent: string[];
  onOpen: (p: { slug: string } & Record<string, unknown>) => void;
}) {
  const { items, isLoading } = useTopViewed(30, 5);
  const suggestions = recent.length ? recent.slice(0, 6) : DEFAULT_SUGGESTIONS;
  return (
    <div className="search-idle lg:mt-4 lg:grid lg:grid-cols-2 lg:gap-16">
      <div>
      <p className="mt-8 text-[17px] text-[#A9A9A9]">{recent.length ? "Buscas recentes" : "Sugestões"}</p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {suggestions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="press h-12 rounded-full bg-[#1F1F1F] px-5 text-[16px] font-medium text-white transition-colors hover:bg-[#2A2A2A]"
          >
            {q}
          </button>
        ))}
      </div>

      </div>
      <div>
      <h2 className="mt-12 text-[26px] font-bold tracking-[-0.025em] text-white lg:mt-7">Mais procurados</h2>
      <ol className="mt-3">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <li key={i} className="my-3 h-12 skeleton rounded-[12px]" />)
          : items.slice(0, 5).map((p, i) => (
              <li key={p.id} className="border-b border-white/10 last:border-0">
                <Link
                  to="/perfume/$slug"
                  params={{ slug: p.slug }}
                  onClick={() => onOpen(p as never)}
                  className="press flex min-h-[66px] items-center gap-4 py-3"
                >
                  <span className="w-4 text-[17px] font-bold text-[#FFD599] tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-bold text-white">{productTitle(p.canonical_name)}</span>
                    {p.brand ? <span className="block truncate text-[14px] text-[#A9A9A9]">{p.brand}</span> : null}
                  </span>
                  {p.retail_price ? (
                    <span className="text-[16px] font-bold text-white tabular-nums">{brl(Number(p.retail_price))}</span>
                  ) : null}
                  <ChevronRight className="size-5 shrink-0 text-[#8C8C8C]" strokeWidth={2} />
                </Link>
              </li>
            ))}
      </ol>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; onClick: () => void } | undefined;
}) {
  return (
    <div className="py-14 text-center">
      <p className="text-[20px] font-bold tracking-[-0.02em] text-white">{title}</p>
      <p className="mx-auto mt-2 max-w-[30ch] text-[15px] leading-relaxed text-[#A9A9A9]">{text}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="press mt-6 h-11 rounded-full bg-white px-6 text-[14px] font-bold text-[#15130F]"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
