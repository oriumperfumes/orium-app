-- products: colunas internas só para a equipe (parte 2 de 2). Pré-requisitos: 20261113170000_public_ready_to_deliver_ids.sql aplicada e o app
-- desta branch publicado (leituras/escritas internas passam por server functions: src/lib/product-internal.functions.ts).
--
-- Contexto
--   * O papel `authenticated` é o mesmo para clientes logados e para a equipe, e tinha SELECT de tabela inteira em
--     public.products. A política "public reads active products" vale para ele, então qualquer cliente logado lia as 37
--     colunas internas (manual_cost, preços-base, estoque local, chaves de identidade etc.).
--   * No banco atual (snapshot de 13/11) `anon` e `authenticated` têm GRANT ALL de tabela em products, o que torna sem efeito os
--     grants por coluna que também existem. Só o baseline endurecido (40-acl-hardened.sql do candidato) já fecha o `anon`; em
--     produção não. Por isso esta migração fecha os DOIS papéis para o mesmo conjunto: as 39 colunas públicas (as 38 de antes +
--     `price_on_request`, o "Consultar no WhatsApp" da loja). Nenhuma escrita direta: INSERT/UPDATE/DELETE em products só pelo
--     servidor (service_role) ou por RPCs SECURITY DEFINER protegidas por is_staff().
--   * A equipe lê/edita as colunas internas por server functions que checam is_staff() e usam o cliente de serviço.
--   * `search_catalog` é SECURITY DEFINER e continua lendo products inteira.
--
-- Não altera o baseline (generated/baseline.sql) nem migrações anteriores. Idempotente.

-- 2. anon e authenticated: leitura somente das colunas públicas de products, sem escrita direta.
REVOKE ALL ON TABLE public.products FROM anon, authenticated;
GRANT SELECT (
  id, canonical_name, brand, gender, concentration, volume_ml, image_url, slug, active, in_stock, stock_quantity,
  retail_price, wholesale_price, created_at, updated_at, image_urls, brand_id, product_type, gender_norm,
  catalog_eligible, weight_g, height_cm, width_cm, length_cm, flanker, search_aliases, search_text, product_line,
  search_norm, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, source, sale_mode,
  full_bottle_available, pinned_at, pinned_new, price_on_request
) ON TABLE public.products TO anon, authenticated;

-- 3. store_sale_apply_stock é auxiliar interno (só store_sale_commit/update/cancel/delete a chamam, todas SECURITY DEFINER) e
--    altera local_stock, decant_ml_consumed e inventory_movements SEM checar equipe. Estava executável por `anon` (via PUBLIC) e por
--    `authenticated`: qualquer visitante ou cliente logado podia ajustar o estoque por RPC. Fica só para o dono e service_role.
REVOKE ALL ON FUNCTION public.store_sale_apply_stock(uuid, integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_sale_apply_stock(uuid, integer, numeric) TO service_role;

-- 4. store_product_cost(uuid) devolve o custo (manual_cost / melhor oferta) de QUALQUER produto, sem checar quem chama, e estava
--    executável por `anon` (via PUBLIC) e por `authenticated`: era um caminho de leitura de custo sem passar pelas colunas. Só
--    store_sale_commit/store_sale_update (SECURITY DEFINER, executam como o dono) a usam; nenhum código do app a chama.
REVOKE ALL ON FUNCTION public.store_product_cost(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_product_cost(uuid) TO service_role;

-- Reversão (somente se algo crítico quebrar; reabre as colunas internas a todo cliente logado):
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products TO authenticated;
--   GRANT SELECT ON TABLE public.products TO anon;   -- estado anterior de produção também deixava `anon` com GRANT ALL
