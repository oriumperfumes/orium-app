# Relacionamento e retenção — status

# Correção urgente de regressões — busca e Admin
- [x] Restaurar busca automática do catálogo com uma única query, cancelamento e paginação limpa
- [x] Validar busca, erro de digitação, limpar, ESC, modo sticky e voltar do perfume (sem erros no console)
- [x] Corrigir falha real de navegação/pré-carregamento do Admin (bibliotecas alinhadas, pré-carregamento automático desligado)
- [ ] Testar telas do Admin logado como administrador (aguarda saber qual conta de administrador usar no teste)

- [x] Base de dados: favoritos, avisos de estoque + fila, carrinhos e itens, fichas de clientes, anotações e eventos
- [x] Favoritos com coração no card e na página do perfume (visitante + conta, sincronização, sem duplicar)
- [x] Página “Meus favoritos” com atalho no cabeçalho e escolha de tamanho de decant
- [x] “Quero experimentar” em decant, só para perfumes
- [x] Avise-me quando voltar (conta, WhatsApp ou e-mail) + cancelamento + fila sem repetir
- [x] Carrinho salvo no servidor, merge por variante, marcação de abandonado e conversão em pedido
- [x] Admin → Clientes: métricas, busca (nome, WhatsApp, e-mail, número do pedido), filtros, ficha completa, WhatsApp, anotações
- [x] Acesso restrito a admin/owner (funções internas fechadas para visitante)
- [ ] Envio real de aviso por e-mail/WhatsApp: a fila registra quem avisar, mas o disparo depende de canal configurado
- [ ] Marcação automática de carrinho abandonado por agendamento (hoje é botão no painel + atualização em cada visita)

# Reformulação visual (preto quente + dourado)
- [x] Tokens globais dark-first (preto quente, grafite, dourado fosco) + light reinterpretado
- [x] Header compacto, busca premium, categorias em círculos
- [x] Hero editorial da Home + atalhos de descoberta
- [x] Cards de perfume com imagem protagonista e CTA dourado
- [x] Bottom navigation mobile
- [ ] Página do perfume editorial (decant, acordes em barras, pirâmide)
- [ ] Carrinho/checkout/sheets/empty states/skeletons na nova linguagem

- [ ] Busca: só pesquisar após pausa na digitação, sem subir a página sozinha
- [ ] Carrinho (CartSheet/FloatingCart/checkout) com a identidade visual atual

# Reformulação da interface do Admin (ver → entender → agir)
- [x] Base compartilhada (status, blocos, cartões, "⋯", confirmação, vazios, skeletons, detalhes técnicos)
- [x] Moldura: menu agrupado (Geral, Catálogo, Vendas, Sistema), topo simples com título
- [x] Pedidos: lista enxuta + detalhe em blocos, ações perigosas só no "⋯"
- [x] Dashboard: "Precisa de atenção" primeiro, movimento por período, atalhos
- [x] Clientes: lista simples + ficha no detalhe
- [x] Produtos: linha limpa, uma ação principal, barra de seleção com "Mais"
- [x] Marcas: nome, quantidade, status, Editar + "⋯"
- [x] Sincronização: status + "Sincronizar agora"; diagnóstico em "Ver detalhes"
- [x] Negociação e Ao Vivo: listas enxutas, detalhes no item
- [x] Pedidos como central visual de vendas: fotos, badges Frasco/Decant, ação contextual, envio seletivo para reposição
- [ ] Auditoria no celular real com sessão de administrador (Pedidos, Produtos, Clientes, Reposição)

# Vendas da loja (registro por voz)
- [x] Base de dados: vendas da loja, itens, histórico, ml de decant consumido, acesso só da administração
- [x] Assistente por voz: gravar → transcrever → interpretar → revisar → confirmar (voz nunca registra sozinha)
- [x] Lançamento manual com busca de perfume, variante, quantidade, preço, pagamento e cliente opcional
- [x] Estoque: decant desconta ml (frasco só cai ao completar o volume); cancelamento devolve com histórico
- [x] Dashboard com filtro Todos / App / Loja; mais vendidos soma os dois canais
- [x] Funil de conversão e lista de Pedidos seguem só com as vendas do app
- [x] Testado de 320 a 1920px, sem rolagem lateral e sem erros no console

## Comparador de fornecedores (2026-09-24)
- [x] KL Cosméticos cadastrada com adapter próprio e fallback permitido para a fonte estruturada do Kyte
- [x] Assistente de compras (/admin/compras), rota via Google Maps, Fornecedores e rota (/admin/fornecedores-rota)
- [x] Veto de flanker no vínculo automático de ofertas
- [x] Diagnosticar e corrigir a sincronização KL ponta a ponta, com adapter próprio, health check e erro de zero produtos
- [x] Registrar etapas, contadores, respostas limitadas e log técnico de cada execução KL
- [x] Preservar ofertas válidas em falhas e distinguir disponibilidade desconhecida de indisponível
- [x] Executar backfill completo da KL sem publicar vínculos incertos nem tratar a carga como novidade comercial
- [ ] Validar preços, paginação, disponibilidade, identidade, falhas e participação da KL no Comparador/Reposição
- [ ] Endereços dos 3 fornecedores + local de saída (aguardando usuário)
- [ ] Tela visual de duplicados com fornecedores lado a lado (Identity v2 completo) e backfill
- [ ] Pendente anterior: validar os 7 testes de editar/excluir vendas da loja

## Identity Engine V3
- [x] Estrutura (vínculos persistentes, pares diferentes, fila, snapshots, log reversível, travas por campo, aliases por tipo, flag)
- [x] Motor determinístico + 44 testes com casos reais
- [x] Simulação, auditoria e fila de revisão (Admin → Integridade)
- [x] Mesclar / desfazer mesclagem / separar produto
- [x] Sync respeita separações manuais e veto V3 de flanker
- [ ] Fase 6: V3 como caminho único do sync (staging + proteção ANOMALOUS_IMPORT) — após revisão da fila
- [ ] IA auxiliar para nomes difíceis (só extração)

- [x] Catálogo focado em perfumaria árabe: segmento da marca + regra central no banco; simulação/aplicação em Admin → Marcas
- [ ] Aplicar a limpeza Designer/Nicho (aguarda revisão do dono em Admin → Marcas)

# Orium Copilot
- [x] Estoque Orium separado do fornecedor + regra única de disponibilidade (bloqueio > estoque local > liberação manual > fornecedor)
- [x] Sincronização não apaga estoque local; vendas da loja baixam estoque local; movimentações auditadas
- [x] Central de ações com risco/confirmação/permissão/desfazer no servidor
- [x] Copilot global no Admin (texto, voz tocar/segurar, "sim" com expiração, cartões com foto, conversas salvas)
- [x] Configurações → Copilot (comandos, apelidos, confirmações, histórico); ficha do produto com Estoque Orium × Fornecedores
- [ ] Teste completo logado como administrador (conta de teste não é staff) e em iPhone/Android reais
- [ ] Cupom de valor fixo / valor mínimo (o sistema de cupons hoje só aceita %)
- [ ] Sugestão automática de apelido por uso frequente

- [x] Dashboard: "Pedidos em atenção" = todos os pedidos ativos não entregues (pendente > confirmado > pedido feito, mais antigo primeiro), itens resumidos, contador total

# Admin no PC (layout de sistema de gestão)
- [x] Largura total no PC (sem coluna estreita) e Dashboard em grade: KPIs em linha, Pedidos + resumo do estoque, gráfico + atalhos
- [ ] Pedidos: lista + detalhe lado a lado
- [ ] Produtos: lista densa + edição lateral
- [ ] Estoque: lista + resumo lateral fixo
- [ ] Reposição: lista + resumo por fornecedor fixo
- [ ] Precificação: busca + simulador lado a lado
- [ ] Clientes: lista + perfil
- [ ] Ao Vivo: visitantes + detalhe da sessão
- [ ] Sincronização: fornecedores em cards horizontais
- [ ] Configurações: menu de categorias + conteúdo
- [ ] Testar 360→1920 logado como administrador

## Otimização global (plano aprovado 30/09)
- [x] Fotos da Home em WebP leve (3,3MB → 51KB)
- [x] Sistema único de movimento (tokens) + toque imediato nos botões + esqueletos discretos
- [x] Cache global curto; voltar ao catálogo reaproveita páginas
- [x] Pipeline de fotos: 3 versões (320/640/1400) + troca automática da origem pela versão Orium
- [x] Ilha dourada "Adicionado!" no carrinho
- [ ] Rodar "Otimizar fotos existentes" (Admin → Produtos → ⋯) — precisa ser feito logado como admin
- [ ] Fotos novas vindas da sincronização entram otimizadas só após rodar a ferramenta (o servidor não redimensiona sozinho)
- [x] Teste com celular lento: rolagem restaurada ao voltar, CLS 0,02, sem erros
- [x] Carrinho flutuante mostra "Adicionado" e volta ao compacto; coração mais sutil
- [x] Índices do banco para filtros e acordes do catálogo
- [x] Supplier Hub: Kyte connector, Amado Fragrance integrated (reference-only), priorities/logistics/per-perfume prefs, comparison in Fornecedores + product page, Restock honors priorities
- [ ] Supplier Hub: Copilot write action "priorizar fornecedor X para perfume Y" (read/compare already uses the hub rules)
- [ ] Supplier Hub: CSV/XML manual import and Shopify/WooCommerce connectors
- [ ] Supplier Hub: supply forecast shown inside customer orders
