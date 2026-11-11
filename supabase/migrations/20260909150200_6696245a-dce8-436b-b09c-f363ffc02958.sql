ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS first_seen_source text NOT NULL DEFAULT 'detected';

-- Baseline: o catálogo que já existia não pode virar "novidade de hoje".
UPDATE public.supplier_products sp
SET first_seen_at = COALESCE(sp.source_updated_at, p.created_at, sp.last_synced_at, now()),
    first_seen_source = 'baseline'
FROM public.products p
WHERE p.id = sp.product_id AND sp.first_seen_source = 'detected';

UPDATE public.supplier_products
SET first_seen_at = COALESCE(source_updated_at, last_synced_at, now()),
    first_seen_source = 'baseline'
WHERE product_id IS NULL AND first_seen_source = 'detected';

CREATE INDEX IF NOT EXISTS supplier_products_first_seen_idx
  ON public.supplier_products (first_seen_at DESC);

CREATE OR REPLACE FUNCTION public.new_arrivals(p_limit integer DEFAULT 12, p_new_days integer DEFAULT 30)
RETURNS TABLE(
  id uuid, slug text, canonical_name text, brand text, gender_norm text, product_type text,
  concentration text, volume_ml integer, image_url text, in_stock boolean,
  retail_price numeric, wholesale_price numeric, decant_available boolean,
  decant_price_2ml numeric, decant_price_5ml numeric, decant_price_10ml numeric,
  arrived_at timestamp with time zone, is_new boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH arrivals AS (
    SELECT sp.product_id,
           MIN(COALESCE(sp.source_updated_at, sp.first_seen_at)) AS arrived_at,
           bool_or(sp.first_seen_source = 'detected') AS detected
    FROM public.supplier_products sp
    WHERE sp.product_id IS NOT NULL AND sp.active
    GROUP BY sp.product_id
  )
  SELECT p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type,
         p.concentration, p.volume_ml, p.image_url, p.in_stock,
         p.retail_price, p.wholesale_price, p.decant_available,
         p.decant_price_2ml, p.decant_price_5ml, p.decant_price_10ml,
         a.arrived_at,
         (a.detected AND a.arrived_at > now() - make_interval(days => GREATEST(p_new_days, 1))) AS is_new
  FROM arrivals a
  JOIN public.products p ON p.id = a.product_id
  WHERE p.active AND p.catalog_eligible AND p.product_type = 'PERFUME' AND p.image_url IS NOT NULL
  ORDER BY p.in_stock DESC, a.arrived_at DESC NULLS LAST, p.created_at DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 12), 24), 1);
$$;

REVOKE ALL ON FUNCTION public.new_arrivals(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.new_arrivals(integer, integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.new_arrivals_audit(p_limit integer DEFAULT 40)
RETURNS TABLE(
  product_id uuid, product_name text, brand text, supplier_name text,
  first_seen_at timestamp with time zone, first_seen_source text,
  supplier_added_at timestamp with time zone, in_stock boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.canonical_name, p.brand, s.name,
         sp.first_seen_at, sp.first_seen_source, sp.source_updated_at, p.in_stock
  FROM public.supplier_products sp
  JOIN public.products p ON p.id = sp.product_id
  JOIN public.suppliers s ON s.id = sp.supplier_id
  WHERE public.is_staff(auth.uid())
  ORDER BY COALESCE(sp.source_updated_at, sp.first_seen_at) DESC
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 40), 200), 1);
$$;

REVOKE ALL ON FUNCTION public.new_arrivals_audit(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.new_arrivals_audit(integer) TO authenticated, service_role;