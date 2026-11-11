import { createClient } from "@supabase/supabase-js";
import type { CopilotCtx, Role } from "./registry.server";

/** Valida o token, confere staff e monta os dois clientes (usuário + privilegiado). */
export async function copilotContext(token: string | null, threadId: string | null = null): Promise<CopilotCtx> {
  if (!token) throw new Response("Sem permissão.", { status: 401 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.getUser(token);
  const userId = data?.user?.id;
  if (!userId) throw new Response("Sem permissão.", { status: 401 });
  const userDb = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isStaff } = await userDb.rpc("is_staff", { _user_id: userId });
  if (!isStaff) throw new Response("Sem permissão.", { status: 403 });
  const { data: roleRows } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((r: any) => r.role).filter((r: string) => r === "owner" || r === "admin") as Role[];
  return { userDb, adminDb: supabaseAdmin as any, userId, roles, threadId };
}

export function bearer(request: Request) {
  const auth = request.headers.get("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}
