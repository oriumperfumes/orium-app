# Catálogo público focado em perfumaria árabe

## Situação atual (medida no banco)
- Já existe o segmento de marca (Árabe / Designer / Nicho / Desconhecido), mas **nenhuma marca está marcada como Designer ou Nicho**: 24 árabes e 47 desconhecidas.
- **39 perfumes de marca desconhecida estão públicos**. Vários são perfumes designer com a marca cadastrada errada: "212 Vi", "212 Ro", "212 Me" (Carolina Herrera 212 VIP…), "Acqua" (Acqua di Giò, da Giorgio Armani), "Allure" (Chanel), "Addict" (Dior), "Victoria's Secret". Hoje eles aparecem para o cliente.
- O bloqueio de designer existe só em parte da sincronização e não é reavaliado quando a marca muda.

## O que será feito

**1. Classificação oficial da marca (fonte da verdade)**
- O segmento fica na marca, com origem (manual ou automática) e quem decidiu. A decisão manual nunca é sobrescrita.
- Lista inicial de marcas Designer (todas as que você citou, com seus apelidos, ex.: YSL, D&G, Paco Rabanne) e lista de marcas Árabes protegidas (Lattafa, Maison Alhambra, Armaf, Afnan, Rasasi, Al Wataniah, French Avenue, Fragrance World, Paris Corner, Khadlaj, Ahmed Al Maghribi, Orientica, Swiss Arabian e as árabes que já estão no catálogo). Nicho só por decisão do Admin; preço ou "premium" nunca vira Nicho.
- As listas ficam no banco e são editáveis pelo Admin, não presas no código.

**2. Regra de elegibilidade única (etapa própria depois da identidade)**
- Perfume + Designer → oculto. Perfume + Nicho → oculto. Perfume + Desconhecida → **em revisão** (não publica perfume novo; os que já estão públicos só saem quando você confirmar). Árabe → segue as regras normais.
- Body splash, hidratantes, pastas, cremes e cosméticos **não** são afetados por esta regra.
- A regra roda sozinha no banco sempre que a marca ou o produto mudam: trocar o segmento de uma marca reavalia todos os perfumes dela na hora. A sincronização de KL, MRX e Smart passa pela mesma regra, então não consegue republicar nada.
- Nada é apagado: ofertas, custos, pedidos, favoritos, histórico, vínculos e apelidos ficam guardados.

**3. Correção das marcas erradas (Identity Engine V3)**
- A auditoria de identidade passa a apontar produtos cuja "marca" é, na verdade, o nome de uma linha designer (212, Acqua di Giò, Allure, Addict…) e sugere a marca real. Você confirma, e o perfume sai do catálogo público pela regra.

**4. Simulação antes de aplicar**
- "Simular limpeza Designer/Nicho": marcas Designer encontradas, perfumes Designer, marcas Nicho, perfumes Nicho, itens que serão ocultados e itens duvidosos (Desconhecidas), com a lista.
- [Revisar] e [Aplicar]. Aplicar só oculta Designer/Nicho confirmados; Desconhecidas nunca são ocultadas em massa. Tudo fica registrado e é reversível ao mudar o segmento.

**5. Admin → Marcas**
- Cada marca mostra nome, segmento, qtd. de produtos e qtd. de públicos.
- Filtros: Todos, Árabes, Designer, Nicho, Desconhecidos.
- Seleção de várias marcas → [Alterar segmento], com reavaliação automática dos perfumes.

**6. Experiência pública**
- Filtro de marcas, busca, sugestões, página do perfume, Novidades, Mais vendidos, Mais vistos, "Você também pode gostar", notas olfativas e promoções mostram só produtos elegíveis. Marca sem produto público não aparece.
- Buscar "Dior" ou "Chanel" não retorna nem sugere nada oculto.
- Favoritos antigos de itens ocultos simplesmente não aparecem (nada é apagado).
- Carrinho: item que ficou oculto aparece como "indisponível" e não pode ser finalizado.
- Pedidos antigos continuam intactos.

**7. Áreas internas**
- Admin continua encontrando tudo (produtos, ofertas, pedidos, relatórios de vendas).
- Reposição e Assistente de compras ganham o filtro [Apenas catálogo Orium], ligado por padrão.
- Integridade do catálogo: perfumes Designer ocultos, perfumes Nicho ocultos, marcas Desconhecidas.
- Relatório de cada sincronização: coletados, árabes elegíveis, Designer/Nicho ocultos, em revisão. Oculto por regra aparece como "importado · fora do catálogo", nunca como falha.

**8. Testes automáticos**
Dior Sauvage e Chanel Bleu não aparecem; Lattafa Asad aparece; Maison Alhambra continua árabe; marca desconhecida vai para revisão; nova sync de Dior atualiza a oferta e o produto continua oculto; busca pública por Dior sem resultados; Admin encontra o item; body splash de marca designer não é afetado.

## Detalhes técnicos
- Migração: `brands.segment_locked`, tabela `brand_segment_rules` (chave da marca/apelido → segmento, editável), coluna `products.public_visible` e `products.eligibility_reason`; função `compute_catalog_eligibility(product)` + triggers em `products` (brand_id, product_type) e `brands` (segment) que recalculam `catalog_eligible`/`public_visible`.
- Unknown: novos perfumes entram com `eligibility_reason='brand-review'`; existentes ficam como estão até decisão.
- Auditar e ajustar os RPCs públicos (`search_catalog`, `search_intent`, `top_sold_products`, `top_viewed_products`, `new_arrivals`, `olfactory_similar`, `fragrance_publicly_visible`, `public_promotions`) e as consultas de `index.tsx`/`perfume.$slug.tsx`/carrinho para exigir `catalog_eligible AND public_visible AND active`; filtro de marcas público derivado só de produtos elegíveis.
- Sync (`engine.server.ts`) deixa de decidir designer por conta própria e grava contadores de elegibilidade no `sync_runs`.
- Classificador em `src/lib/identity-v3/eligibility.ts` com testes vitest.
