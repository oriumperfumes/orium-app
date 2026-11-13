-- Tabelas só do servidor: widget_keys, supplier_orders, supplier_order_items (e a sequência do número do pedido ao fornecedor).
--
-- Contexto: as migrações 20261111200000_supplier_orders.sql e 20261112110000_widget_keys.sql criam as tabelas com RLS e política só
-- de equipe, mas, pelos privilégios padrão do Supabase, `anon` e `authenticated` ficam com GRANT ALL de tabela. A RLS segura
-- (is_staff(auth.uid()) é falso para visitante e cliente), mas é a única barreira. Todo acesso do app a estas tabelas passa por
-- server functions que checam is_staff e usam o cliente de serviço (src/lib/orders-control.functions.ts, orders-restock.server.ts,
-- widget.functions.ts, widget.server.ts); nada no navegador as lê ou escreve. Então os papéis de cliente não precisam de privilégio
-- nenhum: a RLS continua como segunda barreira e service_role mantém acesso total.
--
-- Idempotente. Reversão: GRANT ALL ON TABLE ... TO anon, authenticated (não recomendado).

REVOKE ALL ON TABLE public.widget_keys FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.supplier_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.supplier_order_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.supplier_orders_seq_seq FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.widget_keys TO service_role;
GRANT ALL ON TABLE public.supplier_orders TO service_role;
GRANT ALL ON TABLE public.supplier_order_items TO service_role;
GRANT ALL ON SEQUENCE public.supplier_orders_seq_seq TO service_role;
