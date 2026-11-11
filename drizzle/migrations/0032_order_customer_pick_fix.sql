CREATE OR REPLACE FUNCTION public.crm_customer_pick(p_q text DEFAULT NULL, p_limit int DEFAULT 12)
RETURNS TABLE(id uuid, name text, phone text, phone_normalized text, orders int, last_order_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q text := nullif(btrim(coalesce(p_q,'')),''); d text := regexp_replace(coalesce(p_q,''),'[^0-9]','','g');
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF length(d) > 11 AND left(d,2) = '55' THEN d := right(d, 11); END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.phone, c.phone_normalized,
         count(o.id)::int, max(o.created_at)
  FROM public.crm_customers c
  LEFT JOIN public.catalog_orders o ON o.crm_customer_id = c.id AND o.deleted_at IS NULL
  WHERE c.archived_at IS NULL
    AND (q IS NULL
      OR public.catalog_norm(coalesce(c.name,'')) LIKE '%' || public.catalog_norm(q) || '%'
      OR (length(d) >= 3 AND c.phone_normalized LIKE '%' || d || '%'))
  GROUP BY c.id
  ORDER BY (q IS NULL AND max(o.created_at) IS NULL), max(o.created_at) DESC NULLS LAST, c.updated_at DESC
  LIMIT greatest(1, least(p_limit, 50));
END $$;