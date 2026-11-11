DROP FUNCTION IF EXISTS public.crm_cleanup_prepare(boolean);

CREATE OR REPLACE FUNCTION public.crm_real_customers()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id FROM public.crm_customers c
  WHERE EXISTS (
    SELECT 1 FROM public.catalog_orders o
    WHERE o.deleted_at IS NULL
      AND ((c.user_id IS NOT NULL AND o.customer_user_id = c.user_id)
        OR (c.phone_normalized IS NOT NULL AND o.customer_phone_normalized = c.phone_normalized))
  );
$$;

REVOKE ALL ON FUNCTION public.crm_real_customers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_protected_users(p_include_real boolean)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT c.user_id FROM public.crm_customers c
  WHERE NOT p_include_real AND c.user_id IS NOT NULL
    AND c.id IN (SELECT public.crm_real_customers());
$$;

REVOKE ALL ON FUNCTION public.crm_protected_users(boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_protected_devices(p_include_real boolean)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT d.device_id FROM public.crm_customer_devices d
  WHERE NOT p_include_real AND d.device_id IS NOT NULL
    AND d.customer_id IN (SELECT public.crm_real_customers());
$$;

REVOKE ALL ON FUNCTION public.crm_protected_devices(boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_cleanup_preview(p_include_real boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN NOT public.is_staff(auth.uid()) THEN NULL::jsonb ELSE jsonb_build_object(
    'fichas', (SELECT count(*) FROM public.crm_customers c
                WHERE c.id NOT IN (SELECT public.crm_real_customers())),
    'favoritos', (SELECT count(*) FROM public.favorites f
                WHERE (f.user_id IS NULL OR f.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
                  AND (f.anonymous_id IS NULL OR f.anonymous_id NOT IN (SELECT public.crm_protected_devices(p_include_real)))),
    'carrinhos', (SELECT count(*) FROM public.shopping_carts s
                WHERE s.order_id IS NULL AND s.converted_at IS NULL
                  AND coalesce(s.status,'') NOT IN ('converted','abandoned')
                  AND (s.user_id IS NULL OR s.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
                  AND (s.anonymous_id IS NULL OR s.anonymous_id NOT IN (SELECT public.crm_protected_devices(p_include_real)))),
    'abandonados', (SELECT count(*) FROM public.shopping_carts s
                WHERE s.order_id IS NULL AND s.converted_at IS NULL AND s.status = 'abandoned'
                  AND (s.user_id IS NULL OR s.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
                  AND (s.anonymous_id IS NULL OR s.anonymous_id NOT IN (SELECT public.crm_protected_devices(p_include_real)))),
    'visualizacoes', (SELECT count(*) FROM public.product_views p
                WHERE (p.user_id IS NULL OR p.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
                  AND (p.anonymous_id IS NULL OR p.anonymous_id NOT IN (SELECT public.crm_protected_devices(p_include_real)))),
    'interesses', (SELECT count(*) FROM public.negotiation_interests i
                WHERE (i.user_id IS NULL OR i.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
                  AND (i.visitor_id IS NULL OR i.visitor_id NOT IN (SELECT public.crm_protected_devices(p_include_real)))
                  AND (p_include_real OR i.customer_id IS NULL OR i.customer_id NOT IN (SELECT public.crm_real_customers()))),
    'alertas', (SELECT count(*) FROM public.back_in_stock_subscriptions b
                WHERE (b.user_id IS NULL OR b.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
                  AND (b.anonymous_id IS NULL OR b.anonymous_id NOT IN (SELECT public.crm_protected_devices(p_include_real)))),
    'eventos', (SELECT count(*) FROM public.crm_events e
                WHERE p_include_real OR e.customer_id IS NULL
                  OR e.customer_id NOT IN (SELECT public.crm_real_customers()))
  ) END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_cleanup_preview(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_cleanup_apply(p_scopes text[], p_include_real boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v jsonb := '{}'::jsonb; n integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_scopes IS NULL OR array_length(p_scopes, 1) IS NULL THEN RETURN v; END IF;

  IF 'favoritos' = ANY(p_scopes) THEN
    DELETE FROM public.favorites f
    WHERE (f.user_id IS NULL OR f.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
      AND (f.anonymous_id IS NULL OR f.anonymous_id NOT IN (SELECT public.crm_protected_devices(p_include_real)));
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('favoritos', n);
  END IF;

  IF 'carrinhos' = ANY(p_scopes) THEN
    DELETE FROM public.shopping_carts s
    WHERE s.order_id IS NULL AND s.converted_at IS NULL
      AND coalesce(s.status,'') NOT IN ('converted','abandoned')
      AND (s.user_id IS NULL OR s.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
      AND (s.anonymous_id IS NULL OR s.anonymous_id NOT IN (SELECT public.crm_protected_devices(p_include_real)));
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('carrinhos', n);
  END IF;

  IF 'abandonados' = ANY(p_scopes) THEN
    DELETE FROM public.shopping_carts s
    WHERE s.order_id IS NULL AND s.converted_at IS NULL AND s.status = 'abandoned'
      AND (s.user_id IS NULL OR s.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
      AND (s.anonymous_id IS NULL OR s.anonymous_id NOT IN (SELECT public.crm_protected_devices(p_include_real)));
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('abandonados', n);
  END IF;

  IF 'visualizacoes' = ANY(p_scopes) THEN
    DELETE FROM public.product_views p
    WHERE (p.user_id IS NULL OR p.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
      AND (p.anonymous_id IS NULL OR p.anonymous_id NOT IN (SELECT public.crm_protected_devices(p_include_real)));
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('visualizacoes', n);
  END IF;

  IF 'interesses' = ANY(p_scopes) THEN
    DELETE FROM public.negotiation_interests i
    WHERE (i.user_id IS NULL OR i.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
      AND (i.visitor_id IS NULL OR i.visitor_id NOT IN (SELECT public.crm_protected_devices(p_include_real)))
      AND (p_include_real OR i.customer_id IS NULL OR i.customer_id NOT IN (SELECT public.crm_real_customers()));
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('interesses', n);
  END IF;

  IF 'alertas' = ANY(p_scopes) THEN
    DELETE FROM public.back_in_stock_subscriptions b
    WHERE (b.user_id IS NULL OR b.user_id NOT IN (SELECT public.crm_protected_users(p_include_real)))
      AND (b.anonymous_id IS NULL OR b.anonymous_id NOT IN (SELECT public.crm_protected_devices(p_include_real)));
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('alertas', n);
  END IF;

  IF 'eventos' = ANY(p_scopes) THEN
    DELETE FROM public.crm_events e
    WHERE p_include_real OR e.customer_id IS NULL
      OR e.customer_id NOT IN (SELECT public.crm_real_customers());
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('eventos', n);
  END IF;

  IF 'fichas' = ANY(p_scopes) THEN
    DELETE FROM public.crm_customers c
    WHERE c.id NOT IN (SELECT public.crm_real_customers());
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('fichas', n);
  END IF;

  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_cleanup_apply(text[], boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_purge_customers_without_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'not authorized'; END IF;
  DELETE FROM public.crm_customers c WHERE c.id NOT IN (SELECT public.crm_real_customers());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('fichas', n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_purge_customers_without_orders() TO authenticated;