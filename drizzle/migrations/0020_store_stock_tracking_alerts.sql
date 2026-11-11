-- Estoque da loja = somente frascos lacrados. Produtos passam a ser "acompanhados" ao entrar no estoque.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_tracked boolean NOT NULL DEFAULT false;
UPDATE public.products SET stock_tracked = true
 WHERE coalesce(local_stock,0) > 0
    OR id IN (SELECT DISTINCT product_id FROM public.inventory_movements WHERE product_id IS NOT NULL AND coalesce(after_qty,0) > 0);

CREATE OR REPLACE FUNCTION public.products_stock_tracked_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(NEW.local_stock,0) > 0 THEN NEW.stock_tracked := true; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS products_stock_tracked_sync ON public.products;
CREATE TRIGGER products_stock_tracked_sync BEFORE INSERT OR UPDATE OF local_stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_stock_tracked_sync();

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
           EXISTS (SELECT 1 FROM public.restock_items ri WHERE ri.restock_list_id = v_list AND ri.product_id = p.id) AS in_restock
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
       'units',units,'unit_cost',unit_cost,'retail_price',retail_price,'cost_total',round(coalesce(unit_cost,0)*units,2),'status',status)
       ORDER BY name) FILTER (WHERE units > 0), '[]'::jsonb),
    'alerts', coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'brand',brand,'image_url',image_url,'units',units,'status',status,'in_restock',in_restock)
       ORDER BY units, name) FILTER (WHERE units <= 1), '[]'::jsonb)
  ) INTO v FROM s;
  RETURN v;
END $function$;