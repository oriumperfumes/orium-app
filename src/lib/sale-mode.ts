/**
 * Forma de venda de cada perfume: somente Decant, somente Frasco ou os dois.
 *
 * As listagens públicas (busca, novidades, queridinhos, similares) devolvem um
 * conjunto fixo de colunas, então a exceção vem de uma consulta pública leve
 * (`public_sale_modes`), que traz apenas os produtos que NÃO vendem das duas
 * formas. Quem não está na lista é "Ambos" — o comportamento de sempre.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SaleMode = "DECANT" | "FULL" | "BOTH";

export type SaleModeInfo = {
  sale_mode: SaleMode;
  full_bottle_available: boolean;
  decant_available: boolean;
};

const DEFAULT: SaleModeInfo = { sale_mode: "BOTH", full_bottle_available: true, decant_available: true };

const map = new Map<string, SaleModeInfo>();
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
let loaded = false;

/** Carrega (uma única vez por sessão) as exceções de forma de venda. */
export function loadSaleModes(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const { data } = await supabase.rpc("public_sale_modes");
    for (const row of (data ?? []) as Array<{
      product_id: string;
      sale_mode: string;
      full_bottle_available: boolean;
      decant_available: boolean;
    }>) {
      map.set(row.product_id, {
        sale_mode: (row.sale_mode as SaleMode) ?? "BOTH",
        full_bottle_available: row.full_bottle_available !== false,
        decant_available: row.decant_available !== false,
      });
    }
    loaded = true;
    listeners.forEach((l) => l());
  })().catch(() => {
    // Falha de rede nunca pode esconder o catálogo: segue tudo como "Ambos".
    loaded = true;
  });
  return loading;
}

/** Recarrega após uma edição no Admin (mudança de forma de venda). */
export function refreshSaleModes() {
  map.clear();
  loaded = false;
  loading = null;
  void loadSaleModes();
}

type MaybeProduct =
  | {
      id?: string | null;
      sale_mode?: string | null;
      full_bottle_available?: boolean | null;
      decant_available?: boolean | null;
    }
  | null
  | undefined;

/** Regras do produto: usa as colunas quando vieram, senão a lista pública. */
export function saleModeOf(product: MaybeProduct): SaleModeInfo {
  if (!product) return DEFAULT;
  if (product.sale_mode) {
    const mode = product.sale_mode as SaleMode;
    return {
      sale_mode: mode,
      full_bottle_available: product.full_bottle_available !== false && mode !== "DECANT",
      decant_available: product.decant_available !== false && mode !== "FULL",
    };
  }
  const hit = product.id ? map.get(product.id) : undefined;
  if (hit) return hit;
  return { ...DEFAULT, decant_available: product.decant_available !== false };
}

/** Mantém o componente atualizado quando a lista termina de carregar. */
export function useSaleModes(): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    void loadSaleModes();
    const l = () => bump((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return loaded;
}
