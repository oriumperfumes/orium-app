-- Abertura da Home em modo Black (Admin → Precificação).
-- Ligada (padrão) e com uma campanha "Black" em vigor: o vídeo do topo da Home
-- troca o "Encontre o seu próximo perfume" pela chamada da Black November.
ALTER TABLE public.pricing_settings
  ADD COLUMN IF NOT EXISTS black_hero boolean NOT NULL DEFAULT true;

-- A vitrine lê a chave pela função pública (a tabela é só da equipe).
DROP FUNCTION IF EXISTS public.public_pricing_settings();

CREATE FUNCTION public.public_pricing_settings()
RETURNS TABLE(
  wholesale_min_quantity integer,
  pix_discount_percent numeric,
  pix_discount_active boolean,
  prices_on_request boolean,
  black_hero boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.wholesale_min_quantity, s.pix_discount_percent, s.pix_discount_active, s.prices_on_request, s.black_hero
  FROM public.pricing_settings s
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.public_pricing_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_pricing_settings() TO anon, authenticated, service_role;
