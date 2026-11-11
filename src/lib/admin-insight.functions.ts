import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Camada operacional do catálogo (Visão Admin).
 *
 * Custo, fornecedor, margem e estoque real NUNCA saem daqui sem que o backend
 * confirme, pela role gravada no banco, que quem pediu é owner/admin.
 * Cliente comum recebe erro de permissão — não existe versão "escondida no CSS".
 *
 * Consulta agregada: 2 buscas para o lote inteiro de produtos visíveis,
 * nunca uma por card.
 */

export type AdminOffer = {
  supplier: string;
  price: number | null;
  inStock: boolean;
  stockQuantity: number | null;
  rawName: string;
  url: string | null;
  syncedAt: string | null;
};

export type AdminProductInsight = {
  productId: string;
  cost: number | null;
  retailPrice: number | null;
  wholesalePrice: number | null;
  /** venda − custo (varejo) */
  margin: number | null;
  stockQuantity: number | null;
  inStock: boolean;
  bestSupplier: string | null;
  offers: AdminOffer[];
  updatedAt: string | null;
  lastSyncedAt: string | null;
};

type OfferRow = {
  product_id: string | null;
  supplier_id: string;
  supplier_product_name: string;
  price: number | null;
  in_stock: boolean;
  stock_quantity: number | null;
  url: string | null;
  last_synced_at: string;
  suppliers?: { name?: string | null } | null;
};

export const getAdminCatalogInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { productIds: string[] }) => data)
  .handler(async ({ data, context }): Promise<AdminProductInsight[]> => {
    const { supabase, userId } = context;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
    if (!isStaff) throw new Error("Sem permissão.");

    const ids = [...new Set((data.productIds ?? []).filter(Boolean))].slice(0, 240);
    if (!ids.length) return [];

    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const [{ data: products }, { data: offersRaw }] = await Promise.all([
      db
        .from("products")
        .select("id, retail_price, wholesale_price, stock_quantity, in_stock, updated_at")
        .in("id", ids),
      db
        .from("supplier_products")
        .select(
          "product_id, supplier_id, supplier_product_name, price, in_stock, stock_quantity, url, last_synced_at, suppliers(name)",
        )
        .in("product_id", ids)
        .eq("active", true),
    ]);

    const byProduct = new Map<string, AdminOffer[]>();
    for (const raw of (offersRaw ?? []) as OfferRow[]) {
      if (!raw.product_id) continue;
      const list = byProduct.get(raw.product_id) ?? [];
      list.push({
        supplier: raw.suppliers?.name ?? "Fornecedor",
        price: raw.price == null ? null : Number(raw.price),
        inStock: Boolean(raw.in_stock),
        stockQuantity: raw.stock_quantity,
        rawName: raw.supplier_product_name,
        url: raw.url,
        syncedAt: raw.last_synced_at ?? null,
      });
      byProduct.set(raw.product_id, list);
    }

    return (products ?? []).map((p) => {
      const offers = (byProduct.get(p.id) ?? []).sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
      const priced = offers.filter((o) => o.price != null);
      const inStock = priced.filter((o) => o.inStock);
      // mesma regra oficial de preço: preço médio (mediana) dos fornecedores manda
      const pool = inStock.length ? inStock : priced;
      const mid = pool.length ? (pool.length - 1) / 2 : 0;
      const medianCost = pool.length
        ? Number(((Number(pool[Math.floor(mid)].price) + Number(pool[Math.ceil(mid)].price)) / 2).toFixed(2))
        : null;
      const winner = pool.length
        ? pool.reduce((a, b) =>
            Math.abs(Number(b.price) - medianCost!) < Math.abs(Number(a.price) - medianCost!) ? b : a,
          )
        : null;
      const retail = p.retail_price == null ? null : Number(p.retail_price);
      const cost = medianCost;
      const syncedAt = offers
        .map((o) => o.syncedAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
      return {
        productId: p.id,
        cost,
        retailPrice: retail,
        wholesalePrice: p.wholesale_price == null ? null : Number(p.wholesale_price),
        margin: retail != null && cost != null ? Number((retail - cost).toFixed(2)) : null,
        stockQuantity: p.stock_quantity,
        inStock: Boolean(p.in_stock),
        bestSupplier: winner?.supplier ?? null,
        offers,
        updatedAt: p.updated_at ?? null,
        lastSyncedAt: syncedAt,
      };
    });
  });

/**
 * Linha completa do produto (inclui custo manual e preços-base).
 *
 * A tabela `products` não expõe mais colunas de custo/margem para o role
 * `authenticated`; somente esta função, após confirmar owner/admin no banco,
 * devolve a linha inteira.
 */
export const getAdminProductRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
    if (!isStaff) throw new Error("Sem permissão.");

    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await db.from("products").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });
