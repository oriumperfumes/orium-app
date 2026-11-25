-- Teste da migração 20261125120000_negociacao_vendas.sql (tabela negotiation_sales), por perfil:
-- visitante (anon), cliente logado sem equipe e regra "pago nunca passa do preço".
-- Dados fictícios; tudo termina em ROLLBACK. Rodar depois do baseline + a migração:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/20261125_negotiation_sales.test.sql
-- Sucesso = só avisos PASS; qualquer FAIL aborta com erro.
--
-- Perfis (UUIDs inventados, sem vínculo com auth.users):
--   visitante : role anon, sem usuário
--   cliente   : 00000000-0000-4000-8000-000000000002 (role client)
--   equipe    : 00000000-0000-4000-8000-000000000001 (role admin)
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'client');
INSERT INTO public.negotiation_items (id, name) VALUES ('00000000-0000-4000-8000-0000000000e1', 'Perfume Ficticio');

DO $t$
DECLARE n int;
BEGIN
  -- equipe: grava e lê a venda (50 de 200 pagos)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.negotiation_sales (item_id, customer_name, sale_price, amount_paid, payment_method, payment_due_date)
    VALUES ('00000000-0000-4000-8000-0000000000e1', 'Cliente Ficticio', 200, 50, 'PIX', current_date + 7);
  SELECT count(*) INTO n FROM public.negotiation_sales;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL equipe nao leu a propria venda (%)', n; END IF;
  RAISE NOTICE 'PASS equipe grava e le';
  RESET ROLE;

  -- cliente sem equipe: RLS esconde a linha e bloqueia escrita
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.negotiation_sales;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL cliente enxergou venda (%)', n; END IF;
  RAISE NOTICE 'PASS cliente nao ve vendas';
  BEGIN
    UPDATE public.negotiation_sales SET amount_paid = 200;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL cliente alterou venda'; END IF;
    RAISE NOTICE 'PASS cliente nao altera vendas';
  END;
  BEGIN
    INSERT INTO public.negotiation_sales (item_id, sale_price) VALUES ('00000000-0000-4000-8000-0000000000e1', 1);
    RAISE EXCEPTION 'FAIL cliente inseriu venda';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation THEN RAISE NOTICE 'PASS cliente nao insere vendas';
  END;
  RESET ROLE;

  -- visitante: sem acesso nenhum
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM public.negotiation_sales;
    RAISE EXCEPTION 'FAIL anon leu vendas';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS anon bloqueado';
  END;
  RESET ROLE;

  -- regra: pago nunca passa do preço
  BEGIN
    UPDATE public.negotiation_sales SET amount_paid = 201;
    RAISE EXCEPTION 'FAIL pago maior que o preco';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS pago <= preco';
  END;
END $t$;

ROLLBACK;
