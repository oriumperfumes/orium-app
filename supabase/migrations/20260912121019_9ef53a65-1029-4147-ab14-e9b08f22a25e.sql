-- ============ VISITANTES ANÔNIMOS / SESSÕES / EVENTOS ============
CREATE TABLE IF NOT EXISTS public.analytics_visitors (
  visitor_id text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  customer_id uuid REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  user_id uuid,
  device text,
  first_source text,
  first_referrer text,
  first_landing text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.analytics_visitors TO service_role;
GRANT SELECT ON public.analytics_visitors TO authenticated;
ALTER TABLE public.analytics_visitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe lê visitantes" ON public.analytics_visitors
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.analytics_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key text NOT NULL UNIQUE,
  visitor_id text NOT NULL,
  user_id uuid,
  customer_id uuid REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  device text,
  source text,
  referrer text,
  landing_path text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.analytics_sessions TO service_role;
GRANT SELECT ON public.analytics_sessions TO authenticated;
ALTER TABLE public.analytics_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe lê sessões" ON public.analytics_sessions
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE INDEX IF NOT EXISTS analytics_sessions_started_idx ON public.analytics_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS analytics_sessions_visitor_idx ON public.analytics_sessions (visitor_id);

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id bigserial PRIMARY KEY,
  event text NOT NULL,
  visitor_id text NOT NULL,
  session_key text,
  user_id uuid,
  customer_id uuid REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant text,
  decant_ml integer,
  price numeric(10,2),
  promotion_id uuid,
  source text,
  device text,
  path text,
  query text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.analytics_events TO service_role;
GRANT SELECT ON public.analytics_events TO authenticated;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe lê eventos" ON public.analytics_events
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON public.analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_event_idx ON public.analytics_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_visitor_idx ON public.analytics_events (visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_product_idx ON public.analytics_events (product_id, created_at DESC);

CREATE TRIGGER analytics_visitors_touch BEFORE UPDATE ON public.analytics_visitors
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER analytics_sessions_touch BEFORE UPDATE ON public.analytics_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ FICHA DO CLIENTE: ORIGEM / GATILHO / CONSENTIMENTO ============
ALTER TABLE public.crm_customers
  ADD COLUMN IF NOT EXISTS first_source text,
  ADD COLUMN IF NOT EXISTS lead_trigger text,
  ADD COLUMN IF NOT EXISTS marketing_optin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_optin_at timestamptz;

-- ============ FUNIL DE CONVERSÃO (somente equipe) ============
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
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'source', coalesce(nullif(source, ''), 'direto'),
          'campaign', utm_campaign,
          'visitors', count(DISTINCT visitor_id)::int,
          'leads', count(DISTINCT visitor_id) FILTER (WHERE customer_id IS NOT NULL)::int
        ) AS x
        FROM public.analytics_sessions
        WHERE started_at >= p_from AND started_at < p_to
        GROUP BY 1, 2 ORDER BY count(DISTINCT visitor_id) DESC LIMIT 12
      ) s
    ),
    'order_sources', (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('source', coalesce(nullif(v.first_source, ''), 'direto'), 'orders', count(DISTINCT o.id)::int) AS x
        FROM public.catalog_orders o
        JOIN public.crm_customers c ON c.id = o.customer_id
        JOIN public.analytics_visitors v ON v.customer_id = c.id
        WHERE o.deleted_at IS NULL AND o.created_at >= p_from AND o.created_at < p_to
        GROUP BY 1 ORDER BY count(DISTINCT o.id) DESC LIMIT 12
      ) s
    ),
    'devices', (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'device', coalesce(nullif(device, ''), 'desconhecido'),
          'visitors', count(DISTINCT visitor_id)::int
        ) AS x
        FROM public.analytics_sessions
        WHERE started_at >= p_from AND started_at < p_to
        GROUP BY 1 ORDER BY count(DISTINCT visitor_id) DESC
      ) s
    ),
    'device_conversion', (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'device', coalesce(nullif(device, ''), 'desconhecido'),
          'added', count(DISTINCT visitor_id) FILTER (WHERE event = 'cart_item_added')::int,
          'whatsapp', count(DISTINCT visitor_id) FILTER (WHERE event = 'whatsapp_checkout_clicked')::int
        ) AS x
        FROM public.analytics_events
        WHERE created_at >= p_from AND created_at < p_to
        GROUP BY 1
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
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'product_id', e.product_id,
          'name', p.canonical_name,
          'brand', p.brand,
          'slug', p.slug,
          'views', count(*) FILTER (WHERE e.event = 'product_view')::int,
          'visitors', count(DISTINCT e.visitor_id) FILTER (WHERE e.event = 'product_view')::int,
          'added', count(*) FILTER (WHERE e.event = 'cart_item_added')::int
        ) AS x
        FROM public.analytics_events e
        JOIN public.products p ON p.id = e.product_id
        WHERE e.created_at >= p_from AND e.created_at < p_to AND e.product_id IS NOT NULL
        GROUP BY e.product_id, p.canonical_name, p.brand, p.slug
        ORDER BY count(*) FILTER (WHERE e.event = 'product_view') DESC
        LIMIT 15
      ) s
    ),
    'added_products', (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'product_id', e.product_id,
          'name', p.canonical_name,
          'brand', p.brand,
          'added', count(*)::int,
          'ordered', (
            SELECT count(*)::int FROM public.catalog_order_items i
            JOIN public.catalog_orders o ON o.id = i.order_id
            WHERE i.product_id = e.product_id AND o.deleted_at IS NULL
              AND o.created_at >= p_from AND o.created_at < p_to
          )
        ) AS x
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
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('name', coalesce(ci.product_name, p.canonical_name), 'quantity', sum(ci.quantity)::int) AS x
        FROM public.cart_items ci
        JOIN public.shopping_carts sc ON sc.id = ci.cart_id
        LEFT JOIN public.products p ON p.id = ci.product_id
        WHERE sc.status = 'ABANDONED' AND sc.last_activity_at >= p_from AND sc.last_activity_at < p_to
        GROUP BY 1 ORDER BY sum(ci.quantity) DESC LIMIT 10
      ) s
    ),
    'lead_triggers', (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('trigger', coalesce(nullif(meta->>'trigger', ''), 'outro'), 'leads', count(DISTINCT visitor_id)::int) AS x
        FROM public.analytics_events
        WHERE event = 'lead_identified' AND created_at >= p_from AND created_at < p_to
        GROUP BY 1 ORDER BY count(DISTINCT visitor_id) DESC
      ) s
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_funnel(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_funnel(timestamptz, timestamptz) TO authenticated, service_role;

-- ============ JORNADA DO CLIENTE NA FICHA (somente equipe) ============
CREATE OR REPLACE FUNCTION public.crm_customer_journey(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  SELECT jsonb_build_object(
    'first_source', c.first_source,
    'lead_trigger', c.lead_trigger,
    'marketing_optin', c.marketing_optin,
    'first_seen_at', (SELECT min(v2.first_seen_at) FROM public.analytics_visitors v2 WHERE v2.customer_id = c.id),
    'last_seen_at', (SELECT max(v2.last_seen_at) FROM public.analytics_visitors v2 WHERE v2.customer_id = c.id),
    'device', (SELECT v2.device FROM public.analytics_visitors v2 WHERE v2.customer_id = c.id ORDER BY v2.last_seen_at DESC LIMIT 1),
    'utm_campaign', (SELECT v2.utm_campaign FROM public.analytics_visitors v2 WHERE v2.customer_id = c.id ORDER BY v2.last_seen_at DESC LIMIT 1),
    'searches', (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT DISTINCT ON (lower(e.query)) jsonb_build_object('query', e.query, 'at', e.created_at) AS x
        FROM public.analytics_events e
        WHERE e.customer_id = c.id AND e.event = 'search' AND coalesce(e.query, '') <> ''
        ORDER BY lower(e.query), e.created_at DESC
      ) s
    ),
    'help_requests', (
      SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('name', p.canonical_name, 'slug', p.slug, 'at', e.created_at) AS x
        FROM public.analytics_events e
        LEFT JOIN public.products p ON p.id = e.product_id
        WHERE e.customer_id = c.id AND e.event = 'consultant_help_clicked'
        ORDER BY e.created_at DESC LIMIT 5
      ) s
    )
  ) INTO v
  FROM public.crm_customers c WHERE c.id = p_customer_id;

  RETURN coalesce(v, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_customer_journey(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_customer_journey(uuid) TO authenticated, service_role;