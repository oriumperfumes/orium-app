/**
 * Widgets (Admin): prévia com dados reais e as chaves de cada aparelho.
 * A chave só aparece uma vez, ao gerar; no banco fica apenas o hash.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WidgetSummary } from "@/lib/widget.server";

export type { WidgetSummary, WidgetOrder, WidgetPhase } from "@/lib/widget.server";

async function requireStaff(context: { supabase: any; userId: string }) {
  const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!isStaff) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export const widgetPreview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WidgetSummary> => {
    const db = await requireStaff(context as never);
    const { buildWidgetSummary } = await import("@/lib/widget.server");
    return buildWidgetSummary(db);
  });

export type WidgetKey = { id: string; name: string; hint: string; createdAt: string; lastUsedAt: string | null; revoked: boolean };

export const listWidgetKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WidgetKey[]> => {
    const db = await requireStaff(context as never);
    const { data } = await db.from("widget_keys").select("*").order("created_at", { ascending: false });
    return (data ?? []).map((k: any) => ({ id: k.id, name: k.name, hint: k.token_hint, createdAt: k.created_at, lastUsedAt: k.last_used_at, revoked: !!k.revoked_at }));
  });

export const createWidgetKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    const { newWidgetToken, sha256 } = await import("@/lib/widget.server");
    const token = newWidgetToken();
    const name = (data.name ?? "").trim().slice(0, 60) || "Aparelho";
    const { error } = await db.from("widget_keys").insert({
      name,
      token_hash: await sha256(token),
      token_hint: `…${token.slice(-4)}`,
      created_by: (context as any).userId,
    });
    if (error) throw new Error("Não foi possível gerar a chave.");
    return { token, name };
  });

export const revokeWidgetKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context as never);
    await db.from("widget_keys").update({ revoked_at: new Date().toISOString() }).eq("id", data.id);
    return { ok: true as const };
  });
