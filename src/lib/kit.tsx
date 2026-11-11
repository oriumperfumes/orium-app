/**
 * "Monte seu Kit de Decants": seleção temporária de vários perfumes com tamanho
 * individual. Só vira carrinho quando o cliente confirma. Sem desconto automático.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { trackDecant, type DecantMl } from "@/lib/decants";

export type KitEntry = {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  ml: DecantMl;
  /** preços por tamanho já resolvidos para este perfume */
  prices: Record<DecantMl, number>;
};

type KitContext = {
  active: boolean;
  start: () => void;
  stop: () => void;
  entries: KitEntry[];
  has: (productId: string) => boolean;
  toggle: (entry: KitEntry) => void;
  setMl: (productId: string, ml: DecantMl) => void;
  remove: (productId: string) => void;
  clear: () => void;
  subtotal: number;
  open: boolean;
  setOpen: (v: boolean) => void;
};

const Ctx = createContext<KitContext | null>(null);

export function KitProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [entries, setEntries] = useState<KitEntry[]>([]);
  const [open, setOpen] = useState(false);

  const start = useCallback(() => {
    setActive(true);
    trackDecant("kit_started");
  }, []);
  const stop = useCallback(() => {
    setActive(false);
    setOpen(false);
  }, []);

  const toggle = useCallback((entry: KitEntry) => {
    setEntries((prev) => {
      if (prev.some((e) => e.productId === entry.productId)) return prev.filter((e) => e.productId !== entry.productId);
      trackDecant("kit_product_added", { productId: entry.productId, variant: `DECANT_${entry.ml}` });
      return [...prev, entry];
    });
  }, []);

  const value = useMemo<KitContext>(
    () => ({
      active,
      start,
      stop,
      entries,
      has: (id) => entries.some((e) => e.productId === id),
      toggle,
      setMl: (id, ml) => setEntries((prev) => prev.map((e) => (e.productId === id ? { ...e, ml } : e))),
      remove: (id) => setEntries((prev) => prev.filter((e) => e.productId !== id)),
      clear: () => setEntries([]),
      subtotal: entries.reduce((s, e) => s + e.prices[e.ml], 0),
      open,
      setOpen,
    }),
    [active, start, stop, entries, toggle, open],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKit() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useKit precisa estar dentro de KitProvider");
  return ctx;
}
