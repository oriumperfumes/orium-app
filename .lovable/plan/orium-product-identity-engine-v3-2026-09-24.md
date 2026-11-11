# Orium Product Identity Engine V3

Hoje: 719 produtos ativos, 1.746 ofertas de fornecedor (748 sem vínculo). Já existem peças soltas (merges, duplicados, blocklist, histórico, travas de vínculo) — o V3 unifica tudo num motor único, conservador e reversível, sem quebrar o catálogo atual.

## Regra global de volume e concentração (decisão)
- **Produto canônico = marca + nome base + flanker + edição.** (Ex.: "Hawas Black · Rasasi")
- **Apresentação = volume + concentração + estado (lacrado/tester/sem caixa/kit)** — é uma variante *dentro* do canônico.
- O Comparador e a Reposição só comparam ofertas da **mesma apresentação**. 100ml nunca concorre com 200ml; EDT nunca com Parfum; tester nunca com lacrado.
- Loja pública continua mostrando um produto por canônico.

## Etapas de entrega (rollout seguro, cada fase validada antes da próxima)

**Fase 1 — Estrutura + auditoria (sem mudar o comportamento atual)**
- Camadas separadas: dado bruto do fornecedor (preservado com hash e versão) → vínculo persistente (oferta → canônico, com estado e autor) → oferta → canônico.
- Estados de vínculo: AUTO_MATCHED, REVIEW_REQUIRED, NEW_CANONICAL, MANUALLY_MATCHED, MANUALLY_SEPARATED, BLOCKED, ERROR.
- Pares "já revisados, são diferentes" (nunca mais sugeridos).
- Travas por campo (nome, marca, volume, concentração, imagem, Fragrantica…) + origem de cada campo.
- Aliases por tipo: marca, produto, fornecedor, voz, busca.
- Registro de versão do motor (v3) em cada decisão.
- Flag `identity_engine_v3_enabled` (desligada no início).

**Fase 2 — Motor + simulação (dry run)**
- Pipeline: normalização que preserva identidade → extração de atributos (marca, base, flanker, concentração, volume, gênero, edição, estado, categoria) → candidatos (marca/base/aliases/tokens, top 5–20) → comparação → regras duras → pontuação explicável → decisão.
- Regras duras que vencem qualquer pontuação: flanker diferente ou presente só de um lado, edição diferente, marca diferente (salvo alias conhecido), par marcado como diferente → nunca auto-mescla.
- EAN confiável = evidência fortíssima; imagem igual = só sinal extra.
- IA apenas para nomes difíceis (extrair atributos em formato estruturado), nunca decide sozinha; custo diário baixo.
- "Simular limpeza": relatório completo sem gravar nada.

**Fase 3 — Backfill em fases**
- Snapshot lógico de todos os vínculos/merges antes de qualquer alteração.
- Marcas → atributos → reconstrução de vínculos → duplicados reais → **merges suspeitos existentes** (canônicos com ofertas de flankers/volumes/marcas conflitantes) → fila de revisão → só aplicar vínculos de altíssima confiança, com prévia.

**Fase 4 — Fila de revisão e ferramentas**
- Admin → Produtos → Integridade do catálogo: cards (Produtos, Ofertas, Sem vínculo, Possíveis duplicados, Merges suspeitos, Sem marca, Revisões, Travas) + [Revisar duplicados] [Revisar inconsistências] [Executar auditoria] [Simular limpeza].
- Cartão lado a lado com foto, marca, concentração, volume, fornecedor e preço; diferenças escritas ("Base igual · Flanker: nenhum vs Elixir") e recomendação.
- Ações: Mesmo produto / Produtos diferentes / Editar dados / Revisar depois.
- Ações em lote apenas com prévia ("Aplicar 43 matches seguros") e desfazer. Sem botão "Corrigir tudo".
- Aprendizado: alias só é criado após confirmações repetidas.

**Fase 5 — Mesclar, desfazer e separar**
- Mesclar preserva e migra: ofertas, estoque, custos, aliases, imagens, views, favoritos (sem duplicar), carrinhos (mesma variante/quantidade), alertas de estoque, dados olfativos, promoções e histórico. Conflitos (descrição, imagem, Fragrantica) mostrados para escolha ou resolvidos por prioridade definida.
- **Desfazer mesclagem** a partir do registro completo.
- **Separar produto** (ex.: Yara + Yara Elixir): redistribui ofertas e dados e grava "são diferentes".
- Pedidos antigos e vendas da loja nunca são alterados (usam snapshot).

**Fase 6 — V3 como caminho oficial**
- KL, MRX e Smart passam a usar só o motor; nenhum adaptador decide duplicados.
- Sync não cria produto público direto; vínculo existente é reutilizado sem novo fuzzy; decisões manuais e exclusões permanentes são respeitadas.
- Proteção contra explosão/mass merge: se novos canônicos ou merges saírem muito acima do histórico → ANOMALOUS_IMPORT, nada publicado, alerta no painel.
- Comparador, Reposição, busca, favoritos e rankings consultam por canônico (+ apresentação).
- Regras de segmento (ARABIC/DESIGNER/NICHE, designer perfume fora da loja, body/cosméticos preservados) continuam valendo sem atrapalhar a identificação.

## Testes automatizados obrigatórios
Dataset com casos reais: devem mesclar (variações de Club de Nuit Intense Man EDT 105ml, Hawas Black nos 3 fornecedores); nunca mesclar (Yara×Elixir/Tous/Moi/Candy, Asad×Bourbon/Zanzibar/Elixir, Hawas×Black/Elixir/Kobra, Fakhar Black×Rose×Gold, Khamrah×Qahwa/Dukhan/Waha, família Club de Nuit, Turathi Blue×Electric, Spectre Ghost×Wraith); volume, concentração, marca, vínculo persistente, trava manual, split + sync, merge + sync, pedidos, favoritos, analytics, carrinho, promoções e alertas.

## Detalhes técnicos
- Novas tabelas: `supplier_raw_items` (payload, hash, versão), `identity_mappings` (supplier_product_id → product_id, estado, score, sinais, engine_version, decided_by), `identity_negative_pairs`, `identity_merge_log` (payload reversível com todos os ids migrados), `identity_snapshots`, `identity_runs` (dry run/relatório/anomalias), `product_field_provenance` (campo, origem, lock), `catalog_aliases` (tipo).
- Reaproveita `product_merges`, `product_duplicates`, `permanent_catalog_blocklist`, `link_locked`, `canonical_identity_locked`; os antigos ficam marcados como obsoletos, sem remoção.
- Motor puro em `src/lib/identity-v3/` (normalize, extract, candidates, compare, decide) testado com vitest; merge/split como funções do banco atômicas; tudo staff-only com RLS.
- Execução: construirei as fases 1–4 neste ciclo (estrutura, motor, testes, dry run, auditoria e fila). Fases 5–6 (merge/split reversível e ativação oficial no sync) logo em seguida, após você revisar o relatório da simulação.
