/**
 * ANÁLISE DAS CONVERSAS DO WHATSAPP (IA) — só servidor.
 * Lê cada conversa e extrai o que importa para vender: o que o cliente quer, estilo,
 * orçamento, ocasião, por que não comprou, chance de compra, próximo passo e uma
 * mensagem pronta. Roda sozinha (agendamento a cada 5 min) e quando chega mensagem nova.
 * Conversa com interesse real e sem ficha no CRM ganha ficha automaticamente.
 */

export type InsightData = {
  resumo: string;
  status:
    | "comprou"
    | "negociando"
    | "interessado"
    | "perdido"
    | "so_duvida"
    | "pos_venda"
    | "sem_interesse";
  chance_compra: number;
  motivo_nao_comprou:
    | "nao_se_aplica"
    | "preco"
    | "vou_pensar"
    | "sumiu"
    | "sem_estoque"
    | "confianca"
    | "entrega_prazo"
    | "comparando"
    | "indeciso"
    | "outro";
  motivo_detalhe: string;
  perfumes: Array<{
    nome: string;
    interesse: "perguntou" | "quer" | "comprou" | "recusou" | "comparou";
  }>;
  estilo: string[];
  ocasiao: string;
  orcamento: string;
  prefere: "frasco" | "decant" | "indefinido";
  para_quem: "si_mesmo" | "presente" | "indefinido";
  genero_perfume: "masculino" | "feminino" | "compartilhavel" | "indefinido";
  sentimento: "positivo" | "neutro" | "negativo";
  objecoes: string[];
  proximo_passo: string;
  mensagem_sugerida: string;
  alerta: string;
  /** perfumes citados ligados ao catálogo (preço e estoque reais) — preenchido pelo sistema */
  catalogo?: Array<{
    nome: string;
    product_id: string;
    produto: string;
    marca: string | null;
    em_estoque: boolean;
    estoque: number;
    preco: number | null;
    imagem: string | null;
    slug: string | null;
  }>;
};

const SYSTEM = `Você é o gerente de vendas da Orium Perfumes (perfumes árabes originais, Rio de Janeiro) analisando uma conversa de WhatsApp entre a loja ("Orium") e um cliente.
Extraia SÓ o que está na conversa — não invente. Se algo não aparece, use "" ou "indefinido".
- resumo: 2 a 3 frases objetivas para o dono da loja: o que o cliente queria, o que aconteceu e onde parou.
- status: comprou (fechou/pagou/combinou retirada), negociando (falando de preço/forma de pagamento), interessado (quer perfume mas não avançou), perdido (desistiu ou comprou em outro lugar), so_duvida (só tirou dúvida), pos_venda (já comprou e voltou para elogio/dúvida/troca), sem_interesse (conversa que não é de venda: pessoal, fornecedor, spam).
- chance_compra (0-100): chance realista de comprar nas próximas 2 semanas, considerando sinais como pedir preço, perguntar disponibilidade, forma de pagamento, retirada (sinais fortes) e "vou ver", silêncio, achar caro (sinais fracos).
- motivo_nao_comprou: só se não comprou. "sumiu" = parou de responder depois da resposta da loja. "vou_pensar" = disse que ia ver/pensar. Explique em motivo_detalhe em 1 frase com o fato da conversa.
- perfumes: cada perfume citado e o nível de interesse.
- estilo: preferências olfativas ditas ou claramente implícitas (ex.: doce, amadeirado, fresco, cítrico, oriental, gourmand, baunilha, couro, oud, marcante, discreto, que fixa muito).
- ocasiao (dia a dia, trabalho, festa, encontro, presente…), orcamento (ex.: "até R$ 300" se ele disse), prefere (frasco/decant), para_quem, genero_perfume.
- objecoes: frases curtas com as objeções reais (ex.: "achou caro o Khamrah").
- proximo_passo: a ação mais certeira do vendedor agora, 1 frase.
- mensagem_sugerida: mensagem pronta de WhatsApp (máx. 3 frases curtas, tom humano igual ao da equipe na conversa, SEM emoji, sem dizer "sem estoque"/"em falta") para retomar ou fechar, sem inventar preço, desconto, prazo ou estoque, terminando com uma pergunta fácil de responder.
- alerta: problema que o dono precisa ver (reclamação, atraso, cliente irritado, pedido de troca). "" se nada.`;

const SCHEMA = {
  name: "orium_insight",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "resumo",
      "status",
      "chance_compra",
      "motivo_nao_comprou",
      "motivo_detalhe",
      "perfumes",
      "estilo",
      "ocasiao",
      "orcamento",
      "prefere",
      "para_quem",
      "genero_perfume",
      "sentimento",
      "objecoes",
      "proximo_passo",
      "mensagem_sugerida",
      "alerta",
    ],
    properties: {
      resumo: { type: "string" },
      status: {
        type: "string",
        enum: [
          "comprou",
          "negociando",
          "interessado",
          "perdido",
          "so_duvida",
          "pos_venda",
          "sem_interesse",
        ],
      },
      chance_compra: { type: "integer" },
      motivo_nao_comprou: {
        type: "string",
        enum: [
          "nao_se_aplica",
          "preco",
          "vou_pensar",
          "sumiu",
          "sem_estoque",
          "confianca",
          "entrega_prazo",
          "comparando",
          "indeciso",
          "outro",
        ],
      },
      motivo_detalhe: { type: "string" },
      perfumes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nome", "interesse"],
          properties: {
            nome: { type: "string" },
            interesse: {
              type: "string",
              enum: ["perguntou", "quer", "comprou", "recusou", "comparou"],
            },
          },
        },
      },
      estilo: { type: "array", items: { type: "string" } },
      ocasiao: { type: "string" },
      orcamento: { type: "string" },
      prefere: { type: "string", enum: ["frasco", "decant", "indefinido"] },
      para_quem: { type: "string", enum: ["si_mesmo", "presente", "indefinido"] },
      genero_perfume: {
        type: "string",
        enum: ["masculino", "feminino", "compartilhavel", "indefinido"],
      },
      sentimento: { type: "string", enum: ["positivo", "neutro", "negativo"] },
      objecoes: { type: "array", items: { type: "string" } },
      proximo_passo: { type: "string" },
      mensagem_sugerida: { type: "string" },
      alerta: { type: "string" },
    },
  },
};

const fmtTs = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Analisa uma conversa e grava em wa_insights. Devolve o resultado (ou lança erro). */
export async function analyzeConversation(db: any, jid: string): Promise<InsightData> {
  const [{ data: contact }, { data: msgs }] = await Promise.all([
    db
      .from("wa_contacts")
      .select(
        "jid, push_name, saved_name, customer_id, phone_normalized, last_message_at, customer:crm_customers(name)",
      )
      .eq("jid", jid)
      .maybeSingle(),
    db
      .from("wa_messages")
      .select("from_me, body, kind, ts, transcript")
      .eq("jid", jid)
      .order("ts", { ascending: false })
      .limit(80),
  ]);
  if (!contact) throw new Error("Conversa não encontrada.");
  const history = (
    (msgs ?? []) as Array<{
      from_me: boolean;
      body: string | null;
      kind: string;
      ts: string;
      transcript?: string | null;
    }>
  ).reverse();
  if (!history.length) throw new Error("Conversa vazia.");
  const lastTs = history[history.length - 1]!.ts;
  const name = contact.customer?.name || contact.saved_name || contact.push_name || null;

  // memória: análise anterior + compras registradas (app e loja)
  const [{ data: prev }, purchases] = await Promise.all([
    db.from("wa_insights").select("resumo, status, data").eq("jid", jid).maybeSingle(),
    contact.customer_id ? purchasesOf(db, contact.customer_id) : Promise.resolve([] as string[]),
  ]);
  const memory = [
    prev?.resumo ? `Análise anterior desta conversa: ${prev.resumo}` : null,
    purchases.length
      ? `Compras registradas do cliente (mais recentes primeiro): ${purchases.join("; ")}`
      : "Compras registradas: nenhuma.",
  ]
    .filter(Boolean)
    .join("\n");

  const transcript = history
    .map(
      (m) =>
        `[${fmtTs(m.ts)}] ${m.from_me ? "Orium" : "Cliente"}: ${m.body || (m.transcript ? `[áudio] ${m.transcript}` : `[${m.kind}]`)}`,
    )
    .join("\n");
  const { aiJson } = await import("@/lib/ai/engine.server");
  let out: InsightData;
  try {
    out = await aiJson<InsightData>({
      feature: "crm_insight",
      profile: "advanced",
      system: SYSTEM,
      prompt: `Cliente: ${name ?? "sem nome"}\nAgora: ${fmtTs(new Date().toISOString())}\n${memory}\n\nConversa (as mais recentes no fim):\n${transcript.slice(-14000)}`,
      schema: SCHEMA,
    });
  } catch (e) {
    await db.from("wa_insights").upsert(
      {
        jid,
        analyzed_at: new Date().toISOString(),
        error: e instanceof Error ? e.message.slice(0, 300) : "erro",
      },
      { onConflict: "jid" },
    );
    throw e;
  }
  out.chance_compra = Math.max(0, Math.min(100, Math.round(Number(out.chance_compra) || 0)));
  out.catalogo = await linkCatalog(db, out.perfumes ?? []).catch(() => []);

  // interesse real e sem ficha: cria a ficha do cliente (o gatilho liga a conversa)
  let customerId: string | null = contact.customer_id ?? null;
  const real = ["comprou", "negociando", "interessado", "perdido", "pos_venda"].includes(
    out.status,
  );
  if (!customerId && real && contact.phone_normalized?.length === 11) {
    const { data: existing } = await db
      .from("crm_customers")
      .select("id")
      .eq("phone_normalized", contact.phone_normalized)
      .is("archived_at", null)
      .limit(1);
    customerId = existing?.[0]?.id ?? null;
    if (!customerId) {
      const { data: created } = await db
        .from("crm_customers")
        .insert({
          name: name ?? `WhatsApp ${contact.phone_normalized.slice(-4)}`,
          phone: contact.phone_normalized,
          phone_normalized: contact.phone_normalized,
          first_source: "whatsapp",
          lead_trigger: "whatsapp",
        })
        .select("id")
        .single();
      customerId = created?.id ?? null;
    }
    if (customerId)
      await db
        .from("wa_contacts")
        .update({ customer_id: customerId })
        .eq("jid", jid)
        .is("customer_id", null);
  }

  // etapa do funil acompanha a conversa quando ainda está no começo
  const stageFrom: Record<string, string> = {
    comprou: "comprou",
    negociando: "negociando",
    interessado: "interessado",
    perdido: "perdido",
  };
  const { data: cur } = await db.from("wa_contacts").select("stage").eq("jid", jid).maybeSingle();
  const next = stageFrom[out.status];
  const order = ["novo", "interessado", "negociando", "comprou"];
  if (
    next &&
    cur &&
    (next === "comprou" || next === "perdido" || order.indexOf(next) > order.indexOf(cur.stage)) &&
    cur.stage !== "comprou"
  )
    await db.from("wa_contacts").update({ stage: next }).eq("jid", jid);

  await db.from("wa_insights").upsert(
    {
      jid,
      customer_id: customerId,
      analyzed_at: new Date().toISOString(),
      last_msg_ts: lastTs,
      msg_count: history.length,
      status: out.status,
      chance: out.chance_compra,
      motivo: out.motivo_nao_comprou,
      resumo: out.resumo,
      data: out,
      error: null,
    },
    { onConflict: "jid" },
  );
  return out;
}

/** Lote do agendamento: analisa as conversas pendentes, uma por vez. */
export async function runInsightsBatch(db: any, limit = 8) {
  const { data: due, error } = await db.rpc("wa_insights_due", { p_limit: limit, p_quiet_min: 10 });
  if (error) throw new Error(error.message);
  let ok = 0;
  let failed = 0;
  for (const r of (due ?? []) as Array<{ jid: string }>) {
    try {
      await analyzeConversation(db, r.jid);
      ok++;
    } catch (e) {
      failed++;
      console.error("wa-insights", e instanceof Error ? e.message.slice(0, 200) : e);
      // sem chave/limite de gastos: para o lote para não insistir
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        ["not_configured", "disabled", "budget", "invalid_key", "no_quota"].includes(
          String((e as { code: string }).code),
        )
      )
        break;
    }
  }
  return { due: (due ?? []).length, analyzed: ok, failed };
}

/** Últimas compras do cliente (app + loja física), em texto curto para a IA. */
async function purchasesOf(db: any, customerId: string): Promise<string[]> {
  const [{ data: online }, { data: store }] = await Promise.all([
    db
      .from("catalog_orders")
      .select(
        "created_at, status, final_total, catalog_order_items(product_name_snapshot, decant_ml, quantity)",
      )
      .eq("crm_customer_id", customerId)
      .is("deleted_at", null)
      .neq("status", "cancelado")
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("store_sales")
      .select("sold_at, total, store_sale_items(product_name_snapshot, decant_ml, quantity)")
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("sold_at", { ascending: false })
      .limit(5),
  ]);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const items = (rows: any[]) =>
    (rows ?? [])
      .map(
        (i) =>
          `${i.quantity > 1 ? `${i.quantity}x ` : ""}${i.product_name_snapshot}${i.decant_ml ? ` (decant ${i.decant_ml}ml)` : ""}`,
      )
      .join(", ");
  return [
    ...((online ?? []) as any[]).map((o) => ({
      at: o.created_at,
      t: `${day(o.created_at)}: ${items(o.catalog_order_items)} (R$ ${Math.round(Number(o.final_total ?? 0))})`,
    })),
    ...((store ?? []) as any[]).map((o) => ({
      at: o.sold_at,
      t: `${day(o.sold_at)} na loja: ${items(o.store_sale_items)} (R$ ${Math.round(Number(o.total ?? 0))})`,
    })),
  ]
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 6)
    .map((x) => x.t);
}

/** Liga os perfumes que o cliente citou aos produtos do catálogo (preço e estoque reais). */
async function linkCatalog(
  db: any,
  perfumes: InsightData["perfumes"],
): Promise<NonNullable<InsightData["catalogo"]>> {
  if (!perfumes.length) return [];
  const { mentionIndex } = await import("@/lib/crm-wa.functions");
  const { findMentions } = await import("@/lib/perfume-mentions");
  const idx = await mentionIndex(db);
  const hits = perfumes
    .slice(0, 8)
    .map((p) => ({ nome: p.nome, m: findMentions(p.nome, idx, 1)[0] }))
    .filter((x) => x.m);
  if (!hits.length) return [];
  const { data: rows } = await db
    .from("products")
    .select("id, canonical_name, brand, in_stock, local_stock, retail_price, image_url, slug")
    .in(
      "id",
      hits.map((h) => h.m!.productId),
    );
  const byId = new Map(((rows ?? []) as any[]).map((r) => [r.id, r]));
  // preço final de verdade (com promoção e Pix), o mesmo cálculo do site
  const { getProductPrices } = await import("@/lib/copilot/pricing-tools.server");
  const finalPrice = new Map<string, number>();
  await Promise.all(
    [...byId.keys()].map(async (id) => {
      try {
        const pr: any = await getProductPrices({ adminDb: db } as any, id);
        if (pr?.frasco?.pix != null) finalPrice.set(id, Number(pr.frasco.pix));
      } catch {
        /* sem preço: fica o de tabela */
      }
    }),
  );
  return hits
    .map((h) => {
      const r = byId.get(h.m!.productId);
      if (!r) return null;
      const estoque = Number(r.local_stock ?? 0);
      return {
        nome: h.nome,
        product_id: r.id,
        produto: r.canonical_name,
        marca: r.brand ?? null,
        em_estoque: estoque > 0 || !!r.in_stock,
        estoque,
        preco: finalPrice.get(r.id) ?? (r.retail_price != null ? Number(r.retail_price) : null),
        imagem: r.image_url ?? null,
        slug: r.slug ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}
