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
  /** nome salvo na agenda do celular da loja */
  saved_name?: string | null;
  /** foto de perfil do WhatsApp (miniatura) */
  avatar?: string | null;
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
          "jid, phone_normalized, push_name, saved_name, avatar, customer_id, stage, unread, pinned, archived, last_message_at, last_message_preview, last_from_me, last_inbound_at, customer:crm_customers(name)",
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
    (d: { jid: string; stage?: string; unread?: number; pinned?: boolean; archived?: boolean }) => {
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

export type { ReplySuggestion, ReplyGoal } from "@/lib/sales-playbook";

const GOAL_TEXT: Record<string, string> = {
  fechar: "Objetivo do vendedor: levar ao fechamento agora (reserva/Pix/retirada).",
  objecao: "Objetivo do vendedor: contornar a objeção do cliente com empatia e valor.",
  duvida: "Objetivo do vendedor: tirar a dúvida com clareza e avançar um passo.",
  reengajar:
    "Objetivo do vendedor: retomar um cliente que parou de responder, com algo novo e útil.",
  abrir: "Objetivo do vendedor: puxar conversa de forma natural e útil, sem parecer propaganda.",
};

/** Vendas reais dos últimos 30 dias (unidades) por produto + lista dos mais vendidos. */
async function salesProof(db: any, productIds: string[]) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: online }, { data: store }] = await Promise.all([
    db
      .from("catalog_order_items")
      .select(
        "product_id, quantity, catalog_orders!inner(created_at, status, deleted_at, canceled_at)",
      )
      .gte("catalog_orders.created_at", since)
      .is("catalog_orders.deleted_at", null)
      .is("catalog_orders.canceled_at", null)
      .neq("catalog_orders.status", "cancelado")
      .limit(5000),
    db
      .from("store_sale_items")
      .select("product_id, quantity, store_sales!inner(sold_at, deleted_at, canceled_at)")
      .gte("store_sales.sold_at", since)
      .is("store_sales.deleted_at", null)
      .is("store_sales.canceled_at", null)
      .limit(5000),
  ]);
  const units = new Map<string, number>();
  for (const r of [...((online ?? []) as any[]), ...((store ?? []) as any[])])
    if (r.product_id)
      units.set(r.product_id, (units.get(r.product_id) ?? 0) + Number(r.quantity ?? 0));
  const top = [...units.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);
  return Object.fromEntries(
    productIds.map((id) => [
      id,
      { vendidos_30d: units.get(id) ?? 0, top_vendas: top.includes(id) },
    ]),
  );
}

/** Promoções em vigor com data real de fim, por produto. */
async function promoEnds(db: any, productIds: string[]) {
  const now = new Date().toISOString();
  const { data } = await db
    .from("promotions")
    .select("name, discount_percent, ends_at, applies_to, product_ids, starts_at, active")
    .eq("active", true)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .limit(50);
  const out: Record<string, { promocao: string; acaba_em: string | null }> = {};
  for (const id of productIds) {
    const p = ((data ?? []) as any[]).find(
      (x) =>
        (!x.starts_at || x.starts_at <= now) &&
        (x.applies_to === "all" || (x.product_ids ?? []).includes(id)),
    );
    if (p)
      out[id] = {
        promocao: `${p.name} (${Math.round(Number(p.discount_percent))}% off)`,
        acaba_em: p.ends_at,
      };
  }
  return out;
}

export const crmSuggestReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jid: string; goal?: string | null; tone?: string | null }) => ({
    jid: String(d.jid),
    goal: d.goal && d.goal in GOAL_TEXT ? d.goal : "auto",
    tone: d.tone ? String(d.tone).slice(0, 120) : null,
  }))
  .handler(async ({ data, context }) => {
    const ctx = await staffCtx(context as any);
    const db = ctx.adminDb;
    const [{ data: contact }, { data: msgs }, { data: ps }] = await Promise.all([
      db
        .from("wa_contacts")
        .select(
          "jid, push_name, saved_name, customer_id, stage, phone_normalized, last_inbound_at, last_from_me",
        )
        .eq("jid", data.jid)
        .maybeSingle(),
      db
        .from("wa_messages")
        .select("from_me, body, kind, ts")
        .eq("jid", data.jid)
        .order("ts", { ascending: false })
        .limit(30),
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
    const { data: insightRow } = await db
      .from("wa_insights")
      .select("data")
      .eq("jid", data.jid)
      .maybeSingle();
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
    // perfumes citados + os que o cliente olhou/tem no carrinho (para recomendar com preço real)
    const extraIds = [
      ...(lead?.cart?.products ?? []).map((p) => p.product_id),
      ...(lead?.views?.top ?? []).filter((t) => !t.bought).map((t) => t.product_id),
    ].filter((x): x is string => !!x);
    const quotes = await quotesFor(ctx, {
      text: inbound,
      productIds: [...new Set(extraIds)].slice(0, inbound ? 2 : 3),
    });
    const ids = quotes.map((q) => q.product_id);
    const [proof, promos] = ids.length
      ? await Promise.all([
          salesProof(db, ids).catch(() => ({})),
          promoEnds(db, ids).catch(() => ({})),
        ])
      : [{}, {}];
    const pix = ps?.pix_discount_active ? Number(ps.pix_discount_percent ?? 0) : 0;
    const waitingMin =
      contact.last_from_me === false && contact.last_inbound_at
        ? Math.round((Date.now() - new Date(contact.last_inbound_at).getTime()) / 60000)
        : null;

    const facts = {
      cliente: {
        nome: lead?.name ?? contact.saved_name ?? contact.push_name ?? null,
        etapa_no_funil: contact.stage,
        esperando_resposta_ha_minutos: waitingMin,
        ja_comprou: lead ? lead.orders_count > 0 : null,
        compras: lead?.orders_count ?? 0,
        ticket_medio: lead && lead.orders_count ? Math.round(lead.spent / lead.orders_count) : null,
        prefere:
          lead && lead.decant_units + lead.bottle_units > 0
            ? lead.decant_units > lead.bottle_units
              ? "decant"
              : "frasco"
            : null,
        faixa_que_paga_no_frasco: lead?.avg_bottle_price
          ? { media: lead.avg_bottle_price, maximo: lead.max_item_price }
          : null,
        sensivel_a_promocao:
          lead && lead.total_items >= 2 ? lead.promo_items / lead.total_items >= 0.5 : null,
        marcas_favoritas: lead?.top_brands ?? [],
        ultimas_compras: (lead?.recent_items ?? [])
          .slice(0, 4)
          .map((r) => `${r.name}${r.decant ? " (decant)" : ""}`),
        carrinho_aberto: lead?.cart?.names ?? [],
        favoritos: (lead?.favorites ?? []).slice(0, 4).map((f) => f.name),
        sinais: lead?.reasons ?? [],
      },
      perfumes: quotes.map((q) => ({
        nome: q.name,
        marca: q.brand,
        ml: q.volume_ml,
        citado_pelo_cliente: q.confidence !== "manual",
        frasco_pix: q.frasco?.pix ?? null,
        frasco_cartao: q.frasco?.card ?? null,
        preco_cheio_antes_da_promocao: q.frasco?.promo ? q.frasco.base : null,
        decants: q.decants.map((d) => ({ ml: d.ml, pix: d.pix })),
        estoque_na_loja: q.stock,
        pronta_entrega: q.ready,
        ...((proof as Record<string, object>)[q.product_id] ?? {}),
        ...((promos as Record<string, object>)[q.product_id] ?? {}),
      })),
      loja: {
        desconto_pix_percent: pix,
        retirada: "grátis na loja física (Rio de Janeiro)",
        entrega: "valor combinado pelo WhatsApp",
        produtos: "originais e lacrados",
        site: "https://oriumperfumes.com",
      },
      analise_da_conversa: insightRow?.data ?? null,
      conversa: history
        .slice(-20)
        .map((m) => `${m.from_me ? "Orium" : "Cliente"}: ${m.body || `[${m.kind}]`}`),
      objetivo:
        GOAL_TEXT[data.goal] ??
        "Objetivo: a melhor próxima mensagem para vender, decidida por você.",
      pedido_extra_do_vendedor: data.tone,
    };

    const { aiJson } = await import("@/lib/ai/engine.server");
    const { SALES_SYSTEM, SALES_SCHEMA } = await import("@/lib/sales-playbook");
    const out = await aiJson<import("@/lib/sales-playbook").ReplySuggestion>({
      feature: "crm_reply",
      profile: "advanced",
      system: SALES_SYSTEM,
      prompt: `Dados reais (JSON):\n${JSON.stringify(facts)}\n\nEscreva a melhor próxima mensagem agora.`,
      schema: SALES_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    });
    const s = (v: unknown) => String(v ?? "").trim();
    return {
      situacao: s(out.situacao),
      objecao: out.objecao ?? "nenhuma",
      temperatura: out.temperatura ?? "morno",
      tecnica: s(out.tecnica),
      por_que: s(out.por_que),
      reply: s(out.reply),
      short: s(out.short),
      alternativas: (out.alternativas ?? [])
        .slice(0, 2)
        .map((a) => ({ rotulo: s(a.rotulo), texto: s(a.texto) }))
        .filter((a) => a.texto),
      next_step: s(out.next_step),
      se_nao_responder: s(out.se_nao_responder),
      evitar: s(out.evitar),
    } satisfies import("@/lib/sales-playbook").ReplySuggestion;
  });

/** Apaga a conversa (contato + mensagens + fila) do CRM. Se o cliente escrever de novo, ela volta. */
export const waDeleteContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jid: string }) => {
    if (!/@s\.whatsapp\.net$/.test(d.jid)) throw new Error("Conversa inválida.");
    return { jid: d.jid };
  })
  .handler(async ({ data, context }) => {
    const ctx = await staffCtx(context as any);
    const { error } = await ctx.adminDb.from("wa_contacts").delete().eq("jid", data.jid);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- análise da conversa (IA) ----------

export type WaInsight = {
  jid: string;
  analyzed_at: string;
  last_msg_ts: string | null;
  status: string | null;
  chance: number | null;
  motivo: string | null;
  resumo: string | null;
  data: import("@/lib/wa-insights.server").InsightData | Record<string, never>;
  error: string | null;
};

export const waInsight = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jid: string }) => ({ jid: String(d.jid) }))
  .handler(async ({ data, context }) => {
    const { data: row } = await (context.supabase as any)
      .from("wa_insights")
      .select("*")
      .eq("jid", data.jid)
      .maybeSingle();
    return (row ?? null) as WaInsight | null;
  });

/** Analisa a conversa agora (botão "Analisar de novo"). */
export const waAnalyze = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jid: string }) => ({ jid: String(d.jid) }))
  .handler(async ({ data, context }) => {
    const ctx = await staffCtx(context as any);
    const { analyzeConversation } = await import("@/lib/wa-insights.server");
    await analyzeConversation(ctx.adminDb, data.jid);
    const { data: row } = await ctx.adminDb
      .from("wa_insights")
      .select("*")
      .eq("jid", data.jid)
      .maybeSingle();
    return (row ?? null) as WaInsight | null;
  });
