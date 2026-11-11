CREATE OR REPLACE FUNCTION public.top_sold_products(p_days integer DEFAULT 30, p_limit integer DEFAULT 12)
RETURNS TABLE(
  id uuid, slug text, canonical_name text, brand text, gender_norm text, product_type text,
  concentration text, volume_ml integer, image_url text, in_stock boolean,
  retail_price numeric, wholesale_price numeric, decant_available boolean,
  decant_price_2ml numeric, decant_price_5ml numeric, decant_price_10ml numeric,
  sold integer, period_days integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 12), 24));
  v_days integer := greatest(1, least(coalesce(p_days, 30), 3650));
  v_window integer;
  v_min_products constant integer := 4;
BEGIN
  -- Janela comercial: 30 dias -> 90 dias -> histórico completo.
  SELECT w INTO v_window FROM (
    SELECT x.w, (
      SELECT count(DISTINCT i.product_id)
        FROM public.catalog_order_items i
        JOIN public.catalog_orders o ON o.id = i.order_id
        JOIN public.products p ON p.id = i.product_id
       WHERE o.is_confirmed
         AND o.deleted_at IS NULL
         AND o.canceled_at IS NULL
         AND i.quantity > 0
         AND p.active AND p.catalog_eligible AND p.retail_price IS NOT NULL
         AND (x.w IS NULL OR o.created_at > now() - (x.w || ' days')::interval)
    ) AS n, x.ord
      FROM (VALUES (v_days, 1), (90, 2), (NULL::integer, 3)) AS x(w, ord)
  ) q
  WHERE q.n >= v_min_products
  ORDER BY q.ord
  LIMIT 1;

  IF NOT FOUND THEN
    v_window := NULL; -- histórico completo mesmo com poucos dados
  END IF;

  RETURN QUERY
  WITH s AS (
    SELECT i.product_id, sum(i.quantity)::int AS sold, max(o.created_at) AS last_sale
      FROM public.catalog_order_items i
      JOIN public.catalog_orders o ON o.id = i.order_id
     WHERE o.is_confirmed
       AND o.deleted_at IS NULL
       AND o.canceled_at IS NULL
       AND i.quantity > 0
       AND (v_window IS NULL OR o.created_at > now() - (v_window || ' days')::interval)
     GROUP BY i.product_id
  )
  SELECT p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type,
         p.concentration, p.volume_ml, p.image_url, p.in_stock,
         p.retail_price, p.wholesale_price,
         (p.product_type = 'PERFUME' AND p.decant_available) AS decant_available,
         p.decant_price_2ml, p.decant_price_5ml, p.decant_price_10ml,
         s.sold, coalesce(v_window, 0) AS period_days
    FROM s
    JOIN public.products p ON p.id = s.product_id
   WHERE p.active AND p.catalog_eligible AND p.retail_price IS NOT NULL
   ORDER BY s.sold DESC, s.last_sale DESC, p.in_stock DESC
   LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.top_sold_products(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.top_sold_products(integer, integer) TO anon, authenticated, service_role;