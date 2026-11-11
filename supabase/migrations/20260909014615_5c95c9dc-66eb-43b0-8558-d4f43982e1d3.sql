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
  ),
  ord AS (
    SELECT c.id AS cid,
           count(*) FILTER (WHERE o.is_confirmed)::int AS orders_count,
           coalesce(sum(coalesce(o.grand_total, o.sales_total)) FILTER (WHERE o.is_confirmed), 0) AS total_spent,
           min(o.created_at) FILTER (WHERE o.is_confirmed) AS first_order_at,
           max(o.created_at) FILTER (WHERE o.is_confirmed) AS last_order_at
      FROM cust c
      JOIN public.catalog_orders o
        ON o.deleted_at IS NULL AND o.canceled_at IS NULL
       AND ((c.user_id IS NOT NULL AND o.customer_user_id = c.user_id)
         OR (c.phone_normalized IS NOT NULL
             AND coalesce(o.customer_phone_normalized, public.norm_phone(o.customer_phone)) = c.phone_normalized))
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
           CASE WHEN coalesce(o.orders_count, 0) > 0
                THEN round(coalesce(o.total_spent, 0) / o.orders_count, 2) ELSE 0 END AS avg_ticket,
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
            OR (qd <> '' AND coalesce(j.phone, '') LIKE '%' || qd || '%')
            OR (qraw LIKE '%@%' AND coalesce(j.email, '') LIKE '%' || qraw || '%')
            OR EXISTS (
                 SELECT 1 FROM public.catalog_orders o
                  WHERE o.deleted_at IS NULL
                    AND lower(coalesce(o.order_number, '')) = qraw
                    AND ((j.user_id IS NOT NULL AND o.customer_user_id = j.user_id)
                      OR (j.phone IS NOT NULL AND public.norm_phone(o.customer_phone) = public.norm_phone(j.phone))))
           )
       AND (p_filter IS NULL OR p_filter = 'todos'
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
                       OR (j.phone IS NOT NULL AND public.norm_phone(o.customer_phone) = public.norm_phone(j.phone)))))
            OR (p_filter = 'comprou-frasco' AND EXISTS (
                  SELECT 1 FROM public.catalog_orders o
                    JOIN public.catalog_order_items i ON i.order_id = o.id
                   WHERE o.is_confirmed AND o.deleted_at IS NULL AND o.canceled_at IS NULL
                     AND i.variant = 'FULL'
                     AND ((j.user_id IS NOT NULL AND o.customer_user_id = j.user_id)
                       OR (j.phone IS NOT NULL AND public.norm_phone(o.customer_phone) = public.norm_phone(j.phone)))))
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
REVOKE ALL ON FUNCTION public.crm_customer_list(text, text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.crm_customer_list(text, text, integer, integer) TO authenticated, service_role;