# Gestão de Marcas no Admin

Nova área **Admin → Marcas** para corrigir, unificar, criar e excluir marcas com segurança, sem editar perfume por perfume.

Situação atual do catálogo: 118 marcas, 29 sem nenhum produto vinculado, 21 com perfumes mas nenhum produto público. Já existe apelido de marca (usado pela sincronização) e já existe correção de marca em lote na tela de Produtos — vamos reaproveitar as duas coisas.

## 1. Lista de marcas

Nova página no menu do Admin, entre Produtos e Precificação, com busca por nome e, para cada marca:

- Nome
- Produtos vinculados
- Perfumes
- Outros tipos (Body Splash, Hidratante, Pasta…) quando existirem
- Produtos públicos
- Status: **Ativa** (tem produto público), **Sem produtos públicos**, **Vazia**
- Ações: Editar · Mesclar · Excluir

Filtros rápidos: todas / só com produtos públicos / sem produtos públicos / vazias, e por categoria (perfume ou outros).

## 2. Editar nome

Um campo de nome. Ao salvar (ex.: Rayhaa → Rayhaan):

- a marca passa a se chamar Rayhaan;
- todos os produtos vinculados recebem o nome novo automaticamente;
- o nome antigo é guardado como apelido, para a sincronização dos fornecedores não recriar “Rayhaa” depois.

## 3. Mover produtos de uma marca para outra

Na própria linha da marca: “Mover todos os produtos para → [marca]”. Mostra quantos produtos serão movidos, pede confirmação e move tudo de uma vez. Depois disso a marca de origem fica vazia e pode ser excluída.

## 4. Mesclar marcas

Escolhe a marca correta (destino) e confirma. Passo a passo:

- todos os produtos e apelidos vão para a marca destino;
- a marca antiga é removida e seu nome vira apelido da destino;
- ofertas de fornecedor continuam intactas — nada de produto ou preço é apagado.

Tela de confirmação antes de aplicar, com resumo: “12 produtos passarão de Rayhaa para Rayhaan”.

## 5. Criar marca

Botão “Nova marca”. Se o nome já existir (mesmo escrito diferente), o sistema avisa e oferece usar a existente em vez de duplicar.

## 6. Excluir com segurança

- Marca vazia: exclusão direta, com confirmação.
- Marca com produtos: exclusão bloqueada, com a mensagem de mover ou mesclar primeiro.

## 7. Sugestões de duplicadas

Bloco no topo listando pares muito parecidos (mesmo nome ignorando acentos, espaços e erros de uma letra). Nunca une nada sozinho: sempre com botões Mesclar / Ignorar.

## 8. Filtros do catálogo

Os filtros do catálogo continuam mostrando apenas marcas com produto público, e as categorias de marca respeitam o tipo de produto — marcas que só têm Body Splash não aparecem no filtro quando o cliente está vendo perfumes. Vamos corrigir o caso das marcas cujo nome gravado no produto ficou diferente do nome da marca, que é o que faz marca sem produto público ainda aparecer.

## 9. Ação em massa em Produtos

Na tela de Produtos, com produtos selecionados, a opção “Mudar marca” continua disponível e passa a mostrar a mesma lista de marcas da nova área.

## 10. Celular

Cartões em vez de tabela, ações em folha inferior, campos grandes, confirmações claras e área de toque confortável.

## Detalhes técnicos

- Novas funções de servidor em `src/lib/brands.functions.ts` (staff-only, via `requireSupabaseAuth` + verificação de papel): `listBrands`, `renameBrand`, `moveBrandProducts`, `mergeBrands`, `createBrand`, `deleteBrand`, `listBrandDuplicateCandidates`, `ignoreBrandDuplicate`.
- Toda escrita é feita por uma função no banco (`admin_brand_rename`, `admin_brand_move_products`, `admin_brand_merge`, `admin_brand_delete`), `security definer` com checagem `is_staff`, para que produtos + `brand`/`brand_id` + apelidos mudem numa única transação.
- Migração: coluna `brands.status_note`/`archived_at` não é necessária; adicionamos apenas `brand_merges` (histórico: origem, destino, produtos movidos, autor, data) e `brand_duplicate_ignores` (pares descartados), com GRANT + RLS staff-only.
- Renomear e mesclar sempre gravam apelido em `brand_aliases` (`source='painel'`), que é o caminho que `ensureBrand` já consulta — é isso que impede o fornecedor de recriar a marca errada.
- Nova rota `src/routes/_authenticated/admin.marcas.tsx` + item no `AdminShell`; componente `src/components/orium/BrandsManager.tsx`.
- Nada muda em preços, promoções, estoque, pedidos ou nas fotos.

## Testes

1. Renomear Rayhaa → Rayhaan e conferir os produtos vinculados.
2. Mover 10 produtos de uma marca para outra.
3. Mesclar duas marcas e conferir produtos, apelidos e histórico.
4. Tentar excluir marca com produtos (deve bloquear) e marca vazia (deve excluir).
5. Rodar a sincronização depois de renomear e confirmar que a marca errada não volta.
6. Conferir os filtros do catálogo e a tela em 320–430px.
