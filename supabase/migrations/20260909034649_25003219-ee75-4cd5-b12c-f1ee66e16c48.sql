CREATE OR REPLACE FUNCTION public.top_viewed_products(p_days integer DEFAULT 30, p_limit integer DEFAULT 12)
 RETURNS TABLE(id uuid, slug text, canonical_name text, brand text, gender_norm text, product_type text, concentration text, volume_ml integer, image_url text, in_stock boolean, retail_price numeric, wholesale_price numeric, decant_available boolean, decant_price_2ml numeric, decant_price_5ml numeric, decant_price_10ml numeric, views integer, sold integer)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH win AS (
    SELECT greatest(1, least(coalesce(p_days, 30), 3650)) AS days,
           greatest(1, least(coalesce(p_limit, 12), 24)) AS lim
  ),
  v AS (
    SELECT pv.product_id, count(*)::int AS views
      FROM public.product_views pv, win
     WHERE pv.viewed_at > now() - (win.days || ' days')::interval
     GROUP BY pv.product_id
  ),
  s AS (
    SELECT i.product_id, sum(i.quantity)::int AS sold
      FROM public.catalog_order_items i
      JOIN public.catalog_orders o ON o.id = i.order_id
     WHERE o.is_confirmed AND o.deleted_at IS NULL AND o.canceled_at IS NULL
     GROUP BY i.product_id
  )
  SELECT p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type,
         p.concentration, p.volume_ml, p.image_url, p.in_stock,
         p.retail_price, p.wholesale_price,
         (p.product_type = 'PERFUME' AND p.decant_available) AS decant_available,
         p.decant_price_2ml, p.decant_price_5ml, p.decant_price_10ml,
         coalesce(v.views, 0) AS views, coalesce(s.sold, 0) AS sold
    FROM public.products p
    LEFT JOIN v ON v.product_id = p.id
    LEFT JOIN s ON s.product_id = p.id
   WHERE p.active AND p.catalog_eligible AND p.retail_price IS NOT NULL
   ORDER BY coalesce(v.views, 0) DESC, coalesce(s.sold, 0) DESC, p.in_stock DESC, p.created_at DESC
   LIMIT (SELECT lim FROM win);
$function$;

GRANT EXECUTE ON FUNCTION public.top_viewed_products(integer, integer) TO anon, authenticated, service_role;