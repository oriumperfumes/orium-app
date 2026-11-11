/**
 * Orium Copilot — conversas, confirmação, desfazer, histórico e configurações.
 * Toda escrita passa pelo servidor com o usuário autenticado e staff.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

async function ctx(threadId: string | null = null) {
  const { copilotContext, bearer } = await import("@/lib/copilot/context.server");
  const req = getRequest();
  return copilotContext(req ? bearer(req) : null, threadId);
}

export type ThreadSummary = { id: string; title: string | null; updated_at: string };

export const copilotThreads = createServerFn({ method: "GET" }).handler(async () => {
  const c = await ctx();
  const { data, error } = await c.userDb.from("copilot_threads").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(40);
  if (error) throw new Error(error.message);
  return (data ?? []) as ThreadSummary[];
});

export const copilotThread = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    const { data: row } = await c.userDb.from("copilot_threads").select("id, title, messages").eq("id", data.id).maybeSingle();
    return row ? { id: row.id as string, title: (row.title ?? null) as string | null, messagesJson: JSON.stringify(row.messages ?? []) } : null;
  });

export const copilotCreateThread = createServerFn({ method: "POST" }).handler(async () => {
  const c = await ctx();
  const { data, error } = await c.userDb.from("copilot_threads").insert({ user_id: c.userId }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id as string };
});

export const copilotDeleteThread = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    await c.userDb.from("copilot_threads").delete().eq("id", data.id);
    return { ok: true };
  });

export const copilotConfirm = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ actionId: z.string().uuid(), voice: z.boolean().optional() }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    const { executeAction } = await import("@/lib/copilot/registry.server");
    return executeAction(c, data.actionId, { voice: data.voice === true });
  });

/** "Sim" por voz: só vale para a pendência mais recente e ainda válida da conversa. */
export const copilotConfirmLatest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ threadId: z.string().uuid(), actionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx(data.threadId);
    const { data: latest } = await c.userDb
      .from("copilot_actions")
      .select("id, created_at")
      .eq("thread_id", data.threadId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest || latest.id !== data.actionId) throw new Error("Não há ação pendente para confirmar agora.");
    if (Date.now() - Date.parse(latest.created_at) > 90_000) throw new Error("A confirmação por voz expirou. Toque em Confirmar ou peça de novo.");
    const { executeAction } = await import("@/lib/copilot/registry.server");
    return executeAction(c, data.actionId, { voice: true });
  });

export const copilotCancel = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ actionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    await c.userDb.from("copilot_actions").update({ status: "canceled" }).eq("id", data.actionId).eq("status", "pending");
    return { ok: true };
  });

export const copilotUndo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ actionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    const { undoAction } = await import("@/lib/copilot/registry.server");
    return undoAction(c, data.actionId);
  });

export type CopilotActionLog = {
  id: string;
  tool: string;
  intent: string;
  risk: string;
  status: string;
  utterance: string | null;
  preview: any;
  result: any;
  error: string | null;
  created_at: string;
  executed_at: string | null;
  user_id: string;
  user_name: string | null;
};

export const copilotHistory = createServerFn({ method: "GET" }).handler(async () => {
  const c = await ctx();
  const { data, error } = await c.userDb
    .from("copilot_actions")
    .select("id, tool, intent, risk, status, utterance, preview, result, error, created_at, executed_at, user_id")
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  const ids = Array.from(new Set((data ?? []).map((a: any) => a.user_id)));
  const { data: profiles } = ids.length ? await c.adminDb.from("profiles").select("id, name, email").in("id", ids) : { data: [] };
  const names = new Map((profiles ?? []).map((p: any) => [p.id, p.name ?? p.email ?? null]));
  return (data ?? []).map((a: any) => ({ ...a, user_name: names.get(a.user_id) ?? null })) as CopilotActionLog[];
});

export const copilotSettings = createServerFn({ method: "GET" }).handler(async () => {
  const c = await ctx();
  const [{ data: commands }, { data: aliases }] = await Promise.all([
    c.userDb.from("copilot_commands").select("*").order("created_at"),
    c.userDb.from("copilot_aliases").select("*").order("created_at"),
  ]);
  return { commands: commands ?? [], aliases: aliases ?? [], roles: c.roles };
});

export const copilotSaveCommand = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid().nullable(), name: z.string().min(1).max(60), phrases: z.array(z.string().min(1).max(120)).min(1).max(12), instructions: z.string().min(3).max(600), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const c = await ctx();
    const row = { name: data.name.trim(), phrases: data.phrases.map((p) => p.trim()), instructions: data.instructions.trim(), active: data.active, updated_at: new Date().toISOString() };
    const { error } = data.id ? await c.userDb.from("copilot_commands").update(row).eq("id", data.id) : await c.userDb.from("copilot_commands").insert(row);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const copilotDeleteCommand = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), kind: z.enum(["command", "alias"]) }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    await c.userDb.from(data.kind === "command" ? "copilot_commands" : "copilot_aliases").delete().eq("id", data.id);
    return { ok: true };
  });

export const copilotSaveAlias = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ phrase: z.string().min(2).max(60), meaning: z.string().min(3).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    const { error } = await c.userDb.from("copilot_aliases").insert({ phrase: data.phrase.trim().toLowerCase(), meaning: data.meaning.trim() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Estoque Orium + disponibilidade para a ficha do produto no Admin. */
export const productInventory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ productId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const c = await ctx();
    const { productSnapshot } = await import("@/lib/copilot/registry.server");
    const snap = await productSnapshot(c, data.productId);
    const { data: moves } = await c.userDb
      .from("inventory_movements")
      .select("delta, before_qty, after_qty, reason, source, created_at")
      .eq("product_id", data.productId)
      .order("created_at", { ascending: false })
      .limit(8);
    return { snap, moves: moves ?? [] };
  });

export const productInventoryAdjust = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ productId: z.string().uuid(), mode: z.enum(["set", "add", "remove"]).nullable(), quantity: z.number().int().min(0).max(9999).nullable(), override: z.enum(["none", "available", "blocked"]).nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const c = await ctx();
    const { setLocalStock, setAvailabilityMode, OVERRIDE_TO_MODE } = await import("@/lib/product-admin.server");
    if (data.mode && data.quantity != null) await setLocalStock(c, { productId: data.productId, mode: data.mode, quantity: data.quantity, source: "painel" });
    if (data.override) await setAvailabilityMode(c, { productId: data.productId, mode: OVERRIDE_TO_MODE[data.override]!, source: "painel" });
    return { ok: true };
  });
