CREATE OR REPLACE FUNCTION public.crm_customer_detail(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; devs text[]; out jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO c FROM public.crm_customers WHERE id = p_customer_id;
  IF c IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(array_agg(d.device_id), '{}'::text[]) INTO devs
    FROM public.crm_customer_devices d WHERE d.customer_id = c.id;

  WITH ord AS (
    SELECT o.* FROM public.catalog_orders o
     WHERE o.deleted_at IS NULL AND o.canceled_at IS NULL
       AND ((c.user_id IS NOT NULL AND o.customer_user_id = c.user_id)
         OR (c.phone_normalized IS NOT NULL
             AND public.norm_phone(coalesce(o.customer_phone, o.customer_phone_normalized)) = c.phone_normalized))
  ),
  valid AS (SELECT * FROM ord WHERE is_confirmed),
  items AS (
    SELECT i.*, p.product_type, p.canonical_name, p.brand, p.volume_ml, p.slug, p.image_url
      FROM public.catalog_order_items i
      JOIN valid v ON v.id = i.order_id
      LEFT JOIN public.products p ON p.id = i.product_id
  )
  SELECT jsonb_build_object(
    'customer', jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email,
      'user_id', c.user_id, 'created_at', c.created_at, 'archived_at', c.archived_at,
      'devices', coalesce(array_length(devs, 1), 0),
      'provisional', (c.phone_normalized IS NULL AND c.email IS NULL AND c.user_id IS NULL
                      AND coalesce(array_length(devs, 1), 0) > 0)
    ),
    'metrics', jsonb_build_object(
        'orders_count', (SELECT count(*)::int FROM ord),
        'confirmed_count', (SELECT count(*)::int FROM valid),
        'total_spent', (SELECT coalesce(sum(coalesce(grand_total, sales_total)), 0) FROM valid),
        'avg_ticket', (SELECT CASE WHEN count(*) > 0
              THEN round(coalesce(sum(coalesce(grand_total, sales_total)), 0) / count(*), 2) ELSE 0 END FROM valid),
        'first_order_at', (SELECT min(created_at) FROM ord),
        'last_order_at', (SELECT max(created_at) FROM valid)
      ),
    'orders', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_number', o.order_number, 'status', o.status,
        'is_confirmed', o.is_confirmed, 'created_at', o.created_at,
        'total', coalesce(o.grand_total, o.sales_total), 'quantity', o.total_quantity,
        'fulfillment', o.fulfillment_type
      ) ORDER BY o.created_at DESC) FROM (SELECT * FROM ord ORDER BY created_at DESC LIMIT 30) o), '[]'::jsonb),
    'decants', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', coalesce(canonical_name, product_name_snapshot), 'brand', brand,
                                  'slug', slug, 'ml', decant_ml, 'quantity', sum(quantity)::int,
                                  'last_at', max(created_at)) AS x
          FROM items WHERE variant = 'DECANT'
         GROUP BY canonical_name, product_name_snapshot, brand, slug, decant_ml
         ORDER BY max(created_at) DESC LIMIT 60) t), '[]'::jsonb),
    'bottles', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', coalesce(canonical_name, product_name_snapshot), 'brand', brand,
                                  'slug', slug, 'volume_ml', volume_ml, 'quantity', sum(quantity)::int,
                                  'last_at', max(created_at)) AS x
          FROM items WHERE variant = 'FULL' AND coalesce(product_type, 'PERFUME') = 'PERFUME'
         GROUP BY canonical_name, product_name_snapshot, brand, slug, volume_ml
         ORDER BY max(created_at) DESC LIMIT 60) t), '[]'::jsonb),
    'others', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', coalesce(canonical_name, product_name_snapshot), 'brand', brand,
                                  'slug', slug, 'type', product_type, 'quantity', sum(quantity)::int,
                                  'last_at', max(created_at)) AS x
          FROM items WHERE variant = 'FULL' AND coalesce(product_type, 'PERFUME') <> 'PERFUME'
         GROUP BY canonical_name, product_name_snapshot, brand, slug, product_type
         ORDER BY max(created_at) DESC LIMIT 60) t), '[]'::jsonb),
    'favorites', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT DISTINCT ON (p.id) jsonb_build_object(
            'product_id', p.id, 'name', p.canonical_name, 'brand', p.brand, 'slug', p.slug,
            'image_url', p.image_url, 'in_stock', p.in_stock, 'want_decant', f.want_decant,
            'created_at', f.created_at) AS x, p.id AS pid, f.created_at AS cat
          FROM public.favorites f JOIN public.products p ON p.id = f.product_id
         WHERE (c.user_id IS NOT NULL AND f.user_id = c.user_id)
            OR (f.anonymous_id IS NOT NULL AND f.anonymous_id = ANY(devs))
         ORDER BY p.id, f.created_at DESC) t), '[]'::jsonb),
    'waiting', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'product_id', p.id, 'name', p.canonical_name, 'brand', p.brand, 'slug', p.slug,
        'in_stock', p.in_stock, 'channel', s.channel, 'created_at', s.created_at) ORDER BY s.created_at DESC)
      FROM public.back_in_stock_subscriptions s JOIN public.products p ON p.id = s.product_id
     WHERE s.active AND s.canceled_at IS NULL
       AND ((c.user_id IS NOT NULL AND s.user_id = c.user_id)
         OR (c.phone_normalized IS NOT NULL AND s.phone_normalized = c.phone_normalized)
         OR (c.email IS NOT NULL AND public.norm_email(s.email) = c.email)
         OR (s.anonymous_id IS NOT NULL AND s.anonymous_id = ANY(devs)))), '[]'::jsonb),
    'viewed', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', p.canonical_name, 'brand', p.brand, 'slug', p.slug,
                                  'views', count(*)::int, 'last_at', max(v.viewed_at)) AS x
          FROM public.product_views v JOIN public.products p ON p.id = v.product_id
         WHERE (c.user_id IS NOT NULL AND v.user_id = c.user_id)
            OR (v.anonymous_id IS NOT NULL AND v.anonymous_id = ANY(devs))
         GROUP BY p.id, p.canonical_name, p.brand, p.slug
         ORDER BY count(*) DESC LIMIT 10) t), '[]'::jsonb),
    'recent_views', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('product_id', p.id, 'name', p.canonical_name, 'brand', p.brand,
                                  'slug', slug, 'image_url', p.image_url, 'in_stock', p.in_stock,
                                  'views', count(*)::int, 'last_at', max(v.viewed_at)) AS x
          FROM public.product_views v JOIN public.products p ON p.id = v.product_id
         WHERE (c.user_id IS NOT NULL AND v.user_id = c.user_id)
            OR (v.anonymous_id IS NOT NULL AND v.anonymous_id = ANY(devs))
         GROUP BY p.id, p.canonical_name, p.brand, p.slug, p.image_url, p.in_stock
         ORDER BY max(v.viewed_at) DESC LIMIT 20) t), '[]'::jsonb),
    'negotiations', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', ni.id, 'item_id', ni.negotiation_item_id, 'item_name', ni.item_name,
        'created_at', ni.created_at) ORDER BY ni.created_at DESC)
      FROM public.negotiation_interests ni
     WHERE ni.customer_id = c.id
        OR (ni.visitor_id IS NOT NULL AND ni.visitor_id = ANY(devs))), '[]'::jsonb),
    'carts', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', ct.id, 'status', ct.status, 'items_count', ct.items_count,
        'estimated_total', ct.estimated_total, 'last_activity_at', ct.last_activity_at,
        'abandoned_at', ct.abandoned_at, 'converted_at', ct.converted_at,
        'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'name', ci.product_name, 'brand', ci.brand, 'variant', ci.variant,
            'decant_ml', ci.decant_ml, 'quantity', ci.quantity, 'unit_price', ci.unit_price,
            'slug', p2.slug) ORDER BY ci.created_at)
          FROM public.cart_items ci LEFT JOIN public.products p2 ON p2.id = ci.product_id
         WHERE ci.cart_id = ct.id), '[]'::jsonb)
      ) ORDER BY ct.last_activity_at DESC)
      FROM public.shopping_carts ct
     WHERE ((c.user_id IS NOT NULL AND ct.user_id = c.user_id)
         OR (c.phone_normalized IS NOT NULL AND ct.phone_normalized = c.phone_normalized)
         OR (ct.anonymous_id IS NOT NULL AND ct.anonymous_id = ANY(devs)))), '[]'::jsonb),
    'notes', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'note', n.note, 'created_at', n.created_at) ORDER BY n.created_at DESC)
      FROM public.crm_notes n WHERE n.customer_id = c.id), '[]'::jsonb)
  ) INTO out;

  RETURN out;
END;
$function$;