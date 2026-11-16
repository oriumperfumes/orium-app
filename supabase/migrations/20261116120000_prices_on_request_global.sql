-- Preço sob consulta para a loja inteira (Admin → Precificação).
-- Ligado: o catálogo público mostra "Sob consulta" no lugar de todos os preços
-- e o pedido pelo site é recusado no servidor. Desligado: tudo volta ao normal.
ALTER TABLE public.pricing_settings
  ADD COLUMN IF NOT EXISTS prices_on_request boolean NOT NULL DEFAULT false;

-- A vitrine lê a chave pela função pública (a tabela é só da equipe).
-- O tipo de retorno muda, então a função é recriada.
DROP FUNCTION IF EXISTS public.public_pricing_settings();

CREATE FUNCTION public.public_pricing_settings()
RETURNS TABLE(
  wholesale_min_quantity integer,
  pix_discount_percent numeric,
  pix_discount_active boolean,
  prices_on_request boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.wholesale_min_quantity, s.pix_discount_percent, s.pix_discount_active, s.prices_on_request
  FROM public.pricing_settings s
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.public_pricing_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_pricing_settings() TO anon, authenticated, service_role;
