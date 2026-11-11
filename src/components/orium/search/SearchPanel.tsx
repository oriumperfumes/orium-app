import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Clock, Search as SearchIcon } from "lucide-react";
import { ProductImage, type CatalogProduct } from "@/components/orium/ProductCard";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePriceView } from "@/lib/decant-size";
import { useDecantSettings } from "@/lib/use-decant-settings";
import { canDecant, canFullBottle, decantPrice } from "@/lib/decants";
import { rememberProductPreview, warmProductImage } from "@/lib/product-preview";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useSearchUI, SEARCH_MIN_CHARS } from "./search-context";
import { useAnchoredPanel } from "./useAnchoredPanel";

/** Destaca discretamente o trecho que o cliente digitou. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (q.length < 2) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-gold">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

/** Preço do resultado no modo atual do catálogo (2ml / 5ml / 10ml / frasco). */
function ResultPrice({ product }: { product: CatalogProduct }) {
  const view = usePriceView();
  const settings = useDecantSettings();
  const decant = canDecant(product as never) && view !== "frasco";
  const value = decant
    ? decantPrice(product as never, settings, view as 2 | 5 | 10)
    : canFullBottle(product as never) && product.retail_price != null
      ? Number(product.retail_price)
      : null;
  if (value == null) return null;
  return (
    <span className="shrink-0 text-right">
      <span className="block text-sm font-semibold text-gold tabular-nums">{brl(value)}</span>
      {decant ? <span className="block text-[10px] text-muted-foreground">{view}ml</span> : null}
    </span>
  );
}

/**
 * PAINEL DE RESULTADOS DA BUSCA.
 *
 * Renderizado por portal no <body>: nunca é cortado por card, header, grid,
 * overflow ou transform. Posição, largura e altura vêm do motor de ancoragem,
 * por isso o painel acompanha a barra visível (inclusive a encaixada no topo) e
 * se adapta ao teclado do celular.
 */
export function SearchPanel() {
  const {
    term,
    query,
    results,
    loading,
    error,
    retry,
    open,
    close,
    closeForNavigation,
    submit,
    clear,
    activeIndex,
    setActiveIndex,
    anchor,
    recent,
    forgetRecent,
    setTerm,
    rememberSearch,
    keepQuery,
  } = useSearchUI();

  const hasQuery = query.length >= SEARCH_MIN_CHARS;
  const showRecent = !hasQuery && recent.length > 0;
  const visible = open && Boolean(anchor) && (hasQuery || showRecent);

  const box = useAnchoredPanel(anchor, visible, [results.length, loading, error, showRecent]);
  // enquanto o painel está aberto, o dedo rola só a lista
  useBodyScrollLock(visible);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // um diálogo aberto acima da busca tem prioridade
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]')) return;
      close();
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.tagName === "INPUT") el.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, close]);

  /** mantém o item selecionado pelo teclado sempre visível */
  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  /**
   * Arrastar não é clicar: se o dedo andou pela lista, o toque não abre perfume.
   */
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const onPointerDown = (e: ReactPointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
    dragged.current = false;
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const s = start.current;
    if (!s) return;
    if (Math.abs(e.clientX - s.x) > 10 || Math.abs(e.clientY - s.y) > 10) dragged.current = true;
  };

  /**
   * TOCAR FORA FECHA O PAINEL — sem cortina por cima da tela.
   *
   * Nada de fundo que capture o toque: assim o botão de filtros e a própria
   * barra continuam funcionando com o painel aberto. Um toque fora fecha o
   * painel e é engolido, então não aciona o card que estava atrás.
   */
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!visible) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      // a barra e o botão de filtros seguem clicáveis
      if (t.closest('form[role="search"]')) return;

      e.preventDefault();
      e.stopPropagation();
      (document.activeElement as HTMLElement | null)?.blur();
      const swallow = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      const opts = { capture: true, once: true } as AddEventListenerOptions;
      window.addEventListener("click", swallow, opts);
      window.addEventListener("pointerup", swallow, opts);
      window.addEventListener("touchend", swallow, opts);
      window.setTimeout(() => {
        window.removeEventListener("click", swallow, true);
        window.removeEventListener("pointerup", swallow, true);
        window.removeEventListener("touchend", swallow, true);
      }, 400);
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [visible, close]);

  if (typeof document === "undefined" || !visible) return null;

  return createPortal(
    <>
      <div
        ref={panelRef}
        role="listbox"
        id="orium-search-results"
        aria-label="Resultados da busca"
        style={{
          top: box.top,
          left: box.left,
          width: box.width,
          maxHeight: box.maxHeight,
          visibility: box.ready ? "visible" : "hidden",
        }}
        className="card-surface r-card animate-fade-in fixed z-[61] flex flex-col overflow-hidden border border-border/70 shadow-lift"
        // o clique do mouse no painel não tira o foco do campo
        onMouseDown={(e) => e.preventDefault()}
      >
        <div
          ref={listRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onClickCapture={(e) => {
            if (dragged.current) {
              e.preventDefault();
              e.stopPropagation();
              dragged.current = false;
            }
          }}
          className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
        >
          {showRecent ? (
            <>
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <span className="text-[10.5px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Recentes</span>
              <button
                type="button"
                className="press rounded-full px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  if (window.confirm("Limpar histórico de pesquisa?")) forgetRecent();
                }}
              >
                Limpar histórico
              </button>
            </div>
            <ul className="divide-y divide-border/50">
              {recent.map((r) => (
                <li key={r}>
                  <button
                    type="button"
                    onClick={() => {
                      setTerm(r);
                      submit(r);
                    }}
                    className="press flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <Clock className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{r}</span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
            </>
          ) : error ? (
            <div className="p-4">
              <p className="text-sm">Não conseguimos buscar agora.</p>
              <button
                type="button"
                onClick={retry}
                className="press mt-3 rounded-full border border-border/70 px-4 py-2 text-sm font-medium"
              >
                Tentar novamente
              </button>
            </div>
          ) : results.length === 0 && loading ? (
            <div className="divide-y divide-border/50">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <div className="skeleton size-12 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="skeleton h-3 w-1/3 rounded" />
                    <div className="skeleton h-3 w-2/3 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Nenhum perfume encontrado para “{query}”.</p>
              <button
                type="button"
                onClick={clear}
                className="press mt-3 rounded-full border border-border/70 px-4 py-2 text-sm font-medium"
              >
                Limpar busca
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {results.map((p, i) => (
                <li key={p.id}>
                  <Link
                    to="/perfume/$slug"
                    params={{ slug: p.slug }}
                    role="option"
                    data-idx={i}
                    id={`orium-search-opt-${i}`}
                    aria-selected={i === activeIndex}
                    onPointerEnter={() => setActiveIndex(i)}
                    onClick={() => {
                      rememberProductPreview(p as unknown as { slug: string } & Record<string, unknown>);
                      warmProductImage(p.image_url);
                      rememberSearch(term);
                      keepQuery(term);
                      closeForNavigation();
                    }}
                    className={cn(
                      "press flex min-h-[68px] items-center gap-3 px-4 py-3 transition-colors",
                      i === activeIndex ? "bg-surface-2" : "hover:bg-surface-2",
                    )}
                  >
                    <ProductImage product={p} variant="thumb" className="size-12 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] tracking-wide text-muted-foreground uppercase">
                        {p.brand ?? "—"}
                      </span>
                      <span className="line-clamp-2 text-sm leading-snug font-medium">
                        <Highlight text={p.canonical_name} query={query} />
                      </span>
                    </span>
                    <ResultPrice product={p} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {hasQuery && (results.length > 0 || loading) ? (
          <button
            type="button"
            onClick={() => submit(query)}
            className="press flex shrink-0 items-center justify-center gap-2 border-t border-border/60 px-4 py-3 text-sm font-medium text-gold"
          >
            <SearchIcon className="size-4" />
            Ver todos os resultados
          </button>
        ) : null}

        <span aria-live="polite" className="sr-only">
          {hasQuery && !loading ? `${results.length} resultados encontrados.` : ""}
        </span>
      </div>
    </>,
    document.body,
  );
}
