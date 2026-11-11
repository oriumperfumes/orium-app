import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CatalogProduct } from "@/components/orium/ProductCard";

/**
 * FONTE ÚNICA DE VERDADE DA PESQUISA.
 *
 * A barra no fluxo da Home, a barra encaixada no topo (sticky) e o painel de
 * resultados compartilham exatamente o mesmo estado: termo digitado, resultados,
 * carregando, erro, item selecionado, painel aberto e qual barra está visível
 * (âncora). Trocar de barra nunca reinicia a busca.
 *
 * O React Query garante que uma resposta antiga ("Ya") nunca sobrescreva a
 * resposta nova ("Yara"): cada termo é uma chave própria e só a chave atual
 * alimenta a tela.
 */

const RECENT_KEY = "orium-recent-searches";
export const SEARCH_MIN_CHARS = 2;

export type SearchCtx = {
  /** o que está escrito na barra, letra por letra */
  term: string;
  setTerm: (v: string) => void;
  /** termo estabilizado que realmente vai ao banco */
  query: string;
  results: CatalogProduct[];
  loading: boolean;
  error: boolean;
  retry: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  close: () => void;
  closeForNavigation: () => void;
  /** confirma a busca no catálogo */
  submit: (raw?: string) => void;
  clear: () => void;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  move: (dir: 1 | -1) => void;
  /** qual barra está visível agora (fluxo ou encaixada) */
  anchor: HTMLElement | null;
  registerAnchor: (el: HTMLElement | null) => void;
  compactAnchor: boolean;
  setCompactAnchor: (v: boolean) => void;
  recent: string[];
  rememberSearch: (q: string) => void;
  /** chamado ao abrir um perfume: voltar devolve a mesma busca */
  keepQuery: (q: string) => void;
  forgetRecent: () => void;
};

const Ctx = createContext<SearchCtx | null>(null);

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function SearchProvider({
  value,
  children,
}: {
  /** o catálogo continua dono do termo confirmado (URL) */
  value: {
    term: string;
    /** único termo estabilizado, compartilhado com o catálogo completo */
    query: string;
    onTermChange: (v: string) => void;
    onSubmit: (v: string) => void;
    /** guarda o termo no endereço ao abrir um perfume, sem mexer na rolagem */
    onKeepQuery: (v: string) => void;
  };
  children: ReactNode;
}) {
  const { term, query, onTermChange, onSubmit, onKeepQuery } = value;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [compactAnchor, setCompactAnchor] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => setRecent(readRecent()), []);

  useEffect(() => setActiveIndex(-1), [query]);

  const q = useQuery({
    queryKey: ["search-preview", query],
    // Se a pesquisa está fechada, não executar autocomplete desnecessário.
    enabled: open && query.length >= SEARCH_MIN_CHARS,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc("search_catalog", {
          p_q: query,
          p_availability: "todos",
          p_limit: 8,
          p_offset: 0,
        })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []).map(({ rank: _r, total: _t, ...p }) => p) as CatalogProduct[];
    },
  });

  const results = useMemo(
    () => (open && query.length >= SEARCH_MIN_CHARS && !q.isFetching ? (q.data ?? []) : []),
    [open, q.data, q.isFetching, query],
  );
  // "carregando" também cobre o intervalo entre digitar e o termo estabilizar
  const pendingTerm = term.trim().length >= SEARCH_MIN_CHARS && term.trim() !== query;
  const loading = open && term.trim().length >= SEARCH_MIN_CHARS && (q.isLoading || q.isFetching || pendingTerm);

  const rememberSearch = useCallback((raw: string) => {
    const clean = raw.trim();
    if (clean.length < 3) return;
    setRecent((prev) => {
      const next = [clean, ...prev.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 6);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* modo privado */
      }
      return next;
    });
  }, []);

  const forgetRecent = useCallback(() => {
    setRecent([]);
    try {
      window.localStorage.removeItem(RECENT_KEY);
    } catch {
      /* ignora */
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  /** fecha para abrir um perfume: não pode dar "voltar", senão desfaz a navegação */
  const closeForNavigation = useCallback(() => {
    if (typeof window !== "undefined") {
      const st = (window.history.state ?? {}) as Record<string, unknown>;
      if (st["oriumSearch"]) {
        const rest = { ...st };
        delete rest["oriumSearch"];
        window.history.replaceState(rest, "");
      }
    }
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const submit = useCallback(
    (raw?: string) => {
      const clean = (raw ?? term).trim();
      rememberSearch(clean);
      close();
      if (typeof document !== "undefined") (document.activeElement as HTMLElement | null)?.blur?.();
      onSubmit(clean);
    },
    [term, onSubmit, close, rememberSearch],
  );

  const clear = useCallback(() => {
    onTermChange("");
    setActiveIndex(-1);
  }, [onTermChange]);

  const move = useCallback(
    (dir: 1 | -1) => {
      const n = results.length;
      if (n === 0) return;
      setActiveIndex((i) => {
        const next = i + dir;
        if (next < 0) return n - 1;
        if (next >= n) return 0;
        return next;
      });
    },
    [results.length],
  );

  /**
   * VOLTAR FECHA A PESQUISA.
   * Ao abrir, empurramos uma entrada no histórico (mesma URL, marcada). O gesto
   * ou botão de voltar consome essa entrada e só fecha a busca. Fechando por
   * outro meio, removemos a entrada para não sobrar um "voltar" vazio.
   */
  const closedByPop = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const marked = () => Boolean((window.history.state as { oriumSearch?: boolean } | null)?.oriumSearch);
    if (open) {
      if (!marked()) window.history.pushState({ ...(window.history.state ?? {}), oriumSearch: true }, "");
    } else if (closedByPop.current) {
      closedByPop.current = false;
    } else if (marked()) {
      window.history.back();
    }
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const marked = Boolean((window.history.state as { oriumSearch?: boolean } | null)?.oriumSearch);
      if (open && !marked) {
        closedByPop.current = true;
        setOpen(false);
        setActiveIndex(-1);
        (document.activeElement as HTMLElement | null)?.blur?.();
      } else if (!open && marked) {
        // entrada órfã (ex.: voltou de um perfume): pula direto
        window.history.back();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  /** só a barra visível é âncora do painel */
  const anchorRef = useRef<HTMLElement | null>(null);
  const registerAnchor = useCallback((el: HTMLElement | null) => {
    anchorRef.current = el;
    setAnchor(el);
  }, []);

  const ctx: SearchCtx = {
    term,
    setTerm: onTermChange,
    query,
    results,
    loading,
    error: q.isError,
    retry: () => void q.refetch(),
    open,
    setOpen,
    close,
    closeForNavigation,
    submit,
    clear,
    activeIndex,
    setActiveIndex,
    move,
    anchor,
    registerAnchor,
    compactAnchor,
    setCompactAnchor,
    recent,
    rememberSearch,
    keepQuery: (q: string) => onKeepQuery(q.trim()),
    forgetRecent,
  };

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useSearchUI(): SearchCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSearchUI precisa estar dentro de <SearchProvider>");
  return ctx;
}

