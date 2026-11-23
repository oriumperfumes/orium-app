/**
 * CRM + WhatsApp — só equipe. Leitura/escrita pelo cliente do usuário (RLS is_staff);
 * custo e margem passam pelas ferramentas oficiais do Copilot (getProductCosts exige owner/admin).
 * Enviar = colocar na fila wa_outbox; a ponte entrega. Nada sai sem clique.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { LeadRaw } from "@/lib/crm-intel";

export type WaContact = {
  jid: string;
  phone_normalized: string | null;
  push_name: string | null;
  customer_id: string | null;
  stage: "novo" | "interessado" | "negociando" | "comprou" | "perdido";
  unread: number;
  pinned: boolean;
  archived: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_from_me: boolean | null;
  last_inbound_at: string | null;
  customer: { name: string | null } | null;
};
export type WaMessage = {
  id: string;
  jid: string;
  from_me: boolean;
  body: string | null;
  kind: string;
  ts: string;
  pending?: "pending" | "sending" | "failed";
  error?: string | null;
};
export type WaBridge = {
  status: "offline" | "qr" | "connecting" | "online";
  qr: string | null;
  phone: string | null;
  last_seen: string | null;
};

export type PerfumeQuote = {
  product_id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  volume_ml: number | null;
  term: string | null;
  confidence: "alta" | "media" | "manual";
  frasco: {
    pix: number;
    card: number | null;
    base: number;
    promo: number | null;
    cost: number | null;
    profit: number | null;
    margin: number | null;
  } | null;
  decants: Array<{ ml: number; pix: number; cost: number | null; profit: number | null }>;
  stock: number;
  ready: boolean;
  slug: string | null;
};

const STAGES = ["novo", "interessado", "negociando", "comprou", "perdido"] as const;

async function staffCtx(context: { supabase: any; userId: string }) {
  const { data: ok } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!ok) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  const roles = (roleRows ?? [])
    .map((r: any) => String(r.role))
    .filter((r: string) => r === "owner" || r === "admin") as Array<"owner" | "admin">;
  return {
    userDb: context.supabase,
    adminDb: supabaseAdmin as any,
    userId: context.userId,
    roles,
    threadId: null,
  };
}

export const crmLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any).rpc("crm_leads");
    if (error) throw new Error(error.message);
    return (data ?? []) as LeadRaw[];
  });

export const waInbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const [{ data, error }, { data: bridge }] = await Promise.all([
      db
        .from("wa_contacts")
        .select(
          "jid, phone_normalized, push_name, customer_id, stage, unread, pinned, archived, last_message_at, last_message_preview, last_from_me, last_inbound_at, customer:crm_customers(name)",
        )
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(300),
      db.from("wa_bridge_state").select("status, qr, phone, last_seen").maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    return {
      contacts: (data ?? []) as WaContact[],
      bridge: (bridge ?? { status: "offline", qr: null, phone: null, last_seen: null }) as WaBridge,
    };
  });

export const waThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jid: string }) => d)
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const [{ data: msgs, error }, { data: out }] = await Promise.all([
      db
        .from("wa_messages")
        .select("id, jid, from_me, body, kind, ts")
        .eq("jid", data.jid)
        .order("ts", { ascending: false })
        .limit(120),
      db
        .from("wa_outbox")
        .select("id, jid, body, status, error, created_at")
        .eq("jid", data.jid)
        .in("status", ["pending", "sending", "failed"])
        .order("created_at"),
    ]);
    if (error) throw new Error(error.message);
    const list = ((msgs ?? []) as WaMessage[]).reverse();
    for (const o of (out ?? []) as any[])
      list.push({
        id: `out:${o.id}`,
        jid: o.jid,
        from_me: true,
        body: o.body,
        kind: "text",
        ts: o.created_at,
        pending: o.status,
        error: o.error,
      });
    return list;
  });

export const waSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jid: string; body: string }) => {
    const body = String(d.body ?? "").trim();
    if (!body) throw new Error("Mensagem vazia.");
    if (body.length > 4000) throw new Error("Mensagem longa demais.");
    if (!/@s\.whatsapp\.net$/.test(d.jid)) throw new Error("Conversa inválida.");
    return { jid: d.jid, body };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { error } = await db.from("wa_outbox").insert({ jid: data.jid, body: data.body });
    if (error) throw new Error(error.message);
    await db.from("wa_contacts").update({ unread: 0 }).eq("jid", data.jid);
    return { ok: true };
  });

/** Começa conversa com um cliente do CRM (cria o contato se ainda não existe). */
export const waOpenForCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { customerId: string }) => d)
  .handler(async ({ data, context }) => {
    const ctx = await staffCtx(context as any);
    const { data: c } = await ctx.adminDb
      .from("crm_customers")
      .select("id, phone_normalized")
      .eq("id", data.customerId)
      .maybeSingle();
    const phone = c?.phone_normalized as string | null;
    if (!phone || phone.length !== 11) throw new Error("Esse cliente não tem celular válido.");
    const jid = `55${phone}@s.whatsapp.net`;
    const { data: existing } = await ctx.adminDb
      .from("wa_contacts")
      .select("jid")
      .or(`jid.eq.${jid},phone_normalized.eq.${phone}`)
      .limit(1);
    if (existing?.[0]) {
      await ctx.adminDb
        .from("wa_contacts")
        .update({ customer_id: c.id })
        .eq("jid", existing[0].jid)
        .is("customer_id", null);
      return { jid: existing[0].jid as string };
    }
    const { error } = await ctx.adminDb
      .from("wa_contacts")
      .insert({ jid, phone_normalized: phone, customer_id: c.id });
    if (error) throw new Error(error.message);
    return { jid };
  });

export const waUpdateContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { jid: string; stage?: string; unread?: 0; pinned?: boolean; archived?: boolean }) => {
      if (d.stage && !(STAGES as readonly string[]).includes(d.stage))
        throw new Error("Etapa inválida.");
      return d;
    },
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of ["stage", "unread", "pinned", "archived"] as const)
      if (data[k] !== undefined) patch[k] = data[k];
    const { error } = await (context.supabase as any)
      .from("wa_contacts")
      .update(patch)
      .eq("jid", data.jid);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Liga a conversa a um cliente existente ou cria a ficha com o nome informado. */
export const waLinkCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jid: string; customerId?: string | null; createName?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const ctx = await staffCtx(context as any);
    let id = data.customerId ?? null;
    if (!id && data.createName?.trim()) {
      const { data: wc } = await ctx.adminDb
        .from("wa_contacts")
        .select("phone_normalized")
        .eq("jid", data.jid)
        .maybeSingle();
      const phone = wc?.phone_normalized ?? null;
      const { data: created, error } = await ctx.adminDb
        .from("crm_customers")
        .insert({
          name: data.createName.trim().slice(0, 120),
          phone,
          phone_normalized: phone,
          first_source: "whatsapp",
          lead_trigger: "whatsapp",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      id = created.id;
    }
    const { error } = await ctx.adminDb
      .from("wa_contacts")
      .update({ customer_id: id })
      .eq("jid", data.jid);
    if (error) throw new Error(error.message);
    return { customerId: id };
  });

export const crmCustomerSearch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q: string }) => d)
  .handler(async ({ data, context }) => {
    const q = data.q.trim().replace(/[%,()]/g, " ");
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    let query = (context.supabase as any)
      .from("crm_customers")
      .select("id, name, phone_normalized")
      .is("archived_at", null)
      .limit(8);
    query =
      digits.length >= 4
        ? query.ilike("phone_normalized", `%${digits}%`)
        : query.ilike("name", `%${q}%`);
    const { data: rows } = await query;
    return (rows ?? []) as Array<{
      id: string;
      name: string | null;
      phone_normalized: string | null;
    }>;
  });

/** Gera um token novo para a ponte (o antigo para de valer). */
export const waNewBridgeToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any).rpc("wa_bridge_new_token");
    if (error) throw new Error(error.message);
    return { token: data as string };
  });

// ---------- detector de perfume ----------
let mentionCache: { at: number; index: import("@/lib/perfume-mentions").MentionIndex } | null =
  null;

async function mentionIndex(db: any) {
  if (mentionCache && Date.now() - mentionCache.at < 5 * 60_000) return mentionCache.index;
  const { buildMentionIndex } = await import("@/lib/perfume-mentions");
  const { data: products } = await db
    .from("products")
    .select("id, canonical_name, brand, in_stock, local_stock, search_aliases")
    .eq("active", true)
    .eq("product_type", "PERFUME")
    .limit(6000);
  const rows = new Map<
    string,
    { id: string; name: string; brand: string | null; terms: string[]; in_stock: boolean }
  >();
  const byName = new Map<string, string[]>();
  const { flat } = await import("@/lib/perfume-mentions");
  for (const p of (products ?? []) as any[]) {
    if (!p.canonical_name) continue;
    rows.set(p.id, {
      id: p.id,
      name: p.canonical_name,
      brand: p.brand,
      terms: (p.search_aliases ?? []).filter(Boolean),
      in_stock: !!p.in_stock || Number(p.local_stock ?? 0) > 0,
    });
    const k = flat(p.canonical_name);
    byName.set(k, [...(byName.get(k) ?? []), p.id]);
  }
  const { data: aliases } = await db
    .from("perfume_aliases")
    .select("alias, perfume_identity_registry(canonical_name)")
    .limit(20000);
  for (const a of (aliases ?? []) as any[]) {
    const name = a.perfume_identity_registry?.canonical_name;
    if (!a.alias || !name) continue;
    for (const id of byName.get(flat(name)) ?? []) rows.get(id)!.terms.push(a.alias);
  }
  const index = buildMentionIndex([...rows.values()]);
  mentionCache = { at: Date.now(), index };
  return index;
}

/** Perfumes citados no texto (ou ids escolhidos) com preço final, custo, lucro e estoque. */

type StaffCtx = Awaited<ReturnType<typeof staffCtx>>;

/** Preço final, custo, lucro e estoque dos perfumes citados no texto (ou ids escolhidos). */
async function quotesFor(
  ctx: StaffCtx,
  data: { text: string; productIds: string[] },
): Promise<PerfumeQuote[]> {
  const hits: Array<{
    productId: string;
    term: string | null;
    confidence: PerfumeQuote["confidence"];
  }> = data.productIds.map((id) => ({ productId: id, term: null, confidence: "manual" }));
  if (data.text) {
    const { findMentions } = await import("@/lib/perfume-mentions");
    for (const m of findMentions(data.text, await mentionIndex(ctx.adminDb), 3))
      hits.push({ productId: m.productId, term: m.term, confidence: m.confidence });
  }
  if (!hits.length) return [] as PerfumeQuote[];
  const { getProductPrices, getProductCosts } = await import("@/lib/copilot/pricing-tools.server");
  const { data: prows } = await ctx.adminDb
    .from("products")
    .select("id, image_url, slug, local_stock, ready_to_deliver, volume_ml")
    .in(
      "id",
      hits.map((h) => h.productId),
    );
  const extra = new Map(((prows ?? []) as any[]).map((p) => [p.id, p]));
  const canCost = ctx.roles.length > 0;
  const out: PerfumeQuote[] = [];
  for (const h of hits) {
    try {
      const prices: any = await getProductPrices(ctx as any, h.productId);
      const costs: any = canCost
        ? await getProductCosts(ctx as any, h.productId).catch(() => null)
        : null;
      const p = extra.get(h.productId) ?? {};
      const f = prices.frasco;
      out.push({
        product_id: h.productId,
        name: prices.product?.name,
        brand: prices.product?.brand ?? null,
        image_url: p.image_url ?? prices.product?.image_url ?? null,
        volume_ml: p.volume_ml ?? null,
        term: h.term,
        confidence: h.confidence,
        frasco: f
          ? {
              pix: f.pix,
              card: f.card ?? null,
              base: f.base_price,
              promo: f.promotion?.percent ?? null,
              cost: costs?.frasco?.cost ?? costs?.bottle_cost ?? null,
              profit: costs?.frasco?.profit ?? null,
              margin: costs?.frasco?.margin_percent ?? null,
            }
          : null,
        decants: [5, 10]
          .map((ml) => {
            const d = prices[`decant_${ml}ml`];
            const c = costs?.[`decant_${ml}ml`];
            return d ? { ml, pix: d.pix, cost: c?.cost ?? null, profit: c?.profit ?? null } : null;
          })
          .filter(Boolean) as PerfumeQuote["decants"],
        stock: Number(p.local_stock ?? 0),
        ready: !!p.ready_to_deliver || Number(p.local_stock ?? 0) > 0,
        slug: p.slug ?? null,
      });
    } catch (e) {
      console.error("crmPerfumeQuote", h.productId, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

export const crmPerfumeQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { text?: string; productIds?: string[] }) => ({
    text: String(d.text ?? "").slice(0, 2000),
    productIds: (d.productIds ?? []).slice(0, 4),
  }))
  .handler(async ({ data, context }) => {
    const ctx = await staffCtx(context as any);
    return quotesFor(ctx, data);
  });

// ---------- resposta ideal (IA) ----------

export type ReplySuggestion = { reply: string; short: string; why: string; next_step: string };

const REPLY_SYSTEM = `Você é o melhor vendedor da Orium Perfumes, loja de perfumes árabes no Rio de Janeiro, respondendo clientes pelo WhatsApp.
Objetivo: fazer o cliente comprar agora, com a menor chance de erro.
Regras:
- Português do Brasil, tom humano e próximo de WhatsApp. Curto: no máximo 3 frases curtas. 0 a 2 emojis.
- NUNCA invente preço, estoque, prazo, desconto, cupom ou brinde. Use só os dados fornecidos. Sem preço nos dados: diga que vai confirmar o valor.
- Nunca fale de custo, margem ou lucro. Nunca diga que viu os dados de navegação do cliente de forma invasiva ("vi que você curtiu" é ok; números de visitas não).
- Se perguntou preço: dê o preço no Pix (e cartão, se houver) dos dados e, se houver desconto Pix, destaque. Se tiver frasco pronta na loja, diga que pode retirar hoje.
- Se o preço parecer alto para o perfil, ofereça o decant como alternativa (se houver nos dados).
- Retirada na loja é grátis. Entrega: o valor é combinado pelo WhatsApp. Não fale "sob encomenda" nem prazos longos.
- Sobre o perfume: descreva o estilo de forma geral e desejável, sem inventar notas específicas se não tiver certeza.
- Termine sempre com uma pergunta fechada que avance a venda (ex.: "Separo um pra você?", "Te mando a chave Pix?").
- Responda à ÚLTIMA mensagem do cliente. Se não houver mensagem do cliente, escreva uma abertura certeira para o perfil.`;

export const crmSuggestReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jid: string; tone?: string | null }) => ({
    jid: String(d.jid),
    tone: d.tone ? String(d.tone).slice(0, 80) : null,
  }))
  .handler(async ({ data, context }) => {
    const ctx = await staffCtx(context as any);
    const db = ctx.adminDb;
    const [{ data: contact }, { data: msgs }, { data: ps }] = await Promise.all([
      db
        .from("wa_contacts")
        .select("jid, push_name, customer_id, stage, phone_normalized")
        .eq("jid", data.jid)
        .maybeSingle(),
      db
        .from("wa_messages")
        .select("from_me, body, kind, ts")
        .eq("jid", data.jid)
        .order("ts", { ascending: false })
        .limit(24),
      db
        .from("pricing_settings")
        .select("pix_discount_active, pix_discount_percent")
        .eq("id", true)
        .maybeSingle(),
    ]);
    if (!contact) throw new Error("Conversa não encontrada.");
    const history = (
      (msgs ?? []) as Array<{ from_me: boolean; body: string | null; kind: string; ts: string }>
    ).reverse();
    const inbound = history
      .filter((m) => !m.from_me && m.body)
      .slice(-8)
      .map((m) => m.body)
      .join("\n");

    let lead: import("@/lib/crm-intel").Lead | null = null;
    if (contact.customer_id) {
      const { data: rows } = await (context.supabase as any).rpc("crm_leads");
      const raw = ((rows ?? []) as LeadRaw[]).find((r) => r.id === contact.customer_id);
      if (raw) lead = (await import("@/lib/crm-intel")).enrich([raw])[0] ?? null;
    }
    const quotes = inbound ? await quotesFor(ctx, { text: inbound, productIds: [] }) : [];
    const pix = ps?.pix_discount_active ? Number(ps.pix_discount_percent ?? 0) : 0;

    const facts = {
      cliente: {
        nome: lead?.name ?? contact.push_name ?? null,
        etapa: contact.stage,
        ja_comprou: lead ? lead.orders_count > 0 : null,
        compras: lead?.orders_count ?? 0,
        ticket_medio: lead && lead.orders_count ? Math.round(lead.spent / lead.orders_count) : null,
        perfil: lead?.profile ?? [],
        sinais: lead?.reasons ?? [],
        proxima_acao_sugerida: lead?.action.title ?? null,
        carrinho: lead?.cart?.names ?? [],
        favoritos: (lead?.favorites ?? []).slice(0, 4).map((f) => f.name),
        mais_vistos: (lead?.views?.top ?? [])
          .filter((t) => !t.bought)
          .slice(0, 3)
          .map((t) => t.name),
      },
      perfumes_citados: quotes.map((q) => ({
        nome: q.name,
        marca: q.brand,
        ml: q.volume_ml,
        frasco_pix: q.frasco?.pix ?? null,
        frasco_cartao: q.frasco?.card ?? null,
        promocao_percent: q.frasco?.promo ?? null,
        decants: q.decants.map((d) => ({ ml: d.ml, pix: d.pix })),
        pronta_na_loja: q.ready,
      })),
      loja: {
        desconto_pix_percent: pix,
        retirada: "grátis na loja",
        entrega: "valor combinado pelo WhatsApp",
        site: "https://oriumperfumes.com",
      },
      conversa: history
        .slice(-16)
        .map((m) => `${m.from_me ? "Orium" : "Cliente"}: ${m.body || `[${m.kind}]`}`),
      pedido_do_vendedor: data.tone,
    };

    const { aiJson } = await import("@/lib/ai/engine.server");
    const out = await aiJson<ReplySuggestion>({
      feature: "crm_reply",
      profile: "advanced",
      system: REPLY_SYSTEM,
      prompt: `Dados (JSON):\n${JSON.stringify(facts)}\n\nEscreva a melhor resposta agora.`,
      schema: {
        name: "crm_reply",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["reply", "short", "why", "next_step"],
          properties: {
            reply: { type: "string", description: "Resposta pronta para enviar" },
            short: { type: "string", description: "Versão ainda mais curta, 1 frase" },
            why: {
              type: "string",
              description: "Por que essa resposta converte, 1 frase para o vendedor",
            },
            next_step: {
              type: "string",
              description: "O que o vendedor faz depois que o cliente responder, 1 frase",
            },
          },
        },
      },
    });
    return {
      reply: String(out.reply ?? "").trim(),
      short: String(out.short ?? "").trim(),
      why: String(out.why ?? "").trim(),
      next_step: String(out.next_step ?? "").trim(),
    };
  });
