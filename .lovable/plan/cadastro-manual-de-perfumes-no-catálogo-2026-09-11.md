# Cadastro manual de perfumes no catálogo

Criar um fluxo simples no Admin para cadastrar um perfume do zero, sem depender de MRX ou Smart Mania, escolhendo se ele é vendido só como Decant, só como Frasco, ou os dois.

## O que você vai ver

**Admin → Produtos** ganha o botão **+ Adicionar produto**, que abre um formulário em uma coluna (mobile-first), na mesma pegada da área de Negociação:

1. Foto (câmera ou galeria, com preview, trocar e remover)
2. Nome do perfume
3. Marca (escolher existente ou criar nova, sem duplicar)
4. Volume, concentração, gênero, descrição
5. **Como será vendido?** Decant · Frasco · Ambos
6. Preço e estoque, quando houver frasco
7. Link do Fragrantica + Importar informações
8. Status: Ativo · Oculto · Indisponível
9. Salvar

Depois de salvo, o mesmo formulário abre em modo edição na página do produto, permitindo mudar tudo — inclusive trocar o tipo de venda (ex.: de Decant para Decant + Frasco), com efeito imediato na loja. Também haverá **Excluir produto**, com confirmação, sem apagar pedidos antigos.

## Regras de venda

- **Decant**: o perfume aparece no catálogo apenas com 2ml/5ml/10ml. O card mostra "Decant a partir de R$ 19,90" com o selo Decant, e a página do perfume não oferece frasco.
- **Frasco**: aparece só como frasco completo, sem opção de decant.
- **Ambos**: comportamento atual, cliente escolhe.

Essas regras valem em catálogo, busca, página do perfume, Queridinhos, recomendações, favoritos e carrinho — o carrinho recusa uma variante que o produto não vende.

## Preço e estoque

- Frasco: você informa o preço de venda; o custo é opcional (serve só para ver margem no painel). Há a opção **Usar precificação automática da Orium**, que aplica custo + margem configurada; desligada, vale o preço manual.
- Decant: usa os preços globais atuais (2ml R$ 19,90 · 5ml R$ 39,90 · 10ml R$ 69,90), já preparado para override por produto no futuro.
- Estoque: em unidades apenas para frasco. Produto somente Decant fica disponível/indisponível pelo **status**, sem contagem de unidades.
- Sem estoque de frasco (quando vende frasco) continua bloqueando frasco e decant, conforme a regra atual.

## Informações olfativas

Mesmo sistema dos perfumes atuais: colar o link do Fragrantica e importar acordes, pirâmide e notas; edição manual depois; se o Fragrantica bloquear, cai no fluxo assistido de colar o conteúdo. Nada é inventado.

## Proteção contra a sincronização

O produto é marcado como cadastro manual da Orium. A sincronização dos fornecedores não pode sobrescrever, apagar, recriar nem mudar preço/estoque dele. Se um dia um fornecedor passar a ter esse perfume, a oferta é registrada para você decidir — sem alterar o produto sozinho.

## Detalhes técnicos

- Migração em `public.products`: `source text default 'supplier'` (`'manual'` no cadastro), `sale_mode text default 'BOTH'` (`DECANT` | `FULL` | `BOTH`), `full_bottle_available boolean default true`, `manual_pricing boolean default false`, `manual_cost numeric`, `visibility_status text default 'ATIVO'` (`ATIVO` | `OCULTO` | `INDISPONIVEL`). `sale_mode` sincroniza `decant_available` e `full_bottle_available` por trigger, para que as regras cheguem à loja pelas colunas já públicas.
- `recompute_product_pricing` e `recompute_all_pricing` passam a ignorar produtos com `source='manual'` (hoje zerariam preço e estoque por não haver `supplier_products`). Preço automático do manual = `manual_cost` + margem de `pricing_settings`, aplicado no salvamento.
- `search_catalog`, `new_arrivals`, `top_viewed_products` e `olfactory_similar` passam a devolver `full_bottle_available` e `sale_mode`; grants públicos limitados às colunas públicas (custo/margem/`manual_cost` seguem fora do alcance anônimo).
- Novas server functions em `src/lib/manual-product.functions.ts` (staff-only via `is_staff`, `supabaseAdmin` dentro do handler): `createManualProduct`, `updateManualProduct`, `deleteManualProduct`. Slug único, `ensureBrand` para marca, `product_identity_history` para auditoria, `canonical_identity_locked=true`.
- Foto: novo bucket público `produtos`, reaproveitando o pipeline de otimização da Negociação (`src/lib/image-optimize.ts` + rota de upload) gerando WebP em duas medidas (thumb + grande).
- Motor de fornecedores (`src/lib/suppliers/engine.server.ts`): `source='manual'` passa a bloquear update de preço, estoque, imagem, `active` e desativação por ausência; ofertas novas só criam `supplier_products` para revisão.
- UI: `ManualProductSheet.tsx` (bottom sheet mobile-first, uma coluna, sem os bugs de teclado já corrigidos), botão em `admin.produtos.tsx`, edição + exclusão em `admin.produtos.$id.tsx`, reaproveitando `FragranceEditor`/`FragrancePanel` para acordes e pirâmide.
- Front: `canDecant` respeita `sale_mode`; novo helper `canFullBottle`; `ProductCard`, `BuySheet`, `DecantPicker`, `perfume.$slug.tsx` e o carrinho passam a usar os dois.

## Verificação

Typecheck e build, mais teste no navegador a 320/375/430px: cadastrar um perfume somente Decant, um somente Frasco e um Ambos; conferir card, busca, filtros, página do perfume e carrinho; mudar o tipo de venda e confirmar reflexo imediato; rodar uma sincronização e confirmar que o produto manual não muda.
