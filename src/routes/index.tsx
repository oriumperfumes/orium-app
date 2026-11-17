import { createFileRoute, useNavigate, useRouter, Link } from "@tanstack/react-router";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { withQueryTimeout } from "@/lib/request-timeout";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { SiteHeader } from "@/components/orium/SiteHeader";
import { SiteFooter } from "@/components/orium/SiteFooter";
import {
  ProductCard,
  ProductCardSkeleton,
  ProductImage,
  type CatalogProduct,
} from "@/components/orium/ProductCard";
import { SORT_OPTIONS, type SortKey } from "@/components/orium/filters-options";
import { lazyUI, MountWhen, useIdlePrefetch } from "@/lib/lazy-ui";
import { HomeHero } from "@/components/orium/HomeHero";
import { smoothScrollToEl } from "@/lib/smooth-scroll";
import { SortMenu } from "@/components/orium/SortMenu";
import { HomeBrands } from "@/components/orium/HomeBrands";
import { HomeContact } from "@/components/orium/HomeContact";
import { HomeShortcuts } from "@/components/orium/HomeShortcuts";
import { QuickCategories, type QuickItem } from "@/components/orium/QuickCategories";

import { BestSellersRow } from "@/components/orium/BestSellersRow";
import { NegotiationShowcase, useHasNegotiation } from "@/components/orium/NegotiationShowcase";
import { HomeCampaigns } from "@/components/orium/HomeCampaigns";
import { BlackShowcase } from "@/components/orium/black/BlackShowcase";
import { Button } from "@/components/ui/button";
import { TYPE_LABEL, GENDER_LABEL, type ProductType, type Gender } from "@/lib/catalog/classify";
import { trackDecant, type DecantMl } from "@/lib/decants";
import { track } from "@/lib/analytics";
import { setPriceView, usePriceView } from "@/lib/decant-size";


import { useAuth } from "@/lib/auth";
import { useAdminInsightView } from "@/lib/use-admin-insight-view";
import { getAdminCatalogInsight } from "@/lib/admin-insight.functions";
import { cn } from "@/lib/utils";
import { useRouteMotion } from "@/lib/route-motion";
import { SearchProvider } from "@/components/orium/search/search-context";
// Descarrega a tela de pesquisa do bundle inicial sem modificar as animações.
const SearchScreen = lazyUI(() => import("@/components/orium/search/SearchScreen").then((m) => ({ default: m.SearchScreen })));
import { rememberProductPreview, warmProductImage, warmProductRoute } from "@/lib/product-preview";


import { useSearchIntent } from "@/lib/search-intent";
import { SearchExactResult } from "@/components/orium/SearchExactResult";
import { usePublicPricingSettings } from "@/lib/pricing-settings";
import { takeCatalogPrefetch } from "@/lib/catalog-prefetch";

// gavetas abertas sob demanda: fora do carregamento inicial da Home
const FiltersSheet = lazyUI(() => import("@/components/orium/FiltersSheet").then((m) => ({ default: m.FiltersSheet })));
const BuySheet = lazyUI(() => import("@/components/orium/BuySheet").then((m) => ({ default: m.BuySheet })));
const DecantOfferSheet = lazyUI(() =>
  import("@/components/orium/DecantOfferSheet").then((m) => ({ default: m.DecantOfferSheet })),
);


/**
 * Filtros do catálogo vivem na URL: assim o cliente pode abrir um perfume e
 * voltar exatamente para a mesma busca, com os mesmos filtros e a mesma
 * posição de rolagem (o histórico do navegador guarda o endereço completo).
 */
/** termo da busca guardado ao abrir um perfume (voltar restaura). */
const RESUME_KEY = "orium-search-resume";

export type CatalogSearch = {
  q?: string | undefined;
  type?: string | undefined;
  gender?: string | undefined;
  brand?: string | undefined;
  disp?: "todos" | "em-estoque" | "sem-estoque" | undefined;
  sort?: SortKey | undefined;
  pmin?: number | undefined;
  pmax?: number | undefined;
  ac?: string[] | undefined;
  /**
   * "catalogo" = catálogo completo (rolagem infinita, sem a abertura da Home).
   * É a porta do "Ver tudo"; quando a tela própria do Catálogo existir, ela
   * assume este papel e este parâmetro vira só o endereço dela.
   */
  ver?: "catalogo" | undefined;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const num = (v: unknown) => {
  const n = Number(v);
  return v === "" || v == null || !Number.isFinite(n) ? undefined : n;
};

export const Route = createFileRoute("/")({
  validateSearch: (raw: Record<string, unknown>): CatalogSearch => {
    const disp = str(raw['disp']);
    const ac = Array.isArray(raw['ac'])
      ? raw['ac'].filter((x): x is string => typeof x === "string" && x.length > 0)
      : typeof raw['ac'] === "string" && raw['ac']
        ? [raw['ac']]
        : [];
    return {
      q: str(raw['q']),
      type: str(raw['type']),
      gender: str(raw['gender']),
      brand: str(raw['brand']),
      disp: disp === "em-estoque" || disp === "sem-estoque" ? disp : undefined,
      sort: str(raw['sort']) as SortKey | undefined,
      pmin: num(raw['pmin']),
      pmax: num(raw['pmax']),
      ...(ac.length ? { ac } : {}),
      ...(raw['ver'] === "catalogo" ? { ver: "catalogo" as const } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Orium Perfumes — Decants 2ml, 5ml e 10ml e perfumes importados" },
      {
        name: "description",
        content:
          "Experimente antes de comprar: decants de 2ml, 5ml e 10ml a partir de R$ 19,90, além de perfumes importados, body splash e hidratantes com preço de varejo e atacado.",
      },
      { property: "og:title", content: "Orium Perfumes — Decants e perfumes importados" },
      {
        property: "og:description",
        content: "Decants 2ml • 5ml • 10ml e frascos completos com preço de varejo e atacado a partir de 6 unidades.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Catalog,
});

/** Só o que difere do padrão fica no endereço — a URL segue curta e limpa. */
const cleanSearch = (s: CatalogSearch): CatalogSearch => ({
  ...(s.q ? { q: s.q } : {}),
  ...(s.type && s.type !== "todos" ? { type: s.type } : {}),
  ...(s.gender && s.gender !== "todos" ? { gender: s.gender } : {}),
  ...(s.brand && s.brand !== "todas" ? { brand: s.brand } : {}),
  ...(s.disp && s.disp !== "todos" ? { disp: s.disp } : {}),
  ...(s.sort && s.sort !== "relevantes" ? { sort: s.sort } : {}),
  ...(s.pmin != null ? { pmin: s.pmin } : {}),
  ...(s.pmax != null ? { pmax: s.pmax } : {}),
  ...(s.ac && s.ac.length ? { ac: s.ac } : {}),
  ...(s.ver === "catalogo" ? { ver: "catalogo" as const } : {}),
});


const PAGE_SIZE = 24;

/** Ordem de exibição dos tipos; só aparecem os que tiverem produto. */
const TYPE_ORDER: ProductType[] = [
  "PERFUME",
  "BODY_SPLASH",
  "BODY_MOISTURIZER",
  "BODY_CREAM",
  "BODY_LOTION",
  "COSMETIC",
];
const GENDER_ORDER: Gender[] = ["MALE", "FEMALE", "UNISEX"];

/** Filtros principais de categoria — poucos, claros e em uma única linha. */
const BODY_TYPES: ProductType[] = ["BODY_MOISTURIZER", "BODY_CREAM", "BODY_LOTION", "COSMETIC"];
const MAIN_GROUPS = [
  { key: BODY_TYPES.join(","), label: "Pastas / Hidratantes", types: BODY_TYPES },
  { key: "BODY_SPLASH", label: "Body Splash", types: ["BODY_SPLASH" as ProductType] },
];

/** Nome amigável de um filtro de tipo, simples ou agrupado. */
const typeLabel = (value: string) =>
  MAIN_GROUPS.find((g) => g.key === value)?.label ?? TYPE_LABEL[value as ProductType] ?? value;

type FacetRow = {
  brand: string | null;
  product_type: string | null;
  gender_norm: string | null;
  in_stock: boolean;
  decant_available: boolean;
};

function Catalog() {
  const sp = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const gridRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const priceView = usePriceView();

  /**
   * Trocar filtro devolve o cliente ao topo real da página (a logo volta a
   * aparecer), não ao começo da lista. Descobrimos qual elemento realmente
   * rola — pode ser um container com overflow, não a janela.
   */
  const topLockUntil = useRef(0);
  const scrollToTop = useCallback(() => {
    if (typeof window === "undefined") return;
    const findScroller = (): HTMLElement | null => {
      let node: HTMLElement | null = gridRef.current?.parentElement ?? null;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        const scrolls = /(auto|scroll|overlay)/.test(`${style.overflowY}`);
        if (scrolls && node.scrollHeight > node.clientHeight + 4) return node;
        node = node.parentElement;
      }
      return null;
    };
    const scroller = findScroller();
    const at = () => (scroller ? scroller.scrollTop : window.scrollY);
    const jump = (behavior: ScrollBehavior) => {
      if (scroller) scroller.scrollTo({ top: 0, behavior });
      else window.scrollTo({ top: 0, behavior });
    };
    if (at() <= 1) return;

    // 1. vai direto ao topo real (instantâneo: nada interrompe no meio)
    jump("auto");

    // 2. nenhum render/restauração/foco posterior empurra a tela de volta:
    //    por ~1.2s qualquer posição diferente de 0 é desfeita.
    topLockUntil.current = Date.now() + 1200;
    let raf = 0;
    const release = () => {
      topLockUntil.current = 0;
      cancelAnimationFrame(raf);
      for (const ev of ["wheel", "touchmove"]) window.removeEventListener(ev, release);
    };
    // o gesto do cliente sempre vence a trava
    for (const ev of ["wheel", "touchmove"]) window.addEventListener(ev, release, { passive: true });
    const guard = () => {
      if (Date.now() >= topLockUntil.current) return release();
      if (at() > 1) jump("auto");
      raf = requestAnimationFrame(guard);
    };
    raf = requestAnimationFrame(guard);
  }, []);
  const scrollToResults = scrollToTop;

  /** Toda troca de filtro atualiza o endereço no lugar, sem poluir o histórico. */
  const patch = useCallback(
    (next: Partial<CatalogSearch>, opts?: { scroll?: boolean }) => {
      void navigate({
        search: (prev) => cleanSearch({ ...(prev as CatalogSearch), ...next }),
        replace: true,
        resetScroll: false,
      });
      if (opts?.scroll !== false) scrollToResults();
    },
    [navigate, scrollToResults],
  );

  const type = sp.type ?? "todos";
  const gender = sp.gender ?? "todos";
  const brand = sp.brand ?? "todas";
  const availability = sp.disp ?? "todos";
  const sort: SortKey = sp.sort ?? "relevantes";
  const priceMin = sp.pmin ?? null;
  const priceMax = sp.pmax ?? null;
  const urlQuery = sp.q ?? "";
  const accords = useMemo(() => sp.ac ?? [], [sp.ac]);

  const setType = (v: string) => patch({ type: v });
  const setGender = (v: string) => patch({ gender: v });
  const setBrand = (v: string) => patch({ brand: v });
  const setAvailability = (v: "todos" | "em-estoque" | "sem-estoque") => patch({ disp: v });
  const setSort = (v: SortKey) => patch({ sort: v });

  const [term, setTerm] = useState(urlQuery);
  const [debounced, setDebounced] = useState(urlQuery);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [buy, setBuy] = useState<CatalogProduct | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const motion = useRouteMotion();

  /** fim da lista: estado (e não ref) para o observador ser armado sempre que ele aparece */
  const [moreEl, setMoreEl] = useState<HTMLDivElement | null>(null);

  /**
   * PRÉVIA DA BUSCA — o estado (termo, resultados, painel, seleção) vive em
   * <SearchProvider>: uma única fonte de verdade para a barra no fluxo, a barra
   * encaixada no topo e o painel de resultados.
   */

  /** Verdadeiro enquanto o cliente está com o cursor dentro da barra. */
  const isTypingInSearch = () => {
    const el = document.activeElement as HTMLInputElement | null;
    return el?.tagName === "INPUT" && el.type === "search";
  };

  /** Confirmar a busca: aí sim o catálogo mostra os resultados. */
  const runSearch = useCallback(
    (raw: string) => {
      // espera o popup fechar (ele desfaz sua entrada no histórico) antes de
      // gravar o termo na URL, senão o "voltar" do popup apagaria a busca
      const clean = raw.trim();
      window.setTimeout(() => setDebounced(clean), 120);
      if (typeof document !== "undefined") (document.activeElement as HTMLElement | null)?.blur?.();
      scrollToTop();
    },
    [scrollToTop],
  );

  /**
   * Digitar só atualiza a prévia (popup). O catálogo completo muda apenas ao
   * confirmar (Enter/lupa). Apagar tudo volta ao catálogo normal.
   */
  const [preview, setPreview] = useState(urlQuery);
  useEffect(() => {
    const clean = term.trim();
    const timer = window.setTimeout(() => {
      setPreview(clean);
      if (!clean) setDebounced("");
    }, 250);
    return () => window.clearTimeout(timer);
  }, [term]);

  /** A busca também mora na URL: voltar do perfume devolve o mesmo termo. */
  const searchWasActive = useRef(Boolean(urlQuery));
  useEffect(() => {
    if (debounced !== urlQuery) patch({ q: debounced || undefined }, { scroll: false });
    const active = debounced.trim().length > 0;
    if (active !== searchWasActive.current) {
      searchWasActive.current = active;
      // enquanto o teclado está aberto a tela fica onde está: subir agora tiraria
      // a barra (e o cursor) do lugar. O topo é garantido ao confirmar a busca.
      if (!isTypingInSearch()) scrollToTop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  useEffect(() => {
    if (urlQuery !== debounced) {
      setTerm(urlQuery);
      setDebounced(urlQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);


  /** Voltar de um perfume aberto pela busca devolve o mesmo termo. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    let saved: string | null = null;
    try {
      saved = window.sessionStorage.getItem(RESUME_KEY);
      window.sessionStorage.removeItem(RESUME_KEY);
    } catch {
      return;
    }
    if (saved && !urlQuery) {
      setTerm(saved);
      setDebounced(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    trackDecant("decant_view");
  }, []);

  /** Busca usada: métrica do funil (nunca atrasa a digitação). */
  useEffect(() => {
    if (debounced.trim().length >= 3) track("search", { query: debounced.trim() });
  }, [debounced]);

  const { data: settings } = usePublicPricingSettings();

  /** Contagens reais do catálogo — nenhum filtro é oferecido sem produto. */
  const { data: facets } = useQuery({
    queryKey: ["catalog-facets", 2],
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("brand, product_type, gender_norm, in_stock, decant_available")
        .eq("active", true)
        .eq("catalog_eligible", true);
      if (error) throw error;
      return (data ?? []) as FacetRow[];
    },
  });

  /** Acordes reais mais frequentes (dados do catálogo, não lista inventada). */
  const { data: accordOptions } = useQuery({
    queryKey: ["accord-facets"],
    enabled: filtersOpen,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fragrance_accords")
        .select("accord_name, products!inner(active, catalog_eligible)")
        .lte("position", 2)
        .eq("products.active", true)
        .eq("products.catalog_eligible", true)
        .limit(3000);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const r of data ?? []) counts.set(r.accord_name, (counts.get(r.accord_name) ?? 0) + 1);
      return [...counts.entries()]
        .filter(([, n]) => n >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([key, count]) => ({ key, count }));
    },
  });

  /** Busca e filtros rodam no banco; a paginação por deslocamento alcança o catálogo inteiro. */
  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetchingNextPage,
    isFetchNextPageError,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: [
      "catalog",
      { debounced, type, gender, brand, availability, accords, sort, priceMin, priceMax },
    ],
    initialPageParam: 0,
    retry: 1,
    // Voltar de um perfume reaproveita as páginas já carregadas (sem refazer tudo).
    staleTime: 60_000,
    queryFn: async ({ pageParam, signal }) => {
      const args = {
        p_q: debounced,
        p_availability: availability,
        p_limit: PAGE_SIZE,
        p_offset: pageParam,
        ...(sort !== "relevantes" ? { p_sort: sort } : {}),
        ...(priceMin != null ? { p_price_min: priceMin } : {}),
        ...(priceMax != null ? { p_price_max: priceMax } : {}),
        ...(accords.length ? { p_accords: accords } : {}),
        ...(type !== "todos" ? { p_type: type } : {}),
        ...(gender !== "todos" ? { p_gender: gender } : {}),
        ...(brand !== "todas" ? { p_brand: brand } : {}),
      };

      // 1ª página da Home: a consulta já saiu no <head>, junto com o download do app
      const early = pageParam === 0 ? await takeCatalogPrefetch(args) : null;
      const { data, error } = early
        ? { data: early as never, error: null }
        : await withQueryTimeout(
            (requestSignal) => supabase.rpc("search_catalog", args).abortSignal(requestSignal),
            15_000,
            signal,
          );
      if (error) throw error;
      const list = data ?? [];
      const rows = list.map(({ rank: _rank, total: _total, ...p }) => p) as CatalogProduct[];
      const total = Number(list[0]?.total ?? 0);
      if (pageParam === 0 && debounced.length >= 3 && rows.length === 0) {
        // Métrica secundária: nunca prender a tela enquanto registra busca sem resultado.
        void supabase.rpc("log_search_miss", { p_query: debounced }).then(() => undefined, () => undefined);
      }
      return { rows, total, offset: pageParam };
    },
    getNextPageParam: (last) => {
      const next = last.offset + last.rows.length;
      return last.rows.length > 0 && next < last.total ? next : undefined;
    },
  });

  /** Um produto nunca aparece duas vezes, mesmo se lotes se sobrepuserem. */
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: CatalogProduct[] = [];
    for (const page of data?.pages ?? []) {
      for (const p of page.rows) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
      }
    }
    return out;
  }, [data]);
  const total = data?.pages?.[0]?.total ?? 0;

  /**
   * Camada operacional: uma única consulta agregada para todos os produtos já
   * carregados. Quem é admin/owner vê automaticamente — o backend confere a role
   * antes de devolver custo/margem, então cliente comum nunca recebe esses dados.
   */
  const { isStaff } = useAuth();
  const { visible: insightVisible } = useAdminInsightView();
  const showAdmin = isStaff && insightVisible;
  const loadInsight = useServerFn(getAdminCatalogInsight);

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const { data: insight } = useQuery({
    queryKey: ["admin-insight", ids.length, ids[0] ?? "", ids.at(-1) ?? ""],
    enabled: showAdmin && ids.length > 0,
    staleTime: 60_000,
    retry: false,
    // camada interna: se a sessão caiu, o catálogo do cliente segue normal
    queryFn: () => loadInsight({ data: { productIds: ids } }).catch(() => []),
  });

  const insightById = useMemo(() => new Map((insight ?? []).map((i) => [i.productId, i])), [insight]);



  /** "Tentar novamente" continua exatamente do lote que falhou. */
  const retryNextPage = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  /** Uma requisição por vez: o observador pode disparar várias vezes. */
  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  /** Filtro novo: a lista antiga sai de cena e a paginação recomeça do zero. */

  /**
   * Intenção da busca: linha de perfumes (lista normal) ou um perfume
   * específico (destaque + parecidos no cheiro).
   */
  const { intent: searchIntent, exact, similar, similarLoading } = useSearchIntent(debounced);
  // O destaque só faz sentido quando a busca é a única coisa em jogo:
  // com filtros ativos o cliente está explorando uma lista, não um perfume.
  const noFilters =
    type === "todos" &&
    gender === "todos" &&
    brand === "todas" &&
    availability === "todos" &&
    accords.length === 0 &&
    priceMin == null &&
    priceMax == null;
  const exactMode = Boolean(exact) && searchIntent === "EXACT_PRODUCT_SEARCH" && noFilters;


  /** No modo perfume específico o destaque não se repete na lista abaixo. */
  const listRows = useMemo(
    () => (exactMode && exact ? rows.filter((p) => p.id !== exact.id) : rows),
    [exactMode, exact, rows],
  );

  /** "Resultados para Club de Nuit" quando o cliente digitou diferente do nome oficial. */
  const suggestion = useMemo(() => {
    const top = rows[0];
    if (!debounced || !top) return null;
    const k = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const line = (top as CatalogProduct & { product_line?: string | null }).product_line ?? null;
    const target = line ?? top.canonical_name;
    return k(target).includes(k(debounced)) ? null : target;
  }, [rows, debounced]);


  // ---- opções dinâmicas, sempre com contagem > 0 ----
  const scoped = useMemo(
    () =>
      (facets ?? []).filter((f) =>
        availability === "em-estoque" ? f.in_stock : availability === "sem-estoque" ? !f.in_stock : true,
      ),
    [facets, availability],
  );

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of scoped) if (f.product_type) counts.set(f.product_type, (counts.get(f.product_type) ?? 0) + 1);
    return TYPE_ORDER.filter((t) => counts.get(t)).map((t) => ({ key: t, label: TYPE_LABEL[t], count: counts.get(t)! }));
  }, [scoped]);

  const existingTypes = useMemo(() => new Set(typeOptions.map((t) => t.key as string)), [typeOptions]);

  const inType = useMemo(() => {
    if (type === "todos") return scoped;
    const allowed = new Set(type.split(","));
    return scoped.filter((f) => f.product_type && allowed.has(f.product_type));
  }, [scoped, type]);

  // gêneros vêm sempre dos perfumes: os filtros principais nunca desaparecem da barra
  const genderOptions = useMemo(() => {
    const list = scoped.filter((f) => f.product_type === "PERFUME");
    const counts = new Map<string, number>();
    for (const f of list) if (f.gender_norm) counts.set(f.gender_norm, (counts.get(f.gender_norm) ?? 0) + 1);
    return GENDER_ORDER.filter((g) => counts.get(g)).map((g) => ({
      key: g,
      label: GENDER_LABEL[g],
      count: counts.get(g)!,
    }));
  }, [scoped]);

  const brandOptions = useMemo(() => {
    const list = inType.filter((f) => (gender === "todos" ? true : f.gender_norm === gender));
    const counts = new Map<string, number>();
    for (const f of list) if (f.brand) counts.set(f.brand, (counts.get(f.brand) ?? 0) + 1);
    return [...counts.entries()]
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => a.key.localeCompare(b.key, "pt-BR"));
  }, [inType, gender]);

  // filtro escolhido que deixou de existir volta para "todos"
  useEffect(() => {
    if (type === "todos" || !typeOptions.length) return;
    if (!type.split(",").some((t) => existingTypes.has(t))) patch({ type: undefined }, { scroll: false });
  }, [typeOptions, existingTypes, type]);
  useEffect(() => {
    if (gender !== "todos" && !genderOptions.some((g) => g.key === gender)) patch({ gender: undefined }, { scroll: false });
  }, [genderOptions, gender]);
  useEffect(() => {
    if (brand !== "todas" && !brandOptions.some((b) => b.key === brand)) patch({ brand: undefined }, { scroll: false });
  }, [brandOptions, brand]);

  /**
   * Rolagem infinita: o lote seguinte começa ~600px antes do fim da lista.
   * O observador é rearmado a cada troca de filtro e a cada lote, e um teste
   * de distância no próprio scroll cobre os casos em que o iOS não dispara.
   */
  const filterKey = `${debounced}|${type}|${gender}|${brand}|${availability}|${sort}|${priceMin ?? ""}|${priceMax ?? ""}|${accords.join(",")}`;
  useEffect(() => {
    const el = moreEl;
    if (!el) return;
    const near = () => {
      const r = el.getBoundingClientRect();
      if (r.top - window.innerHeight < 600) loadMore();
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) loadMore();
        },
        { rootMargin: "0px 0px 600px 0px" },
      );
      io.observe(el);
    }
    // sem IntersectionObserver (raro): mede na rolagem, no máximo uma vez por quadro
    let rafScroll = 0;
    const nearSoon = () => {
      cancelAnimationFrame(rafScroll);
      rafScroll = requestAnimationFrame(near);
    };
    if (!io) window.addEventListener("scroll", nearSoon, { passive: true });
    window.addEventListener("resize", nearSoon);
    // lista curta demais para rolar: já busca o lote seguinte
    const first = requestAnimationFrame(near);
    return () => {
      io?.disconnect();
      window.removeEventListener("scroll", nearSoon);
      window.removeEventListener("resize", nearSoon);
      cancelAnimationFrame(first);
      cancelAnimationFrame(rafScroll);
    };
  }, [moreEl, loadMore, hasNextPage, rows.length, filterKey]);

  const activeFilters =
    (type !== "todos" ? 1 : 0) +
    (gender !== "todos" ? 1 : 0) +
    (brand !== "todas" ? 1 : 0) +
    (availability !== "todos" ? 1 : 0) +
    (sort !== "relevantes" ? 1 : 0) +
    (priceMin != null || priceMax != null ? 1 : 0) +
    accords.length +
    (debounced ? 1 : 0);

  /** Filtro escolhido também é sinal de intenção — registrado sem bloquear a lista. */
  useEffect(() => {
    if (activeFilters === 0) return;
    track("filters_applied", {
      meta: { type, gender, brand, availability, sort, accords: accords.length },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);


  const setPriceRange = (min: number | null, max: number | null) =>
    patch({ pmin: min ?? undefined, pmax: max ?? undefined });

  /**
   * Faixa de preço sem nenhum frasco: sugerimos decants uma única vez por
   * faixa escolhida — nunca repetidamente durante a mesma interação.
   */
  const [decantOfferOpen, setDecantOfferOpen] = useState(false);
  const offeredFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${priceMin ?? ""}|${priceMax ?? ""}`;
    if (priceMin == null && priceMax == null) {
      offeredFor.current = null;
      return;
    }
    // só depois de fechar o painel de filtros: um sheet por vez
    if (filtersOpen || isLoading || isError || rows.length > 0) return;
    if (offeredFor.current === key) return;
    offeredFor.current = key;
    setDecantOfferOpen(true);
  }, [priceMin, priceMax, filtersOpen, isLoading, isError, rows.length]);


  /** Escolheu um tamanho: a faixa que esvaziou o catálogo sai e os cards passam a mostrar aquele decant. */
  const takeDecantSize = (ml: DecantMl) => {
    setPriceRange(null, null);
    setPriceView(ml);
    scrollToGrid();
  };


  /** Texto curto da faixa escolhida, para o chip. */
  const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const priceChipLabel =
    priceMin != null && priceMax != null
      ? `${money(priceMin)} – ${money(priceMax)}`
      : priceMax != null
        ? `Até ${money(priceMax)}`
        : priceMin != null
          ? `Acima de ${money(priceMin)}`
          : null;

  const clearFilters = () => {
    setTerm("");
    setDebounced("");
    patch({
      q: undefined,
      type: undefined,
      gender: undefined,
      brand: undefined,
      disp: undefined,
      sort: undefined,
      pmin: undefined,
      pmax: undefined,
      ac: [],
    });
  };


  const toggleAccord = (a: string) =>
    patch({ ac: accords.includes(a) ? accords.filter((x) => x !== a) : [...accords, a] });

  /**
   * "Explorar perfumes" leva aos cartões Decants/Frascos, não ao catálogo:
   * o foco é o decant, e o cliente segue rolando pela identidade da loja.
   */
  const scrollToShortcuts = () =>
    smoothScrollToEl(document.querySelector("[data-home-shortcuts]"), { gap: 20 });

  /** Desliza até o título do Catálogo (o respiro acima dele fica fora da tela). */
  const scrollToGrid = () => smoothScrollToEl(gridRef.current, { gap: activeFilters === 0 ? -36 : 12 });

  /** "Procurar" da barra inferior abre a tela de pesquisa. */
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const focus = () => setSearchOpen(true);
    const openCatalog = () => scrollToGrid();
    window.addEventListener("orium:focus-search", focus);
    window.addEventListener("orium:open-catalog", openCatalog);
    return () => {
      window.removeEventListener("orium:focus-search", focus);
      window.removeEventListener("orium:open-catalog", openCatalog);
    };
  }, []);



  /**
   * Voltar do perfume devolve o catálogo exatamente na posição anterior.
   *
   * Enquanto a restauração está em curso reafirmamos a posição a cada frame:
   * o router, as imagens e os lotes em cache mexem na altura da página e
   * qualquer "uma vez só" perde a corrida. A fase termina no primeiro gesto
   * real do cliente (ou no limite de tempo) — só então voltamos a gravar.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const KEY = "orium-catalog-scroll";
    const saved = Number(sessionStorage.getItem(KEY) ?? 0);

    let restoring = saved > 200;
    /** Depois do toque em um perfume nada mais pode alterar a posição guardada. */
    let frozen = false;
    let raf = 0;
    let loop = 0;
    const deadline = Date.now() + 10000;

    const endRestore = () => {
      restoring = false;
      cancelAnimationFrame(loop);
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // a subida provocada por um filtro invalida a posição guardada
        if (Date.now() < topLockUntil.current) {
          sessionStorage.removeItem(KEY);
          endRestore();
          return;
        }
        if (restoring || frozen) return;
        sessionStorage.setItem(KEY, String(window.scrollY));
      });
    };

    /**
     * O toque no card é o único instante em que a posição vale de verdade:
     * a saída da página ainda dispara scrolls que sobrescreveriam o valor.
     */
    const freeze = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("a[href]")) return;
      cancelAnimationFrame(raf);
      sessionStorage.setItem(KEY, String(window.scrollY));
      frozen = true;
      endRestore();
    };

    /** Se o cliente continuou na Home e voltou a rolar, a posição volta a ser gravada. */
    const unfreeze = () => {
      frozen = false;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("pointerdown", freeze, { capture: true, passive: true });
    for (const ev of ["wheel", "touchmove"]) window.addEventListener(ev, unfreeze, { passive: true });
    for (const ev of ["wheel", "touchstart", "keydown", "pointerdown"]) {
      window.addEventListener(ev, endRestore, { passive: true });
    }



    if (restoring) {
      const tick = () => {
        if (!restoring) return;
        if (Date.now() > deadline) return endRestore();
        if (Date.now() < topLockUntil.current) return endRestore();
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const target = Math.min(saved, Math.max(0, max));
        if (Math.abs(window.scrollY - target) > 4) window.scrollTo({ top: target, behavior: "auto" });
        // chegamos na posição real: a página volta a ser do cliente
        if (Math.abs(window.scrollY - saved) <= 4) return endRestore();
        loop = requestAnimationFrame(tick);
      };

      loop = requestAnimationFrame(tick);
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("pointerdown", freeze, { capture: true });
      for (const ev of ["wheel", "touchmove"]) window.removeEventListener(ev, unfreeze);
      for (const ev of ["wheel", "touchstart", "keydown", "pointerdown"]) {
        window.removeEventListener(ev, endRestore);
      }

      cancelAnimationFrame(raf);
      cancelAnimationFrame(loop);
    };
  }, []);


  const minQty = settings?.wholesale_min_quantity ?? 6;
  const genderVisible = type === "PERFUME" || type === "todos";
  /** Catálogo completo aberto pelo "Ver tudo" (rolagem infinita). */
  const fullCatalog = sp.ver === "catalogo";
  const showHero = activeFilters === 0 && !fullCatalog;
  const negotiation = useHasNegotiation();
  /** Home: só uma vitrine do catálogo, com "Ver tudo" — nada de rolagem infinita aqui. */
  const homePreview = showHero && !exactMode;

  const openFullCatalog = () => {
    track("discovery_clicked", { meta: { card: "ver_tudo_catalogo" } });
    void navigate({ search: (prev) => cleanSearch({ ...(prev as CatalogSearch), ver: "catalogo" }) }).then(() =>
      window.scrollTo({ top: 0, behavior: "auto" }),
    );
  };
  /** "N perfumes no catálogo" do cartão Frascos — só perfumes, sem cosméticos. */
  const perfumeCount = typeOptions.find((t) => t.key === "PERFUME")?.count;

  /** Tela de catálogo (Figma): "Ver tudo", busca ou qualquer filtro aplicado. */
  const catalogScreen = !showHero;
  /** "‹ Início": limpa busca e filtros e volta para o topo da Home. */
  const goHome = () => {
    setTerm("");
    setDebounced("");
    void navigate({ search: {} as CatalogSearch }).then(() => window.scrollTo({ top: 0, behavior: "auto" }));
  };

  /** Chips de categoria do Figma: Todos · Masculino · Feminino · Unissex · Body splash… */
  const catChips: { k: string; l: string; on: boolean; go: () => void }[] = [
    { k: "all", l: "Todos", on: gender === "todos" && type === "todos", go: () => patch({ type: undefined, gender: undefined }) },
    ...genderOptions
      .filter((g) => ["MALE", "FEMALE", "UNISEX"].includes(g.key))
      .map((g) => ({
        k: g.key,
        l: g.label,
        on: gender === g.key,
        go: () => patch(gender === g.key ? { gender: undefined } : { type: "PERFUME", gender: g.key }),
      })),
    ...MAIN_GROUPS.filter((grp) => grp.types.some((t) => existingTypes.has(t))).map((grp) => ({
      k: grp.key,
      l: grp.key === "BODY_SPLASH" ? "Body splash" : "Hidratantes",
      on: type === grp.key,
      go: () => patch(type === grp.key ? { type: undefined } : { type: grp.key, gender: undefined }),
    })),
  ];
  const chipTypeKeys = new Set(["todos", "PERFUME", ...MAIN_GROUPS.map((g) => g.key)]);

  /** Filtros aplicados que não aparecem nos chips nem no "Ordenar". */
  const applied: { k: string; l: string; clear: () => void }[] = [
    ...(debounced ? [{ k: "q", l: `“${debounced}”`, clear: () => { setTerm(""); setDebounced(""); } }] : []),
    ...(!chipTypeKeys.has(type) ? [{ k: "type", l: typeLabel(type), clear: () => setType("todos") }] : []),
    ...(brand !== "todas" ? [{ k: "brand", l: brand, clear: () => setBrand("todas") }] : []),
    ...accords.map((a) => ({ k: `ac:${a}`, l: a, clear: () => toggleAccord(a) })),
    ...(availability !== "todos"
      ? [{ k: "disp", l: availability === "em-estoque" ? "Em estoque" : "Sem estoque", clear: () => setAvailability("todos") }]
      : []),
    ...(priceChipLabel ? [{ k: "price", l: priceChipLabel, clear: () => setPriceRange(null, null) }] : []),
  ];
  const countNoun = type === "PERFUME" || gender !== "todos" ? (total === 1 ? "perfume" : "perfumes") : total === 1 ? "produto" : "produtos";

  const chipRow = (
    <div className="page-bleed scrollbar-none flex gap-2.5 overflow-x-auto scroll-px-[var(--page-gutter)] after:block after:w-1 after:shrink-0 after:content-['']">
      {catChips.map((c) => (
        <button
          key={c.k}
          type="button"
          aria-pressed={c.on}
          onClick={c.go}
          className={cn(
            "press h-11 shrink-0 rounded-full px-5 text-[15px] font-semibold whitespace-nowrap transition-colors duration-[var(--motion-standard)] ease-[var(--ease-orium)]",
            c.on ? "bg-white text-[#15130F]" : "bg-[#1F1F1F] text-white hover:bg-[#2A2A2A]",
          )}
        >
          {c.l}
        </button>
      ))}
    </div>
  );

  // "Adicionar" e filtros respondem na hora: o código das gavetas aquece no ocioso
  // a página do perfume é o próximo passo mais provável: o código também aquece
  const router = useRouter();
  useIdlePrefetch([SearchScreen.prefetch, BuySheet.prefetch, FiltersSheet.prefetch, () => warmProductRoute(router as never)]);

  const choose = (p: CatalogProduct) => {
    setBuy(p);
    setBuyOpen(true);
  };

  /**
   * Atalhos circulares: mesmos filtros da barra antiga, agora como ícones.
   * "Mais vendidos" leva ao carrossel de venda real e
   * "Decants" troca a forma de compra que o catálogo mostra.
   */
  const quickItems = useMemo(() => {
    const base = { brand: undefined, ac: [] as string[] };
    const items: QuickItem[] = [
      {
        key: "top",
        label: "Mais vendidos",
        icon: "top" as const,
        active: false,
        onSelect: () => smoothScrollToEl(topRef.current),
      },
      ...genderOptions.map((g) => ({
        key: `gender:${g.key}`,
        label: g.label,
        icon: (g.key === "MALE" ? "male" : g.key === "FEMALE" ? "female" : "unisex") as QuickItem["icon"],
        active: type === "PERFUME" && gender === g.key,
        onSelect: () =>
          gender === g.key
            ? patch({ ...base, type: undefined, gender: undefined })
            : patch({ ...base, type: "PERFUME", gender: g.key }),
      })),
      {
        key: "decant",
        label: "Decants",
        icon: "decant" as const,
        active: priceView !== "frasco",
        onSelect: () => {
          setPriceView(priceView === "frasco" ? 5 : "frasco");
          scrollToGrid();
        },
      },
      ...MAIN_GROUPS.filter((grp) => grp.types.some((t) => existingTypes.has(t))).map((grp) => ({
        key: `type:${grp.key}`,
        label: grp.label,
        icon: (grp.key === "BODY_SPLASH" ? "splash" : "body") as QuickItem["icon"],
        active: type === grp.key,
        onSelect: () =>
          type === grp.key
            ? patch({ ...base, type: undefined })
            : patch({ ...base, type: grp.key, gender: undefined }),
      })),
    ];
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genderOptions, existingTypes, type, gender, priceView, patch]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader clearAtTop={showHero} onBack={catalogScreen ? goHome : undefined} onOpenFilters={() => setFiltersOpen(true)} filtersCount={catalogScreen ? applied.length + (sort !== "relevantes" ? 1 : 0) : 0} />

      {/* o vídeo ocupa a largura toda; o resto da página segue a moldura da loja */}
      {showHero ? <HomeHero onExplore={scrollToShortcuts} /> : null}

      <main
        key={motion.key}
        className={cn(
          motion.className,
          "shell pt-2 pb-10 lg:pb-24",
        )}
      >
        {/* BLACK em primeiro lugar: acima da Negociação e dos cartões */}
        {showHero ? (
          <div className="mb-10 empty:hidden tab:mb-12">
            <BlackShowcase onChoose={choose} onExplore={scrollToGrid} />
          </div>
        ) : null}
        {/* com perfume em Negociação, ela abre a Home e os cartões Decants/Frascos descem */}
        {showHero && negotiation.has ? <NegotiationShowcase /> : null}
        {showHero ? (
          <div className={negotiation.has ? "mt-10 tab:mt-12" : undefined}>
            <HomeShortcuts onExplore={scrollToGrid} total={perfumeCount} />
          </div>
        ) : null}

        <div className="mt-5 empty:hidden">
          <HomeCampaigns onExplore={scrollToGrid} />
        </div>

        {showHero ? (
          <>
            <div ref={topRef} className="mt-12 scroll-mt-4 tab:mt-14" />
            <BestSellersRow onSeeAll={scrollToGrid} onChoose={choose} />
            <HomeBrands
              brands={brandOptions}
              onPick={(b) => patch({ brand: b })}
              onSeeAll={() => setFiltersOpen(true)}
            />
          </>
        ) : null}

        <div ref={gridRef} id="catalogo" className="scroll-mt-4" />
        {showHero ? (
          <>
            <h2 className="home-title mt-12 tab:mt-14">Catálogo</h2>
            <div className="mt-4 mb-5">{chipRow}</div>
          </>
        ) : (
          <section aria-label="Catálogo" className="cat-head mb-6">
            <h1 className="mt-3 text-[40px] leading-[1.15] font-bold tracking-[-0.035em] text-white tab:mt-6 tab:text-[48px]">
              Catálogo
            </h1>
            <p className="mt-1 text-[16px] font-medium text-[#BABABA]">
              {debounced
                ? `Resultados para “${suggestion ?? debounced}”`
                : perfumeCount
                  ? `${perfumeCount} perfumes árabes em frascos e decants.`
                  : "Perfumes árabes em frascos e decants."}
            </p>
            <div className="mt-6">{chipRow}</div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <p key={total} className="value-in truncate text-[14px] font-semibold text-[#A8A8A8] tabular-nums">
                  {isLoading ? " " : `${total} ${countNoun}`}
                </p>
              </div>
              <SortMenu value={sort} options={SORT_OPTIONS} onChange={(k) => setSort(k)} />
            </div>
            {applied.length ? (
              <div className="page-bleed scrollbar-none mt-4 flex items-center gap-2 overflow-x-auto scroll-px-[var(--page-gutter)] after:block after:w-1 after:shrink-0 after:content-['']">
                {applied.map((f) => (
                  <button
                    key={f.k}
                    type="button"
                    onClick={f.clear}
                    aria-label={`Remover filtro ${f.l}`}
                    className="applied-chip press inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-[#1A1A1A] pr-1.5 pl-3.5 text-[13px] font-semibold whitespace-nowrap text-white ring-1 ring-white/10 ring-inset"
                  >
                    {f.l}
                    <span className="grid size-6 place-items-center rounded-full bg-white/10">
                      <X className="size-3" strokeWidth={2.6} />
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={clearFilters}
                  className="press h-9 shrink-0 px-2 text-[13px] font-bold whitespace-nowrap text-[#FFD599]"
                >
                  Limpar tudo
                </button>
              </div>
            ) : null}
          </section>
        )}
        {/* busca só na tela de pesquisa, aberta pelo "Procurar" da barra inferior */}
        <SearchProvider value={{
            term,
            query: preview,
            onTermChange: setTerm,
            onSubmit: (v: string) => {
              setSearchOpen(false);
              runSearch(v);
            },
            onKeepQuery: (v) => {
              /**
               * Ao abrir um perfume, o termo fica guardado: voltar devolve a
               * mesma busca com os mesmos resultados (o endereço do catálogo é
               * substituído pelo router durante a navegação, então a memória
               * curta da sessão é a fonte confiável aqui).
               */
              // não mexe na URL aqui: isso disparava uma navegação para a
              // Home/busca que cancelava a abertura do perfume
              try {
                if (v) window.sessionStorage.setItem(RESUME_KEY, v);
                else window.sessionStorage.removeItem(RESUME_KEY);
              } catch {
                /* modo privado */
              }
            },
          }}>
          <MountWhen when={searchOpen}>
            <SearchScreen
              requestOpen={searchOpen}
              onClosed={() => setSearchOpen(false)}
              onChoose={choose}
              minQty={minQty}
            />
          </MountWhen>
        </SearchProvider>

        {isLoading ? (
          <div className="product-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : isError ? (
          <div className="py-16 text-center">
            <h2 className="text-[22px] font-bold tracking-[-0.02em] text-white">Não conseguimos carregar</h2>
            <p className="mt-2 text-[15px] text-[#A9A9A9]">Verifique sua conexão e tente novamente.</p>
            <button
              type="button"
              className="press mt-6 h-11 rounded-full bg-white px-6 text-[14px] font-bold text-[#15130F]"
              onClick={() => void refetch()}
            >
              Tentar de novo
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <h2 className="text-[22px] font-bold tracking-[-0.02em] text-white">Nada por aqui</h2>
            <p className="mx-auto mt-2 max-w-[30ch] text-[15px] leading-relaxed text-[#A9A9A9]">
              Confira a grafia, tente só o nome da marca ou tire alguns filtros.
            </p>
            {activeFilters > 0 && (
              <button
                type="button"
                className="press mt-6 h-11 rounded-full bg-white px-6 text-[14px] font-bold text-[#15130F]"
                onClick={clearFilters}
              >
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            {exactMode && exact ? (
              <SearchExactResult
                exact={exact}
                similar={similar}
                similarLoading={similarLoading}
                minQty={minQty}
                onChoose={choose}
                adminInsight={showAdmin ? (id: string) => insightById.get(id) ?? null : undefined}
              />
            ) : null}
            <div className={cn(homePreview && "relative")}>
            <div
              key={`${type}|${gender}|${availability}|${sort}|${debounced}|${priceMin ?? ""}|${priceMax ?? ""}`}
              className={cn(
                "list-swap product-grid",
                homePreview && "home-preview",
              )}
            >
              {(homePreview ? listRows.slice(0, 12) : listRows).map((p, i) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  index={i % 8}
                  minQty={minQty}
                  onChoose={choose}
                  adminInsight={showAdmin ? (insightById.get(p.id) ?? null) : null}
                />

              ))}
            </div>
            {homePreview && listRows.length > 4 ? (
              <div className="home-preview-fade">
                <button type="button" onClick={openFullCatalog} className="home-preview-cta press">
                  Ver tudo
                </button>
              </div>
            ) : null}
            </div>
            {/* rolagem infinita (só no catálogo completo): o próximo lote começa antes do fim */}
            {homePreview ? null : hasNextPage ? (
              <>
                {isFetchingNextPage ? (
                  <div className="mt-7" aria-live="polite">
                    <div className="product-grid">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <ProductCardSkeleton key={i} />
                      ))}
                    </div>
                    <p className="mt-6 text-center text-[13px] font-medium text-[#8C8C8C]">Carregando mais perfumes…</p>
                  </div>
                ) : null}
                {isFetchNextPageError ? (
                  <div className="mt-6 text-center">
                    <p className="text-sm text-muted-foreground">Não foi possível carregar mais produtos.</p>
                    <button
                      type="button"
                      className="press mt-3 h-11 rounded-full bg-white px-6 text-[14px] font-bold text-[#15130F]"
                      onClick={retryNextPage}
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : null}
                <div ref={setMoreEl} aria-hidden className="h-px w-full" />
              </>
            ) : rows.length > PAGE_SIZE ? (
              <p className="mt-10 text-center text-[13px] font-medium text-[#8C8C8C]">Você viu todos os perfumes</p>
            ) : null}
          </>
        )}

        {showHero ? <HomeContact /> : null}
      </main>

      <SiteFooter />

      <MountWhen when={filtersOpen}>
      <FiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        total={total}
        typeOptions={typeOptions}
        type={type}
        setType={(v) =>
          patch({ type: v, brand: undefined, ...(v !== "PERFUME" ? { gender: undefined } : {}) })
        }
        genderOptions={genderOptions}
        gender={gender}
        setGender={setGender}
        genderVisible={genderVisible}
        brandOptions={brandOptions}
        brand={brand}
        setBrand={setBrand}
        availability={availability}
        setAvailability={setAvailability}
        sort={sort}
        setSort={setSort}
        priceMin={priceMin}
        priceMax={priceMax}
        setPriceRange={setPriceRange}
        accordOptions={(accordOptions ?? []).map((a) => ({ key: a.key, label: a.key, count: a.count }))}
        accords={accords}
        toggleAccord={toggleAccord}
        onClear={clearFilters}
      />
      </MountWhen>

      <MountWhen when={buyOpen}>
        <BuySheet product={buy} open={buyOpen} onOpenChange={setBuyOpen} />
      </MountWhen>

      <MountWhen when={decantOfferOpen}>
        <DecantOfferSheet
          open={decantOfferOpen}
          onOpenChange={setDecantOfferOpen}
          priceMax={priceMax}
          onChooseSize={takeDecantSize}
        />
      </MountWhen>

    </div>
  );
}


