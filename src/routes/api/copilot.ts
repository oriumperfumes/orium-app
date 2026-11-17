/**
 * ORIUM COPILOT — conversa com ferramentas.
 * A IA só interpreta e escolhe ferramentas da central de ações. Consultas
 * respondem direto; alterações viram pendências que o Admin confirma.
 */
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, isStepCount, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

type PageContext = { route?: string | null; product_id?: string | null; order_id?: string | null; filters?: string | null };

const SYSTEM = (today: string, page: PageContext, commands: any[], aliases: any[]) => `Você é o Orium Copilot, assistente operacional do Admin da Orium Perfumes (perfumaria árabe). Responda em português do Brasil, curto e direto.

Classifique cada pedido em:
- QUERY (consulta): responda usando ferramentas de consulta. Nunca altere nada.
- ADVICE (conselho): chame advice_data/sales_summary e responda com duas seções: "**Dados**" (só números que vieram das ferramentas) e "**Sugestão**". Nunca invente causa ("caiu porque o preço subiu") sem evidência. Termine sugerindo uma ação concreta (ex.: criar promoção) sem executá-la.
- ACTION (alteração): chame a ferramenta propose_* correspondente. Ela NÃO executa: gera um cartão que o Admin confirma. Depois diga só uma frase curta pedindo confirmação. NUNCA diga "pronto", "alterei" ou "feito" — quem executa é o botão Confirmar.

Regras:
- Nunca invente IDs. Use product_id apenas se veio de uma ferramenta ou do contexto da tela; caso contrário passe o nome em "query" exatamente como falado (o catálogo corrige erros de voz, ex.: "lique de bran" → Liquid Brun).
- Se a ferramenta devolver candidatos/ambiguidade, pergunte qual deles. Nunca escolha sozinho ("Yara" não é "Yara Elixir").
- FONTE DE VERDADE DE PREÇOS: o Pricing Engine da Orium, acessado SÓ pelas ferramentas. Você NUNCA estima, lembra ou inventa preço, e nunca pergunta ao Admin um preço que o sistema tem.
  • "Quanto custa X" / "preço do X" / "X de 5ml" / "no cartão" / "atacado" → chame get_product_prices (com query = nome falado) e responda com os valores retornados. Pergunta de uma variante só → mostre só ela.
  • Formato: "**Nome**\nFrasco: R$ … (Pix) · R$ … (cartão)\nDecant 2ml: R$ …\nDecant 5ml: R$ …\nDecant 10ml: R$ …" (+ atacado se pedido; + promoção ativa se houver).
  • Preços citados antes nesta conversa podem estar velhos: SEMPRE consulte de novo antes de responder ou cotar.
  • Custo, lucro, margem → get_product_costs. Disponibilidade/estoque → get_product_availability. Total de vários itens, sinal, saldo → quote_sale (contas são do backend).
  • Leia error_code das ferramentas: "not_found" = não existe no catálogo; "ambiguous" = pergunte qual dos candidatos; "no_price" = existe mas sem preço configurado; "variant_unavailable" = variante não vendida; "backend_error"/"connection" = falha técnica — diga que a consulta falhou e peça para tentar de novo, NUNCA diga que o preço não está cadastrado; "permission" = sem permissão.
  • Criar pedido ("cria um pedido de X para João com 50% de sinal") → propose_order_create; pagamento unpaid/deposit/paid. Valor vendido ≠ valor recebido: o sinal é o único valor recebido.
- PREÇOS (alterações; todas as contas são do backend; nunca calcule lucro/margem você mesmo — use simulate_price):
  • O preço cadastrado É o preço no Pix. "frasco a X" ou "X no Pix" = price_kind "pix"; "X no cartão" = "card".
  • "5ml a 44,90" / "todos os decants de 5ml a 44,90" SEM perfume = REGRA GLOBAL → propose_pricing_rules decant_5.
  • "5ml do Liquid Brun a 49,90" = só aquele perfume → propose_price_change decant_5.
  • Vários preços numa frase ("Liquid Brun: 2ml 24,90, 5ml 49,90 e 10ml 79,90") ou vários perfumes → propose_price_batch.
  • "Volta o 5ml do X para o padrão" = reset_to_default true com decant_5. "Volta o frasco ao automático" = auto; atacado = auto_wholesale.
  • "Muda varejo para custo + 130" = propose_pricing_rules retail_markup 130; atacado idem wholesale_markup; "desconto Pix 6%" = pix_discount_percent 6; preço comercial ,90 = psych_*.
  • "Faz 15% no decant 10ml do X até domingo" = propose_promotion_create applies_to DECANT, decant_sizes [10].
  • Se não estiver claro qual preço, use price_kind "unknown". "Aumenta 10 reais" = delta 10. Se a prévia disser abaixo do custo, AVISE com destaque.
- Estoque Orium (unidades físicas da loja) é diferente do estoque do fornecedor. "Tenho 3 aqui" / "coloca 5 em estoque" = mode set. "Chegaram mais 3" / "adiciona 3" / "dar entrada" = mode add. "Zera" = set 0. Se não der para saber set × add, pergunte. "Vendi um X aqui" = registrar venda da loja (propose_store_sale), não ajuste de estoque.
- "Esconde X" = propose_availability blocked. "Libera X mesmo sem estoque" = available. "Volta ao automático" = none.
- Promoções usam o sistema de promoções; nunca altere preço base para simular promoção.
- FOTOS: o Admin pode mandar fotos (numeradas: foto 1 = a mais recente). Olhe a foto com atenção: leia rótulo, marca, nome, concentração e volume do frasco/caixa e diga qual perfume é (com o grau de certeza). Depois chame search_products para ver se já existe no catálogo. Se não der para ler, diga o que conseguiu ver e peça outra foto.
- Ferramentas que usam foto têm o campo photo (número da foto). Use a foto do perfume quando o Admin pedir para cadastrar/registrar/trocar a foto.
- PESQUISA: research_perfume busca na internet a ficha completa (volume, gênero, concentração, acordes, pirâmide, descrição em português). Use antes de cadastrar no catálogo ou na Negociação, e sempre que o Admin pedir para pesquisar. Mostre um resumo curto do que achou (marca, volume, gênero, 3-4 notas) antes do cartão.
- CADASTRAR NO CATÁLOGO ("cadastra esse perfume", "registra no catálogo"): research_perfume → propose_catalog_create com os dados pesquisados + photo. Preço: use o que o Admin falar; se ele disser só o custo, mande cost (o sistema calcula o preço pela regra); se não falar preço, pergunte (ou ofereça sob consulta / só decant). Padrão: frasco e decant, à venda.
- NEGOCIAÇÃO ("registra pra negociação", "coloca no mostruário"): research_perfume (para ficha e descrição) → propose_negotiation_create com photo, volume e ml restantes (se o Admin falar, ex.: "tá com 80ml"). Se ele não disser quanto tem no frasco, pergunte uma vez antes de propor.
- EDITAR PRODUTO (nome, marca, volume, gênero, descrição, foto, situação à venda/oculto/indisponível, frasco/decant, sob consulta, fixar no topo, acordes/pirâmide) → propose_product_update só com os campos que mudam (os outros null). Preço continua em propose_price_change; estoque em propose_stock_change.
- EDITAR PEDIDO (itens, quantidade, cliente, telefone, entrega, cupom, observação, data de entrega) → propose_order_edit. Etapas do pedido ("avança", "marca como entregue", "pedido feito", "cancela") → propose_order_status; "avançar" = próxima etapa: pendente → pedido feito → entregue. Pagamento ("cliente pagou", "pagou o sinal", "recebi 200") → propose_order_payment.
- Você consegue fazer praticamente tudo no Admin. Se algo realmente não existir como ferramenta, diga o caminho na tela (e use navigate).
- Registrar venda da loja: use propose_store_sale com todos os itens (quantidade, frasco ou decant+ml, pagamento PIX/CARTAO/DINHEIRO). Nunca invente preço: unit_price null usa o preço do sistema. Se faltar pagamento ou produto, a ferramenta pergunta; repasse a pergunta curta. A venda só é gravada após o Admin confirmar.
- Navegação ("abre", "vai para", "mostra a tela") executa na hora pela ferramenta navigate.
- "Ele", "esse", "desse" referem-se ao último produto/pedido desta conversa ou ao da tela atual.
- AUTONOMIA: nunca mande o usuário para Configurações, Produtos ou outra tela fazer algo manualmente se existe uma ferramenta que faça. Use a ferramenta. Se realmente não existir ferramenta, diga "Essa ação ainda não está conectada ao Copilot." e nunca finja que fez.
- Comandos personalizados/macros ("cria um comando chamado X", "quando eu falar X faça Y", "muda o X", "apaga o comando X", "quais comandos eu tenho"): use list_commands / propose_command_save / propose_command_delete. Antes de propor, resolva o que faltar com UMA pergunta curta (ex.: código do cupom: "pedir na hora" ou "gerar automaticamente"; ofereça as opções). As instructions devem dizer exatamente o que fazer ao ser disparado (ex.: "Chame propose_coupon_create com percent 5; gere o código DESCONTO5-XXXX com 4 caracteres aleatórios; sem validade"). Comandos compostos listam várias consultas; comandos dinâmicos dizem quais parâmetros extrair da fala.
- Ao disparar um comando, siga as instruções dele usando as ferramentas normais (ações continuam pedindo confirmação).
- Se o usuário disser "sim"/"confirmar" sem ação pendente clara, diga que não há nada pendente.
- Dados de clientes: mostre só o necessário (primeiro nome, fim do telefone, totais).
- Valores em reais no formato R$ 1.234,56.

Hoje é ${today} (horário de São Paulo).
Tela atual do Admin: ${JSON.stringify(page)}.
${commands.length ? `Comandos personalizados (quando a fala combinar com uma frase, siga as instruções):\n${commands.map((c) => `- "${c.name}" — frases: ${c.phrases.join(" | ")} → ${c.instructions}`).join("\n")}` : ""}
${aliases.length ? `Apelidos de comando:\n${aliases.map((a) => `- "${a.phrase}" significa: ${a.meaning}`).join("\n")}` : ""}`;

const productRef = { product_id: z.string().nullable().describe("ID real vindo de ferramenta/contexto, ou null"), query: z.string().nullable().describe("nome como falado, ou null") };

export const Route = createFileRoute("/api/copilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { messages?: UIMessage[]; threadId?: string; page?: PageContext } | null;
        if (!body || !Array.isArray(body.messages)) return new Response("Mensagens obrigatórias.", { status: 400 });
        const engine = await import("@/lib/ai/engine.server");

        const { copilotContext, bearer } = await import("@/lib/copilot/context.server");
        let ctx;
        try {
          ctx = await copilotContext(bearer(request), body.threadId ?? null);
        } catch (e) {
          if (e instanceof Response) return e;
          throw e;
        }
        const R = await import("@/lib/copilot/registry.server");
        const P = await import("@/lib/copilot/pricing-tools.server");
        const threadId = body.threadId ?? null;
        if (threadId) {
          const { data: t } = await ctx.userDb.from("copilot_threads").select("id").eq("id", threadId).maybeSingle();
          if (!t) return new Response("Conversa não encontrada.", { status: 404 });
        }
        const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
        const PW = await import("@/lib/copilot/power-tools.server");
        const photos = PW.collectPhotos(body.messages);
        const withPhoto = PW.lastUserHasPhoto(body.messages);
        const spoken = lastUser?.parts?.map((p: any) => (p.type === "text" ? p.text : "")).join(" ").trim().slice(0, 500) ?? "";
        const utterance = spoken || (withPhoto ? "(foto de perfume)" : null);
        const safe = async (fn: () => Promise<unknown>) => {
          try {
            return await fn();
          } catch (e) {
            console.error("copilot tool falhou:", e instanceof Error ? e.message.slice(0, 300) : e);
            return { error_code: "backend_error", message: "A consulta falhou no sistema (não é falta de dado). Tente de novo." };
          }
        };

        const [{ data: commands }, { data: aliases }] = await Promise.all([
          ctx.userDb.from("copilot_commands").select("name, phrases, instructions").eq("active", true),
          ctx.userDb.from("copilot_aliases").select("phrase, meaning").eq("active", true),
        ]);

        const tools = {
          search_products: tool({
            description: "Busca perfumes no catálogo (tolerante a erros de voz). Retorna candidatos com foto.",
            inputSchema: z.object({ query: z.string() }),
            execute: ({ query }) => safe(() => R.resolveProduct(ctx, null, query)),
          }),
          get_product_prices: tool({
            description: "Preços REAIS e atuais de um perfume, do mesmo motor do catálogo/carrinho: frasco (Pix e cartão), decants 2/5/10ml, atacado, promoções ativas e se o preço é manual. Use SEMPRE que perguntarem preço.",
            inputSchema: z.object(productRef),
            execute: ({ product_id, query }) =>
              P.guarded("get_product_prices", async () => {
                const r = await R.resolveProduct(ctx, product_id, query);
                return r.status === "ok" ? P.getProductPrices(ctx, r.product.id) : { error_code: r.status, query: r.query, candidates: r.candidates };
              }),
          }),
          get_product_availability: tool({
            description: "Disponibilidade real: frascos lacrados no estoque Orium, pronta entrega, catálogo público, fornecedor e decant.",
            inputSchema: z.object(productRef),
            execute: ({ product_id, query }) =>
              P.guarded("get_product_availability", async () => {
                const r = await R.resolveProduct(ctx, product_id, query);
                return r.status === "ok" ? P.getProductAvailability(ctx, r.product.id) : { error_code: r.status, query: r.query, candidates: r.candidates };
              }),
          }),
          get_product_costs: tool({
            description: "Custo do frasco, lucro e margem por variante (só administradores).",
            inputSchema: z.object(productRef),
            execute: ({ product_id, query }) =>
              P.guarded("get_product_costs", async () => {
                const r = await R.resolveProduct(ctx, product_id, query);
                return r.status === "ok" ? P.getProductCosts(ctx, r.product.id) : { error_code: r.status, query: r.query, candidates: r.candidates };
              }),
          }),
          quote_sale: tool({
            description: "Cotação oficial (não grava nada): preço unitário do sistema com promoções e atacado, subtotais, total Pix/cartão e, se pedido, sinal e saldo restante.",
            inputSchema: z.object({
              items: z.array(z.object({ ...productRef, variant: z.enum(["FRASCO", "DECANT"]), decant_ml: z.number().nullable(), quantity: z.number() })),
              payment_method: z.enum(["PIX", "CARTAO", "DINHEIRO"]).nullable(),
              deposit_percent: z.number().nullable().describe("ex.: 50 para sinal de 50%"),
            }),
            execute: (a) =>
              P.guarded("quote_sale", async () => {
                const items = [];
                for (const it of a.items.slice(0, 20)) {
                  const r = await R.resolveProduct(ctx, it.product_id, it.query);
                  if (r.status !== "ok") return { error_code: r.status, query: r.query, candidates: r.candidates };
                  items.push({ product_id: r.product.id, variant: it.variant === "DECANT" ? ("DECANT" as const) : ("FULL" as const), decant_ml: it.decant_ml, quantity: it.quantity });
                }
                return P.quoteSale(ctx, items, { payment_method: a.payment_method, deposit_percent: a.deposit_percent });
              }),
          }),
          propose_order_create: tool({
            description: "Prepara um pedido manual com preço do sistema e situação de pagamento (precisa de confirmação). Calcula pago e restante no backend.",
            inputSchema: z.object({
              customer_name: z.string().nullable(),
              customer_phone: z.string().nullable(),
              items: z.array(z.object({ ...productRef, variant: z.enum(["FRASCO", "DECANT"]).nullable(), decant_ml: z.number().nullable(), quantity: z.number() })),
              payment: z.enum(["unpaid", "deposit", "paid"]).nullable(),
              deposit_percent: z.number().nullable().describe("padrão 50"),
              notes: z.string().nullable(),
            }),
            execute: (a) => P.guarded("propose_order_create", () => R.proposeOrderCreate(ctx, a, utterance)),
          }),
          get_product: tool({
            description: "Ficha geral do produto (estoque, fornecedores, modo de preço). Para responder PREÇO use get_product_prices; custo/margem use get_product_costs.",
            inputSchema: z.object(productRef),
            execute: ({ product_id, query }) =>
              safe(async () => {
                const r = await R.resolveProduct(ctx, product_id, query);
                return r.status === "ok" ? R.productSnapshot(ctx, r.product.id) : r;
              }),
          }),
          simulate_price: tool({
            description: "Simula lucro e margem para um preço. Não altera nada.",
            inputSchema: z.object({ ...productRef, price: z.number(), price_kind: z.enum(["pix", "card", "wholesale", "decant_2", "decant_5", "decant_10"]).nullable() }),
            execute: ({ product_id, query, price, price_kind }) =>
              safe(async () => {
                const r = await R.resolveProduct(ctx, product_id, query);
                return r.status === "ok" ? R.querySimulatePrice(ctx, r.product.id, price, price_kind ?? "pix") : r;
              }),
          }),
          sales_summary: tool({
            description: "Vendas, lucro bruto, pedidos, vendas da loja, ticket, mais vendidos, pendentes e reposição do período, com o período anterior para comparar.",
            inputSchema: z.object({ period: z.enum(["today", "yesterday", "7d", "30d", "month"]) }),
            execute: ({ period }) => safe(() => R.querySalesSummary(ctx, period)),
          }),
          list_orders: tool({
            description: "Lista pedidos por situação.",
            inputSchema: z.object({ status: z.enum(["pendente", "pedido feito", "entregue", "cancelado", "todos"]) }),
            execute: ({ status }) => safe(() => R.queryOrders(ctx, status)),
          }),
          get_order: tool({
            description: "Detalhes de um pedido pelo número (ex.: 184).",
            inputSchema: z.object({ number: z.string() }),
            execute: ({ number }) => safe(() => R.queryOrder(ctx, number)),
          }),
          find_customer: tool({
            description: "Busca cliente por nome ou telefone: total comprado e últimos pedidos (dados mínimos).",
            inputSchema: z.object({ query: z.string() }),
            execute: ({ query }) => safe(() => R.queryCustomers(ctx, query)),
          }),
          list_coupons: tool({ description: "Cupons ativos.", inputSchema: z.object({}), execute: () => safe(() => R.queryCoupons(ctx)) }),
          list_promotions: tool({ description: "Promoções ativas.", inputSchema: z.object({}), execute: () => safe(() => R.queryPromotions(ctx)) }),
          list_commands: tool({ description: "Comandos personalizados (macros) do Copilot.", inputSchema: z.object({}), execute: () => safe(() => R.queryCommands(ctx)) }),
          propose_command_save: tool({
            description: "Prepara criação ou edição de um comando personalizado (macro). O comando é executado pelo próprio Copilot quando o usuário disser uma das frases.",
            inputSchema: z.object({
              existing_name: z.string().nullable().describe("nome do comando existente quando for edição; null para criar"),
              name: z.string().describe("nome do comando, ex.: DESCONTO5"),
              phrases: z.array(z.string()).describe("frases que disparam, incluindo o nome"),
              steps: z.array(z.string()).describe("passos em linguagem simples para o cartão, ex.: 'Criar cupom de 5%'"),
              instructions: z.string().describe("instrução completa para você mesmo seguir quando o comando for dito, incluindo parâmetros fixos, o que perguntar na hora e o que extrair da fala"),
            }),
            execute: (a) => safe(() => R.proposeCommandSave(ctx, a, utterance)),
          }),
          propose_command_delete: tool({
            description: "Prepara exclusão de um comando personalizado.",
            inputSchema: z.object({ name: z.string() }),
            execute: (a) => safe(() => R.proposeCommandDelete(ctx, a, utterance)),
          }),
          restock_summary: tool({ description: "Itens e custo da reposição aberta.", inputSchema: z.object({}), execute: () => safe(() => R.queryRestock(ctx)) }),
          compare_suppliers: tool({
            description: "Compara preços e disponibilidade de uma lista de perfumes nos fornecedores.",
            inputSchema: z.object({ lines: z.array(z.object({ name: z.string(), quantity: z.number() })) }),
            execute: ({ lines }) =>
              safe(async () => {
                const { compareBasket } = await import("@/lib/purchase/compare.server");
                const c = await compareBasket(
                  ctx.adminDb,
                  lines.slice(0, 40).map((l, i) => ({ key: `l${i}`, query: l.name, quantity: Math.max(1, Math.round(l.quantity || 1)), product_id: null, forced_supplier_id: null })),
                );
                return {
                  items: c.items.map((i) => ({
                    query: i.query,
                    quantity: i.quantity,
                    status: i.status,
                    product: i.product,
                    candidates: i.candidates.slice(0, 4),
                    best: i.chosen ? { supplier: i.chosen.supplier_name, price: i.chosen.price, status: i.chosen.status } : null,
                    offers: i.offers.map((o) => ({ supplier: o.supplier_name, price: o.price, status: o.status })),
                  })),
                  cheapest: { total: c.cheapest.total, groups: c.cheapest.groups.map((g) => ({ supplier: g.supplier_name, total: g.total, items: g.items.length })) },
                  fewest_suppliers: c.fewest ? { total: c.fewest.total, suppliers: c.fewest.groups.map((g) => g.supplier_name) } : null,
                };
              }),
          }),
          advice_data: tool({
            description: "Dados reais para conselhos: vendas 30 dias, mais vendidos, estoque Orium parado, melhores margens, mais vistos.",
            inputSchema: z.object({}),
            execute: () => safe(() => R.queryAdviceData(ctx)),
          }),
          navigate: tool({
            description: "Abre uma tela do Admin imediatamente.",
            inputSchema: z.object({
              destination: z.enum([...(R.DESTINATIONS as [string, ...string[]]), "produto", "pedido"]),
              product_id: z.string().nullable(),
              product_query: z.string().nullable(),
              order_number: z.string().nullable(),
            }),
            execute: (a) => safe(() => R.resolveNavigation(ctx, a.destination, a.product_id, a.product_query, a.order_number)),
          }),
          propose_price_change: tool({
            description: "Prepara alteração de preço (precisa de confirmação).",
            inputSchema: z.object({
              ...productRef,
              price_kind: z.enum(["pix", "card", "wholesale", "decant_2", "decant_5", "decant_10", "auto", "auto_wholesale", "unknown"]),
              new_price: z.number().nullable(),
              delta: z.number().nullable().describe("variação em reais, ex.: +10 ou -20"),
              reset_to_default: z.boolean().nullable().describe("true = remover o preço próprio e voltar ao global/automático"),
            }),
            execute: (a) => safe(() => R.proposePrice(ctx, a, utterance)),
          }),
          propose_price_batch: tool({
            description: "Prepara vários preços de produto de uma vez (ex.: 2ml/5ml/10ml do mesmo perfume, ou vários perfumes). Precisa de confirmação.",
            inputSchema: z.object({
              items: z.array(z.object({
                ...productRef,
                price_kind: z.enum(["pix", "card", "wholesale", "decant_2", "decant_5", "decant_10", "auto", "auto_wholesale"]),
                new_price: z.number().nullable(),
                reset_to_default: z.boolean().nullable(),
              })),
            }),
            execute: (a) => safe(() => R.proposePriceBatch(ctx, a, utterance)),
          }),
          get_pricing_rules: tool({ description: "Regras globais atuais: margens, desconto Pix, preço comercial e preços globais dos decants.", inputSchema: z.object({}), execute: () => safe(() => R.queryPricingRules(ctx)) }),
          propose_pricing_rules: tool({
            description: "Prepara mudança de REGRA GLOBAL (vale para todos os produtos). Mostra quantos produtos mudam. Passe null no que não mudar.",
            inputSchema: z.object({
              retail_markup: z.number().nullable().describe("varejo = custo + X reais"),
              wholesale_markup: z.number().nullable().describe("atacado = custo + X reais"),
              wholesale_min_quantity: z.number().nullable(),
              psych_pricing_active: z.boolean().nullable(),
              psych_max_reduction: z.number().nullable(),
              pix_discount_percent: z.number().nullable(),
              pix_discount_active: z.boolean().nullable(),
              decant_2: z.number().nullable().describe("preço GLOBAL do decant 2ml"),
              decant_5: z.number().nullable(),
              decant_10: z.number().nullable(),
            }),
            execute: (a) => safe(() => R.proposePricingRules(ctx, a as any, utterance)),
          }),
          propose_stock_change: tool({
            description: "Prepara ajuste do estoque físico da Orium (um ou vários produtos).",
            inputSchema: z.object({ items: z.array(z.object({ ...productRef, mode: z.enum(["set", "add", "remove"]), quantity: z.number() })) }),
            execute: (a) => safe(() => R.proposeStock(ctx, a, utterance)),
          }),
          propose_availability: tool({
            description: "Prepara liberação manual, bloqueio (esconder) ou volta ao automático.",
            inputSchema: z.object({ ...productRef, override: z.enum(["none", "available", "blocked"]) }),
            execute: (a) => safe(() => R.proposeAvailability(ctx, a, utterance)),
          }),
          supplier_buy_analysis: tool({
            description: "Compensa comprar um perfume num fornecedor? Custo anunciado, frete da remessa rateado, custo total, margem real (preço do sistema) e comparação com os outros fornecedores. Só dados do banco; frete desconhecido aparece como 'a consultar'.",
            inputSchema: z.object({ ...productRef, supplier: z.string().nullable(), units: z.number().nullable() }),
            execute: ({ product_id, query, supplier, units }) =>
              P.guarded("supplier_buy_analysis", async () => {
                const r = await R.resolveProduct(ctx, product_id, query);
                if (r.status !== "ok") return { error_code: r.status, query: r.query, candidates: r.candidates };
                const { buildOfferComparison } = await import("@/lib/suppliers/hub.server");
                const c = await buildOfferComparison(ctx.userDb, r.product.id, units ?? 1);
                const pick = supplier ? c.offers.filter((o) => o.supplier_name.toLowerCase().includes(supplier.toLowerCase())) : c.offers;
                return { product: c.product, units: c.units, local_stock: c.localStock, focus: pick, all_offers: c.offers.map((o) => ({ supplier: o.supplier_name, price: o.price, freight_per_unit: o.freight_per_unit, total: o.effective_unit_cost, margin: o.margin, labels: o.labels, catalog_public: o.catalog.public })) };
              }),
          }),
          supplier_freight_quote: tool({
            description: "Cotação REAL SuperFrete para trazer N frascos de um fornecedor até a Orium (uma remessa). Se faltar CEP/medidas/peso, devolve o que falta; nunca invente frete.",
            inputSchema: z.object({ supplier: z.string(), units: z.number() }),
            execute: ({ supplier, units }) =>
              P.guarded("supplier_freight_quote", async () => {
                const { data: sups } = await ctx.userDb.from("suppliers").select("id, name").ilike("name", `%${supplier.slice(0, 60)}%`).limit(3);
                if (!sups?.length) return { error_code: "not_found", message: `Fornecedor ${supplier} não encontrado.` };
                if (sups.length > 1) return { error_code: "ambiguous", candidates: sups.map((s: any) => s.name) };
                const { quoteSupplyFreight } = await import("@/lib/suppliers/freight.server");
                return { supplier: sups[0].name, ...(await quoteSupplyFreight(ctx.userDb, sups[0].id, Math.max(1, Math.min(500, Math.round(units))))) };
              }),
          }),
          supplier_catalog_status: tool({
            description: "Quais ofertas de um fornecedor estão ou não autorizadas a disponibilizar perfumes no catálogo público.",
            inputSchema: z.object({ supplier: z.string(), filter: z.enum(["hidden", "public"]) }),
            execute: ({ supplier, filter }) =>
              P.guarded("supplier_catalog_status", async () => {
                const { data: sups } = await ctx.userDb.from("suppliers").select("id, name").ilike("name", `%${supplier.slice(0, 60)}%`).limit(3);
                if (!sups?.length) return { error_code: "not_found", message: `Fornecedor ${supplier} não encontrado.` };
                if (sups.length > 1) return { error_code: "ambiguous", candidates: sups.map((s: any) => s.name) };
                const { listCatalogOffers } = await import("@/lib/suppliers/catalog.server");
                const r = await listCatalogOffers(ctx.userDb, { supplierId: sups[0].id, filter });
                return { supplier: sups[0].name, catalog_mode: r.supplier.catalog_mode, total: r.total, sample: r.rows.slice(0, 30).map((x: any) => ({ name: x.name, price: x.price, linked: x.product_name, decision: x.decision ?? "seguir fornecedor" })) };
              }),
          }),
          propose_supplier_catalog: tool({
            description: "Prepara (com confirmação) a regra de catálogo público de um fornecedor: all (todos elegíveis), selected (só selecionados) ou none (não disponibilizar). Sincronização de preços continua.",
            inputSchema: z.object({ supplier: z.string(), mode: z.enum(["all", "selected", "none"]) }),
            execute: (a) => safe(() => R.proposeSupplierCatalog(ctx, a, utterance)),
          }),
          propose_coupon_create: tool({
            description: "Prepara criação de cupom. Passe null no que não foi dito.",
            inputSchema: z.object({
              code: z.string().nullable(),
              percent: z.number().nullable(),
              fixed_amount: z.number().nullable(),
              min_order: z.number().nullable(),
              ends_hint: z.string().nullable().describe("como falado: 'domingo', 'amanhã', data"),
              max_redemptions: z.number().nullable(),
              visibility: z.enum(["PUBLIC", "SECRET"]).nullable(),
              applies_to: z.enum(["BOTH", "FULL", "DECANT"]).nullable(),
            }),
            execute: (a) => safe(() => R.proposeCoupon(ctx, a, utterance)),
          }),
          propose_coupon_toggle: tool({
            description: "Prepara ativar/desativar cupom existente.",
            inputSchema: z.object({ code: z.string(), active: z.boolean() }),
            execute: (a) => safe(() => R.proposeCouponToggle(ctx, a, utterance)),
          }),
          propose_promotion_create: tool({
            description: "Prepara promoção percentual em um produto (frasco, decant ou ambos).",
            inputSchema: z.object({
              ...productRef,
              percent: z.number().nullable(),
              ends_hint: z.string().nullable(),
              applies_to: z.enum(["BOTH", "FULL", "DECANT"]),
              decant_sizes: z.array(z.number()).nullable(),
              name: z.string().nullable(),
            }),
            execute: (a) => safe(() => R.proposePromotion(ctx, a, utterance)),
          }),
          propose_promotion_end: tool({
            description: "Prepara remoção das promoções ativas de um produto.",
            inputSchema: z.object(productRef),
            execute: (a) => safe(() => R.proposePromotionEnd(ctx, a, utterance)),
          }),
          propose_order_status: tool({
            description: "Prepara mudança de situação de um pedido.",
            inputSchema: z.object({ order_number: z.string(), status: z.enum(["pendente", "pedido feito", "entregue", "cancelado"]) }),
            execute: (a) => safe(() => R.proposeOrderStatus(ctx, a, utterance)),
          }),
          propose_order_to_restock: tool({
            description: "Prepara envio dos itens de um pedido para a reposição.",
            inputSchema: z.object({ order_number: z.string() }),
            execute: (a) => safe(() => R.proposeOrderToRestock(ctx, a, utterance)),
          }),
          propose_restock_add: tool({
            description: "Prepara inclusão de perfumes na reposição (fornecedor mais barato disponível, ou o indicado).",
            inputSchema: z.object({ items: z.array(z.object({ ...productRef, quantity: z.number(), supplier: z.string().nullable() })) }),
            execute: (a) => safe(() => R.proposeRestockAdd(ctx, a, utterance)),
          }),
          research_perfume: tool({
            description: "Pesquisa um perfume na internet (Fragrantica e outra fonte) e devolve a ficha em português: nome oficial, marca, concentração, volume, tamanhos, gênero, família, acordes, notas de saída/coração/fundo, descrição, ano, perfumista. Demora alguns segundos.",
            inputSchema: z.object({ name: z.string(), brand: z.string().nullable(), details: z.string().nullable().describe("o que dá para ver na foto (rótulo, cor, volume), se houver") }),
            execute: (a) => safe(() => PW.researchPerfume(a)),
          }),
          propose_negotiation_create: tool({
            description: "Prepara uma peça nova na Negociação (mostruário): nome, marca, volume do frasco, ml que restam, foto e ficha olfativa pesquisada.",
            inputSchema: z.object({
              name: z.string(),
              brand: z.string().nullable(),
              volume_ml: z.number().nullable(),
              remaining_ml: z.number().nullable().describe("quanto ainda tem no frasco, em ml"),
              condition_note: z.string().nullable(),
              status: z.enum(["AVAILABLE", "NEGOTIATING", "HIDDEN"]).nullable(),
              photo: z.number().nullable().describe("número da foto (1 = a mais recente) ou null"),
              description: z.string().nullable(),
              olfactory_family: z.string().nullable(),
              fragrantica_url: z.string().nullable(),
              accords: z.array(z.object({ name: z.string(), intensity: z.number() })).nullable(),
              top: z.array(z.string()).nullable(),
              heart: z.array(z.string()).nullable(),
              base: z.array(z.string()).nullable(),
            }),
            execute: (a) => P.guarded("propose_negotiation_create", () => PW.proposeNegotiationCreate(ctx, a as any, photos, utterance)),
          }),
          propose_catalog_create: tool({
            description: "Prepara o cadastro de um perfume NOVO no catálogo da loja, com dados pesquisados, foto, preço/custo, estoque e ficha olfativa.",
            inputSchema: z.object({
              name: z.string(),
              brand: z.string(),
              volume_ml: z.number().nullable(),
              concentration: z.string().nullable(),
              gender: z.enum(["MASCULINO", "FEMININO", "UNISSEX"]).nullable(),
              sale_mode: z.enum(["FULL", "DECANT", "BOTH"]).nullable().describe("padrão BOTH"),
              visibility: z.enum(["ATIVO", "OCULTO", "INDISPONIVEL"]).nullable().describe("padrão ATIVO"),
              retail_price: z.number().nullable().describe("preço de venda do frasco, se o Admin disse"),
              cost: z.number().nullable().describe("custo, se o Admin disse"),
              stock: z.number().nullable(),
              price_on_request: z.boolean().nullable(),
              photo: z.number().nullable(),
              description: z.string().nullable(),
              olfactory_family: z.string().nullable(),
              fragrantica_url: z.string().nullable(),
              accords: z.array(z.object({ name: z.string(), intensity: z.number() })).nullable(),
              top: z.array(z.string()).nullable(),
              heart: z.array(z.string()).nullable(),
              base: z.array(z.string()).nullable(),
            }),
            execute: (a) => P.guarded("propose_catalog_create", () => PW.proposeCatalogCreate(ctx, a as any, photos, utterance)),
          }),
          propose_product_update: tool({
            description: "Prepara edição de um produto do catálogo. Mande só o que muda (o resto null).",
            inputSchema: z.object({
              ...productRef,
              name: z.string().nullable(),
              brand: z.string().nullable(),
              volume_ml: z.number().nullable(),
              concentration: z.string().nullable(),
              gender: z.enum(["MASCULINO", "FEMININO", "UNISSEX"]).nullable(),
              visibility: z.enum(["ATIVO", "OCULTO", "INDISPONIVEL"]).nullable(),
              sale_mode: z.enum(["FULL", "DECANT", "BOTH"]).nullable(),
              price_on_request: z.boolean().nullable(),
              pinned: z.boolean().nullable(),
              photo: z.number().nullable(),
              description: z.string().nullable(),
              olfactory_family: z.string().nullable(),
              accords: z.array(z.object({ name: z.string(), intensity: z.number() })).nullable(),
              top: z.array(z.string()).nullable(),
              heart: z.array(z.string()).nullable(),
              base: z.array(z.string()).nullable(),
            }),
            execute: (a) => P.guarded("propose_product_update", () => PW.proposeProductUpdate(ctx, a as any, photos, utterance)),
          }),
          propose_order_edit: tool({
            description: "Prepara edição de um pedido: adicionar/remover itens, mudar quantidade, cliente, telefone, entrega, cupom, forma de pagamento, observação e data de entrega. O sistema recalcula os preços e mostra a prévia.",
            inputSchema: z.object({
              order_number: z.string(),
              customer_name: z.string().nullable(),
              customer_phone: z.string().nullable(),
              notes: z.string().nullable(),
              fulfillment: z.enum(["PICKUP", "LOCAL", "SHIPPING"]).nullable(),
              coupon_code: z.string().nullable(),
              payment_method: z.enum(["PIX", "CARD"]).nullable(),
              delivery_date: z.string().nullable().describe("AAAA-MM-DD"),
              delivery_time: z.string().nullable().describe("HH:MM"),
              add_items: z.array(z.object({ ...productRef, variant: z.enum(["FRASCO", "DECANT"]), decant_ml: z.number().nullable(), quantity: z.number(), unit_price: z.number().nullable() })).nullable(),
              remove_items: z.array(z.object({ ...productRef, variant: z.enum(["FRASCO", "DECANT"]).nullable(), decant_ml: z.number().nullable() })).nullable(),
              set_quantity: z.array(z.object({ ...productRef, variant: z.enum(["FRASCO", "DECANT"]).nullable(), decant_ml: z.number().nullable(), quantity: z.number() })).nullable(),
            }),
            execute: (a) => P.guarded("propose_order_edit", () => PW.proposeOrderEdit(ctx, a as any, utterance)),
          }),
          propose_order_payment: tool({
            description: "Prepara o pagamento de um pedido: unpaid (não pago), deposit (sinal), paid (pago tudo) ou amount (valor total recebido até agora).",
            inputSchema: z.object({ order_number: z.string(), mode: z.enum(["unpaid", "deposit", "paid", "amount"]), amount: z.number().nullable() }),
            execute: (a) => P.guarded("propose_order_payment", () => PW.proposeOrderPayment(ctx, a, utterance)),
          }),
          propose_store_sale: tool({
            description: "Prepara uma venda da loja física (vários itens). Resolve os perfumes no catálogo, usa o preço do sistema e pede confirmação.",
            inputSchema: z.object({
              items: z.array(
                z.object({
                  ...productRef,
                  spoken: z.string().nullable().describe("trecho exatamente como falado"),
                  variant: z.enum(["FRASCO", "DECANT"]).nullable(),
                  decant_ml: z.number().nullable(),
                  quantity: z.number(),
                  unit_price: z.number().nullable().describe("só se o Admin falou um preço diferente"),
                }),
              ),
              payment_method: z.enum(["PIX", "CARTAO", "DINHEIRO"]).nullable(),
              customer_name: z.string().nullable(),
            }),
            execute: (a) => safe(() => R.proposeStoreSale(ctx, a as any, utterance)),
          }),
        };

        const today = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        // ORIUM INTELLIGENT MODEL ROUTER: escolhe o perfil pela tarefa
        const cfg = await engine.getAiConfig();
        const route = engine.routeTask(utterance, cfg.auto_route);
        let prep;
        try {
          prep = await engine.prepare(withPhoto ? "vision" : route.profile);
        } catch (e) {
          if (e instanceof engine.AiError) return new Response(e.message, { status: e.status });
          throw e;
        }
        const openai = engine.sdkProvider(prep.key);
        const t0 = Date.now();

        // histórico enxuto: só o necessário para manter o contexto
        const messages = body.messages.slice(-14);
        // fotos antigas não vão de novo para a IA (custo): viram a marcação "[foto N enviada antes]"
        let photoNo = 0;
        const recentIds = new Set(messages.filter((m) => m.role === "user").slice(-2).map((m) => m.id));
        const forModel = [...messages]
          .reverse()
          .map((m) => {
            if (m.role !== "user") return m;
            const parts = [...(m.parts as any[])].reverse().map((p) => {
              if (p?.type !== "file" || !/^image\//.test(p.mediaType ?? "")) return p;
              photoNo += 1;
              const n = photoNo;
              return recentIds.has(m.id) ? [{ type: "text", text: `[foto ${n}]` }, p] : [{ type: "text", text: `[foto ${n} enviada antes]` }];
            });
            return { ...m, parts: parts.reverse().flat() };
          })
          .reverse() as UIMessage[];
        const result = streamText({
          model: openai.responses(prep.model),
          system: SYSTEM(today, body.page ?? {}, commands ?? [], aliases ?? []),
          messages: await convertToModelMessages(forModel, { ignoreIncompleteToolCalls: true }),
          tools,
          stopWhen: isStepCount(50),
          abortSignal: request.signal,
          providerOptions: engine.reasoningOptions(prep.model, route.effort) as never,
          onFinish: async ({ totalUsage }) => {
            await engine.recordUsage({
              feature: "copilot",
              profile: prep.profile,
              model: prep.model,
              task: route.task,
              input_tokens: totalUsage?.inputTokens ?? 0,
              output_tokens: totalUsage?.outputTokens ?? 0,
              latency_ms: Date.now() - t0,
            });
          },
          onError: async ({ error }) => {
            await engine.recordUsage({ feature: "copilot", profile: prep.profile, model: prep.model, ok: false, task: route.task, error_code: error instanceof Error ? error.name.slice(0, 40) : "erro", latency_ms: Date.now() - t0 });
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onError: (e) => {
            const m = e instanceof Error ? e.message : "";
            if (/401|invalid_api_key|Incorrect API key/i.test(m)) return "A chave da OpenAI é inválida. Confira na Central de IA.";
            if (/quota|billing/i.test(m)) return "A conta da OpenAI está sem saldo. Nada foi alterado — tente de novo depois de recarregar.";
            if (/429|rate/i.test(m)) return "Muitos pedidos à OpenAI agora. Nada foi alterado — tente de novo em alguns segundos.";
            return "A IA não respondeu agora. Nada foi alterado — tente de novo.";
          },
          onFinish: async ({ messages: all }) => {
            if (!threadId) return;
            const first = all.find((m) => m.role === "user");
            const title = first?.parts?.map((p: any) => (p.type === "text" ? p.text : "")).join(" ").slice(0, 60) || null;
            const { data: t } = await ctx.userDb.from("copilot_threads").select("title").eq("id", threadId).maybeSingle();
            const { error } = await ctx.userDb
              .from("copilot_threads")
              .update({ messages: all.slice(-60), updated_at: new Date().toISOString(), ...(t?.title ? {} : { title }) })
              .eq("id", threadId);
            if (error) console.error("copilot: falha ao salvar conversa", error.message);
          },
        });
      },
    },
  },
});
