/**
 * Notificações do painel — funções chamadas pelo app.
 *
 * Só ADMIN/OWNER podem registrar aparelhos. Cliente comum nunca aparece aqui:
 * a identidade vem da sessão verificada no servidor, não do corpo do pedido.
 */
import { createServerFn } from "@tanstack/react-start";

export type PushDeviceState = {
  /** Chave pública VAPID (pode ser pública por definição). */
  publicKey: string | null;
  staff: boolean;
  /** Este aparelho já está registrado e ativo. */
  enabled: boolean;
};

export const getPushState = createServerFn({ method: "POST" })
  .inputValidator((data: { endpoint?: string | null }) => data)
  .handler(async ({ data }): Promise<PushDeviceState> => {
    const { verifiedViewerId } = await import("@/lib/viewer.server");
    const { isStaffUser, pushPublicKey } = await import("@/lib/push.server");
    const userId = await verifiedViewerId();
    const staff = await isStaffUser(userId);
    if (!staff) return { publicKey: null, staff: false, enabled: false };

    let enabled = false;
    if (data.endpoint) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row } = await supabaseAdmin
        .from("push_devices")
        .select("enabled, revoked_at")
        .eq("endpoint", data.endpoint)
        .eq("user_id", userId!)
        .maybeSingle();
      enabled = !!row?.enabled && !row?.revoked_at;
    }
    return { publicKey: pushPublicKey(), staff: true, enabled };
  });

export const savePushDevice = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      endpoint: string;
      p256dh: string;
      auth: string;
      deviceLabel?: string | null;
      userAgent?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { verifiedViewerId } = await import("@/lib/viewer.server");
    const { isStaffUser } = await import("@/lib/push.server");
    const userId = await verifiedViewerId();
    if (!(await isStaffUser(userId))) throw new Error("Acesso restrito à equipe da Orium.");
    if (!/^https:\/\//i.test(data.endpoint)) throw new Error("Inscrição inválida.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Um mesmo Admin pode ter iPhone, PC e notebook: cada endpoint é um
    // aparelho próprio e nunca substitui o outro.
    const { error } = await supabaseAdmin.from("push_devices").upsert(
      {
        user_id: userId!,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        device_label: data.deviceLabel?.slice(0, 80) ?? null,
        user_agent: data.userAgent?.slice(0, 300) ?? null,
        enabled: true,
        revoked_at: null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error("Não foi possível ativar as notificações agora.");
    return { ok: true };
  });

export const disablePushDevice = createServerFn({ method: "POST" })
  .inputValidator((data: { endpoint: string }) => data)
  .handler(async ({ data }) => {
    const { verifiedViewerId } = await import("@/lib/viewer.server");
    const { isStaffUser } = await import("@/lib/push.server");
    const userId = await verifiedViewerId();
    if (!(await isStaffUser(userId))) throw new Error("Acesso restrito à equipe da Orium.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("push_devices")
      .update({ enabled: false, revoked_at: new Date().toISOString() })
      .eq("endpoint", data.endpoint)
      .eq("user_id", userId!);
    return { ok: true };
  });

/** Aviso de teste — só a própria equipe consegue disparar. */
export const sendPushTest = createServerFn({ method: "POST" }).handler(async () => {
  const { verifiedViewerId } = await import("@/lib/viewer.server");
  const { isStaffUser, notifyStaff } = await import("@/lib/push.server");
  const userId = await verifiedViewerId();
  if (!(await isStaffUser(userId))) throw new Error("Acesso restrito à equipe da Orium.");
  const sent = await notifyStaff({
    title: "Notificações ativas",
    body: "Você vai receber novos pedidos e interesses de clientes por aqui.",
    url: "/admin",
    tag: "orium-teste",
  });
  return { sent };
});
