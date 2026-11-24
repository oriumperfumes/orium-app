/**
 * Porteiro das tarefas automáticas (pg_cron → rotas /api/public/hooks/*).
 * Aceita o segredo do servidor (LOVABLE_CRON_SECRET) ou o segredo guardado no
 * cofre do banco (orium_cron_secret), conferido pelo próprio banco.
 * Devolve uma Response 401 quando não autoriza; null quando pode seguir.
 */
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export async function cronDenied(request: Request): Promise<Response | null> {
  const denied = await authenticateCronRequest(request);
  if (!denied) return null;
  const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!token) return new Response("Unauthorized", { status: 401 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: ok } = await (supabaseAdmin as any).rpc("orium_cron_ok", { p_token: token });
  return ok ? null : new Response("Unauthorized", { status: 401 });
}
