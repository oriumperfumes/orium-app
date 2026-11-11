CREATE OR REPLACE FUNCTION public.commercial_price(p_base numeric, p_active boolean, p_max numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE c numeric;
BEGIN
  IF p_base IS NULL THEN RETURN NULL; END IF;
  IF p_active IS NOT TRUE OR coalesce(p_max, 0) <= 0 THEN RETURN round(p_base, 2); END IF;
  c := ceil(round(p_base, 2) - p_max - 0.90) + 0.90;
  IF c <= 0 OR c > round(p_base, 2) OR round(p_base, 2) - c > p_max THEN
    RETURN round(p_base, 2);
  END IF;
  RETURN round(c, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.commercial_price(numeric, boolean, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_price(numeric, boolean, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recompute_product_pricing(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record; o record; best record; total_qty integer;
  base_retail numeric; base_wholesale numeric;
BEGIN
  IF p_product_id IS NULL THEN RETURN; END IF;
  SELECT * INTO s FROM public.pricing_settings WHERE id;
  SELECT * INTO o FROM public.pricing_overrides WHERE product_id = p_product_id;
  SELECT sp.price, sp.supplier_id INTO best
    FROM public.supplier_products sp
    WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock AND sp.price IS NOT NULL
    ORDER BY sp.price ASC LIMIT 1;
  IF best.price IS NULL THEN
    SELECT sp.price, sp.supplier_id INTO best
      FROM public.supplier_products sp
      WHERE sp.product_id = p_product_id AND sp.active AND sp.price IS NOT NULL
      ORDER BY sp.price ASC LIMIT 1;
  END IF;
  SELECT sum(coalesce(sp.stock_quantity,0)) INTO total_qty
    FROM public.supplier_products sp WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock;

  INSERT INTO public.product_costs (product_id, best_cost, best_supplier_id, updated_at)
  VALUES (p_product_id, best.price, best.supplier_id, now())
  ON CONFLICT (product_id) DO UPDATE
    SET best_cost = EXCLUDED.best_cost, best_supplier_id = EXCLUDED.best_supplier_id, updated_at = now();

  base_retail := coalesce(o.fixed_retail_price, best.price + coalesce(o.retail_markup, s.retail_markup));
  base_wholesale := coalesce(o.fixed_wholesale_price, best.price + coalesce(o.wholesale_markup, s.wholesale_markup));

  UPDATE public.products p SET
    in_stock = EXISTS (SELECT 1 FROM public.supplier_products sp WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock),
    stock_quantity = NULLIF(total_qty, 0),
    base_retail_price = CASE WHEN base_retail IS NULL THEN NULL ELSE round(base_retail, 2) END,
    base_wholesale_price = CASE WHEN base_wholesale IS NULL THEN NULL ELSE round(base_wholesale, 2) END,
    retail_price = CASE
      WHEN o.fixed_retail_price IS NOT NULL THEN round(o.fixed_retail_price, 2)
      ELSE public.commercial_price(base_retail, s.psych_pricing_active, s.psych_max_reduction)
    END,
    wholesale_price = CASE
      WHEN o.fixed_wholesale_price IS NOT NULL THEN round(o.fixed_wholesale_price, 2)
      ELSE public.commercial_price(base_wholesale, s.psych_pricing_active, s.psych_max_reduction)
    END,
    updated_at = now()
  WHERE p.id = p_product_id;
END;
$$;