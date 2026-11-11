# Vendas da loja (com registro por voz)

Nova área no Admin, dentro de **Vendas**, para registrar vendas feitas presencialmente. Dois modos: manual rápido e por voz com IA. O dinheiro entra na Dashboard junto com o app, mas o funil de conversão do aplicativo não é tocado.

## O que você vai usar

**Admin → Vendas da loja**
- Topo: `🎙 Registrar por voz` e `+ Nova venda`
- "Vendas de hoje: R$ X · N vendas"
- Lista das vendas recentes: número (#LV-0142), hora, itens resumidos, pagamento, total, `Ver`

**Registrar por voz**
1. Toca no microfone → tela escura com microfone grande, onda de áudio e cronômetro ("Estou ouvindo…")
2. Você fala: "Vendi 3 decants de 5ml do Asad Bourbon no Pix"
3. Aparece discretamente "Você disse: …" com opção de corrigir o texto
4. Tela **Revise a venda**: foto real do perfume, marca, Frasco/Decant, tamanho, quantidade com − e +, preço unitário, subtotal, pagamento, total
5. `Confirmar venda` → "✓ Venda registrada" com `🎙 Registrar outra venda` e `Ver venda`

Correção por voz na própria revisão: "na verdade foram dois", "adiciona dois Yara de 10ml", "tira um 9PM", "tudo deu 150 reais", "pagamento foi dinheiro". O contexto acaba quando a venda é confirmada ou cancelada.

**Nova venda (manual)**: busca do perfume (a mesma busca do catálogo), escolhe Frasco ou Decant, tamanho, quantidade, preço; o campo de busca volta pronto para o próximo item. O microfone também fica disponível para adicionar itens por voz.

## Regras que respeitamos

- A IA nunca registra sozinha: ela interpreta, o servidor valida, você confirma.
- A IA nunca inventa perfume, preço, cliente nem variante. Em dúvida, ela pergunta.
- Perfumes parecidos nunca se misturam (Yara ≠ Yara Elixir ≠ Yara Tous ≠ Yara Moi; Asad ≠ Asad Bourbon; Club de Nuit Intense ≠ Iconic ≠ Milestone). Confiança alta pré-seleciona; média pede confirmação; baixa mostra as opções.
- Preço falado vale como preço praticado. Sem preço falado, usamos o preço atual e avisamos "Preço não informado — usando preço atual".
- "Tudo deu 150 reais" vira Subtotal / Desconto / Total pago — os itens não são alterados em silêncio.
- Pagamento não falado fica como `Selecionar`.
- Cliente é opcional; um nome falado sem certeza mostra `Vincular cliente` ou `Registrar sem cliente`.
- Data é hoje por padrão; data diferente sempre aparece antes de confirmar.
- Dois toques em Confirmar criam uma venda só.
- Sem custo cadastrado, o lucro não é inventado: "Lucro pendente — custo ausente".

## Estoque

- **Frasco vendido**: baixa 1 unidade do estoque do perfume.
- **Decant vendido**: some o volume (3 × 5ml = 15ml). O frasco só sai do estoque quando o volume acumulado completa um frasco inteiro (usando o volume do frasco do produto). Nunca 3 decants = 3 frascos.
- Custo do decant = parte proporcional do líquido (custo do frasco ÷ volume × ml vendidos). A embalagem fica preparada para depois, como você escolheu.
- Toda venda confirmada gera movimentação rastreável, e cancelar/editar reverte o estoque.

## Financeiro e Dashboard

- Cards de Vendas, Lucro bruto, Ticket médio e Mais vendidos passam a somar app + loja.
- Filtro `Todos | App | Loja` no período da Dashboard.
- O rótulo passa a ser "Vendas", com detalhe "Pedidos do app: X · Vendas da loja: Y".
- Reposição considera frascos e ml consumidos conforme a regra atual.
- **Funil de conversão continua só digital** — venda presencial não entra.
- Venda da loja não aparece como pedido pendente e continua fora da lista de Pedidos.

## Parte técnica

**Banco (migração)**
- `store_sales`: número sequencial (LV-), `sale_channel` ('physical_store'), `entry_method` ('voice'|'manual'), `payment_method`, `customer_id` (opcional), `subtotal`, `discount`, `total`, `cost_total`, `gross_profit`, `cost_complete` (bool), `status` ('confirmada'|'cancelada'), `sold_at`, `created_by`, `transcript`, `idempotency_key` único.
- `store_sale_items`: `product_id`, `variant` ('FULL'|'DECANT'), `decant_ml`, `quantity`, `unit_price`, `unit_cost_snapshot`, `ml_consumed`, `subtotal`, snapshots de nome/imagem.
- `store_sale_events`: auditoria (criada, editada, cancelada, voz).
- `products.decant_ml_consumed` (numeric default 0) para o consumo parcial de frasco.
- GRANTs para `authenticated` e `service_role`; RLS com `is_staff(auth.uid())` em todas as políticas.
- RPCs `SECURITY DEFINER`: `store_sale_commit(payload jsonb)` (atômica: venda + itens + snapshot de custo + estoque + eventos, idempotente), `store_sale_cancel(id)`, `store_sale_list(from,to)`, `store_sale_detail(id)`.
- `admin_dashboard(p_from, p_to, p_channel default 'all')` passa a unir `catalog_orders` e `store_sales`, mantendo `analytics_funnel` intocado; `top_sold_products` ganha os itens da loja.

**Voz e IA (tudo no servidor)**
- `src/lib/store-sales-voice.functions.ts`: `transcribeSale` envia o áudio para `/v1/audio/transcriptions` (`google/gemini-3.5-transcribe`, pt-BR) e `interpretSale` usa `openai/gpt-6-astra` no endpoint Responses com schema estrito devolvendo apenas termos falados (nome, marca, variante, ml, quantidade, preço, pagamento, cliente, desconto, total, data) — nunca IDs.
- Matching em duas etapas: a IA extrai os termos, o motor de identidade existente (`search_catalog` + `perfume_aliases` + `canonical.ts`) devolve os candidatos reais, e só um candidato com confiança suficiente é pré-selecionado. Enviamos apenas os candidatos recuperados, não o catálogo inteiro.
- `LOVABLE_API_KEY` fica só no servidor; o navegador só envia o áudio.
- `src/lib/store-sales.functions.ts`: `storeSaleCommit`, `storeSaleCancel`, `storeSaleUpdate`, `storeSaleList`, `storeSaleDetail`, todas com `requireSupabaseAuth` + checagem de staff.

**Interface**
- Rota `src/routes/_authenticated/admin.vendas-loja.tsx` + item "Vendas da loja" no grupo Vendas do menu.
- Componentes em `src/components/orium/admin/store-sales/`: `VoiceCapture` (MediaRecorder, waveform em canvas, cronômetro, permissão pedida só no toque, sem gravação contínua, áudio descartado depois), `SaleReview`, `SaleItemCard`, `ManualSaleComposer`, `SaleDetailSheet`.
- Mobile-first, grafite/dourado, campos ≥16px, safe-area, zero scroll horizontal; no tablet/desktop a venda fica à esquerda e o resumo à direita quando há espaço.
- Fallback: microfone negado ou navegador sem suporte → "Não foi possível acessar o microfone" + `Abrir lançamento manual`. Offline → rascunho local com "Rascunho — aguardando conexão".
- Eventos internos de operação (`voice_sale_started`, `voice_transcribed`, `physical_sale_confirmed`, …) separados do analytics público.

## Ordem de execução

1. Migração (tabelas, RLS, RPCs de commit/cancelamento/listagem, coluna de ml consumido)
2. `admin_dashboard` e `top_sold_products` com canal
3. Funções de servidor (voz, interpretação, commit)
4. Tela de Vendas da loja + revisão + manual + detalhe
5. Filtro de canal na Dashboard
6. Testes dos 10 casos do seu roteiro (incluindo duplo toque, cancelamento e custo ausente) em celular, tablet e desktop
