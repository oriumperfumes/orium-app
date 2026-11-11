CREATE OR REPLACE FUNCTION public.crm_cleanup_prepare(p_include_real boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _crm_real_c (id uuid primary key) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _crm_prot_u (user_id uuid primary key) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _crm_prot_d (device_id text primary key) ON COMMIT DROP;
  DELETE FROM _crm_real_c; DELETE FROM _crm_prot_u; DELETE FROM _crm_prot_d;

  INSERT INTO _crm_real_c
  SELECT c.id FROM public.crm_customers c
  WHERE EXISTS (
    SELECT 1 FROM public.catalog_orders o
    WHERE o.deleted_at IS NULL
      AND ((c.user_id IS NOT NULL AND o.customer_user_id = c.user_id)
        OR (c.phone_normalized IS NOT NULL AND o.customer_phone_normalized = c.phone_normalized))
  );

  IF NOT p_include_real THEN
    INSERT INTO _crm_prot_u
    SELECT DISTINCT c.user_id FROM public.crm_customers c
    JOIN _crm_real_c r ON r.id = c.id WHERE c.user_id IS NOT NULL;

    INSERT INTO _crm_prot_d
    SELECT DISTINCT d.device_id FROM public.crm_customer_devices d
    JOIN _crm_real_c r ON r.id = d.customer_id WHERE d.device_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_cleanup_prepare(boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_cleanup_preview(p_include_real boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  PERFORM public.crm_cleanup_prepare(p_include_real);

  SELECT jsonb_build_object(
    'fichas', (SELECT count(*) FROM public.crm_customers c
                WHERE c.id NOT IN (SELECT id FROM _crm_real_c)),
    'favoritos', (SELECT count(*) FROM public.favorites f
                WHERE (f.user_id IS NULL OR f.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
                  AND (f.anonymous_id IS NULL OR f.anonymous_id NOT IN (SELECT device_id FROM _crm_prot_d))),
    'carrinhos', (SELECT count(*) FROM public.shopping_carts s
                WHERE s.order_id IS NULL AND s.converted_at IS NULL AND coalesce(s.status,'') <> 'converted'
                  AND coalesce(s.status,'') <> 'abandoned'
                  AND (s.user_id IS NULL OR s.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
                  AND (s.anonymous_id IS NULL OR s.anonymous_id NOT IN (SELECT device_id FROM _crm_prot_d))),
    'abandonados', (SELECT count(*) FROM public.shopping_carts s
                WHERE s.order_id IS NULL AND s.converted_at IS NULL AND s.status = 'abandoned'
                  AND (s.user_id IS NULL OR s.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
                  AND (s.anonymous_id IS NULL OR s.anonymous_id NOT IN (SELECT device_id FROM _crm_prot_d))),
    'visualizacoes', (SELECT count(*) FROM public.product_views p
                WHERE (p.user_id IS NULL OR p.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
                  AND (p.anonymous_id IS NULL OR p.anonymous_id NOT IN (SELECT device_id FROM _crm_prot_d))),
    'interesses', (SELECT count(*) FROM public.negotiation_interests i
                WHERE (i.user_id IS NULL OR i.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
                  AND (i.visitor_id IS NULL OR i.visitor_id NOT IN (SELECT device_id FROM _crm_prot_d))
                  AND (i.customer_id IS NULL OR i.customer_id NOT IN (SELECT id FROM _crm_real_c) OR p_include_real)),
    'alertas', (SELECT count(*) FROM public.back_in_stock_subscriptions b
                WHERE (b.user_id IS NULL OR b.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
                  AND (b.anonymous_id IS NULL OR b.anonymous_id NOT IN (SELECT device_id FROM _crm_prot_d))),
    'eventos', (SELECT count(*) FROM public.crm_events e
                WHERE p_include_real OR e.customer_id IS NULL OR e.customer_id NOT IN (SELECT id FROM _crm_real_c))
  ) INTO v;
  RETURN v;
END;
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
  PERFORM public.crm_cleanup_prepare(p_include_real);

  IF 'favoritos' = ANY(p_scopes) THEN
    WITH d AS (
      DELETE FROM public.favorites f
      WHERE (f.user_id IS NULL OR f.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
        AND (f.anonymous_id IS NULL OR f.anonymous_id NOT IN (SELECT device_id FROM _crm_prot_d))
      RETURNING 1) SELECT count(*) INTO n FROM d;
    v := v || jsonb_build_object('favoritos', n);
  END IF;

  IF 'carrinhos' = ANY(p_scopes) THEN
    WITH d AS (
      DELETE FROM public.shopping_carts s
      WHERE s.order_id IS NULL AND s.converted_at IS NULL AND coalesce(s.status,'') NOT IN ('converted','abandoned')
        AND (s.user_id IS NULL OR s.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
        AND (s.anonymous_id IS NULL OR s.anonymous_id NOT IN (SELECT device_id FROM _crm_prot_d))
      RETURNING 1) SELECT count(*) INTO n FROM d;
    v := v || jsonb_build_object('carrinhos', n);
  END IF;

  IF 'abandonados' = ANY(p_scopes) THEN
    WITH d AS (
      DELETE FROM public.shopping_carts s
      WHERE s.order_id IS NULL AND s.converted_at IS NULL AND s.status = 'abandoned'
        AND (s.user_id IS NULL OR s.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
        AND (s.anonymous_id IS NULL OR s.anonymous_id NOT IN (SELECT device_id FROM _crm_prot_d))
      RETURNING 1) SELECT count(*) INTO n FROM d;
    v := v || jsonb_build_object('abandonados', n);
  END IF;

  IF 'visualizacoes' = ANY(p_scopes) THEN
    WITH d AS (
      DELETE FROM public.product_views p
      WHERE (p.user_id IS NULL OR p.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
        AND (p.anonymous_id IS NULL OR p.anonymous_id NOT IN (SELECT device_id FROM _crm_prot_d))
      RETURNING 1) SELECT count(*) INTO n FROM d;
    v := v || jsonb_build_object('visualizacoes', n);
  END IF;

  IF 'interesses' = ANY(p_scopes) THEN
    WITH d AS (
      DELETE FROM public.negotiation_interests i
      WHERE (i.user_id IS NULL OR i.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
        AND (i.visitor_id IS NULL OR i.visitor_id NOT IN (SELECT device_id FROM _crm_prot_d))
        AND (p_include_real OR i.customer_id IS NULL OR i.customer_id NOT IN (SELECT id FROM _crm_real_c))
      RETURNING 1) SELECT count(*) INTO n FROM d;
    v := v || jsonb_build_object('interesses', n);
  END IF;

  IF 'alertas' = ANY(p_scopes) THEN
    WITH d AS (
      DELETE FROM public.back_in_stock_subscriptions b
      WHERE (b.user_id IS NULL OR b.user_id NOT IN (SELECT user_id FROM _crm_prot_u))
        AND (b.anonymous_id IS NULL OR b.anonymous_id NOT IN (SELECT device_id FROM _crm_prot_d))
      RETURNING 1) SELECT count(*) INTO n FROM d;
    v := v || jsonb_build_object('alertas', n);
  END IF;

  IF 'eventos' = ANY(p_scopes) THEN
    WITH d AS (
      DELETE FROM public.crm_events e
      WHERE p_include_real OR e.customer_id IS NULL OR e.customer_id NOT IN (SELECT id FROM _crm_real_c)
      RETURNING 1) SELECT count(*) INTO n FROM d;
    v := v || jsonb_build_object('eventos', n);
  END IF;

  IF 'fichas' = ANY(p_scopes) THEN
    WITH d AS (
      DELETE FROM public.crm_customers c
      WHERE c.id NOT IN (SELECT id FROM _crm_real_c)
      RETURNING 1) SELECT count(*) INTO n FROM d;
    v := v || jsonb_build_object('fichas', n);
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
  PERFORM public.crm_cleanup_prepare(false);
  WITH d AS (
    DELETE FROM public.crm_customers c
    WHERE c.id NOT IN (SELECT id FROM _crm_real_c)
    RETURNING 1) SELECT count(*) INTO n FROM d;
  RETURN jsonb_build_object('fichas', n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_purge_customers_without_orders() TO authenticated;