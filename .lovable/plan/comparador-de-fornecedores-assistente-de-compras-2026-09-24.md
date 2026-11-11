# Comparador de Fornecedores + Assistente de Compras

Um sistema grande, então vou construir em 4 etapas. Cada etapa pode ser usada e testada assim que fica pronta.

## Etapa 1 — KL Cosméticos entra como fornecedor oficial
- A KL usa a mesma plataforma de loja da Smart Mania. O leitor que já existe para a Smart Mania vira um leitor genérico para esse tipo de loja, e KL e Smart Mania passam a usá-lo com endereços diferentes. Nada de código específico espalhado.
- Todos os leitores entregam as mesmas informações: fornecedor, código do produto no fornecedor, nome, marca, preço, disponibilidade, link, foto, volume, concentração, data da coleta e dados brutos.
- Leitura completa na primeira vez, passando por paginação, categorias e todas as páginas. Isso vale também para uma revisão da MRX e da Smart Mania.
- O preço é guardado exatamente como o fornecedor mostra. É o custo real, sem margem, frete ou taxa.
- Histórico de preço: um registro a cada mudança de valor ou de disponibilidade.
- Status de cada oferta: Disponível / Indisponível / Não encontrado / Desatualizado / Erro de sincronização. Quando não foi possível verificar, isso nunca é tratado como "sem estoque".
- Plano B quando um site não pode ser lido: importar CSV/XLSX, colar o catálogo ou corrigir uma oferta à mão. Cada oferta mostra se veio de "Sincronização automática" ou de "Atualização manual". Nada de passar por CAPTCHA.
- Números da coleta por fornecedor: coletados, associados a produtos existentes, novos produtos, precisam de revisão e ignorados.

## Etapa 2 — Identificação de perfumes v2 e limpeza de duplicados
- Uma nota de semelhança que combina: marca, nome, linha, versão (flanker), concentração, volume, gênero, apelidos, SKU/EAN, fonética, histórico de associações e foto (a foto só como sinal extra).
- Termos de versão têm peso decisivo. Se um nome tem a palavra e o outro não, os dois nunca são unidos automaticamente. Entram na lista: Elixir, Intense, Black, White, Rose, Gold, Silver, Platinum, Bourbon, Tous, Moi, Candy, Qahwa, Dukhan, Waha, Electric, Blue, Green, Kobra, Iconic, Sillage, Milestone, Precieux, Zanzibar, Limited/Collector's Edition, Parfum, Extrait, EDP e EDT.
- Três resultados possíveis: MESMO PRODUTO (liga sozinho), REVISAR (você decide) e DIFERENTES (ficam separados). Na dúvida, nunca une.
- Memória permanente: um código de produto do fornecedor fica ligado a um perfume da Orium. Na próxima sincronização o sistema não tenta descobrir de novo.
- Trava manual: uma correção sua sobrevive às próximas sincronizações.
- Revisão dos produtos já cadastrados: procura duplicados reais, uniões erradas, apelidos repetidos e itens de fornecedor sem perfume ligado. Isso só gera sugestões e não une nada sozinho.
- Nova tela de revisão em "Possível duplicado": duas fotos lado a lado, diferenças destacadas, os fornecedores de cada um e os botões [São o mesmo] / [São diferentes].
- As regras atuais continuam valendo: árabe, body splash e hidratante; perfume de grife fica fora do catálogo público.

## Etapa 3 — Assistente de compras (dentro de Reposição)
- Botão "Assistente de compras" em Reposição.
  - Computador: conversa à esquerda e compra atual à direita.
  - Tablet: as duas partes se adaptam sem espremer as colunas.
  - Celular: conversa em tela cheia e o botão "Ver compra · N itens" abre a compra embaixo.
- Você escreve ou cola uma lista, com quantidades como "3 Asad Bourbon", "Asad Bourbon x3" ou nomes repetidos.
- Como funciona por dentro:
  1. A IA separa os nomes e entende o que você pediu.
  2. A busca procura no catálogo.
  3. O sistema pega as ofertas salvas.
  4. Totais, economia e divisão entre fornecedores são calculados por código.
  5. A IA só organiza a resposta.
  - Preço e disponibilidade vêm sempre do banco. A IA nunca inventa esses números.
- Respostas em cartões:
  - Um perfume: uma oferta por fornecedor, "Melhor preço" em dourado, economia, última verificação e botão para abrir no site do fornecedor.
  - Lista: tabela compacta (produto · melhor fornecedor · preço), com "Ver comparação" em cada linha, compra agrupada por fornecedor e total.
  - Tudo que você mandar tem um resultado: separo em Encontrados / Revisar ("Qual deles?", com as opções) / Não encontrados.
- Se o mais barato está indisponível, uso o próximo disponível e aviso ("KL seria R$10 mais barato, mas está indisponível").
- Quantidade em estoque só é considerada quando o fornecedor informa de verdade.
- Aviso "Preço pode estar desatualizado" com botão para atualizar o fornecedor. O estado de cada sincronização aparece discretamente.
- Perguntas como "baixou?" são respondidas com o histórico real de preços.
- Comandos da conversa: só com estoque, quanto vou gastar, sem a Smart, dá para comprar em 2 fornecedores?, troca o Hawas para MRX, adicione tudo na reposição.
- "Adicionar à reposição": entra com fornecedor, quantidade, preço por unidade e subtotal. Uma troca feita por você fica marcada como "Escolha manual".
- Cada comparação usada fica salva (lista, preços e escolha) para você consultar depois.
- Só administrador e dono têm acesso, com checagem também no servidor.

## Etapa 4 — Rotas e melhor compra
- Configurações → Fornecedores: cada fornecedor em um cartão com endereço de retirada (a localização exata é buscada automaticamente), telefone, horário, se aceita retirada, observações, status, produtos e [Sincronizar].
- Local de saída: por padrão o endereço da loja Orium, com opção de sair de outro lugar e de "retornar à Orium".
- Custo de deslocamento opcional: valor por km, ou consumo e preço do combustível.
- Duas opções lado a lado para você escolher: A — Menor preço e B — Menos paradas ou equilíbrio. Cada uma mostra a diferença em reais, as paradas e os km economizados. O sistema não decide por você.
- Rota real pelas ruas, com a melhor ordem de visita calculada pelo Google Maps, mapa pequeno e botão "Abrir no Google Maps" com as paradas em ordem. Pedágio só aparece quando o Google informar.

## O que vou precisar de você
- Conectar o Google Maps (vai aparecer um cartão para aprovar) para mapa e rotas reais.
- Os endereços dos 3 fornecedores e da loja Orium. Você pode preencher depois nas Configurações. Até lá, a parte de rota mostra "endereço não configurado" e não inventa nada.

## Detalhes técnicos
- Adapters: `KyteAdapter(baseUrl)` parametrizado (Smart Mania, KL) + MRX; registro em `ADAPTERS`; linha nova em `suppliers` (slug `kl`, site kyte). Auditar cursor/paginação/categorias do sitemap nos três.
- Migração: `supplier_products` + `availability_status`, `stock_qty`, `stock_reliable`, `captured_at`, `source` (auto/manual), `manual_lock`, `ean`; tabela `supplier_offer_history` (ou reuso de `supplier_price_history` com status); `supplier_product_links` (supplier_id+supplier_product_id → product_id, locked, decided_by); `suppliers` + endereço, lat/lng, telefone, horário, pickup, notes; `purchase_settings` (origem, retorno, custo/km); `purchase_comparisons` (audit jsonb). GRANT + RLS apenas para staff em todas.
- Identidade: estender `flankers.ts` e `dedupe.server.ts` com um scorer v2 que devolve `HIGH_SAME | REVIEW | DIFFERENT` e aplica um veto rígido quando os flankers diferem; reutilizar a fonética de `store-sales-phonetics.ts` e o índice de `store-sales-match.server.ts`; job de backfill que preenche `product_duplicates` / `product_identity_suggestions`.
- Ferramentas do chat (server fns, `requireSupabaseAuth` + `is_staff`): `searchCanonicalProducts`, `getSupplierOffers`, `compareShoppingList`, `optimizeSupplierAllocation` (solução exata por subconjuntos de fornecedores, ≤2^N com N pequeno), `buildPurchaseRoute`, `addItemsToRestock`. O LLM (`openai/gpt-6-astra`) só faz o parse da intenção com schema estrito e nunca recebe o catálogo inteiro.
- Rotas: Google Routes `computeRoutes` com `optimizeWaypointOrder` pelo gateway do conector; geocoding na hora de salvar o endereço; mapa com a chave de navegador.
- A etapa 3 funciona sem a etapa 4, e a parte de rota fica desativada até existirem endereços.
- Fica pendente do trabalho anterior: rodar os 7 testes de editar e excluir vendas da loja (registrado no roadmap).
