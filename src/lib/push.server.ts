/**
 * WEB PUSH — envio real, feito no servidor.
 *
 * As chaves VAPID vivem apenas em variáveis de ambiente do servidor: nunca
 * chegam ao navegador. O envio não depende do navegador do Admin estar aberto.
 */
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

export type StaffNotification = {
  title: string;
  body: string;
  /** Rota interna aberta ao tocar na notificação. */
  url: string;
  /** Agrupa avisos equivalentes (evita empilhar repetições). */
  tag?: string;
};

type DeviceRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function vapid() {
  const subject = process.env["VAPID_SUBJECT"];
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  if (!subject || !publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

export function pushPublicKey(): string | null {
  return process.env["VAPID_PUBLIC_KEY"] ?? null;
}

/** Confere no banco se o usuário é admin/owner (nunca confiar no cliente). */
export async function isStaffUser(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("is_staff", { _user_id: userId });
  if (error) return false;
  return data === true;
}

/**
 * Envia um aviso para todos os aparelhos ativos da equipe.
 * Nunca lança: uma falha de push não pode derrubar pedido ou navegação.
 */
export async function notifyStaff(notification: StaffNotification): Promise<number> {
  const keys = vapid();
  if (!keys) return 0;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("push_devices")
      .select("id, endpoint, p256dh, auth")
      .eq("enabled", true)
      .is("revoked_at", null);
    if (error || !data?.length) return 0;

    let sent = 0;
    await Promise.allSettled(
      (data as DeviceRow[]).map(async (device) => {
        const subscription: PushSubscription = {
          endpoint: device.endpoint,
          expirationTime: null,
          keys: { p256dh: device.p256dh, auth: device.auth },
        };
        const payload = await buildPushPayload(
          {
            data: JSON.stringify({
              title: notification.title,
              body: notification.body,
              url: notification.url,
              tag: notification.tag ?? null,
            }),
            options: { ttl: 60 * 60 },
          },
          subscription,
          keys,
        );
        const res = await fetch(device.endpoint, payload);
        if (res.status === 404 || res.status === 410) {
          await supabaseAdmin
            .from("push_devices")
            .update({ enabled: false, revoked_at: new Date().toISOString() })
            .eq("id", device.id);
          return;
        }
        if (res.ok) {
          sent += 1;
          await supabaseAdmin
            .from("push_devices")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", device.id);
        }
      }),
    );
    return sent;
  } catch {
    return 0;
  }
}
