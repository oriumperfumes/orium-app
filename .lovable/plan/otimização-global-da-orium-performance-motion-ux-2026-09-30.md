# Otimização global da Orium — performance, motion, UX

Trabalho grande demais para uma única passada segura. Proposta: fazer por fases, sempre medindo antes e depois, sem remover o visual premium (vidro, decants, carrinho flutuante, busca fixa no topo, Copilot).

## Ponto para você decidir
Antes você pediu: **digitar só mostra sugestões e a lista só muda ao apertar Enter**. Agora o pedido diz "não esperar Enter". Proposta: manter as sugestões instantâneas enquanto digita (com resultados reais, foto e preço) e a lista principal continuar mudando só ao confirmar. Se preferir a lista mudando sozinha, me avise.

## Fase 1 — Auditoria (medir, sem mudar nada)
- Medir abertura, rolagem, busca, abrir perfume, adicionar ao carrinho em 360/390/430, tablet e desktop, com rede lenta simulada.
- Levantar: tamanho do pacote inicial da loja (ver se Admin/Copilot/gráficos vazam), imagens grandes em cards, consultas repetidas por card (favoritos, pronta entrega, promoções, preços), listeners de rolagem, deslocamento de layout.
- Consultas lentas do banco e índices faltando.
- Entrega: relatório curto com os 10 maiores problemas, em ordem do que o cliente sente.

## Fase 2 — Loja pública (o que o cliente sente)
- Imagens: fotos dos cards em tamanho de miniatura (srcset/sizes, WebP), foto grande só na página do perfume; foto principal da Home carregada com prioridade e sem piscar.
- Voltar do perfume para o catálogo: manter rolagem, produtos já carregados, filtros, busca e modo Frasco/Decant.
- Rolagem infinita: carregar o próximo lote antes de chegar ao fim, sem produtos repetidos.
- Cache: catálogo, marcas, preços, favoritos e configurações reaproveitados; preço, estoque e pedido sempre atualizados.
- Pré-carregar perfume ao tocar/passar o mouse (apenas no link, sem pré-carregamento global).
- Separar Admin, Copilot e gráficos do pacote da loja.

## Fase 3 — Sistema de movimento
- Três velocidades únicas (rápida ~140ms, padrão ~220ms, destaque ~320ms) e uma curva só, usadas no app todo.
- Toque: todos os botões respondem com leve redução (~0.98) na hora.
- Transição de telas: fade + poucos pixels. Foto do card → foto do perfume só se ficar estável.
- Topo transparente → vidro: animar só opacidade/fundo/borda, desfoque fixo; o mesmo material de vidro no topo, busca e barra inferior.
- Decants, carrinho flutuante (compacto → mostra item → volta), coração dourado, esqueletos discretos, contadores de 300–500ms.
- Remover brilhos pulsando sem motivo; respeitar "reduzir movimento" do aparelho.

## Fase 4 — UX e conversão
- Home: deixar claro o que vende, como buscar, decant para experimentar, mais vendidos, pronta entrega.
- Card e página do perfume com uma ação principal por etapa; informações secundárias recolhidas.
- Textos de decant: "Para conhecer / Para usar por mais tempo / Para quem já gostou".
- Estados vazios úteis ("Não encontramos esse perfume" + Limpar filtros) e telas de erro que nunca ficam brancas.
- Checkout mostrando produto, variação, quantidade, pagamento, total e entrega sem nada escondido.

## Fase 5 — Admin, PWA e banco
- Admin carregado sob demanda; Copilot sem rerenderizar o app inteiro.
- Service worker: guardar só arquivos estáticos com versão; nunca preço, estoque ou pedido.
- Índices no banco onde a auditoria mostrar lentidão (catálogo, busca, pedidos por status, estoque).
- Métricas internas de tempo (abertura, busca, abrir perfume, adicionar ao carrinho) só no modo de desenvolvimento.

## Detalhes técnicos
- Medição com Playwright + CDP (throttling de CPU 4x e rede Fast 3G), Web Vitals (LCP/INP/CLS) e análise do bundle do Vite.
- Tokens de movimento em `src/styles.css` (`--motion-fast/standard/emphasis`, `--ease-orium`), classe `press` unificada.
- Imagens de fornecedores são URLs externas: usar transformação de imagem do armazenamento quando a foto estiver lá; senão, `sizes` correto + `decoding=async` + dimensões fixas.
- Consultas por card (pronta entrega, favoritos, promoções) já são em lote; confirmar e ajustar onde não forem.
- Nada de `defaultPreload` global (continua desligado).

## Ordem sugerida
Fase 1 → 2 → 3 nesta sequência; 4 e 5 depois. Cada fase termina com teste nas larguras pedidas e um resumo do que melhorou.
