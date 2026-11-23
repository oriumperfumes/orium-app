-- Nome da campanha Black editável no Admin (Precificação → Abertura da Home em modo Black).
-- Vazio = o site usa o nome da promoção. A campanha atual passa a se chamar "Black Orium".
ALTER TABLE public.pricing_settings
  ADD COLUMN IF NOT EXISTS black_title text;

UPDATE public.pricing_settings SET black_title = 'Black Orium' WHERE black_title IS NULL;

DROP FUNCTION IF EXISTS public.public_pricing_settings();

CREATE FUNCTION public.public_pricing_settings()
RETURNS TABLE(
  wholesale_min_quantity integer,
  pix_discount_percent numeric,
  pix_discount_active boolean,
  prices_on_request boolean,
  black_hero boolean,
  black_title text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.wholesale_min_quantity, s.pix_discount_percent, s.pix_discount_active, s.prices_on_request, s.black_hero,
         nullif(btrim(s.black_title), '')
  FROM public.pricing_settings s
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.public_pricing_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_pricing_settings() TO anon, authenticated, service_role;

-- "Esquenta Black" vira "Black Orium" (nome, aviso e título).
UPDATE public.promotions
   SET name = regexp_replace(name, 'esquenta black', 'Black Orium', 'i'),
       announce_title = regexp_replace(coalesce(announce_title, ''), 'esquenta black', 'Black Orium', 'i'),
       updated_at = now()
 WHERE name ~* 'esquenta black' OR announce_title ~* 'esquenta black';
