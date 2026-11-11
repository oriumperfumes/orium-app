CREATE OR REPLACE FUNCTION public.store_stock_set_tracked(p_product_id uuid, p_tracked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  UPDATE public.products SET stock_tracked = p_tracked WHERE id = p_product_id;
END $$;
REVOKE ALL ON FUNCTION public.store_stock_set_tracked(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_stock_set_tracked(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_store_stock()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_list uuid;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  SELECT id INTO v_list FROM public.restock_lists WHERE status = 'aberta' ORDER BY created_at LIMIT 1;
  WITH s AS (
    SELECT p.id, coalesce(p.canonical_name, p.raw_name) AS name, p.brand, p.image_url, p.volume_ml,
           coalesce(p.local_stock,0) AS units, p.retail_price,
           nullif(coalesce(pc.best_cost, p.manual_cost, 0), 0) AS unit_cost,
           CASE WHEN coalesce(p.local_stock,0) >= 2 THEN 'IN_STOCK'
                WHEN coalesce(p.local_stock,0) = 1 THEN 'LOW_STOCK'
                ELSE 'OUT_OF_STOCK' END AS status,
           coalesce((SELECT sum(ri.quantity) FROM public.restock_items ri WHERE ri.restock_list_id = v_list AND ri.product_id = p.id),0)::int AS restock_qty
      FROM public.products p LEFT JOIN public.product_costs pc ON pc.product_id = p.id
     WHERE p.stock_tracked OR coalesce(p.local_stock,0) > 0
  )
  SELECT jsonb_build_object(
    'units', coalesce(sum(units),0),
    'products', count(*) FILTER (WHERE units > 0),
    'cost', round(coalesce(sum(coalesce(unit_cost,0) * units),0),2),
    'sale_value', round(coalesce(sum(coalesce(retail_price,0) * units),0),2),
    'missing_cost', count(*) FILTER (WHERE units > 0 AND unit_cost IS NULL),
    'items', coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'brand',brand,'image_url',image_url,'volume_ml',volume_ml,
       'units',units,'unit_cost',unit_cost,'retail_price',retail_price,'cost_total',round(coalesce(unit_cost,0)*units,2),'status',status,
       'in_restock',restock_qty > 0,'restock_qty',restock_qty)
       ORDER BY (units <= 1) DESC, units, name), '[]'::jsonb),
    'alerts', coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'brand',brand,'image_url',image_url,'units',units,'status',status,
       'in_restock',restock_qty > 0,'restock_qty',restock_qty)
       ORDER BY units, name) FILTER (WHERE units <= 1), '[]'::jsonb)
  ) INTO v FROM s;
  RETURN v;
END $function$;