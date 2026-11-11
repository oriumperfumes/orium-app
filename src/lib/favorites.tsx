/**
 * FAVORITOS / QUERO EXPERIMENTAR.
 *
 * Regra única: o cliente favorita o PERFUME (user_id + product_id).
 * Nunca por variante (decant 2/5/10ml ou frasco) — a escolha do tamanho vem depois.
 *
 * - visitante: fica salvo no próprio navegador;
 * - ao entrar na conta, tudo é enviado para a conta e sincronizado (merge por perfume);
 * - o coração do card e o botão "Quero experimentar" são o MESMO estado.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { syncAnonymousFavorite } from "@/lib/favorites.functions";
import { deviceId } from "@/lib/promotions";
import { track } from "@/lib/analytics";

const KEY = "orium-favorites";

export type FavoriteEntry = { productId: string; createdAt: string };

type FavoritesValue = {
  entries: FavoriteEntry[];
  count: number;
  ready: boolean;
  syncing: boolean;
  isFavorite: (productId: string) => boolean;
  /** Liga/desliga o favorito do perfume. Devolve true quando ficou favoritado. */
  toggle: (productId: string) => boolean;
  remove: (productId: string) => void;
};

/**
 * Um único contexto por aplicação: durante recarregamento a quente o módulo pode
 * ser reavaliado e um segundo contexto deixaria o provedor "invisível".
 */
const g = globalThis as unknown as { __oriumFavoritesCtx?: React.Context<FavoritesValue | null> };
const Ctx = (g.__oriumFavoritesCtx ??= createContext<FavoritesValue | null>(null));

/** Lê do aparelho já removendo duplicados (inclusive de versões antigas salvas por variante). */
const read = (): FavoriteEntry[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: FavoriteEntry[] = [];
    for (const e of raw) {
      const id = e && typeof e.productId === "string" ? e.productId : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ productId: id, createdAt: typeof e.createdAt === "string" ? e.createdAt : new Date().toISOString() });
    }
    return out;
  } catch {
    return [];
  }
};

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [entries, setEntries] = useState<FavoriteEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncedFor = useRef<string | null>(null);

  useEffect(() => {
    setEntries(read());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      /* modo privado: segue só em memória */
    }
  }, [entries, ready]);

  // entrou na conta: manda o que estava no aparelho e traz o que já estava salvo
  useEffect(() => {
    if (!ready || !userId || syncedFor.current === userId) return;
    syncedFor.current = userId;
    let cancelled = false;
    (async () => {
      setSyncing(true);
      try {
        const local = read();
        if (local.length) {
          await supabase.from("favorites").upsert(
            local.map((e) => ({ user_id: userId, product_id: e.productId })),
            { onConflict: "user_id,product_id", ignoreDuplicates: true },
          );
        }
        const { data } = await supabase
          .from("favorites")
          .select("product_id, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (!cancelled && data) {
          const seen = new Set<string>();
          const merged: FavoriteEntry[] = [];
          for (const r of data) {
            if (seen.has(r.product_id)) continue;
            seen.add(r.product_id);
            merged.push({ productId: r.product_id, createdAt: r.created_at });
          }
          setEntries(merged);
        }
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId]);

  useEffect(() => {
    if (!userId) syncedFor.current = null;
  }, [userId]);

  /** Desfaz a mudança na tela quando o servidor recusa. */
  const rollback = useCallback((snapshot: FavoriteEntry[]) => {
    setEntries(snapshot);
  }, []);

  /** Sem conta: guarda ligado ao aparelho, em segundo plano (nunca desfaz a tela). */
  const persistAnon = useCallback((productId: string, favorite: boolean) => {
    const device = deviceId();
    if (!device) return;
    void syncAnonymousFavorite({ data: { productId, anonymousId: device, favorite } }).catch(() => {});
  }, []);

  const persistAdd = useCallback(
    (productId: string, snapshot: FavoriteEntry[]) => {
      if (!userId) return persistAnon(productId, true);
      void supabase
        .from("favorites")
        .upsert({ user_id: userId, product_id: productId }, { onConflict: "user_id,product_id" })
        .then(
          ({ error }) => {
            if (error) rollback(snapshot);
          },
          () => rollback(snapshot),
        );
    },
    [userId, rollback, persistAnon],
  );

  const persistRemove = useCallback(
    (productId: string, snapshot: FavoriteEntry[]) => {
      if (!userId) return persistAnon(productId, false);
      void supabase
        .from("favorites")
        .delete()
        .eq("user_id", userId)
        .eq("product_id", productId)
        .then(
          ({ error }) => {
            if (error) rollback(snapshot);
          },
          () => rollback(snapshot),
        );
    },
    [userId, rollback, persistAnon],
  );

  const value = useMemo<FavoritesValue>(() => {
    const has = (productId: string) => entries.some((e) => e.productId === productId);
    return {
      entries,
      count: entries.length,
      ready,
      syncing,
      isFavorite: has,
      toggle: (productId) => {
        const snapshot = entries;
        if (has(productId)) {
          setEntries(snapshot.filter((e) => e.productId !== productId));
          persistRemove(productId, snapshot);
          track("favorite_removed", { productId });
          return false;
        }
        setEntries([{ productId, createdAt: new Date().toISOString() }, ...snapshot]);
        persistAdd(productId, snapshot);
        track("favorite_added", { productId });
        return true;
      },
      remove: (productId) => {
        const snapshot = entries;
        setEntries(snapshot.filter((e) => e.productId !== productId));
        persistRemove(productId, snapshot);
      },
    };
  }, [entries, ready, syncing, persistAdd, persistRemove]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFavorites(): FavoritesValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFavorites precisa estar dentro de FavoritesProvider");
  return ctx;
}
