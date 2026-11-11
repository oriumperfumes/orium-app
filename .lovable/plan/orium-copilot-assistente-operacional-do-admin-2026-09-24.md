# Orium Copilot — assistente operacional do Admin

O assistente de compras atual vira o **Orium Copilot**: um painel disponível em qualquer tela do Admin, com texto, voz e comandos próprios. O comparador de fornecedores passa a ser uma das ferramentas dele.

Princípio: **a IA entende → a ferramenta valida → o Admin confirma → o servidor executa → a auditoria registra.**

## Decisões já tomadas
- Várias conversas, salvas no servidor, cada uma com endereço próprio (abre igual no celular e no computador).
- Microfone: toque rápido começa/para; segurar grava enquanto pressiona. Nunca fica ouvindo sozinho.
- Sob encomenda continua: estoque local 0 + fornecedor com o produto = Disponível.

## Fase 1 — Estoque da Orium separado do fornecedor (caso crítico)
- Novo estoque local por produto, independente do fornecedor, mais: liberação manual ("disponível mesmo sem contagem") e bloqueio manual ("esconder").
- Uma única regra decide a disponibilidade pública, nesta ordem:
  1. bloqueio manual → Indisponível
  2. estoque local > 0 → Disponível (estoque local)
  3. liberação manual → Disponível (manual)
  4. fornecedor disponível → Disponível (sob encomenda)
  5. caso contrário → Indisponível
- A regra roda no banco sempre que estoque local, liberações ou ofertas mudam. A sincronização só escreve o estoque do fornecedor e **nunca** apaga o estoque local nem as liberações.
- Toda alteração gera uma movimentação (antes, depois, motivo, quem, origem: Copilot/tela/venda). Estoque negativo é recusado.
- Vendas da loja passam a baixar o estoque local; exclusão/edição estorna como hoje.
- Cliente continua vendo só Disponível/Indisponível.
- Admin → Produto ganha o bloco "Estoque Orium" (unidades, disponibilidade pública e por quê) separado de "Fornecedores" (preço e situação de cada um), com ajuste de estoque e as duas chaves manuais.

## Fase 2 — Central de ações (as ferramentas)
Cada ação declara nome, descrição, parâmetros, quem pode usar, risco, se pede confirmação, se pode desfazer e a função do servidor que executa. O Copilot só usa ações dessa lista; nada de comandos livres no banco.

Ações iniciais:
- **Consulta (sem confirmação):** buscar produto, ver produto (preço Pix/cartão/atacado/decants, custo, margem, estoque, fornecedores), pedidos por situação, abrir pedido, clientes (resumo mínimo), vendas e lucro por período, resumo do dia e comparação com ontem, mais vendidos, cupons ativos, promoções ativas, reposição e custo da reposição, comparar fornecedores, produtos parados/boa margem.
- **Navegação (imediata):** abrir telas e itens (pedidos pendentes, reposição, um produto, clientes...).
- **Simulação (sem alterar):** "quanto ganho vendendo por X".
- **Alteração (prévia + confirmar):** alterar preço (qual preço: Pix, atacado, frasco, decant — pergunta se ambíguo; alerta forte abaixo do custo; "voltar ao automático"), ajustar estoque (definir × adicionar × zerar; lote), liberar/bloquear disponibilidade, criar/desativar cupom (pergunta só o que faltar), criar/remover promoção pelo sistema real de promoções, mudar situação do pedido, enviar itens do pedido à reposição, adicionar/trocar fornecedor na reposição, registrar venda da loja (mesmo motor de voz atual).
- **Crítica (confirmação forte):** excluir venda, ações em massa.
- Permissão checada por ação no servidor, com as mesmas regras das telas; a IA nunca pode mais que o usuário.
- Produto, pedido, cliente e cupom sempre localizados no banco; nomes passam pelo motor de identidade V3 e pelos apelidos de voz ("lique de bran" → Liquid Brun). Ambíguo ("Yara") → pergunta com fotos.
- Desfazer: disponível por alguns segundos em preço e estoque, executado como nova operação auditada no servidor.
- Execução parcial em lote mostra "4 concluídas, 1 falhou" com o motivo.

## Fase 3 — Copilot (conversa, voz, cartões)
- Botão discreto no topo do Admin abre o painel: lateral no computador, quase tela cheia no celular; sem fundo travado, navegação continua funcionando.
- Sabe a tela atual (rota, produto/pedido aberto, filtros) — "coloca esse por 319" funciona na página do produto.
- Classifica cada pedido em **Consulta**, **Conselho** ou **Ação**. Consulta e conselho nunca alteram nada.
- Conselhos separam **Dados** (números reais: vendas, margem, estoque, visualizações, carrinhos, favoritos, buscas sem resultado) de **Sugestão**, sem inventar causa; terminam com botões como Criar promoção / Criar cupom / Ver produto.
- Ações aparecem como cartões com foto: "Estoque 0 → 3 · Indisponível → Disponível · [Confirmar]". Depois: "✓ Estoque atualizado" com antes/depois, ou "Não consegui…" com motivo.
- Voz: onda + "Estou ouvindo…" → "Entendendo comando…" → "Você disse: …" → prévia. Confirmar por voz ("sim") vale só para a ação pendente atual e expira em ~60 s.
- Tela vazia com ações rápidas: Registrar venda, Comparar fornecedores, Ajustar estoque, Criar cupom, Alterar preço, Resumo de hoje.
- Contexto ("ele" = último produto) limitado à conversa atual.

## Fase 4 — Admin → Configurações → Copilot
- **Comandos personalizados:** nome + frases + o que fazer (uma ou várias ações, ex. "Fechamento" = vendas de hoje, lucro, pedidos pendentes, vendas da loja, reposição). Frases com espaços simples como "Chegaram {quantidade} {produto}". Formulário simples, sem programação. Ações que alteram algo continuam pedindo confirmação.
- **Apelidos:** "dar entrada" → adicionar estoque. O Copilot pode sugerir salvar um apelido usado com frequência, só salva se você aceitar.
- **Confirmações, Permissões, Voz** (modo de toque) e **Histórico de ações** (quem, frase original, transcrição, intenção, ação, antes/depois, resultado, com Desfazer quando cabível).

## Testes antes de concluir
Consulta, conselho, navegação, preço (incl. abaixo do custo e ambíguo), cupom, promoção, estoque local, liberação manual, fornecedor sem estoque + estoque local, sync não apaga estoque local, pedido, reposição, comparação, venda da loja, voz, confirmação por voz ("sim" fora de contexto recusado), comando personalizado, permissões, auditoria, desfazer, erro parcial, celular 320–430 px e computador. Testes automáticos para a regra de disponibilidade e a central de ações; iPhone/Android reais ficam para você conferir (não consigo abrir um aparelho físico).

## Detalhes técnicos
- Migração: `products.local_stock int not null default 0 check >= 0`, `availability_override text` (`none|available|blocked`), `effective_availability text`, `availability_source text`; tabela `inventory_movements`; tabelas `copilot_threads`, `copilot_messages` (UIMessage jsonb, id do banco uuid), `copilot_actions` (auditoria + pendências com `expires_at`, `status`, `undo_of`), `copilot_commands`, `copilot_aliases`; todas staff-only com GRANT + RLS. Função `compute_effective_availability(product)` + gatilhos em `products` e `supplier_products`; `in_stock` passa a espelhar `effective_availability` para manter busca/cartões atuais. RPCs `inventory_adjust(product, mode, qty, reason, source)` com `FOR UPDATE` e `store_sale_commit/update/delete` baixando/estornando `local_stock`. `stock_quantity` antigo migra para `local_stock` só se veio de ajuste manual (verificar origem antes).
- `src/lib/copilot/registry.server.ts`: definições (zod, risco, confirmação, undo, handler) reaproveitando `purchase`, `store-sales`, `orders`, `promotions`, `pricing`, `dashboard`, `crm`. Ações de alteração em dois passos: `propose` grava a pendência no servidor e devolve a prévia; `confirm(action_id)` revalida e executa. O modelo nunca executa direto.
- `src/routes/api/copilot.ts`: streaming AI SDK, `openai/gpt-6-astra` pela Responses API, ferramentas = consultas + `propose_*` + `navigate`; autenticação e `is_staff` no próprio handler; persistência em `onFinish`.
- Transcrição reaproveita `/api/store-sale-transcribe` e `recorder.ts` (toque/segurar).
- UI com AI Elements (conversation, message, prompt-input, shimmer, tool) em `src/components/orium/copilot/`; rota `/admin/copilot/$threadId` + painel global em `AdminChrome`; `PurchaseAssistant` vira ferramenta dentro do Copilot (tela de compras continua existindo).
- Ordem de entrega: Fase 1 → 2 → 3 → 4; Fase 1 é verificada no banco antes das demais.
