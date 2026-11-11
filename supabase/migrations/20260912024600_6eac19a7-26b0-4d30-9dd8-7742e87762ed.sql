CREATE OR REPLACE FUNCTION public.crm_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN jsonb_build_object(
    'customers', (SELECT count(*)::int FROM public.crm_customers),
    'abandoned_carts', (SELECT count(*)::int FROM public.shopping_carts c
       WHERE c.status = 'ABANDONED' AND c.items_count > 0
         AND (
           EXISTS (SELECT 1 FROM public.crm_customers k WHERE k.user_id IS NOT NULL AND k.user_id = c.user_id)
           OR EXISTS (SELECT 1 FROM public.crm_customer_devices d WHERE c.anonymous_id IS NOT NULL AND d.device_id = c.anonymous_id)
         )),
    'active_carts', (SELECT count(*)::int FROM public.shopping_carts c
       WHERE c.status = 'ACTIVE' AND c.items_count > 0
         AND (
           EXISTS (SELECT 1 FROM public.crm_customers k WHERE k.user_id IS NOT NULL AND k.user_id = c.user_id)
           OR EXISTS (SELECT 1 FROM public.crm_customer_devices d WHERE c.anonymous_id IS NOT NULL AND d.device_id = c.anonymous_id)
         )),
    'waiting_subscriptions', (SELECT count(*)::int FROM public.back_in_stock_subscriptions WHERE active AND canceled_at IS NULL),
    'favorites', (SELECT count(*)::int FROM public.favorites f
       WHERE EXISTS (SELECT 1 FROM public.crm_customers k WHERE k.user_id IS NOT NULL AND k.user_id = f.user_id)
          OR EXISTS (SELECT 1 FROM public.crm_customer_devices d WHERE f.anonymous_id IS NOT NULL AND d.device_id = f.anonymous_id)),
    'pending_notifications', (SELECT count(*)::int FROM public.back_in_stock_notifications WHERE status = 'PENDING'),
    'waiting_products', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('product_id', p.id, 'name', p.canonical_name, 'brand', p.brand,
                                  'slug', p.slug, 'in_stock', p.in_stock, 'people', count(*)::int) AS x
          FROM public.back_in_stock_subscriptions s JOIN public.products p ON p.id = s.product_id
         WHERE s.active AND s.canceled_at IS NULL
         GROUP BY p.id, p.canonical_name, p.brand, p.slug, p.in_stock
         ORDER BY count(*) DESC LIMIT 12) t), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_overview() TO authenticated, service_role;