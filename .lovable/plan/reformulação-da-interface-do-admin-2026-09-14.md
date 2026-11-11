# Reformulação da interface do Admin

Objetivo: manter todas as funções, reduzir drasticamente a carga visual. Regra em toda tela: **ver → entender → agir**. Nenhuma regra de negócio muda (pedidos, estoque, preços, promoções, cupons, CRM, sincronização, reposição, analytics).

## Base compartilhada (feita primeiro)

Um conjunto pequeno de peças reutilizáveis, para todas as telas ficarem iguais:

- Escala de espaçamento única (4/8/12/16/20/24/32), radius e superfícies próprias do Admin — mais sóbrias que a loja, dourado só como acento.
- Cores de estado padronizadas: pendente âmbar, concluído verde discreto, erro vermelho, neutro cinza. Um único badge de status usado em todo o Admin.
- Hierarquia de botões: principal (dourado), secundário (superfície), terciário (texto), perigo (vermelho discreto). Uma ação principal por tela.
- Peças novas: linha de lista, bloco de seção, menu "⋯" que abre bottom sheet no celular, modal de confirmação curto, estados vazios de uma linha, skeletons contextuais, bloco recolhível "Detalhes técnicos".
- Datas e valores: "Hoje · 14:32" na lista, "12/09/2026 às 10:14" no detalhe; sempre R$ 1.299,90.

## Moldura: header e menu

- Header: menu à esquerda, título da página no centro, tema à direita — mesma margem lateral da Home, respeitando safe-area.
- Menu lateral agrupado por Geral / Catálogo / Vendas / Sistema, só ícone + nome, sem contadores espalhados (badge apenas quando há algo realmente pendente). "Voltar para a loja" discreto no fim. Drawer continua fechando por swipe, backdrop, item ou botão.

## Tela por tela

**Dashboard** — primeira dobra no celular: pedidos do período, faturamento e pendências que exigem ação ("3 pedidos pendentes", "2 produtos para revisar"). Depois conversão, mais vendidos e sincronização. Atalhos pequenos (novo produto, pedidos pendentes, reposição).

**Pedidos** (maior mudança) — lista com uma busca única (número, cliente, telefone) e filtros Todos / Pendentes / Pedido feito / Entregues; extras dentro de "Filtros". Card mostra só número, status, cliente, data, quantidade de itens, total, "Ver pedido" e no máximo uma ação rápida contextual. Endereço, telefone, itens, pagamento, custo e observações saem do card. Detalhe em blocos: Status → Cliente → Itens → Total → Entrega → Pagamento → Ações. Editar é um modo separado; cancelar e excluir ficam em "Mais opções" com confirmação.

**Clientes** — lista com nome, WhatsApp, nº de pedidos e total gasto. Perfil com seções/abas: Resumo, Pedidos, Interesses, Favoritos, Carrinho, Alertas.

**Produtos** — linha com foto, nome, marca, status, preço e disponibilidade; ação principal Editar e menu "⋯" (ocultar, alterar marca, excluir, demais). Seleção múltipla vira barra contextual com contagem. Uma ação principal: adicionar produto.

**Marcas** — nome, quantidade de produtos, status, Editar + "⋯" (mesclar, excluir).

**Precificação** — separada em Preços, Promoções e Cupons, cada uma com foco próprio, sem todas as regras juntas.

**Sincronização** — cada fornecedor com última sincronização, situação e "Sincronizar agora"; diagnóstico técnico dentro de "Ver detalhes".

**Negociação** — lista com foto, perfume, status, Editar + "⋯"; informações olfativas só no detalhe.

**Reposição** — fornecedor, produto, quantidade, custo, total, "Copiar lista" e "Exportar". Nada além.

**Ao Vivo** — lista enxuta: pessoa, intenção, carrinho, o que está vendo, "Abrir"; detalhes na sessão.

**Configurações e formulários** — revisão geral: rótulo, campo, ajuda só quando necessária; uma coluna no celular.

## Comportamento

- Navegar troca de página na hora, com skeleton no destino; nunca mostrar 0 antes de carregar.
- Confirmar pedido responde na hora, com atualização otimista e sincronização depois.
- Microinterações 100–180ms, navegação e sheets 200–280ms, só opacidade e transform.
- Scroll previsível por página, sem duplo scroll nem rolagem horizontal.
- Celular = listas e cards; tablet e desktop aproveitam a largura (duas colunas, tabelas onde ajudam), mantendo o toque confortável.

## Verificação

Larguras 320/360/375/390/393/414/430 e 768/820/834/1024 + desktop, sem overflow horizontal. Percursos testados: pedido no celular, buscar e editar um produto, abrir um cliente, montar a reposição.

## Ordem de entrega

1. Base compartilhada + moldura (header, menu)
2. Pedidos (lista + detalhe + edição)
3. Dashboard e Clientes
4. Produtos e Marcas
5. Precificação, Sincronização, Negociação, Reposição, Ao Vivo, Configurações
6. Auditoria final tela por tela
