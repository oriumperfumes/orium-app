/**
 * INTERESSE EM NEGOCIAÇÃO — registrado quando o cliente informa o nome e
 * segue para o WhatsApp.
 *
 * O WhatsApp abre na hora: esta chamada acontece em segundo plano e, se
 * falhar, nada muda para o cliente.
 */
import { createServerFn } from "@tanstack/react-start";

/** Janela curta anti-repetição: 5 cliques seguidos = 1 aviso. */
const DEDUPE_MINUTES = 5;

export const recordNegotiationInterest = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { itemId: string; visitorId?: string | null; customerName?: string | null }) => data,
  )
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: item } = await supabaseAdmin
        .from("negotiation_items")
        .select("id, name, brand")
        .eq("id", data.itemId)
        .maybeSingle();
      if (!item) return { ok: false };

      const visitor = data.visitorId?.slice(0, 80) ?? null;
      const customerName = data.customerName?.trim().slice(0, 80) || null;
      const since = new Date(Date.now() - DEDUPE_MINUTES * 60_000).toISOString();
      const { data: recent } = await supabaseAdmin
        .from("negotiation_interests")
        .select("id")
        .eq("negotiation_item_id", item.id)
        .eq("visitor_id", visitor ?? "")
        .gte("created_at", since)
        .limit(1);
      const duplicate = !!visitor && !!recent?.length;

      const { verifiedViewerId } = await import("@/lib/viewer.server");
      const userId = await verifiedViewerId();

      // O nome informado aqui cria (ou atualiza) a ficha do cliente no CRM.
      // A identidade é o aparelho: negociar outro perfume atualiza a MESMA ficha.
      let customerId: string | null = null;
      if (visitor || userId) {
        const args: { p_name?: string; p_device_id?: string; p_user_id?: string } = {};
        if (customerName) args.p_name = customerName;
        if (visitor) args.p_device_id = visitor;
        if (userId) args.p_user_id = userId;
        const { data: cid } = await supabaseAdmin.rpc("crm_upsert_customer", args);
        customerId = (cid as string | null) ?? null;
      }

      await supabaseAdmin.from("negotiation_interests").insert({
        negotiation_item_id: item.id,
        item_name: item.name,
        customer_name: customerName,
        customer_id: customerId,
        visitor_id: visitor,
        user_id: userId,
        notified: !duplicate,
      });

      if (duplicate) return { ok: true, notified: false };

      const { notifyStaff } = await import("@/lib/push.server");
      await notifyStaff({
        title: "Novo interesse em negociação",
        body: `${customerName ?? "Um cliente"} demonstrou interesse no ${item.name}.`,
        url: `/admin/negociacao?item=${item.id}`,
        tag: `negociacao-${item.id}`,
      });
      return { ok: true, notified: true };
    } catch {
      return { ok: false };
    }
  });
