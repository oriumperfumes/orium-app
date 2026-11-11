-- 1) Arquivamento de clientes
ALTER TABLE public.crm_customers ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 2) Chave de telefone consistente (últimos 11 dígitos), independente do prefixo 55
CREATE OR REPLACE FUNCTION public.crm_order_matches(c public.crm_customers, o public.catalog_orders)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (c.user_id IS NOT NULL AND o.customer_user_id = c.user_id)
      OR (c.phone_normalized IS NOT NULL
          AND public.norm_phone(coalesce(o.customer_phone, o.customer_phone_normalized)) = c.phone_normalized)
$$;

-- 3) Lista de clientes
CREATE OR REPLACE FUNCTION public.crm_customer_list(
  p_q text DEFAULT NULL,
  p_filter text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
) RETURNS TABLE(
  id uuid, name text, phone text, email text, user_id uuid,
  orders_count integer, total_spent numeric, avg_ticket numeric,
  first_order_at timestamptz, last_order_at timestamptz,
  favorites_count integer, waiting_count integer,
  abandoned_count integer, active_cart_items integer,
  last_activity_at timestamptz, total bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q text := public.catalog_norm(coalesce(p_q, ''));
  qraw text := lower(btrim(coalesce(p_q, '')));
  qd text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN QUERY
  WITH cust AS (
    SELECT c.* FROM public.crm_customers c
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
       AND public.crm_order_matches(c, o)
     GROUP BY c.id
  ),
  fav AS (
    SELECT c.id AS cid, count(f.id)::int AS favorites_count
      FROM cust c JOIN public.favorites f ON f.user_id = c.user_id
     GROUP BY c.id
  ),
  wait AS (
    SELECT c.id AS cid, count(s.id)::int AS waiting_count
      FROM cust c JOIN public.back_in_stock_subscriptions s
        ON s.active AND s.canceled_at IS NULL
       AND ((c.user_id IS NOT NULL AND s.user_id = c.user_id)
         OR (c.phone_normalized IS NOT NULL AND s.phone_normalized = c.phone_normalized)
         OR (c.email IS NOT NULL AND public.norm_email(s.email) = c.email))
     GROUP BY c.id
  ),
  carts AS (
    SELECT c.id AS cid,
           count(*) FILTER (WHERE ct.status = 'ABANDONED')::int AS abandoned_count,
           coalesce(max(ct.items_count) FILTER (WHERE ct.status = 'ACTIVE'), 0)::int AS active_cart_items,
           max(ct.last_activity_at) AS cart_activity
      FROM cust c JOIN public.shopping_carts ct
        ON ((c.user_id IS NOT NULL AND ct.user_id = c.user_id)
         OR (c.phone_normalized IS NOT NULL AND ct.phone_normalized = c.phone_normalized))
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
$$;

-- 4) Ficha do cliente: todos os pedidos válidos, financeiro só de confirmados
CREATE OR REPLACE FUNCTION public.crm_customer_detail(p_customer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; out jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT * INTO c FROM public.crm_customers WHERE id = p_customer_id;
  IF c IS NULL THEN RETURN NULL; END IF;

  WITH ord AS (
    SELECT o.* FROM public.catalog_orders o
     WHERE o.deleted_at IS NULL AND o.canceled_at IS NULL
       AND public.crm_order_matches(c, o)
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
      'user_id', c.user_id, 'created_at', c.created_at, 'archived_at', c.archived_at
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
    'favorites', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'product_id', p.id, 'name', p.canonical_name, 'brand', p.brand, 'slug', p.slug,
        'image_url', p.image_url, 'in_stock', p.in_stock, 'want_decant', f.want_decant,
        'created_at', f.created_at) ORDER BY f.created_at DESC)
      FROM public.favorites f JOIN public.products p ON p.id = f.product_id
     WHERE c.user_id IS NOT NULL AND f.user_id = c.user_id), '[]'::jsonb),
    'waiting', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'product_id', p.id, 'name', p.canonical_name, 'brand', p.brand, 'slug', p.slug,
        'in_stock', p.in_stock, 'channel', s.channel, 'created_at', s.created_at) ORDER BY s.created_at DESC)
      FROM public.back_in_stock_subscriptions s JOIN public.products p ON p.id = s.product_id
     WHERE s.active AND s.canceled_at IS NULL
       AND ((c.user_id IS NOT NULL AND s.user_id = c.user_id)
         OR (c.phone_normalized IS NOT NULL AND s.phone_normalized = c.phone_normalized)
         OR (c.email IS NOT NULL AND public.norm_email(s.email) = c.email))), '[]'::jsonb),
    'viewed', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', p.canonical_name, 'brand', p.brand, 'slug', p.slug,
                                  'views', count(*)::int, 'last_at', max(v.viewed_at)) AS x
          FROM public.product_views v JOIN public.products p ON p.id = v.product_id
         WHERE c.user_id IS NOT NULL AND v.user_id = c.user_id
         GROUP BY p.id, p.canonical_name, p.brand, p.slug
         ORDER BY count(*) DESC LIMIT 10) t), '[]'::jsonb),
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
         OR (c.phone_normalized IS NOT NULL AND ct.phone_normalized = c.phone_normalized))), '[]'::jsonb),
    'notes', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'note', n.note, 'created_at', n.created_at) ORDER BY n.created_at DESC)
      FROM public.crm_notes n WHERE n.customer_id = c.id), '[]'::jsonb)
  ) INTO out;

  RETURN out;
END;
$$;

-- 5) Editar e arquivar clientes (somente equipe)
CREATE OR REPLACE FUNCTION public.crm_customer_update(
  p_customer_id uuid, p_name text DEFAULT NULL, p_phone text DEFAULT NULL, p_email text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ph text := public.norm_phone(p_phone);
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF ph IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.crm_customers WHERE phone_normalized = ph AND id <> p_customer_id
  ) THEN RAISE EXCEPTION 'Já existe outro cliente com este telefone.'; END IF;
  UPDATE public.crm_customers SET
    name = nullif(btrim(coalesce(p_name, '')), ''),
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    phone_normalized = ph,
    email = public.norm_email(p_email),
    updated_at = now()
   WHERE id = p_customer_id;
  RETURN p_customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_customer_set_archived(p_customer_id uuid, p_archived boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  UPDATE public.crm_customers
     SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END, updated_at = now()
   WHERE id = p_customer_id;
  RETURN p_archived;
END;
$$;

-- 6) Todo pedido cria/atualiza o cliente no CRM
CREATE OR REPLACE FUNCTION public.crm_sync_order_customer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.crm_upsert_customer(NEW.customer_user_id, NEW.customer_name, NEW.customer_phone, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_sync_order_customer_trg ON public.catalog_orders;
CREATE TRIGGER crm_sync_order_customer_trg
AFTER INSERT OR UPDATE OF customer_user_id, customer_name, customer_phone ON public.catalog_orders
FOR EACH ROW EXECUTE FUNCTION public.crm_sync_order_customer();

-- 7) Preenche o CRM com todos os pedidos já existentes
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT customer_user_id, customer_name, customer_phone
             FROM public.catalog_orders WHERE deleted_at IS NULL
            ORDER BY created_at
  LOOP
    PERFORM public.crm_upsert_customer(r.customer_user_id, r.customer_name, r.customer_phone, NULL);
  END LOOP;
END $$;

-- 8) Permissões: nada disso é público
REVOKE ALL ON FUNCTION public.crm_customer_list(text, text, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.crm_customer_detail(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.crm_customer_update(uuid, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.crm_customer_set_archived(uuid, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.crm_order_matches(public.crm_customers, public.catalog_orders) FROM public, anon;
REVOKE ALL ON FUNCTION public.crm_sync_order_customer() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crm_customer_list(text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_customer_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_customer_update(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_customer_set_archived(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_order_matches(public.crm_customers, public.catalog_orders) TO authenticated, service_role;