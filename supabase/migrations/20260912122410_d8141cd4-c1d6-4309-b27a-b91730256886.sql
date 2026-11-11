CREATE OR REPLACE FUNCTION public.analytics_funnel(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_visitors integer;
  v_identified integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT count(DISTINCT visitor_id)::int INTO v_visitors
  FROM public.analytics_sessions WHERE started_at >= p_from AND started_at < p_to;

  SELECT count(DISTINCT visitor_id)::int INTO v_identified
  FROM public.analytics_sessions
  WHERE started_at >= p_from AND started_at < p_to AND customer_id IS NOT NULL;

  WITH
  period_sessions AS MATERIALIZED (
    SELECT visitor_id, customer_id,
      coalesce(nullif(source, ''), 'direto') AS source_key,
      utm_campaign AS campaign_key,
      coalesce(nullif(device, ''), 'desconhecido') AS device_key
    FROM public.analytics_sessions
    WHERE started_at >= p_from AND started_at < p_to
  ),
  period_events AS MATERIALIZED (
    SELECT event, visitor_id, product_id, variant, decant_ml,
      coalesce(nullif(device, ''), 'desconhecido') AS device_key,
      coalesce(nullif(meta->>'trigger', ''), 'outro') AS trigger_key
    FROM public.analytics_events
    WHERE created_at >= p_from AND created_at < p_to
  ),
  period_orders AS MATERIALIZED (
    SELECT id, customer_id, is_confirmed
    FROM public.catalog_orders
    WHERE deleted_at IS NULL AND created_at >= p_from AND created_at < p_to
  ),
  funnel_steps AS (
    SELECT * FROM (VALUES
      (1, 'visited', 'Visitantes', v_visitors),
      (2, 'product_view', 'Abriram perfume', (SELECT count(DISTINCT visitor_id)::int FROM period_events WHERE event = 'product_view')),
      (3, 'favorite_added', 'Favoritaram', (SELECT count(DISTINCT visitor_id)::int FROM period_events WHERE event = 'favorite_added')),
      (4, 'cart_item_added', 'Adicionaram ao carrinho', (SELECT count(DISTINCT visitor_id)::int FROM period_events WHERE event = 'cart_item_added')),
      (5, 'cart_opened', 'Abriram o carrinho', (SELECT count(DISTINCT visitor_id)::int FROM period_events WHERE event = 'cart_opened')),
      (6, 'checkout_started', 'Iniciaram finalização', (SELECT count(DISTINCT visitor_id)::int FROM period_events WHERE event = 'checkout_started')),
      (7, 'whatsapp_checkout_clicked', 'Foram ao WhatsApp', (SELECT count(DISTINCT visitor_id)::int FROM period_events WHERE event = 'whatsapp_checkout_clicked')),
      (8, 'order_created', 'Pedidos criados', (SELECT count(*)::int FROM period_orders)),
      (9, 'order_confirmed', 'Pedidos confirmados', (SELECT count(*)::int FROM period_orders WHERE is_confirmed))
    ) AS x(pos, key, label, people)
  ),
  source_rows AS (
    SELECT source_key, campaign_key, count(DISTINCT visitor_id)::int AS visitor_count,
      count(DISTINCT visitor_id) FILTER (WHERE customer_id IS NOT NULL)::int AS lead_count
    FROM period_sessions GROUP BY source_key, campaign_key
  ),
  order_source_rows AS (
    SELECT v.first_source AS raw_source, o.id AS order_id
    FROM period_orders o
    JOIN public.crm_customers c ON c.id = o.customer_id
    JOIN public.analytics_visitors v ON v.customer_id = c.id
  ),
  order_sources AS (
    SELECT coalesce(nullif(raw_source, ''), 'direto') AS source_key,
      count(DISTINCT order_id)::int AS order_count
    FROM order_source_rows GROUP BY raw_source
  ),
  device_rows AS (
    SELECT device_key, count(DISTINCT visitor_id)::int AS visitor_count
    FROM period_sessions GROUP BY device_key
  ),
  device_conversion_rows AS (
    SELECT device_key,
      count(DISTINCT visitor_id) FILTER (WHERE event = 'cart_item_added')::int AS added_count,
      count(DISTINCT visitor_id) FILTER (WHERE event = 'whatsapp_checkout_clicked')::int AS whatsapp_count
    FROM period_events GROUP BY device_key
  ),
  product_rows AS (
    SELECT e.product_id, p.canonical_name AS product_name, p.brand AS product_brand, p.slug AS product_slug,
      count(*) FILTER (WHERE e.event = 'product_view')::int AS view_count,
      count(DISTINCT e.visitor_id) FILTER (WHERE e.event = 'product_view')::int AS visitor_count,
      count(*) FILTER (WHERE e.event = 'cart_item_added')::int AS added_count
    FROM period_events e JOIN public.products p ON p.id = e.product_id
    WHERE e.product_id IS NOT NULL
    GROUP BY e.product_id, p.canonical_name, p.brand, p.slug
  ),
  added_product_rows AS (
    SELECT e.product_id, p.canonical_name AS product_name, p.brand AS product_brand,
      count(*)::int AS added_count
    FROM period_events e JOIN public.products p ON p.id = e.product_id
    WHERE e.event = 'cart_item_added'
    GROUP BY e.product_id, p.canonical_name, p.brand
  ),
  added_products_with_orders AS (
    SELECT a.*, (SELECT count(*)::int FROM public.catalog_order_items i
      JOIN public.catalog_orders o ON o.id = i.order_id
      WHERE i.product_id = a.product_id AND o.deleted_at IS NULL
        AND o.created_at >= p_from AND o.created_at < p_to) AS ordered_count
    FROM added_product_rows a
  ),
  abandoned_item_rows AS (
    SELECT coalesce(ci.product_name, p.canonical_name) AS product_name, ci.quantity
    FROM public.cart_items ci
    JOIN public.shopping_carts sc ON sc.id = ci.cart_id
    LEFT JOIN public.products p ON p.id = ci.product_id
    WHERE sc.status = 'ABANDONED' AND sc.last_activity_at >= p_from AND sc.last_activity_at < p_to
  ),
  abandoned_products AS (
    SELECT product_name, sum(quantity)::int AS quantity_count
    FROM abandoned_item_rows GROUP BY product_name
  ),
  lead_trigger_rows AS (
    SELECT trigger_key, count(DISTINCT visitor_id)::int AS lead_count
    FROM period_events WHERE event = 'lead_identified' GROUP BY trigger_key
  )
  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'visitors', v_visitors,
    'identified', v_identified,
    'anonymous', greatest(v_visitors - v_identified, 0),
    'sessions', (SELECT count(*) FROM period_sessions),
    'events', (SELECT count(*) FROM period_events),
    'steps', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'people', people) ORDER BY pos), '[]'::jsonb) FROM funnel_steps),
    'sources', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', source_key, 'campaign', campaign_key, 'visitors', visitor_count, 'leads', lead_count) ORDER BY visitor_count DESC), '[]'::jsonb) FROM (SELECT * FROM source_rows ORDER BY visitor_count DESC LIMIT 12) s),
    'order_sources', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', source_key, 'orders', order_count) ORDER BY order_count DESC), '[]'::jsonb) FROM (SELECT * FROM order_sources ORDER BY order_count DESC LIMIT 12) s),
    'devices', (SELECT coalesce(jsonb_agg(jsonb_build_object('device', device_key, 'visitors', visitor_count) ORDER BY visitor_count DESC), '[]'::jsonb) FROM device_rows),
    'device_conversion', (SELECT coalesce(jsonb_agg(jsonb_build_object('device', device_key, 'added', added_count, 'whatsapp', whatsapp_count) ORDER BY added_count DESC), '[]'::jsonb) FROM device_conversion_rows),
    'variants', (SELECT jsonb_build_object(
      'decant_views', count(*) FILTER (WHERE event = 'product_view' AND variant = 'DECANT')::int,
      'bottle_views', count(*) FILTER (WHERE event = 'product_view' AND variant = 'FULL')::int,
      'decant_added', count(*) FILTER (WHERE event = 'cart_item_added' AND variant = 'DECANT')::int,
      'bottle_added', count(*) FILTER (WHERE event = 'cart_item_added' AND variant = 'FULL')::int,
      'decant_2ml', count(*) FILTER (WHERE event = 'cart_item_added' AND decant_ml = 2)::int,
      'decant_5ml', count(*) FILTER (WHERE event = 'cart_item_added' AND decant_ml = 5)::int,
      'decant_10ml', count(*) FILTER (WHERE event = 'cart_item_added' AND decant_ml = 10)::int
    ) FROM period_events),
    'products', (SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'name', product_name, 'brand', product_brand, 'slug', product_slug, 'views', view_count, 'visitors', visitor_count, 'added', added_count) ORDER BY view_count DESC), '[]'::jsonb) FROM (SELECT * FROM product_rows ORDER BY view_count DESC LIMIT 15) s),
    'added_products', (SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'name', product_name, 'brand', product_brand, 'added', added_count, 'ordered', ordered_count) ORDER BY added_count DESC), '[]'::jsonb) FROM (SELECT * FROM added_products_with_orders ORDER BY added_count DESC LIMIT 15) s),
    'carts', (SELECT jsonb_build_object(
      'abandoned', count(*) FILTER (WHERE status = 'ABANDONED')::int,
      'active', count(*) FILTER (WHERE status = 'ACTIVE')::int,
      'abandoned_total', coalesce(sum(estimated_total) FILTER (WHERE status = 'ABANDONED'), 0),
      'abandoned_avg', coalesce(avg(estimated_total) FILTER (WHERE status = 'ABANDONED' AND estimated_total > 0), 0),
      'recovered', count(*) FILTER (WHERE recovered_at IS NOT NULL)::int
    ) FROM public.shopping_carts WHERE last_activity_at >= p_from AND last_activity_at < p_to),
    'abandoned_products', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', product_name, 'quantity', quantity_count) ORDER BY quantity_count DESC), '[]'::jsonb) FROM (SELECT * FROM abandoned_products ORDER BY quantity_count DESC LIMIT 10) s),
    'lead_triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object('trigger', trigger_key, 'leads', lead_count) ORDER BY lead_count DESC), '[]'::jsonb) FROM lead_trigger_rows)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_funnel(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_funnel(timestamptz, timestamptz) TO authenticated, service_role;