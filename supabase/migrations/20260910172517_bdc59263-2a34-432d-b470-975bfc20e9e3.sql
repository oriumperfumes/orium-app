-- 1. Aparelhos ligados à ficha do cliente
CREATE TABLE IF NOT EXISTS public.crm_customer_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  device_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_customer_devices_customer_idx ON public.crm_customer_devices(customer_id);

GRANT SELECT ON public.crm_customer_devices TO authenticated;
GRANT ALL ON public.crm_customer_devices TO service_role;
ALTER TABLE public.crm_customer_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_customer_devices_staff_read" ON public.crm_customer_devices
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- 2. Favoritos de visitante (sem conta) ligados ao aparelho
ALTER TABLE public.favorites ADD COLUMN IF NOT EXISTS anonymous_id text;
ALTER TABLE public.favorites ALTER COLUMN user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS favorites_anon_product_idx
  ON public.favorites(anonymous_id, product_id) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS favorites_anon_idx ON public.favorites(anonymous_id) WHERE anonymous_id IS NOT NULL;

-- 3. Interesse em negociação sabe de qual ficha é
ALTER TABLE public.negotiation_interests
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.crm_customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS negotiation_interests_customer_idx ON public.negotiation_interests(customer_id);

-- 4. Identidade única do visitante: aparelho -> conta/telefone
CREATE OR REPLACE FUNCTION public.crm_upsert_customer(
  p_user_id uuid DEFAULT NULL::uuid,
  p_name text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_device_id text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ph text := public.norm_phone(p_phone);
  em text := public.norm_email(p_email);
  dev text := nullif(btrim(coalesce(p_device_id, '')), '');
  caller uuid := auth.uid();
  cid uuid;
  cid_dev uuid;
BEGIN
  IF p_user_id IS NOT NULL AND caller IS NOT NULL
     AND p_user_id <> caller AND NOT public.is_staff(caller) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_user_id IS NULL AND ph IS NULL AND em IS NULL AND dev IS NULL THEN RETURN NULL; END IF;

  IF dev IS NOT NULL THEN
    SELECT customer_id INTO cid_dev FROM public.crm_customer_devices WHERE device_id = dev;
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT id INTO cid FROM public.crm_customers WHERE user_id = p_user_id;
  END IF;
  IF cid IS NULL AND ph IS NOT NULL THEN
    SELECT id INTO cid FROM public.crm_customers WHERE phone_normalized = ph;
  END IF;
  IF cid IS NULL AND em IS NOT NULL THEN
    SELECT id INTO cid FROM public.crm_customers WHERE email = em AND phone_normalized IS NULL;
  END IF;

  -- ficha provisória do aparelho encontra a ficha definitiva: unir as duas
  IF cid IS NOT NULL AND cid_dev IS NOT NULL AND cid_dev <> cid THEN
    UPDATE public.crm_customers c SET
      name = coalesce(c.name, (SELECT d.name FROM public.crm_customers d WHERE d.id = cid_dev)),
      updated_at = now()
    WHERE c.id = cid;
    UPDATE public.crm_customer_devices SET customer_id = cid WHERE customer_id = cid_dev;
    UPDATE public.crm_notes SET customer_id = cid WHERE customer_id = cid_dev;
    UPDATE public.crm_events SET customer_id = cid WHERE customer_id = cid_dev;
    UPDATE public.negotiation_interests SET customer_id = cid WHERE customer_id = cid_dev;
    DELETE FROM public.crm_customers WHERE id = cid_dev;
    cid_dev := NULL;
  END IF;

  cid := coalesce(cid, cid_dev);

  IF cid IS NULL THEN
    INSERT INTO public.crm_customers (user_id, name, phone, phone_normalized, email)
    VALUES (p_user_id, nullif(btrim(coalesce(p_name,'')),''), nullif(btrim(coalesce(p_phone,'')),''), ph, em)
    RETURNING id INTO cid;
  ELSE
    UPDATE public.crm_customers c SET
      user_id = coalesce(c.user_id, p_user_id),
      name = coalesce(nullif(btrim(coalesce(p_name,'')),''), c.name),
      phone = coalesce(c.phone, nullif(btrim(coalesce(p_phone,'')),'')),
      phone_normalized = coalesce(c.phone_normalized, ph),
      email = coalesce(c.email, em),
      updated_at = now()
    WHERE c.id = cid
      AND (c.user_id IS NULL OR p_user_id IS NULL OR c.user_id = p_user_id);
  END IF;

  IF dev IS NOT NULL AND cid IS NOT NULL THEN
    INSERT INTO public.crm_customer_devices (customer_id, device_id)
    VALUES (cid, dev)
    ON CONFLICT (device_id) DO UPDATE SET customer_id = EXCLUDED.customer_id;
  END IF;

  RETURN cid;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_upsert_customer(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_upsert_customer(uuid, text, text, text, text) TO authenticated, service_role;

-- 5. Ficha completa considerando o aparelho
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

REVOKE ALL ON FUNCTION public.crm_customer_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_customer_detail(uuid) TO authenticated, service_role;

-- 6. Lista de clientes considerando o aparelho
CREATE OR REPLACE FUNCTION public.crm_customer_list(p_q text DEFAULT NULL::text, p_filter text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, name text, phone text, email text, user_id uuid, orders_count integer, total_spent numeric, avg_ticket numeric, first_order_at timestamp with time zone, last_order_at timestamp with time zone, favorites_count integer, waiting_count integer, abandoned_count integer, active_cart_items integer, last_activity_at timestamp with time zone, total bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  q text := public.catalog_norm(coalesce(p_q, ''));
  qraw text := lower(btrim(coalesce(p_q, '')));
  qd text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN QUERY
  WITH cust AS (
    SELECT c.*, (SELECT coalesce(array_agg(d.device_id), '{}'::text[])
                   FROM public.crm_customer_devices d WHERE d.customer_id = c.id) AS devs
      FROM public.crm_customers c
     WHERE (p_filter = 'arquivados' AND c.archived_at IS NOT NULL)
        OR (coalesce(p_filter, 'todos') <> 'arquivados' AND c.archived_at IS NULL)
  ),
  ord AS (
    SELECT c.id AS cid,
           count(*)::int AS orders_count,
           count(*) FILTER (WHERE o.is_confirmed)::int AS confirmed_count,
           coalesce(sum(coalesce(o.grand_total, o.sales_total)) FILTER (WHERE o.is_confirmed), 0) AS total_spent,
           min(o.created_at) AS first_order_at,
           max(o.created_at) AS last_order_at
      FROM cust c
      JOIN public.catalog_orders o
        ON o.deleted_at IS NULL AND o.canceled_at IS NULL
       AND ((c.user_id IS NOT NULL AND o.customer_user_id = c.user_id)
         OR (c.phone_normalized IS NOT NULL
             AND public.norm_phone(coalesce(o.customer_phone, o.customer_phone_normalized)) = c.phone_normalized))
     GROUP BY c.id
  ),
  fav AS (
    SELECT c.id AS cid, count(DISTINCT f.product_id)::int AS favorites_count
      FROM cust c JOIN public.favorites f
        ON (c.user_id IS NOT NULL AND f.user_id = c.user_id)
        OR (f.anonymous_id IS NOT NULL AND f.anonymous_id = ANY(c.devs))
     GROUP BY c.id
  ),
  wait AS (
    SELECT c.id AS cid, count(s.id)::int AS waiting_count
      FROM cust c JOIN public.back_in_stock_subscriptions s
        ON s.active AND s.canceled_at IS NULL
       AND ((c.user_id IS NOT NULL AND s.user_id = c.user_id)
         OR (c.phone_normalized IS NOT NULL AND s.phone_normalized = c.phone_normalized)
         OR (c.email IS NOT NULL AND public.norm_email(s.email) = c.email)
         OR (s.anonymous_id IS NOT NULL AND s.anonymous_id = ANY(c.devs)))
     GROUP BY c.id
  ),
  carts AS (
    SELECT c.id AS cid,
           count(*) FILTER (WHERE ct.status = 'ABANDONED')::int AS abandoned_count,
           coalesce(max(ct.items_count) FILTER (WHERE ct.status = 'ACTIVE'), 0)::int AS active_cart_items,
           max(ct.last_activity_at) AS cart_activity
      FROM cust c JOIN public.shopping_carts ct
        ON ((c.user_id IS NOT NULL AND ct.user_id = c.user_id)
         OR (c.phone_normalized IS NOT NULL AND ct.phone_normalized = c.phone_normalized)
         OR (ct.anonymous_id IS NOT NULL AND ct.anonymous_id = ANY(c.devs)))
     GROUP BY c.id
  ),
  joined AS (
    SELECT c.id, c.name, c.phone, c.email, c.user_id,
           coalesce(o.orders_count, 0) AS orders_count,
           coalesce(o.total_spent, 0) AS total_spent,
           CASE WHEN coalesce(o.confirmed_count, 0) > 0
                THEN round(coalesce(o.total_spent, 0) / o.confirmed_count, 2) ELSE 0 END AS avg_ticket,
           o.first_order_at, o.last_order_at,
           coalesce(f.favorites_count, 0) AS favorites_count,
           coalesce(w.waiting_count, 0) AS waiting_count,
           coalesce(ct.abandoned_count, 0) AS abandoned_count,
           coalesce(ct.active_cart_items, 0) AS active_cart_items,
           greatest(coalesce(o.last_order_at, c.created_at), coalesce(ct.cart_activity, c.created_at)) AS last_activity_at
      FROM cust c
      LEFT JOIN ord o ON o.cid = c.id
      LEFT JOIN fav f ON f.cid = c.id
      LEFT JOIN wait w ON w.cid = c.id
      LEFT JOIN carts ct ON ct.cid = c.id
  ),
  filtered AS (
    SELECT * FROM joined j
     WHERE (q = ''
            OR public.catalog_norm(coalesce(j.name, '')) LIKE '%' || q || '%'
            OR (qd <> '' AND regexp_replace(coalesce(j.phone, ''), '[^0-9]', '', 'g') LIKE '%' || qd || '%')
            OR (qraw LIKE '%@%' AND coalesce(j.email, '') LIKE '%' || qraw || '%')
            OR EXISTS (
                 SELECT 1 FROM public.catalog_orders o
                  WHERE o.deleted_at IS NULL
                    AND lower(coalesce(o.order_number, '')) = qraw
                    AND ((j.user_id IS NOT NULL AND o.customer_user_id = j.user_id)
                      OR (j.phone IS NOT NULL
                          AND public.norm_phone(coalesce(o.customer_phone, o.customer_phone_normalized))
                              = public.norm_phone(j.phone))))
           )
       AND (p_filter IS NULL OR p_filter IN ('todos', 'arquivados')
            OR (p_filter = 'com-pedidos' AND j.orders_count > 0)
            OR (p_filter = 'sem-pedidos' AND j.orders_count = 0)
            OR (p_filter = 'abandonados' AND j.abandoned_count > 0)
            OR (p_filter = 'aguardando' AND j.waiting_count > 0)
            OR (p_filter = 'favoritos' AND j.favorites_count > 0)
            OR (p_filter = 'comprou-decant' AND EXISTS (
                  SELECT 1 FROM public.catalog_orders o
                    JOIN public.catalog_order_items i ON i.order_id = o.id
                   WHERE o.is_confirmed AND o.deleted_at IS NULL AND o.canceled_at IS NULL
                     AND i.variant = 'DECANT'
                     AND ((j.user_id IS NOT NULL AND o.customer_user_id = j.user_id)
                       OR (j.phone IS NOT NULL
                           AND public.norm_phone(coalesce(o.customer_phone, o.customer_phone_normalized))
                               = public.norm_phone(j.phone)))))
            OR (p_filter = 'comprou-frasco' AND EXISTS (
                  SELECT 1 FROM public.catalog_orders o
                    JOIN public.catalog_order_items i ON i.order_id = o.id
                   WHERE o.is_confirmed AND o.deleted_at IS NULL AND o.canceled_at IS NULL
                     AND i.variant = 'FULL'
                     AND ((j.user_id IS NOT NULL AND o.customer_user_id = j.user_id)
                       OR (j.phone IS NOT NULL
                           AND public.norm_phone(coalesce(o.customer_phone, o.customer_phone_normalized))
                               = public.norm_phone(j.phone)))))
            OR (p_filter = 'inativos' AND (j.last_order_at IS NULL OR j.last_order_at < now() - interval '60 days')))
  )
  SELECT f.id, f.name, f.phone, f.email, f.user_id, f.orders_count, f.total_spent, f.avg_ticket,
         f.first_order_at, f.last_order_at, f.favorites_count, f.waiting_count,
         f.abandoned_count, f.active_cart_items, f.last_activity_at,
         count(*) OVER () AS total
    FROM filtered f
   ORDER BY f.last_activity_at DESC NULLS LAST, f.name ASC NULLS LAST
   LIMIT greatest(1, least(coalesce(p_limit, 20), 60))
  OFFSET greatest(0, coalesce(p_offset, 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_customer_list(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_customer_list(text, text, integer, integer) TO authenticated, service_role;