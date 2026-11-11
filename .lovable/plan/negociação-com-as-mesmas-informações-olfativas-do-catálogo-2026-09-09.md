# Negociação com as mesmas informações olfativas do catálogo

Objetivo: o cadastro, a importação (Fragrantica + colar conteúdo), a edição manual e a
ficha pública dos perfumes de Negociação passam a usar **exatamente** os mesmos
componentes e o mesmo motor já usados em Admin → Produtos → Editar perfume.

## Como será feito (uma única infraestrutura)

Hoje Negociação guarda acordes/notas em campos próprios (texto simples), separados do
sistema olfativo do catálogo. Em vez de duplicar editor, parser e pirâmide, cada item de
Negociação passa a ter uma **ficha olfativa ligada ao mesmo sistema do catálogo**:

- ao salvar um item de Negociação, a Orium cria automaticamente uma ficha interna
  vinculada a ele (invisível no catálogo, sem preço, sem estoque, sem decant, fora de
  busca, promoções, reposição, sincronização de fornecedor, limpeza de duplicados e
  posicionamento de marcas);
- essa ficha é o que guarda família, acordes, descrição e pirâmide — nas mesmas tabelas
  usadas pelos perfumes normais, com as mesmas imagens de notas, mesma fonte e mesmo
  status de importação/verificação.

Resultado: nada de parser, editor ou pirâmide paralelos. Melhorias futuras no sistema
principal aparecem em Negociação automaticamente.

## Admin → Negociação (mobile primeiro)

Fluxo: Adicionar perfume → foto → nome → marca → volume → salvar → abre o bloco
**Informações olfativas** (o mesmo componente do catálogo), com:

- campo “Cole o link do perfume no Fragrantica” e botão de importar;
- se a fonte bloquear (403), a mensagem já explica o bloqueio e abre a área grande
  **Colar conteúdo do Fragrantica** com “Identificar informações”;
- comparação “Conteúdo atual vs Informações encontradas” antes de **Aplicar**;
- edição manual completa depois: família, descrição, acordes (nome, ordem, intensidade),
  notas de saída/coração/fundo com posição e imagens, e travar/soltar a informação;
- mesmos status: verificado, importado, precisa revisão, não encontrado, fonte bloqueada
  (403 nunca vira “não encontrado”).

Também adiciono o campo **Família olfativa** no mesmo editor, para valer nos dois lados.

## Ficha pública de Negociação

A página do item passa a mostrar o mesmo bloco “Conheça a fragrância” do perfume normal:
mesmos acordes em barras, mesma descrição, mesma pirâmide com imagens das notas, mesmo
comportamento mobile e mesmas animações de scroll. Se houver descrição salva à mão, ela
tem prioridade. Continua sem preço, com o botão de negociar no WhatsApp.

Os acordes/notas já cadastrados nos itens existentes são copiados para a nova ficha, sem
perda.

## Detalhes técnicos

- Migração: coluna `negotiation_items.product_id` (FK para `products`, `on delete set null`);
  ficha interna criada com `product_type = 'NEGOCIACAO'`, `active = false`,
  `catalog_eligible = false`, `decant_available = false`, slug `negociacao-<id>`.
- Exclusão explícita de `product_type = 'NEGOCIACAO'` em `hygiene.server.ts`
  (duplicados/marcas), `identity-run.server.ts`, `enrichment-v3.server.ts` e no motor de
  fornecedores, para que essas fichas nunca sejam unificadas, publicadas nem sincronizadas.
- `negotiation.functions.ts`: `saveNegotiationItem` garante/atualiza a ficha interna
  (nome/marca/volume/imagem espelhados); `deleteNegotiationItem` remove a ficha e suas
  linhas olfativas. Backfill único para os itens já existentes.
- `FragranceEditor` é reutilizado sem cópia; ganha campo de família olfativa e passa a ser
  montado na tela de Negociação com o `productId` da ficha.
- `FragranceStory` é reutilizado em `src/routes/negociacao.$id.tsx`; os blocos antigos de
  acordes/pirâmide dessa rota são removidos.
- Servidores de importação (`previewFragranticaLink`, `applyFragranticaLink`,
  `previewFragranticaPaste`, `applyFragranticaPaste`) e o parser de conteúdo colado ficam
  como estão — passam a ser chamados também por Negociação.
- Ajuste de RLS/permissões apenas para leitura pública das linhas olfativas dessas fichas.
- Verificação: typecheck, build e teste no celular (320–430px) cadastrando um item
  completo, com importação por link e por conteúdo colado.
