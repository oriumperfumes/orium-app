import { QueryClient } from "@tanstack/react-query";
import { persistCrmQueries } from "./lib/query-persist";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Cache curto e global: voltar de um perfume não refaz tudo. Preço/estoque
  // continuam frescos (30s) e telas críticas definem o próprio staleTime.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 10 * 60_000, refetchOnWindowFocus: false, retry: 1 },
    },
  });

  // CRM: abre na hora com a última versão salva neste aparelho e atualiza por trás
  persistCrmQueries(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Preload stays opt-in. Eager intent preloads were racing route updates
    // and could crash navigation before a destination mounted.
    defaultPreload: false,
  });

  return router;
};
