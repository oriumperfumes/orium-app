CREATE OR REPLACE FUNCTION public.store_sale_list(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_build_object(
    'today', (
      SELECT jsonb_build_object(
        'total', round(coalesce(sum(total),0),2),
        'count', count(*),
        'profit', round(coalesce(sum(gross_profit),0),2)
      ) FROM public.store_sales
      WHERE status = 'confirmada' AND deleted_at IS NULL AND sold_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
    ),
    'period', (
      SELECT jsonb_build_object(
        'total', round(coalesce(sum(total),0),2),
        'count', count(*),
        'profit', round(coalesce(sum(gross_profit),0),2)
      ) FROM public.store_sales
      WHERE status = 'confirmada' AND deleted_at IS NULL AND sold_at >= p_from AND sold_at < p_to
    ),
    'sales', (
      SELECT coalesce(jsonb_agg(x ORDER BY sold_at DESC), '[]'::jsonb) FROM (
        SELECT s.sold_at, jsonb_build_object(
          'id', s.id, 'sale_number', s.sale_number, 'sold_at', s.sold_at,
          'payment_method', s.payment_method, 'total', round(s.total,2),
          'gross_profit', round(s.gross_profit,2), 'cost_complete', s.cost_complete,
          'status', s.status, 'entry_method', s.entry_method,
          'customer_name', s.customer_name,
          'items', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'name', i.product_name_snapshot, 'brand', i.brand_snapshot,
              'image_url', i.image_snapshot, 'variant', i.variant,
              'decant_ml', i.decant_ml, 'quantity', i.quantity
            )), '[]'::jsonb) FROM public.store_sale_items i WHERE i.sale_id = s.id
          )
        ) AS x
        FROM public.store_sales s
        WHERE s.sold_at >= p_from AND s.sold_at < p_to AND s.deleted_at IS NULL
        ORDER BY s.sold_at DESC
        LIMIT 100
      ) q
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;