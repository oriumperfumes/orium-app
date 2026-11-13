-- Reexecuta, em SQL e por perfil, as consultas REAIS que o app faz em `products` (catálogo, página do perfume, favoritos, filtros,
-- carrinho/pronta entrega, Admin), depois das migrações 20261113170000 + 20261113170100. Dados fictícios; termina em ROLLBACK.
-- Cada consulta é a tradução direta do .select()/.eq()/.in() do código (arquivo indicado ao lado): o que importa aqui é que o papel
-- do banco tenha privilégio de TODAS as colunas selecionadas e filtradas (PostgREST exige SELECT nas colunas de filtro também).
-- Perfis: visitante = anon; cliente = authenticated sem equipe; equipe = authenticated com user_roles admin (+ caminho de servidor = service_role).
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-8000-000000000001', 'admin'), ('00000000-0000-4000-8000-000000000002', 'client');
INSERT INTO public.profiles (id, name, email) VALUES ('00000000-0000-4000-8000-000000000002', 'Cliente Ficticio', 'cliente@exemplo.invalid');
INSERT INTO public.brands (id, canonical_name, slug, segment) VALUES ('00000000-0000-4000-8000-0000000000b1', 'Marca Ficticia', 'marca-ficticia', 'ARABIC');
INSERT INTO public.products (id, canonical_name, slug, brand, brand_id, product_type, concentration, volume_ml, gender_norm, retail_price, wholesale_price, manual_cost,
                             active, catalog_eligible, stock_quantity, local_stock, availability_override, decant_available, decant_price_5ml) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Perfume Ficticio A', 'perfume-ficticio-a', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 'EDP', 100, 'masculino', 250, 200, 100, true,  true,  5, 3, 'none', true, 39.9),
  ('00000000-0000-4000-8000-0000000000a2', 'Perfume Ficticio B', 'perfume-ficticio-b', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 'EDP', 100, 'feminino',  260, 210, 110, true,  false, 5, 2, 'none', true, 39.9),
  ('00000000-0000-4000-8000-0000000000a3', 'Perfume Ficticio C', 'perfume-ficticio-c', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 'EDP', 100, 'masculino', 270, 220, 120, true,  true,  5, 0, 'none', true, 39.9);
INSERT INTO public.fragrance_accords (product_id, accord_name, position) VALUES ('00000000-0000-4000-8000-0000000000a1', 'amadeirado', 1), ('00000000-0000-4000-8000-0000000000a3', 'floral', 1);

-- ============ VISITANTE e CLIENTE LOGADO: as mesmas consultas de loja, nos dois papéis ============
CREATE TEMP TABLE _roles(r text, uid text);
INSERT INTO _roles VALUES ('anon', ''), ('authenticated', '00000000-0000-4000-8000-000000000002');
GRANT SELECT ON _roles TO anon, authenticated;

DO $t$
DECLARE
  rr record; n int; ids uuid[]; a uuid := '00000000-0000-4000-8000-0000000000a1'; cc uuid := '00000000-0000-4000-8000-0000000000a3';
  q record; ok int := 0;
BEGIN
  FOR rr IN SELECT * FROM _roles LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN rr.uid = '' THEN '' ELSE '{"sub":"' || rr.uid || '","role":"authenticated"}' END, true);
    PERFORM set_config('request.jwt.claim.sub', rr.uid, true);
    EXECUTE format('SET LOCAL ROLE %I', rr.r);

    -- routes/index.tsx:377 (facetas do catálogo)
    EXECUTE 'SELECT count(*) FROM (SELECT brand, product_type, gender_norm, in_stock, decant_available FROM public.products WHERE active = true AND catalog_eligible = true) s' INTO n;
    IF n <> 2 THEN RAISE EXCEPTION 'FAIL (%): facets query returned % rows, expected 2', rr.r, n; END IF; ok := ok + 1;

    -- routes/index.tsx:394 (acordes, embed products!inner com filtro nas colunas do embed)
    EXECUTE 'SELECT count(*) FROM (SELECT fa.accord_name FROM public.fragrance_accords fa JOIN public.products p ON p.id = fa.product_id WHERE fa.position <= 2 AND p.active = true AND p.catalog_eligible = true) s' INTO n;
    IF n <> 2 THEN RAISE EXCEPTION 'FAIL (%): accords embed returned % rows, expected 2', rr.r, n; END IF; ok := ok + 1;

    -- routes/perfume.$slug.tsx:109 (página do perfume; PUBLIC_PRODUCT_COLUMNS)
    EXECUTE 'SELECT count(*) FROM (SELECT id, slug, canonical_name, brand, concentration, volume_ml, image_url, in_stock, stock_quantity, retail_price, wholesale_price, gender_norm, product_type, sale_mode, full_bottle_available, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, active, catalog_eligible FROM public.products WHERE slug = ''perfume-ficticio-a'' AND active = true) s' INTO n;
    IF n <> 1 THEN RAISE EXCEPTION 'FAIL (%): product page query returned % rows, expected 1', rr.r, n; END IF; ok := ok + 1;

    -- routes/favoritos.tsx:58 (COLUMNS + .in(id) + active + catalog_eligible)
    EXECUTE 'SELECT count(*) FROM (SELECT id, slug, canonical_name, brand, concentration, volume_ml, image_url, in_stock, stock_quantity, retail_price, wholesale_price, gender_norm, product_type, sale_mode, full_bottle_available, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml FROM public.products WHERE id IN (''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000a3'') AND active = true AND catalog_eligible = true) s' INTO n;
    IF n <> 2 THEN RAISE EXCEPTION 'FAIL (%): favorites query returned % rows, expected 2', rr.r, n; END IF; ok := ok + 1;

    -- components/orium/SimilarPerfumes.tsx:50
    EXECUTE 'SELECT count(*) FROM (SELECT id, slug, canonical_name, brand, concentration, volume_ml, image_url, in_stock, stock_quantity, retail_price, wholesale_price, product_type, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml FROM public.products WHERE active = true AND catalog_eligible = true AND in_stock = true AND id <> ''00000000-0000-4000-8000-0000000000a1'' AND brand = ''Marca Ficticia'' LIMIT 8) s' INTO n;
    ok := ok + 1;

    -- components/orium/LeadCaptureSheet.tsx:96 e SaveChoicesPrompt.tsx:58 (capas dos favoritos)
    EXECUTE 'SELECT count(*) FROM (SELECT id, image_url FROM public.products WHERE id IN (''00000000-0000-4000-8000-0000000000a1'')) s' INTO n; ok := ok + 1;
    -- components/orium/FragranceStatus.tsx:12
    EXECUTE 'SELECT count(*) FROM (SELECT id FROM public.products WHERE product_type = ''PERFUME'' AND active = true) s' INTO n; ok := ok + 1;
    -- components/orium/admin/orders/... e admin.pedidos.tsx:215 (capa e marca do item): colunas públicas
    EXECUTE 'SELECT count(*) FROM (SELECT id, image_url, brand FROM public.products WHERE id IN (''00000000-0000-4000-8000-0000000000a1'')) s' INTO n; ok := ok + 1;

    -- Pronta entrega: catálogo e carrinho (lib/ready-to-deliver.ts → badges.tsx e CartSheet.tsx)
    ids := public.public_ready_to_deliver_ids();
    IF ids IS DISTINCT FROM ARRAY[a] THEN RAISE EXCEPTION 'FAIL (%): ready ids expected {A}, got %', rr.r, ids; END IF;
    IF NOT (a = ANY (ids)) OR (cc = ANY (ids)) THEN RAISE EXCEPTION 'FAIL (%): badge state wrong', rr.r; END IF;       -- selo: A "Pronta entrega", C "Sob encomenda"
    IF EXISTS (SELECT 1 FROM unnest(ARRAY[a]) i WHERE NOT (i = ANY (ids))) THEN RAISE EXCEPTION 'FAIL (%): cart [A] flagged as special order', rr.r; END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(ARRAY[a, cc]) i WHERE NOT (i = ANY (ids))) THEN RAISE EXCEPTION 'FAIL (%): cart [A,C] should be special order', rr.r; END IF;
    ok := ok + 1;

    -- Busca do catálogo e vitrines (RPCs públicas; search-context.tsx, new-arrivals.ts, product-views.ts)
    EXECUTE 'SELECT count(*) FROM public.search_catalog(p_q => ''ficticio'')' INTO n;
    IF n < 2 THEN RAISE EXCEPTION 'FAIL (%): search_catalog returned % rows', rr.r, n; END IF;
    EXECUTE 'SELECT count(*) FROM public.search_catalog(p_q => '''', p_availability => ''ready'')' INTO n;
    PERFORM count(*) FROM public.top_sold_products(30, 12);
    PERFORM count(*) FROM public.top_viewed_products(30, 12);
    PERFORM count(*) FROM public.new_arrivals(12);
    ok := ok + 1;
    RESET ROLE;

    -- Negativas do mesmo perfil: nenhuma coluna interna, nem para filtrar
    FOR q IN SELECT unnest(ARRAY['SELECT manual_cost FROM public.products', 'SELECT local_stock FROM public.products', 'SELECT base_retail_price FROM public.products',
                                 'SELECT identity_key FROM public.products', 'SELECT id FROM public.products WHERE ready_to_deliver = true',
                                 'SELECT * FROM public.products', 'UPDATE public.products SET retail_price = 1', 'DELETE FROM public.products']) AS sql LOOP
      EXECUTE format('SET LOCAL ROLE %I', rr.r);
      BEGIN EXECUTE q.sql; RESET ROLE; RAISE EXCEPTION 'FAIL (%): "%" was allowed', rr.r, q.sql;
      EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; END;
    END LOOP;
    RAISE NOTICE 'PASS (%): % storefront/cart/catalog checks and 8 denials', rr.r, ok;
    ok := 0;
  END LOOP;
END $t$;

-- ============ CLIENTE: login, perfil e carrinho próprio ============
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE r public.app_role; n int;
BEGIN
  r := public.ensure_profile();                                   -- auth.tsx:48 (cada login)
  IF r IS DISTINCT FROM 'client' THEN RAISE EXCEPTION 'FAIL client: ensure_profile returned %', r; END IF;
  UPDATE public.profiles SET cart = '[{"productId":"00000000-0000-4000-8000-0000000000a1","qty":1}]'::jsonb WHERE id = auth.uid();   -- lib/cart.tsx:196
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL client: cannot save own cart'; END IF;
  SELECT count(*) INTO n FROM public.profiles WHERE id = auth.uid();   -- lib/cart.tsx:183
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL client: cannot read own profile'; END IF;
  RAISE NOTICE 'PASS (client): login (ensure_profile = client), own cart saved and read back';
END $t$;
RESET ROLE;

-- ============ EQUIPE: portão + caminho do servidor (Admin) ============
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE r public.app_role; n int; a uuid := '00000000-0000-4000-8000-0000000000a1'; cc uuid := '00000000-0000-4000-8000-0000000000a3'; ids uuid[]; sid uuid; res jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'FAIL staff: gate is_staff false'; END IF;                    -- todo requireStaff()
  -- Admin que continua no navegador com colunas públicas (admin.fornecedores.tsx:462, admin.reposicao.tsx:106, PricingCampaigns, admin.pedidos.tsx)
  PERFORM id, canonical_name, brand, volume_ml, image_url FROM public.products WHERE canonical_name ILIKE '%ficticio%' LIMIT 12;
  PERFORM id, canonical_name, brand, volume_ml, concentration, image_url, in_stock, stock_quantity FROM public.products WHERE active = true;
  PERFORM id, canonical_name, image_url FROM public.products WHERE id IN (a);
  PERFORM p.canonical_name FROM public.catalog_order_items i JOIN public.products p ON p.id = i.product_id LIMIT 1;       -- embed products(canonical_name) de dashboard.functions.ts:129 e live.functions.ts
  PERFORM product_id, status FROM public.fragrance_pyramid_status;                                                     -- lista de manutenção (view)
  PERFORM best_cost FROM public.product_costs;                                                                         -- custos ficam em product_costs (RLS equipe)
  SELECT count(*) INTO n FROM public.suppliers; RAISE NOTICE 'INFO staff: suppliers visible=%', n;
  -- RPCs administrativas do estoque e da disponibilidade (ProductOps, OriumStockPanel, Copilot)
  res := public.inventory_adjust(a, 'add', 2, 'fluxo ficticio', 'painel', NULL);
  res := public.set_availability_override(cc, 'available', 'fluxo ficticio', NULL);
  -- venda pela equipe (store-sales.functions.ts)
  res := public.store_sale_commit(jsonb_build_object('entry_method','manual','payment_method','pix','customer_name','Cliente Ficticio','idempotency_key','flow-sale-1',
         'items', jsonb_build_array(jsonb_build_object('product_id', a, 'variant','FULL','quantity',1,'unit_price',250))));
  sid := (res->>'id')::uuid;
  IF sid IS NULL THEN RAISE EXCEPTION 'FAIL staff: sale not created'; END IF;
  -- no navegador a equipe NÃO lê coluna interna nem escreve em products (desenho)
  BEGIN PERFORM manual_cost FROM public.products; RAISE EXCEPTION 'FAIL staff: browser role read manual_cost'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.products SET decant_price_5ml = 1 WHERE id = a; RAISE EXCEPTION 'FAIL staff: browser role wrote products'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS (staff, browser role): gate ok; public-column Admin reads ok; stock, availability and sale RPCs ok; internal reads/writes denied as designed';
END $t$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $t$
DECLARE n int; a uuid := '00000000-0000-4000-8000-0000000000a1'; cc uuid := '00000000-0000-4000-8000-0000000000a3'; ids uuid[]; rc int; mc numeric; stock int;
BEGIN
  -- adminMaintenanceProducts (product-internal.functions.ts)
  SELECT count(*) INTO n FROM (SELECT id, canonical_name, raw_name, brand, brand_id, source, sale_mode, gender_norm, product_type, concentration, volume_ml, flanker, image_url, in_stock, stock_quantity, local_stock, availability_override, availability_source, manual_pricing, retail_price, wholesale_price, active, catalog_eligible, identity_status, identity_verified, canonical_identity_locked, brand_review_required, suspicious_price, search_aliases, created_at FROM public.products ORDER BY canonical_name) s;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL server: maintenance list returned %', n; END IF;
  -- adminComposerProducts
  SELECT count(*) INTO n FROM (SELECT id, canonical_name, brand, volume_ml, image_url, retail_price, wholesale_price, decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml, local_stock, gender_norm FROM public.products WHERE active = true AND catalog_eligible = true ORDER BY canonical_name LIMIT 3000) s;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL server: composer list returned %', n; END IF;
  -- getAdminProductRow (select *) e stockSearch
  SELECT manual_cost INTO mc FROM public.products WHERE id = a;
  IF mc IS DISTINCT FROM 100 THEN RAISE EXCEPTION 'FAIL server: manual_cost not readable on the server path'; END IF;
  PERFORM id, canonical_name, raw_name, brand, image_url, volume_ml, local_stock FROM public.products WHERE canonical_name ILIKE '%ficticio%' ORDER BY local_stock DESC LIMIT 20;
  -- adminSetProductDecants
  UPDATE public.products SET decant_available = true, decant_price_2ml = 19.9, decant_price_5ml = 44.9, decant_price_10ml = 69.9 WHERE id = a;
  GET DIAGNOSTICS rc = ROW_COUNT; IF rc <> 1 THEN RAISE EXCEPTION 'FAIL server: decants update'; END IF;
  -- efeito da ação da equipe na pronta entrega pública
  ids := public.public_ready_to_deliver_ids();
  IF array_length(ids, 1) <> 2 OR NOT (cc = ANY (ids)) THEN RAISE EXCEPTION 'FAIL server: ready ids should be {A,C} after staff action, got %', ids; END IF;
  SELECT local_stock INTO stock FROM public.products WHERE id = a;
  IF stock <> 4 THEN RAISE EXCEPTION 'FAIL server: local_stock expected 4, got %', stock; END IF;
  RAISE NOTICE 'PASS (staff, server path): maintenance, composer, full row, stock search, decants edit; ready ids now {A, C}; local_stock 4';
END $t$;
RESET ROLE;

-- O visitante vê a mudança feita pela equipe
SET LOCAL ROLE anon;
DO $t$
DECLARE ids uuid[]; a uuid := '00000000-0000-4000-8000-0000000000a1'; cc uuid := '00000000-0000-4000-8000-0000000000a3';
BEGIN
  ids := public.public_ready_to_deliver_ids();
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[a, cc]) i WHERE NOT (i = ANY (ids))) THEN RAISE EXCEPTION 'FAIL visitor: cart [A,C] still special after staff action'; END IF;
  RAISE NOTICE 'PASS (visitor after staff action): cart [A, C] is ready';
END $t$;
RESET ROLE;

ROLLBACK;
