/**
 * GERENCIAMENTO DA LOJA — itens que a loja física usa (não são perfumes à venda):
 * papel higiênico, fitas olfativas, frascos de decant, sacolas, etc.
 * Quantidade atual em store_supplies; toda compra, uso ou correção passa por
 * store_supply_move (histórico antes → depois e quanto se gastou). Só a equipe.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SUPPLY_CATEGORIES = [
  "embalagem",
  "decant",
  "limpeza",
  "divulgacao",
  "escritorio",
  "outros",
] as const;
export type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number];
export type SupplyMoveKind = "compra" | "uso" | "ajuste";

export type SupplyItem = {
  id: string;
  name: string;
  category: SupplyCategory;
  unit: string;
  quantity: number;
  min_quantity: number;
  /** soma do que foi pago nas compras */
  spent: number;
  /** custo médio por unidade das compras com valor (null sem compra com valor) */
  avg_cost: number | null;
  updated_at: string;
};

export type SuppliesOverview = {
  items: SupplyItem[];
  spent_month: number;
  spent_total: number;
  low: number;
};

export type SupplyMove = {
  id: string;
  kind: SupplyMoveKind;
  delta: number;
  before_qty: number;
  after_qty: number;
  total_cost: number | null;
  note: string | null;
  created_at: string;
};

const qty = z.number().finite().min(0).max(1_000_000);
const money = z.number().finite().min(0).max(10_000_000);
const name = z.string().trim().min(1, "Dê um nome ao item.").max(80);
const unit = z.string().trim().min(1).max(12);
const note = z.string().trim().max(200).optional();

/** Primeiro dia do mês corrente no relógio de São Paulo (UTC−3, sem horário de verão). */
function monthStartSaoPaulo(now = new Date()) {
  const [y, m] = now
    .toLocaleDateString("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
    })
    .split("-")
    .map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1, 3)).toISOString();
}

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export const suppliesOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SuppliesOverview> => {
    const sb = context.supabase as any;
    const [items, buys] = await Promise.all([
      sb
        .from("store_supplies")
        .select("id, name, category, unit, quantity, min_quantity, updated_at")
        .is("archived_at", null)
        .order("name"),
      sb
        .from("store_supply_moves")
        .select("supply_id, delta, total_cost, created_at")
        .eq("kind", "compra"),
    ]);
    fail(items.error);
    fail(buys.error);

    const since = monthStartSaoPaulo();
    const per = new Map<string, { spent: number; priced: number }>();
    let spentMonth = 0;
    let spentTotal = 0;
    for (const b of (buys.data ?? []) as Array<{
      supply_id: string;
      delta: number;
      total_cost: number | null;
      created_at: string;
    }>) {
      if (b.total_cost == null) continue;
      const cost = Number(b.total_cost);
      const row = per.get(b.supply_id) ?? { spent: 0, priced: 0 };
      row.spent += cost;
      row.priced += Number(b.delta);
      per.set(b.supply_id, row);
      spentTotal += cost;
      if (b.created_at >= since) spentMonth += cost;
    }

    const list: SupplyItem[] = ((items.data ?? []) as any[]).map((r) => {
      const p = per.get(r.id);
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        unit: r.unit,
        quantity: Number(r.quantity),
        min_quantity: Number(r.min_quantity),
        spent: p?.spent ?? 0,
        avg_cost: p && p.priced > 0 ? p.spent / p.priced : null,
        updated_at: r.updated_at,
      };
    });

    return {
      items: list,
      spent_month: spentMonth,
      spent_total: spentTotal,
      low: list.filter(
        (i) => i.quantity <= i.min_quantity && (i.min_quantity > 0 || i.quantity === 0),
      ).length,
    };
  });

export const supplyCreate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name,
        category: z.enum(SUPPLY_CATEGORIES),
        unit,
        quantity: qty,
        total_cost: money.nullable(),
        min_quantity: qty,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const created = await sb
      .from("store_supplies")
      .insert({
        name: data.name,
        category: data.category,
        unit: data.unit,
        min_quantity: data.min_quantity,
      })
      .select("id")
      .single();
    fail(created.error);
    if (data.quantity > 0) {
      const moved = await sb.rpc("store_supply_move", {
        p_supply: created.data.id,
        p_kind: "compra",
        p_quantity: data.quantity,
        p_total_cost: data.total_cost,
        p_note: "Cadastro do item",
      });
      fail(moved.error);
    }
    return { id: created.data.id as string };
  });

export const supplyUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name,
        category: z.enum(SUPPLY_CATEGORIES),
        unit,
        min_quantity: qty,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("store_supplies")
      .update({
        name: data.name,
        category: data.category,
        unit: data.unit,
        min_quantity: data.min_quantity,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    fail(error);
    return { ok: true };
  });

export const supplyMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        kind: z.enum(["compra", "uso", "ajuste"]),
        quantity: qty,
        total_cost: money.nullable().optional(),
        note,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase as any).rpc("store_supply_move", {
      p_supply: data.id,
      p_kind: data.kind,
      p_quantity: data.quantity,
      p_total_cost: data.kind === "compra" ? (data.total_cost ?? null) : null,
      p_note: data.note ?? null,
    });
    fail(error);
    return { quantity: Number(row?.quantity ?? 0) };
  });

export const supplyMoves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SupplyMove[]> => {
    const { data: rows, error } = await (context.supabase as any)
      .from("store_supply_moves")
      .select("id, kind, delta, before_qty, after_qty, total_cost, note, created_at")
      .eq("supply_id", data.id)
      .order("created_at", { ascending: false })
      .limit(60);
    fail(error);
    return ((rows ?? []) as any[]).map((r) => ({
      ...r,
      delta: Number(r.delta),
      before_qty: Number(r.before_qty),
      after_qty: Number(r.after_qty),
      total_cost: r.total_cost == null ? null : Number(r.total_cost),
    }));
  });

/** Tira o item da lista sem apagar o histórico de gastos. */
export const supplyArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("store_supplies")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.id);
    fail(error);
    return { ok: true };
  });
