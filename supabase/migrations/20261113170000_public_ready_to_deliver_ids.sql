-- Pronta entrega pública por função estreita (parte 1 de 2 da correção de colunas internas de products).
--
-- Seguro de aplicar a qualquer momento: só ACRESCENTA a função public_ready_to_deliver_ids(). O app novo (src/lib/ready-to-deliver.ts)
-- chama essa função em vez de ler products.ready_to_deliver. Aplique ESTE arquivo primeiro, publique o app e só então aplique
-- 20261113170100_products_internal_columns.sql, que fecha as colunas internas (o app antigo deixaria de funcionar).
-- Não altera o baseline (generated/baseline.sql) nem migrações anteriores. Idempotente.

-- 1. Pronta entrega para visitantes e clientes: só ids de produtos que já aparecem no catálogo.
CREATE OR REPLACE FUNCTION public.public_ready_to_deliver_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(array_agg(s.id), '{}'::uuid[])
    FROM (
      SELECT p.id
        FROM public.products p
       WHERE p.ready_to_deliver IS TRUE
         AND p.active IS TRUE
         AND p.catalog_eligible IS TRUE
       LIMIT 2000
    ) s
$$;

COMMENT ON FUNCTION public.public_ready_to_deliver_ids() IS
  'Ids de produtos em pronta entrega que já podem aparecer no catálogo (active e catalog_eligible). Não expõe nenhuma outra coluna de products.';

REVOKE ALL ON FUNCTION public.public_ready_to_deliver_ids() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_ready_to_deliver_ids() TO anon, authenticated, service_role;
