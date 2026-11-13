import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Quem acessa o painel Admin (Configurações › Equipe).
 * - Dono: tudo, inclusive custos/lucro e esta tela.
 * - Admin: opera pedidos, produtos, estoque (sem gerenciar a equipe).
 * Só Dono adiciona, troca papel ou remove. Nunca deixa a loja sem Dono.
 */

export type TeamRole = "owner" | "admin";
export type TeamMember = { userId: string; email: string; name: string | null; role: TeamRole; isMe: boolean; since: string | null };

async function whoAmI(context: { supabase: any; userId: string }) {
  const [{ data: owner }, { data: staff }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "owner" }),
    context.supabase.rpc("is_staff", { _user_id: context.userId }),
  ]);
  if (!staff) throw new Error("Sem permissão.");
  return { isOwner: !!owner };
}

async function staffRows(db: any) {
  const { data } = await db.from("user_roles").select("user_id, role, created_at").in("role", ["owner", "admin"]);
  return (data ?? []) as Array<{ user_id: string; role: TeamRole; created_at: string }>;
}

export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ canManage: boolean; members: TeamMember[] }> => {
    const me = await whoAmI(context as never);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const rows = await staffRows(db);
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const { data: profiles } = ids.length ? await db.from("profiles").select("id, name, email").in("id", ids) : { data: [] };
    const prof = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const members: TeamMember[] = ids.map((id) => {
      const mine = rows.filter((r) => r.user_id === id);
      const role: TeamRole = mine.some((r) => r.role === "owner") ? "owner" : "admin";
      const p: any = prof.get(id);
      return {
        userId: id,
        email: p?.email ?? "",
        name: p?.name ?? null,
        role,
        isMe: id === (context as any).userId,
        since: mine.map((r) => r.created_at).sort()[0] ?? null,
      };
    });
    // email que falta no perfil vem da conta
    for (const m of members.filter((m) => !m.email)) {
      const { data } = await db.auth.admin.getUserById(m.userId);
      m.email = data?.user?.email ?? "";
    }
    members.sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.email.localeCompare(b.email));
    return { canManage: me.isOwner, members };
  });

const cleanEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();

/** Dá acesso ao Admin. Sem conta ainda? Manda convite por e-mail e já deixa o papel pronto. */
export const addTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; role: TeamRole; origin?: string }) => {
    const email = cleanEmail(d?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new Error("E-mail inválido.");
    const role: TeamRole = d?.role === "owner" ? "owner" : "admin";
    const origin = typeof d?.origin === "string" && /^https:\/\/[^\s]+$/.test(d.origin) ? d.origin : undefined;
    return { email, role, origin };
  })
  .handler(async ({ data, context }) => {
    const me = await whoAmI(context as never);
    if (!me.isOwner) throw new Error("Só o dono pode adicionar pessoas.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    let userId: string | null = null;
    const { data: prof } = await db.from("profiles").select("id").ilike("email", data.email).maybeSingle();
    if (prof?.id) userId = prof.id;
    if (!userId) {
      // procura nas contas (perfil pode não existir ainda)
      for (let page = 1; page <= 20 && !userId; page++) {
        const { data: list } = await db.auth.admin.listUsers({ page, perPage: 200 });
        const hit = list?.users?.find((u: any) => cleanEmail(u.email) === data.email);
        if (hit) userId = hit.id;
        if (!list?.users?.length || list.users.length < 200) break;
      }
    }
    let invited = false;
    if (!userId) {
      const { data: inv, error } = await db.auth.admin.inviteUserByEmail(data.email, data.origin ? { redirectTo: `${data.origin}/admin` } : undefined);
      if (error || !inv?.user) throw new Error("Não consegui enviar o convite. Peça para a pessoa criar a conta no site com esse e-mail e tente de novo.");
      userId = inv.user.id;
      invited = true;
    }
    const roles: TeamRole[] = data.role === "owner" ? ["owner"] : ["admin"];
    for (const r of roles) await db.from("user_roles").upsert({ user_id: userId, role: r }, { onConflict: "user_id,role", ignoreDuplicates: true });
    if (data.role === "admin") await db.from("user_roles").delete().eq("user_id", userId).eq("role", "owner");
    return { ok: true as const, invited };
  });

/** Troca entre Dono e Admin. */
export const setTeamRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; role: TeamRole }) => {
    if (typeof d?.userId !== "string") throw new Error("Pessoa inválida.");
    return { userId: d.userId, role: (d.role === "owner" ? "owner" : "admin") as TeamRole };
  })
  .handler(async ({ data, context }) => {
    const me = await whoAmI(context as never);
    if (!me.isOwner) throw new Error("Só o dono pode mudar o acesso.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const rows = await staffRows(db);
    const owners = new Set(rows.filter((r) => r.role === "owner").map((r) => r.user_id));
    if (data.role === "admin" && owners.has(data.userId) && owners.size <= 1) throw new Error("A loja precisa de pelo menos um dono.");
    await db.from("user_roles").upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role", ignoreDuplicates: true });
    await db
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", data.role === "owner" ? "admin" : "owner");
    return { ok: true as const };
  });

/** Tira o acesso ao Admin (a conta continua existindo como cliente). */
export const removeTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => {
    if (typeof d?.userId !== "string") throw new Error("Pessoa inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const me = await whoAmI(context as never);
    if (!me.isOwner) throw new Error("Só o dono pode tirar acesso.");
    if (data.userId === (context as any).userId) throw new Error("Você não pode tirar o seu próprio acesso.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const rows = await staffRows(db);
    const owners = new Set(rows.filter((r) => r.role === "owner").map((r) => r.user_id));
    if (owners.has(data.userId) && owners.size <= 1) throw new Error("A loja precisa de pelo menos um dono.");
    await db.from("user_roles").delete().eq("user_id", data.userId).in("role", ["owner", "admin"]);
    return { ok: true as const };
  });
