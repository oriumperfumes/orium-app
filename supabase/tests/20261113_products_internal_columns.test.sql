-- Teste da migração 20261113170000_public_ready_to_deliver_ids.sql + 20261113170100_products_internal_columns.sql, por perfil: visitante (anon), cliente logado (authenticated sem
-- equipe) e equipe (authenticated + user_roles admin). Dados fictícios; tudo termina em ROLLBACK. Rodar depois do baseline +
-- 40-acl-hardened.sql + a migração:  psql -v ON_ERROR_STOP=1 -f supabase/tests/20261113_products_internal_columns.test.sql
-- Sucesso = só avisos PASS; qualquer FAIL aborta com erro.
--
-- Perfis (UUIDs inventados, sem vínculo com auth.users):
--   visitante : role anon, sem usuário
--   cliente   : 00000000-0000-4000-8000-000000000002 (role client)
--   equipe    : 00000000-0000-4000-8000-000000000001 (role admin)
-- Produtos fictícios: A pronta entrega e no catálogo; B pronta entrega mas FORA do catálogo (catalog_eligible=false);
--                     C sem pronta entrega; D pronta entrega mas INATIVO.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'client');
INSERT INTO public.brands (id, canonical_name, slug, segment) VALUES ('00000000-0000-4000-8000-0000000000b1', 'Marca Ficticia', 'marca-ficticia', 'ARABIC');
INSERT INTO public.products (id, canonical_name, slug, brand, brand_id, product_type, volume_ml, retail_price, wholesale_price, manual_cost,
                             base_retail_price, active, catalog_eligible, stock_quantity, local_stock, availability_override) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Perfume Ficticio A', 'perfume-ficticio-a', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 100, 250.00, 200.00, 100.00, 180.00, true,  true,  5, 3, 'none'),
  ('00000000-0000-4000-8000-0000000000a2', 'Perfume Ficticio B', 'perfume-ficticio-b', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 100, 260.00, 210.00, 110.00, 190.00, true,  false, 5, 2, 'none'),
  ('00000000-0000-4000-8000-0000000000a3', 'Perfume Ficticio C', 'perfume-ficticio-c', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 100, 270.00, 220.00, 120.00, 200.00, true,  true,  5, 0, 'none'),
  ('00000000-0000-4000-8000-0000000000a4', 'Perfume Ficticio D', 'perfume-ficticio-d', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 100, 280.00, 230.00, 130.00, 210.00, false, true,  5, 2, 'none');
INSERT INTO public.suppliers (id, name, slug) VALUES ('00000000-0000-4000-8000-0000000000c1', 'Fornecedor Ficticio', 'fornecedor-ficticio');

-- Condição de partida: só o produto A está em pronta entrega E no catálogo.
DO $t$
DECLARE ids uuid[];
BEGIN
  SELECT array_agg(id ORDER BY id) INTO ids FROM public.products WHERE ready_to_deliver AND active AND catalog_eligible;
  IF ids IS DISTINCT FROM ARRAY['00000000-0000-4000-8000-0000000000a1']::uuid[] THEN RAISE EXCEPTION 'FAIL setup: fixture does not isolate product A (%)', ids; END IF;
END $t$;

-- ===================================================== 0. ESTRUTURA =====================================================
DO $t$
DECLARE
  internal text[] := ARRAY['suspicious_price','gender_confidence','brand_review_required','raw_name','dedupe_key','catalog_eligibility_reason','canonical_identity_locked','identity_source','identity_confidence','identity_status','identity_verified','identity_verified_by','identity_verified_at','identity_key','image_signature','catalog_excluded_manually','base_retail_price','base_wholesale_price','manual_pricing','manual_cost','visibility_status','decant_ml_consumed','public_visible','local_stock','availability_override','supplier_available','availability_source','local_decant_ml','ready_to_deliver','stock_tracked','image_mode','image_manual_url','image_source_supplier_id','image_source_offer_id','image_manual_broken','image_manual_set_at','image_manual_set_by'];
  c text; r record; bad text[] := '{}'; n_pub int := 0; n_int int := 0; fi int;
BEGIN
  FOR c IN SELECT a.attname FROM pg_attribute a WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0 AND NOT a.attisdropped LOOP
    IF c = ANY (internal) THEN
      n_int := n_int + 1;
      IF has_column_privilege('anon', 'public.products', c, 'SELECT') OR has_column_privilege('authenticated', 'public.products', c, 'SELECT') THEN bad := bad || ('readable:' || c); END IF;
    ELSE
      n_pub := n_pub + 1;
      IF NOT has_column_privilege('anon', 'public.products', c, 'SELECT') OR NOT has_column_privilege('authenticated', 'public.products', c, 'SELECT') THEN bad := bad || ('not-readable:' || c); END IF;
    END IF;
  END LOOP;
  IF n_pub <> 39 OR n_int <> 37 THEN RAISE EXCEPTION 'FAIL 0A: expected 39 public + 37 internal columns, found % + %', n_pub, n_int; END IF;
  IF array_length(bad, 1) IS NOT NULL THEN RAISE EXCEPTION 'FAIL 0A: column privileges wrong: %', bad; END IF;
  IF has_table_privilege('authenticated', 'public.products', 'SELECT') OR has_table_privilege('anon', 'public.products', 'SELECT') THEN RAISE EXCEPTION 'FAIL 0A: table-level SELECT exists'; END IF;
  IF has_any_column_privilege('authenticated', 'public.products', 'INSERT') OR has_any_column_privilege('authenticated', 'public.products', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.products', 'DELETE') OR has_table_privilege('authenticated', 'public.products', 'TRUNCATE') THEN
    RAISE EXCEPTION 'FAIL 0A: authenticated can still write products';
  END IF;
  RAISE NOTICE 'PASS 0A: anon and authenticated read exactly the 39 public columns, none of the 37 internal ones, and authenticated cannot write';

  -- 0B. Nenhuma função chamável por cliente devolve coluna interna (colunas OUT) nem linhas inteiras de products.
  FOR r IN SELECT p.oid, p.proname, p.proargnames, p.proargmodes, p.prorettype FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f' AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')) LOOP
    IF r.prorettype = 'public.products'::regtype THEN bad := bad || ('returns-products-row:' || r.proname); END IF;
    IF r.proargnames IS NOT NULL THEN
      FOR fi IN 1 .. array_length(r.proargnames, 1) LOOP
        IF r.proargnames[fi] = ANY (internal) AND (r.proargmodes IS NOT NULL AND r.proargmodes[fi] IN ('o','b','t')) THEN bad := bad || (r.proname || '.' || r.proargnames[fi]); END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF array_length(bad, 1) IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(bad) b WHERE b LIKE 'returns-%' OR b LIKE '%.%') THEN RAISE EXCEPTION 'FAIL 0B: client-callable functions expose internal columns: %', bad; END IF;

  -- 0C. Função (que não seja de gatilho) que lê coluna interna e é chamável por cliente precisa checar equipe (is_staff) no corpo; a única exceção é
  --     top_sold_products (só ordena por ready_to_deliver e devolve colunas públicas) e public_ready_to_deliver_ids (devolve só ids
--     de produtos que já aparecem no catálogo, por desenho).
  bad := '{}';
  FOR r IN SELECT p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')) LOOP
    IF EXISTS (SELECT 1 FROM unnest(internal) i WHERE r.prosrc ~ ('\m' || i || '\M')) AND r.prosrc !~ 'is_staff' AND r.proname NOT IN ('top_sold_products', 'public_ready_to_deliver_ids') THEN bad := bad || r.proname; END IF;
  END LOOP;
  IF array_length(bad, 1) IS NOT NULL THEN RAISE EXCEPTION 'FAIL 0C: SECURITY DEFINER functions reachable by clients read internal columns without a staff check: %', bad; END IF;
  RAISE NOTICE 'PASS 0B/0C: no client-callable function returns internal columns; definers that read them check is_staff';
END $t$;

-- ===================================================== 1. VISITANTE (anon) =====================================================
SET LOCAL ROLE anon;
DO $t$
DECLARE
  internal text[] := ARRAY['suspicious_price','gender_confidence','brand_review_required','raw_name','dedupe_key','catalog_eligibility_reason','canonical_identity_locked','identity_source','identity_confidence','identity_status','identity_verified','identity_verified_by','identity_verified_at','identity_key','image_signature','catalog_excluded_manually','base_retail_price','base_wholesale_price','manual_pricing','manual_cost','visibility_status','decant_ml_consumed','public_visible','local_stock','availability_override','supplier_available','availability_source','local_decant_ml','ready_to_deliver','stock_tracked','image_mode','image_manual_url','image_source_supplier_id','image_source_offer_id','image_manual_broken','image_manual_set_at','image_manual_set_by'];
  ids uuid[]; c text; bad text[] := '{}'; n int; special boolean;
  a uuid := '00000000-0000-4000-8000-0000000000a1'; b uuid := '00000000-0000-4000-8000-0000000000a2'; cc uuid := '00000000-0000-4000-8000-0000000000a3'; d uuid := '00000000-0000-4000-8000-0000000000a4';
BEGIN
  -- pronta entrega no catálogo e no carrinho
  ids := public.public_ready_to_deliver_ids();
  IF ids IS DISTINCT FROM ARRAY[a] THEN RAISE EXCEPTION 'FAIL 1A: visitor ready ids should be exactly {A}, got %', ids; END IF;
  special := EXISTS (SELECT 1 FROM unnest(ARRAY[a]) i WHERE NOT (i = ANY (ids)));
  IF special THEN RAISE EXCEPTION 'FAIL 1B: cart [A] must not be a special order'; END IF;
  special := EXISTS (SELECT 1 FROM unnest(ARRAY[a, cc]) i WHERE NOT (i = ANY (ids)));
  IF NOT special THEN RAISE EXCEPTION 'FAIL 1B: cart [A, C] must be flagged as special order'; END IF;
  IF b = ANY (ids) OR d = ANY (ids) THEN RAISE EXCEPTION 'FAIL 1A: ready-but-hidden products leaked (B not in catalog, D inactive)'; END IF;
  RAISE NOTICE 'PASS 1A/1B (visitor): ready ids = {A} only; cart [A] is ready, cart [A, C] is a special order; hidden products do not leak';

  -- colunas públicas continuam legíveis
  SELECT count(*) INTO n FROM (SELECT id, canonical_name, brand, retail_price, wholesale_price, image_url, slug, active, catalog_eligible, in_stock, stock_quantity,
                                      decant_available, decant_price_5ml FROM public.products WHERE active AND catalog_eligible) s;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 1C: visitor should read the 2 visible fictitious products (A and C) through public columns, got %', n; END IF;
  RAISE NOTICE 'PASS 1C (visitor): public columns readable';

  -- colunas internas negadas (select e filtro), select * negado, escrita negada
  FOREACH c IN ARRAY internal LOOP
    BEGIN EXECUTE format('SELECT %I FROM public.products LIMIT 1', c); bad := bad || ('select:' || c);
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN PERFORM id FROM public.products WHERE ready_to_deliver; bad := bad || 'filter:ready_to_deliver'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.products LIMIT 1; bad := bad || 'select-star'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.products (canonical_name, slug) VALUES ('x', 'x'); bad := bad || 'insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.products SET retail_price = 1; bad := bad || 'update'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.products; bad := bad || 'delete'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.store_sale_apply_stock(a, 1, 0); bad := bad || 'store_sale_apply_stock'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF array_length(bad, 1) IS NOT NULL THEN RAISE EXCEPTION 'FAIL 1D: visitor got through: %', bad; END IF;
  RAISE NOTICE 'PASS 1D (visitor): all 37 internal columns, select *, filters on internal columns, writes and store_sale_apply_stock are denied';

  -- catálogo (RPC pública) segue funcionando e não traz coluna interna
  SELECT count(*) INTO n FROM public.search_catalog(p_q => 'ficticio');
  IF n < 1 THEN RAISE EXCEPTION 'FAIL 1E: search_catalog returned nothing for the fictitious products'; END IF;
  RAISE NOTICE 'PASS 1E (visitor): search_catalog works (% rows)', n;
END $t$;
RESET ROLE;

-- ===================================================== 2. CLIENTE LOGADO =====================================================
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE
  internal text[] := ARRAY['suspicious_price','gender_confidence','brand_review_required','raw_name','dedupe_key','catalog_eligibility_reason','canonical_identity_locked','identity_source','identity_confidence','identity_status','identity_verified','identity_verified_by','identity_verified_at','identity_key','image_signature','catalog_excluded_manually','base_retail_price','base_wholesale_price','manual_pricing','manual_cost','visibility_status','decant_ml_consumed','public_visible','local_stock','availability_override','supplier_available','availability_source','local_decant_ml','ready_to_deliver','stock_tracked','image_mode','image_manual_url','image_source_supplier_id','image_source_offer_id','image_manual_broken','image_manual_set_at','image_manual_set_by'];
  ids uuid[]; c text; bad text[] := '{}'; n int; special boolean;
  a uuid := '00000000-0000-4000-8000-0000000000a1'; cc uuid := '00000000-0000-4000-8000-0000000000a3';
BEGIN
  IF public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'FAIL 2-setup: the client must not be staff'; END IF;
  ids := public.public_ready_to_deliver_ids();
  IF ids IS DISTINCT FROM ARRAY[a] THEN RAISE EXCEPTION 'FAIL 2A: client ready ids should be exactly {A}, got %', ids; END IF;
  special := EXISTS (SELECT 1 FROM unnest(ARRAY[a, cc]) i WHERE NOT (i = ANY (ids)));
  IF NOT special THEN RAISE EXCEPTION 'FAIL 2A: cart [A, C] must be flagged as special order for the client'; END IF;
  RAISE NOTICE 'PASS 2A (client): same ready ids as the visitor; cart behaviour preserved';

  SELECT count(*) INTO n FROM (SELECT id, canonical_name, brand, retail_price, wholesale_price, image_url, slug, catalog_eligible, in_stock FROM public.products WHERE active AND catalog_eligible) s;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 2B: client should read the 2 visible fictitious products through public columns, got %', n; END IF;
  PERFORM count(*) FROM public.fragrance_pyramid_status;  -- view used by the Admin list: must not error for authenticated
  RAISE NOTICE 'PASS 2B (client): public columns readable; fragrance_pyramid_status view still answers';

  FOREACH c IN ARRAY internal LOOP
    BEGIN EXECUTE format('SELECT %I FROM public.products LIMIT 1', c); bad := bad || ('select:' || c);
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN PERFORM id FROM public.products WHERE manual_cost > 0; bad := bad || 'filter:manual_cost'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.products LIMIT 1; bad := bad || 'select-star'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.products (canonical_name, slug) VALUES ('x', 'x'); bad := bad || 'insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.products SET retail_price = 1 WHERE id = a; bad := bad || 'update'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.products SET manual_cost = 1 WHERE id = a; bad := bad || 'update-internal'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.products WHERE id = a; bad := bad || 'delete'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF array_length(bad, 1) IS NOT NULL THEN RAISE EXCEPTION 'FAIL 2C: logged-in client got through: %', bad; END IF;
  RAISE NOTICE 'PASS 2C (client): all 37 internal columns (including manual_cost), select *, filters and every write are denied';

  -- ações de equipe continuam negadas ao cliente (guarda no corpo)
  BEGIN PERFORM public.inventory_adjust(a, 'add', 1, 'x', 'painel', NULL); bad := bad || 'inventory_adjust'; EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN PERFORM public.set_availability_override(cc, 'available', 'x', NULL); bad := bad || 'set_availability_override'; EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN PERFORM public.store_sale_commit('{"items":[{"product_id":"00000000-0000-4000-8000-0000000000a1","quantity":1,"unit_price":1}]}'::jsonb); bad := bad || 'store_sale_commit'; EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN PERFORM public.store_product_cost(a); bad := bad || 'store_product_cost'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.store_sale_apply_stock(a, 1, 0); bad := bad || 'store_sale_apply_stock'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF array_length(bad, 1) IS NOT NULL THEN RAISE EXCEPTION 'FAIL 2D: client reached staff actions: %', bad; END IF;
  RAISE NOTICE 'PASS 2D (client): staff RPCs refuse the client; store_product_cost and store_sale_apply_stock are not executable';
END $t$;
RESET ROLE;

-- ===================================================== 3. EQUIPE =====================================================
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1'; cc uuid := '00000000-0000-4000-8000-0000000000a3';
  r jsonb; sid uuid; ids uuid[];
BEGIN
  -- portão de autorização que as server functions usam antes de acessar o cliente de serviço
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'FAIL 3A: staff gate (is_staff) must be true for staff'; END IF;
  -- o navegador (papel authenticated) não lê coluna interna nem para a equipe: o Admin lê pelo servidor
  BEGIN PERFORM manual_cost FROM public.products LIMIT 1; RAISE EXCEPTION 'FAIL 3A: staff read manual_cost directly in the browser role';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS 3A (staff): is_staff gate true; direct browser-role reads of internal columns are denied even for staff (reads go through the server)';

  -- ações administrativas legítimas por RPC protegida (estoque e disponibilidade) e efeito na pronta entrega pública
  r := public.inventory_adjust(a, 'add', 2, 'teste ficticio', 'painel', NULL);
  r := public.set_availability_override(cc, 'available', 'teste ficticio', NULL);
  RAISE NOTICE 'PASS 3B (staff): inventory_adjust and set_availability_override accepted by the guard';

  -- venda pela equipe (compra interna; custo vem de store_product_cost como definer)
  r := public.store_sale_commit(jsonb_build_object('entry_method','manual','payment_method','pix','customer_name','Cliente Ficticio','idempotency_key','products-fix-sale-1',
         'items', jsonb_build_array(jsonb_build_object('product_id', a, 'variant','FULL','quantity',1,'unit_price',250))));
  sid := (r->>'id')::uuid;
  IF sid IS NULL OR (r->>'duplicate')::boolean THEN RAISE EXCEPTION 'FAIL 3C: sale not created: %', r; END IF;
  IF (SELECT unit_cost_snapshot FROM public.store_sale_items WHERE sale_id = sid) IS DISTINCT FROM 100.00 THEN RAISE EXCEPTION 'FAIL 3C: sale cost snapshot wrong'; END IF;
  IF r ?| ARRAY['manual_cost','local_stock','base_retail_price'] THEN RAISE EXCEPTION 'FAIL 3C: sale response leaks internal fields: %', r; END IF;
  RAISE NOTICE 'PASS 3C (staff): internal sale committed with cost snapshot 100.00; response has only id/duplicate';
END $t$;
RESET ROLE;

-- Caminho do servidor (server functions após o portão is_staff): cliente de serviço lê e edita as colunas internas.
SET LOCAL ROLE service_role;
DO $t$
DECLARE
  a uuid := '00000000-0000-4000-8000-0000000000a1'; cc uuid := '00000000-0000-4000-8000-0000000000a3';
  n int; stock int; mc numeric; dec_price numeric; ids uuid[]; rowcount int;
BEGIN
  -- adminMaintenanceProducts / adminComposerProducts: colunas internas legíveis
  SELECT count(*) INTO n FROM (SELECT id, raw_name, local_stock, availability_override, availability_source, manual_pricing, identity_status, identity_verified,
                                      canonical_identity_locked, brand_review_required, suspicious_price FROM public.products) s;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL 3D: service path should read all 4 fictitious products with internal columns, got %', n; END IF;
  -- getAdminProductRow: linha inteira, com manual_cost, dedupe_key e identity_key
  SELECT manual_cost INTO mc FROM public.products WHERE id = a;
  IF mc IS DISTINCT FROM 100.00 THEN RAISE EXCEPTION 'FAIL 3D: service path cannot read manual_cost'; END IF;
  PERFORM dedupe_key, identity_key FROM public.products WHERE id = a;
  -- efeitos do estoque e da venda feitos pela equipe
  SELECT local_stock INTO stock FROM public.products WHERE id = a;
  IF stock <> 4 THEN RAISE EXCEPTION 'FAIL 3D: expected local_stock 4 for A (3 + 2 added - 1 sold), got %', stock; END IF;
  -- adminSetProductDecants: edição pelo servidor
  UPDATE public.products SET decant_available = true, decant_price_2ml = 19.9, decant_price_5ml = 39.9, decant_price_10ml = 69.9 WHERE id = a;
  GET DIAGNOSTICS rowcount = ROW_COUNT;
  SELECT decant_price_5ml INTO dec_price FROM public.products WHERE id = a;
  IF rowcount <> 1 OR dec_price IS DISTINCT FROM 39.9 THEN RAISE EXCEPTION 'FAIL 3D: decant edit through the service path failed'; END IF;
  RAISE NOTICE 'PASS 3D (staff, server path): internal columns readable, stock and sale effects visible, decant edit works';

  -- pronta entrega reflete a ação da equipe: C passou a "available" e o visitante passa a ver C no catálogo
  ids := public.public_ready_to_deliver_ids();
  IF NOT (cc = ANY (ids)) OR NOT (a = ANY (ids)) THEN RAISE EXCEPTION 'FAIL 3E: ready ids should now contain A and C, got %', ids; END IF;
  IF array_length(ids, 1) <> 2 THEN RAISE EXCEPTION 'FAIL 3E: ready ids should be exactly A and C (B hidden, D inactive), got %', ids; END IF;
  RAISE NOTICE 'PASS 3E: after the staff action, public ready ids = {A, C}';
END $t$;
RESET ROLE;

-- O visitante enxerga a mudança feita pela equipe (pronta entrega atualizada no catálogo e no carrinho)
SET LOCAL ROLE anon;
DO $t$
DECLARE ids uuid[]; special boolean;
  a uuid := '00000000-0000-4000-8000-0000000000a1'; cc uuid := '00000000-0000-4000-8000-0000000000a3';
BEGIN
  ids := public.public_ready_to_deliver_ids();
  special := EXISTS (SELECT 1 FROM unnest(ARRAY[a, cc]) i WHERE NOT (i = ANY (ids)));
  IF special OR array_length(ids, 1) <> 2 THEN RAISE EXCEPTION 'FAIL 3F: visitor should now see A and C ready (cart [A, C] no longer special), got %', ids; END IF;
  RAISE NOTICE 'PASS 3F (visitor after staff action): cart [A, C] is ready; catalog shows both';
END $t$;
RESET ROLE;

ROLLBACK;
