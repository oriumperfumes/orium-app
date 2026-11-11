CREATE OR REPLACE FUNCTION public.analytics_funnel(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
  v_visitors integer;
  v_identified integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT count(DISTINCT s.visitor_id)::int INTO v_visitors
  FROM public.analytics_sessions AS s
  WHERE s.started_at >= p_from AND s.started_at < p_to;

  SELECT count(DISTINCT s.visitor_id)::int INTO v_identified
  FROM public.analytics_sessions AS s
  WHERE s.started_at >= p_from AND s.started_at < p_to
    AND s.customer_id IS NOT NULL;

  WITH
  period_sessions AS MATERIALIZED (
    SELECT s.visitor_id, s.customer_id,
      coalesce(nullif(s.source, ''), 'direto') AS source_key,
      s.utm_campaign AS campaign_key,
      coalesce(nullif(s.device, ''), 'desconhecido') AS device_key
    FROM public.analytics_sessions AS s
    WHERE s.started_at >= p_from AND s.started_at < p_to
  ),
  period_events AS MATERIALIZED (
    SELECT e.event, e.visitor_id, e.product_id, e.variant, e.decant_ml,
      coalesce(nullif(e.device, ''), 'desconhecido') AS device_key,
      coalesce(nullif(e.meta->>'trigger', ''), 'outro') AS trigger_key
    FROM public.analytics_events AS e
    WHERE e.created_at >= p_from AND e.created_at < p_to
  ),
  period_orders AS MATERIALIZED (
    SELECT o.id AS order_id, o.customer_user_id, o.customer_phone_normalized, o.is_confirmed
    FROM public.catalog_orders AS o
    WHERE o.deleted_at IS NULL AND o.created_at >= p_from AND o.created_at < p_to
  ),
  funnel_steps AS (
    SELECT * FROM (VALUES
      (1, 'visited', 'Visitantes', v_visitors),
      (2, 'product_view', 'Abriram perfume', (SELECT count(DISTINCT pe.visitor_id)::int FROM period_events AS pe WHERE pe.event = 'product_view')),
      (3, 'favorite_added', 'Favoritaram', (SELECT count(DISTINCT pe.visitor_id)::int FROM period_events AS pe WHERE pe.event = 'favorite_added')),
      (4, 'cart_item_added', 'Adicionaram ao carrinho', (SELECT count(DISTINCT pe.visitor_id)::int FROM period_events AS pe WHERE pe.event = 'cart_item_added')),
      (5, 'cart_opened', 'Abriram o carrinho', (SELECT count(DISTINCT pe.visitor_id)::int FROM period_events AS pe WHERE pe.event = 'cart_opened')),
      (6, 'checkout_started', 'Iniciaram finalização', (SELECT count(DISTINCT pe.visitor_id)::int FROM period_events AS pe WHERE pe.event = 'checkout_started')),
      (7, 'whatsapp_checkout_clicked', 'Foram ao WhatsApp', (SELECT count(DISTINCT pe.visitor_id)::int FROM period_events AS pe WHERE pe.event = 'whatsapp_checkout_clicked')),
      (8, 'order_created', 'Pedidos criados', (SELECT count(*)::int FROM period_orders)),
      (9, 'order_confirmed', 'Pedidos confirmados', (SELECT count(*)::int FROM period_orders AS po WHERE po.is_confirmed))
    ) AS x(pos, key, label, people)
  ),
  source_rows AS (
    SELECT ps.source_key, ps.campaign_key,
      count(DISTINCT ps.visitor_id)::int AS visitor_count,
      count(DISTINCT ps.visitor_id) FILTER (WHERE ps.customer_id IS NOT NULL)::int AS lead_count
    FROM period_sessions AS ps
    GROUP BY ps.source_key, ps.campaign_key
  ),
  order_source_rows AS (
    SELECT av.first_source AS raw_source, po.order_id
    FROM period_orders AS po
    JOIN public.crm_customers AS cc
      ON (po.customer_user_id IS NOT NULL AND cc.user_id = po.customer_user_id)
      OR (po.customer_phone_normalized IS NOT NULL AND cc.phone_normalized = po.customer_phone_normalized)
    JOIN public.analytics_visitors AS av ON av.customer_id = cc.id
  ),
  order_sources AS (
    SELECT coalesce(nullif(osr.raw_source, ''), 'direto') AS source_key,
      count(DISTINCT osr.order_id)::int AS order_count
    FROM order_source_rows AS osr
    GROUP BY coalesce(nullif(osr.raw_source, ''), 'direto')
  ),
  device_rows AS (
    SELECT ps.device_key, count(DISTINCT ps.visitor_id)::int AS visitor_count
    FROM period_sessions AS ps GROUP BY ps.device_key
  ),
  device_conversion_rows AS (
    SELECT pe.device_key,
      count(DISTINCT pe.visitor_id) FILTER (WHERE pe.event = 'cart_item_added')::int AS added_count,
      count(DISTINCT pe.visitor_id) FILTER (WHERE pe.event = 'whatsapp_checkout_clicked')::int AS whatsapp_count
    FROM period_events AS pe GROUP BY pe.device_key
  ),
  product_rows AS (
    SELECT pe.product_id, p.canonical_name AS product_name, p.brand AS product_brand, p.slug AS product_slug,
      count(*) FILTER (WHERE pe.event = 'product_view')::int AS view_count,
      count(DISTINCT pe.visitor_id) FILTER (WHERE pe.event = 'product_view')::int AS visitor_count,
      count(*) FILTER (WHERE pe.event = 'cart_item_added')::int AS added_count
    FROM period_events AS pe JOIN public.products AS p ON p.id = pe.product_id
    WHERE pe.product_id IS NOT NULL
    GROUP BY pe.product_id, p.canonical_name, p.brand, p.slug
  ),
  added_product_rows AS (
    SELECT pe.product_id, p.canonical_name AS product_name, p.brand AS product_brand,
      count(*)::int AS added_count
    FROM period_events AS pe JOIN public.products AS p ON p.id = pe.product_id
    WHERE pe.event = 'cart_item_added'
    GROUP BY pe.product_id, p.canonical_name, p.brand
  ),
  added_products_with_orders AS (
    SELECT apr.*,
      (SELECT count(*)::int
       FROM public.catalog_order_items AS coi
       JOIN public.catalog_orders AS co ON co.id = coi.order_id
       WHERE coi.product_id = apr.product_id AND co.deleted_at IS NULL
         AND co.created_at >= p_from AND co.created_at < p_to) AS ordered_count
    FROM added_product_rows AS apr
  ),
  abandoned_item_rows AS (
    SELECT coalesce(ci.product_name, p.canonical_name) AS product_name, ci.quantity
    FROM public.cart_items AS ci
    JOIN public.shopping_carts AS sc ON sc.id = ci.cart_id
    LEFT JOIN public.products AS p ON p.id = ci.product_id
    WHERE sc.status = 'ABANDONED' AND sc.last_activity_at >= p_from AND sc.last_activity_at < p_to
  ),
  abandoned_products AS (
    SELECT air.product_name, sum(air.quantity)::int AS quantity_count
    FROM abandoned_item_rows AS air GROUP BY air.product_name
  ),
  lead_trigger_rows AS (
    SELECT pe.trigger_key, count(DISTINCT pe.visitor_id)::int AS lead_count
    FROM period_events AS pe WHERE pe.event = 'lead_identified' GROUP BY pe.trigger_key
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'visitors', v_visitors, 'identified', v_identified,
    'anonymous', greatest(v_visitors - v_identified, 0),
    'sessions', (SELECT count(*) FROM period_sessions),
    'events', (SELECT count(*) FROM period_events),
    'steps', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', fs.key, 'label', fs.label, 'people', fs.people) ORDER BY fs.pos), '[]'::jsonb) FROM funnel_steps AS fs),
    'sources', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', sr.source_key, 'campaign', sr.campaign_key, 'visitors', sr.visitor_count, 'leads', sr.lead_count) ORDER BY sr.visitor_count DESC), '[]'::jsonb) FROM (SELECT * FROM source_rows ORDER BY visitor_count DESC LIMIT 12) AS sr),
    'order_sources', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', os.source_key, 'orders', os.order_count) ORDER BY os.order_count DESC), '[]'::jsonb) FROM (SELECT * FROM order_sources ORDER BY order_count DESC LIMIT 12) AS os),
    'devices', (SELECT coalesce(jsonb_agg(jsonb_build_object('device', dr.device_key, 'visitors', dr.visitor_count) ORDER BY dr.visitor_count DESC), '[]'::jsonb) FROM device_rows AS dr),
    'device_conversion', (SELECT coalesce(jsonb_agg(jsonb_build_object('device', dc.device_key, 'added', dc.added_count, 'whatsapp', dc.whatsapp_count) ORDER BY dc.added_count DESC), '[]'::jsonb) FROM device_conversion_rows AS dc),
    'variants', (SELECT jsonb_build_object(
      'decant_views', count(*) FILTER (WHERE pe.event = 'product_view' AND pe.variant = 'DECANT')::int,
      'bottle_views', count(*) FILTER (WHERE pe.event = 'product_view' AND pe.variant = 'FULL')::int,
      'decant_added', count(*) FILTER (WHERE pe.event = 'cart_item_added' AND pe.variant = 'DECANT')::int,
      'bottle_added', count(*) FILTER (WHERE pe.event = 'cart_item_added' AND pe.variant = 'FULL')::int,
      'decant_2ml', count(*) FILTER (WHERE pe.event = 'cart_item_added' AND pe.decant_ml = 2)::int,
      'decant_5ml', count(*) FILTER (WHERE pe.event = 'cart_item_added' AND pe.decant_ml = 5)::int,
      'decant_10ml', count(*) FILTER (WHERE pe.event = 'cart_item_added' AND pe.decant_ml = 10)::int
    ) FROM period_events AS pe),
    'products', (SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', pr.product_id, 'name', pr.product_name, 'brand', pr.product_brand, 'slug', pr.product_slug, 'views', pr.view_count, 'visitors', pr.visitor_count, 'added', pr.added_count) ORDER BY pr.view_count DESC), '[]'::jsonb) FROM (SELECT * FROM product_rows ORDER BY view_count DESC LIMIT 15) AS pr),
    'added_products', (SELECT coalesce(jsonb_agg(jsonb_build_object('product_id', ap.product_id, 'name', ap.product_name, 'brand', ap.product_brand, 'added', ap.added_count, 'ordered', ap.ordered_count) ORDER BY ap.added_count DESC), '[]'::jsonb) FROM (SELECT * FROM added_products_with_orders ORDER BY added_count DESC LIMIT 15) AS ap),
    'carts', (SELECT jsonb_build_object(
      'abandoned', count(*) FILTER (WHERE sc.status = 'ABANDONED')::int,
      'active', count(*) FILTER (WHERE sc.status = 'ACTIVE')::int,
      'abandoned_total', coalesce(sum(sc.estimated_total) FILTER (WHERE sc.status = 'ABANDONED'), 0),
      'abandoned_avg', coalesce(avg(sc.estimated_total) FILTER (WHERE sc.status = 'ABANDONED' AND sc.estimated_total > 0), 0),
      'recovered', count(*) FILTER (WHERE sc.recovered_at IS NOT NULL)::int
    ) FROM public.shopping_carts AS sc WHERE sc.last_activity_at >= p_from AND sc.last_activity_at < p_to),
    'abandoned_products', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', ap.product_name, 'quantity', ap.quantity_count) ORDER BY ap.quantity_count DESC), '[]'::jsonb) FROM (SELECT * FROM abandoned_products ORDER BY quantity_count DESC LIMIT 10) AS ap),
    'lead_triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object('trigger', ltr.trigger_key, 'leads', ltr.lead_count) ORDER BY ltr.lead_count DESC), '[]'::jsonb) FROM lead_trigger_rows AS ltr)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.analytics_funnel(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_funnel(timestamptz, timestamptz) TO authenticated, service_role;

DO $validation$
DECLARE
  v_owner uuid;
  v_result jsonb;
BEGIN
  SELECT ur.user_id INTO v_owner
  FROM public.user_roles AS ur
  WHERE ur.role = 'owner'
  LIMIT 1;

  IF v_owner IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    v_result := public.analytics_funnel(now() - interval '7 days', now() + interval '1 day');
    IF jsonb_typeof(v_result) <> 'object' THEN
      RAISE EXCEPTION 'Falha ao validar analytics_funnel';
    END IF;
  END IF;
END;
$validation$;