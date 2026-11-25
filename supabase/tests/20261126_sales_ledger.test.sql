-- Teste da migração 20261126120000_vendas_unificadas.sql (função sales_ledger).
-- Dados fictícios; tudo termina em ROLLBACK. Rodar depois do baseline + a migração:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/20261126_sales_ledger.test.sql
-- Sucesso = só avisos PASS; qualquer FAIL aborta com erro.
--
-- Perfis (UUIDs inventados, sem vínculo com auth.users):
--   cliente : 00000000-0000-4000-8000-000000000002 (role client)
--   equipe  : 00000000-0000-4000-8000-000000000001 (role admin)
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'client');

-- uma peça vendida com caderno (150 de 250) e uma vendida sem registro
INSERT INTO public.negotiation_items (id, name, status) VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'Peca Ficticia Registrada', 'SOLD'),
  ('00000000-0000-4000-8000-0000000000e2', 'Peca Ficticia Sem Registro', 'SOLD');
INSERT INTO public.negotiation_sales (item_id, customer_name, sale_price, amount_paid, payment_method)
  VALUES ('00000000-0000-4000-8000-0000000000e1', 'Cliente Ficticio', 250, 150, 'PIX');

DO $t$
DECLARE r jsonb; n int;
BEGIN
  -- visitante: sem permissão de executar
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.sales_ledger(now() - interval '1 day', now() + interval '1 minute');
    RAISE EXCEPTION 'FAIL anon executou sales_ledger';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS anon sem acesso';
  END;
  RESET ROLE;

  -- cliente logado: barrado pelo is_staff
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.sales_ledger(now() - interval '1 day', now() + interval '1 minute');
    RAISE EXCEPTION 'FAIL cliente leu sales_ledger';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
    RAISE NOTICE 'PASS cliente barrado';
  END;
  RESET ROLE;

  -- equipe: vê a venda da Negociação com saldo e a peça sem registro
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.sales_ledger(now() - interval '1 day', now() + interval '1 minute');
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'sales') e
    WHERE e->>'id' = '00000000-0000-4000-8000-0000000000e1' AND (e->>'due')::numeric = 100 AND e->>'channel' = 'negociacao';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL venda da Negociação não apareceu certa'; END IF;
  RAISE NOTICE 'PASS venda da Negociação com saldo';
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'unregistered') e WHERE e->>'id' = '00000000-0000-4000-8000-0000000000e2';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL peça sem registro não apareceu'; END IF;
  RAISE NOTICE 'PASS peça sem registro listada';

  -- período inválido é recusado
  BEGIN
    PERFORM public.sales_ledger(now(), now() - interval '1 day');
    RAISE EXCEPTION 'FAIL aceitou período invertido';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'periodo invalido' THEN RAISE; END IF;
    RAISE NOTICE 'PASS período inválido recusado';
  END;
  RESET ROLE;
END
$t$;

ROLLBACK;
