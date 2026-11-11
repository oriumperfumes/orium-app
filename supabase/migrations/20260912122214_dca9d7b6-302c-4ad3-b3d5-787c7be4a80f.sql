CREATE OR REPLACE FUNCTION public.analytics_funnel(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_visitors integer;
  v_identified integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT count(DISTINCT visitor_id) INTO v_visitors
  FROM public.analytics_sessions WHERE started_at >= p_from AND started_at < p_to;

  SELECT count(DISTINCT visitor_id) INTO v_identified
  FROM public.analytics_sessions
  WHERE started_at >= p_from AND started_at < p_to AND customer_id IS NOT NULL;

  SELECT jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'visitors', v_visitors,
    'identified', v_identified,
    'anonymous', greatest(v_visitors - v_identified, 0),
    'sessions', (SELECT count(*) FROM public.analytics_sessions WHERE started_at >= p_from AND started_at < p_to),
    'events', (SELECT count(*) FROM public.analytics_events WHERE created_at >= p_from AND created_at < p_to),
    'steps', (
      WITH ev AS (
        SELECT event, visitor_id FROM public.analytics_events
        WHERE created_at >= p_from AND created_at < p_to
      ),
      ords AS (
        SELECT id, is_confirmed FROM public.catalog_orders
        WHERE deleted_at IS NULL AND created_at >= p_from AND created_at < p_to
      ),
      steps(pos, key, label, people) AS (
        VALUES
          (1, 'visited', 'Visitantes', v_visitors),
          (2, 'product_view', 'Abriram perfume', (SELECT count(DISTINCT visitor_id)::int FROM ev WHERE event = 'product_view')),
          (3, 'favorite_added', 'Favoritaram', (SELECT count(DISTINCT visitor_id)::int FROM ev WHERE event = 'favorite_added')),
          (4, 'cart_item_added', 'Adicionaram ao carrinho', (SELECT count(DISTINCT visitor_id)::int FROM ev WHERE event = 'cart_item_added')),
          (5, 'cart_opened', 'Abriram o carrinho', (SELECT count(DISTINCT visitor_id)::int FROM ev WHERE event = 'cart_opened')),
          (6, 'checkout_started', 'Iniciaram finalização', (SELECT count(DISTINCT visitor_id)::int FROM ev WHERE event = 'checkout_started')),
          (7, 'whatsapp_checkout_clicked', 'Foram ao WhatsApp', (SELECT count(DISTINCT visitor_id)::int FROM ev WHERE event = 'whatsapp_checkout_clicked')),
          (8, 'order_created', 'Pedidos criados', (SELECT count(*)::int FROM ords)),
          (9, 'order_confirmed', 'Pedidos confirmados', (SELECT count(*)::int FROM ords WHERE is_confirmed))
      )
      SELECT coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'people', people) ORDER BY pos), '[]'::jsonb)
      FROM steps
    ),
    'sources', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'source', src, 'campaign', campaign, 'visitors', visitors, 'leads', leads
      ) ORDER BY visitors DESC), '[]'::jsonb)
      FROM (
        SELECT coalesce(nullif(source, ''), 'direto') AS src,
               utm_campaign AS campaign,
               count(DISTINCT visitor_id)::int AS visitors,
               count(DISTINCT visitor_id) FILTER (WHERE customer_id IS NOT NULL)::int AS leads
        FROM public.analytics_sessions
        WHERE started_at >= p_from AND started_at < p_to
        GROUP BY coalesce(nullif(source, ''), 'direto'), utm_campaign
        ORDER BY count(DISTINCT visitor_id) DESC
        LIMIT 12
      ) s
    ),
    'order_sources', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('source', src, 'orders', orders) ORDER BY orders DESC), '[]'::jsonb)
      FROM (
        SELECT coalesce(nullif(v.first_source, ''), 'direto') AS src, count(DISTINCT o.id)::int AS orders
        FROM public.catalog_orders o
        JOIN public.crm_customers c ON c.id = o.customer_id
        JOIN public.analytics_visitors v ON v.customer_id = c.id
        WHERE o.deleted_at IS NULL AND o.created_at >= p_from AND o.created_at < p_to
        GROUP BY coalesce(nullif(v.first_source, ''), 'direto')
        ORDER BY count(DISTINCT o.id) DESC
        LIMIT 12
      ) s
    ),
    'devices', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('device', dev, 'visitors', visitors) ORDER BY visitors DESC), '[]'::jsonb)
      FROM (
        SELECT coalesce(nullif(device, ''), 'desconhecido') AS dev, count(DISTINCT visitor_id)::int AS visitors
        FROM public.analytics_sessions
        WHERE started_at >= p_from AND started_at < p_to
        GROUP BY coalesce(nullif(device, ''), 'desconhecido')
      ) s
    ),
    'device_conversion', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('device', dev, 'added', added, 'whatsapp', whats) ORDER BY added DESC), '[]'::jsonb)
      FROM (
        SELECT coalesce(nullif(device, ''), 'desconhecido') AS dev,
               count(DISTINCT visitor_id) FILTER (WHERE event = 'cart_item_added')::int AS added,
               count(DISTINCT visitor_id) FILTER (WHERE event = 'whatsapp_checkout_clicked')::int AS whats
        FROM public.analytics_events
        WHERE created_at >= p_from AND created_at < p_to
        GROUP BY coalesce(nullif(device, ''), 'desconhecido')
      ) s
    ),
    'variants', (
      SELECT jsonb_build_object(
        'decant_views', count(*) FILTER (WHERE event = 'product_view' AND variant = 'DECANT')::int,
        'bottle_views', count(*) FILTER (WHERE event = 'product_view' AND variant = 'FULL')::int,
        'decant_added', count(*) FILTER (WHERE event = 'cart_item_added' AND variant = 'DECANT')::int,
        'bottle_added', count(*) FILTER (WHERE event = 'cart_item_added' AND variant = 'FULL')::int,
        'decant_2ml', count(*) FILTER (WHERE event = 'cart_item_added' AND decant_ml = 2)::int,
        'decant_5ml', count(*) FILTER (WHERE event = 'cart_item_added' AND decant_ml = 5)::int,
        'decant_10ml', count(*) FILTER (WHERE event = 'cart_item_added' AND decant_ml = 10)::int
      )
      FROM public.analytics_events WHERE created_at >= p_from AND created_at < p_to
    ),
    'products', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'name', name, 'brand', brand, 'slug', slug,
        'views', views, 'visitors', visitors, 'added', added
      ) ORDER BY views DESC), '[]'::jsonb)
      FROM (
        SELECT e.product_id, p.canonical_name AS name, p.brand AS brand, p.slug AS slug,
               count(*) FILTER (WHERE e.event = 'product_view')::int AS views,
               count(DISTINCT e.visitor_id) FILTER (WHERE e.event = 'product_view')::int AS visitors,
               count(*) FILTER (WHERE e.event = 'cart_item_added')::int AS added
        FROM public.analytics_events e
        JOIN public.products p ON p.id = e.product_id
        WHERE e.created_at >= p_from AND e.created_at < p_to AND e.product_id IS NOT NULL
        GROUP BY e.product_id, p.canonical_name, p.brand, p.slug
        ORDER BY count(*) FILTER (WHERE e.event = 'product_view') DESC
        LIMIT 15
      ) s
    ),
    'added_products', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'name', name, 'brand', brand, 'added', added, 'ordered', ordered
      ) ORDER BY added DESC), '[]'::jsonb)
      FROM (
        SELECT e.product_id, p.canonical_name AS name, p.brand AS brand, count(*)::int AS added,
               (
                 SELECT count(*)::int FROM public.catalog_order_items i
                 JOIN public.catalog_orders o ON o.id = i.order_id
                 WHERE i.product_id = e.product_id AND o.deleted_at IS NULL
                   AND o.created_at >= p_from AND o.created_at < p_to
               ) AS ordered
        FROM public.analytics_events e
        JOIN public.products p ON p.id = e.product_id
        WHERE e.event = 'cart_item_added' AND e.created_at >= p_from AND e.created_at < p_to
        GROUP BY e.product_id, p.canonical_name, p.brand
        ORDER BY count(*) DESC LIMIT 15
      ) s
    ),
    'carts', (
      SELECT jsonb_build_object(
        'abandoned', count(*) FILTER (WHERE status = 'ABANDONED')::int,
        'active', count(*) FILTER (WHERE status = 'ACTIVE')::int,
        'abandoned_total', coalesce(sum(estimated_total) FILTER (WHERE status = 'ABANDONED'), 0),
        'abandoned_avg', coalesce(avg(estimated_total) FILTER (WHERE status = 'ABANDONED' AND estimated_total > 0), 0),
        'recovered', count(*) FILTER (WHERE recovered_at IS NOT NULL)::int
      )
      FROM public.shopping_carts
      WHERE last_activity_at >= p_from AND last_activity_at < p_to
    ),
    'abandoned_products', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity) ORDER BY quantity DESC), '[]'::jsonb)
      FROM (
        SELECT coalesce(ci.product_name, p.canonical_name) AS name, sum(ci.quantity)::int AS quantity
        FROM public.cart_items ci
        JOIN public.shopping_carts sc ON sc.id = ci.cart_id
        LEFT JOIN public.products p ON p.id = ci.product_id
        WHERE sc.status = 'ABANDONED' AND sc.last_activity_at >= p_from AND sc.last_activity_at < p_to
        GROUP BY coalesce(ci.product_name, p.canonical_name)
        ORDER BY sum(ci.quantity) DESC LIMIT 10
      ) s
    ),
    'lead_triggers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('trigger', trg, 'leads', leads) ORDER BY leads DESC), '[]'::jsonb)
      FROM (
        SELECT coalesce(nullif(meta->>'trigger', ''), 'outro') AS trg, count(DISTINCT visitor_id)::int AS leads
        FROM public.analytics_events
        WHERE event = 'lead_identified' AND created_at >= p_from AND created_at < p_to
        GROUP BY coalesce(nullif(meta->>'trigger', ''), 'outro')
      ) s
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.analytics_funnel(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_funnel(timestamptz, timestamptz) TO authenticated, service_role;