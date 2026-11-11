ALTER TABLE public.products ADD COLUMN IF NOT EXISTS local_decant_ml numeric NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.products.local_decant_ml IS 'ml disponíveis na loja em frascos abertos para decant (estoque físico manual)';

CREATE OR REPLACE FUNCTION public.decant_ml_adjust(p_product_id uuid, p_mode text, p_ml numeric, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_after numeric;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF p_mode NOT IN ('set','add','remove') THEN RAISE EXCEPTION 'Modo inválido.'; END IF;
  IF p_ml IS NULL OR p_ml < 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
  SELECT id, local_decant_ml INTO r FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  v_after := CASE p_mode WHEN 'set' THEN p_ml WHEN 'add' THEN r.local_decant_ml + p_ml ELSE r.local_decant_ml - p_ml END;
  IF v_after < 0 THEN RAISE EXCEPTION 'Os ml ficariam negativos (hoje há % ml).', r.local_decant_ml; END IF;
  UPDATE public.products SET local_decant_ml = v_after, updated_at = now() WHERE id = p_product_id;
  IF v_after <> r.local_decant_ml THEN
    INSERT INTO public.inventory_movements (product_id, delta, before_qty, after_qty, mode, reason, source, actor)
    VALUES (p_product_id, round(v_after - r.local_decant_ml)::int, round(r.local_decant_ml)::int, round(v_after)::int, 'ml_' || p_mode, p_reason, 'estoque_ml', auth.uid());
  END IF;
  RETURN jsonb_build_object('before', r.local_decant_ml, 'after', v_after);
END $$;
REVOKE ALL ON FUNCTION public.decant_ml_adjust(uuid, text, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decant_ml_adjust(uuid, text, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_store_stock()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  WITH s AS (
    SELECT p.id, coalesce(p.canonical_name, p.raw_name) AS name, p.brand, p.image_url, p.volume_ml,
           p.local_stock AS units, p.local_decant_ml AS ml, p.retail_price, p.decant_price_10ml,
           nullif(coalesce(pc.best_cost, p.manual_cost, 0), 0) AS unit_cost
      FROM public.products p LEFT JOIN public.product_costs pc ON pc.product_id = p.id
     WHERE p.local_stock > 0 OR p.local_decant_ml > 0
  ), c AS (
    SELECT s.*,
      coalesce(unit_cost,0) * units
        + CASE WHEN coalesce(volume_ml,0) > 0 THEN coalesce(unit_cost,0) / volume_ml * ml ELSE 0 END AS cost_total,
      coalesce(retail_price,0) * units + coalesce(decant_price_10ml,0) / 10 * ml AS sale_total
    FROM s
  )
  SELECT jsonb_build_object(
    'units', coalesce(sum(units),0),
    'ml', coalesce(sum(ml),0),
    'products', count(*),
    'cost', round(coalesce(sum(cost_total),0),2),
    'sale_value', round(coalesce(sum(sale_total),0),2),
    'missing_cost', count(*) FILTER (WHERE unit_cost IS NULL),
    'items', coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'brand',brand,'image_url',image_url,'volume_ml',volume_ml,
       'units',units,'ml',ml,'unit_cost',unit_cost,'retail_price',retail_price,'cost_total',round(cost_total,2)) ORDER BY name), '[]'::jsonb)
  ) INTO v FROM c;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_store_stock() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_store_stock() TO authenticated;