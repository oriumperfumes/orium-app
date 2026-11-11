/** WhatsApp Business Platform / Cloud API. Somente backend; sem scraping ou token no cliente. */
export async function sendWhatsappText(recipient: string, body: string): Promise<string> {
  const token = process.env["WHATSAPP_ACCESS_TOKEN"];
  const phoneId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
  if (!token || !phoneId) throw new Error("Configure WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID no servidor.");
  if (!/^\d{8,15}$/.test(recipient)) throw new Error("Destinatário WhatsApp inválido.");
  if (!/^\d{6,30}$/.test(phoneId)) throw new Error("ID do número remetente não configurado corretamente.");
  // Versão configurável para não depender de uma versão expirada da Meta no código.
  const version = process.env["META_GRAPH_API_VERSION"] || "v23.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Versão da API Meta inválida.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch("https://graph.facebook.com/" + version + "/" + phoneId + "/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "text", text: { preview_url: false, body } }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Não registrar corpo/resposta com informações pessoais ou o token.
      console.error("atendimento whatsapp: Graph HTTP", res.status);
      throw new Error("A API oficial recusou o envio (HTTP " + res.status + "). Confira as permissões e a janela de atendimento.");
    }
    const data = (await res.json()) as { messages?: Array<{ id?: string }> };
    const id = data.messages?.[0]?.id;
    if (!id) throw new Error("A Meta não confirmou o identificador da mensagem.");
    return id;
  } finally {
    clearTimeout(timeout);
  }
}

export async function receiveWhatsapp(body: unknown) {
  const payload = body as { object?: string; entry?: Array<{ changes?: Array<{ value?: {
    metadata?: { phone_number_id?: string };
    contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
    messages?: Array<{ id?: string; from?: string; type?: string; text?: { body?: string } }>;
    statuses?: Array<{ id?: string; status?: string }>;
  } }> }> };
  if (payload?.object !== "whatsapp_business_account") return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const expectedPhone = process.env["WHATSAPP_PHONE_NUMBER_ID"];
  if (!expectedPhone) throw new Error("WhatsApp não configurado.");
  for (const entry of (payload.entry ?? []).slice(0, 20)) {
    for (const change of (entry.changes ?? []).slice(0, 20)) {
      const value = change.value;
      if (!value || value.metadata?.phone_number_id !== expectedPhone) continue;
      const { data: channel } = await db.from("omni_channels").select("id").eq("id", "whatsapp").maybeSingle();
      if (!channel) throw new Error("Migração da Central de Atendimento ainda não aplicada.");
      const names = new Map((value.contacts ?? []).map(c => [c.wa_id, c.profile?.name ?? ""]));
      for (const m of (value.messages ?? []).slice(0, 50)) {
        if (!m.id || !m.from || m.type !== "text" || !m.text?.body) continue;
        const { error } = await db.rpc("omni_receive_whatsapp", {
          p_wa_id: m.from, p_name: names.get(m.from) ?? "",
          p_message_id: m.id, p_body: m.text.body.slice(0, 4096),
        });
        if (error) throw new Error("Não foi possível registrar mensagem recebida: " + error.message);
      }
      for (const s of (value.statuses ?? []).slice(0, 50)) {
        if (!s.id || !["sent","delivered","read","failed"].includes(s.status ?? "")) continue;
        const { error } = await db.from("omni_messages")
          .update({ delivery_status: s.status }).eq("external_message_id", s.id);
        if (error) throw new Error(error.message);
      }
      await db.from("omni_channels").update({ connection_status: process.env["WHATSAPP_ACCESS_TOKEN"] ? "connected" : "disconnected", updated_at: new Date().toISOString() }).eq("id", "whatsapp");
    }
  }
}
