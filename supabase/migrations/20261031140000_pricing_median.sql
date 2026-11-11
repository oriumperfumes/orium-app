-- Precificação pelo PREÇO MÉDIO (mediana) dos fornecedores, não mais o mais barato.
-- Ex.: fornecedores a 200, 210 e 220 -> custo 210. Com dois preços, o ponto do meio.
-- Fornecedor "preferido" (supplier_product_preferences) continua mandando.
-- Mantém: só fornecedores com use_for_pricing, não inativos e não bloqueados;
-- primeiro os que têm estoque, e se nenhum tem, os ativos.
CREATE OR REPLACE FUNCTION public.recompute_product_pricing(p_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record; o record; best record; total_qty integer;
  base_retail numeric; base_wholesale numeric; src text; tier integer;
BEGIN
  IF p_product_id IS NULL THEN RETURN; END IF;
  SELECT source INTO src FROM public.products WHERE id = p_product_id;
  IF src = 'manual' THEN RETURN; END IF;

  SELECT * INTO s FROM public.pricing_settings WHERE id;
  SELECT * INTO o FROM public.pricing_overrides WHERE product_id = p_product_id;

  FOR tier IN 1..2 LOOP
    WITH c AS (
      SELECT sp.price, sp.supplier_id, coalesce(pf.mode = 'preferred', false) AS pref
        FROM public.supplier_products sp
        JOIN public.suppliers su ON su.id = sp.supplier_id
        LEFT JOIN public.supplier_product_preferences pf ON pf.product_id = p_product_id AND pf.supplier_id = sp.supplier_id
       WHERE sp.product_id = p_product_id AND sp.active AND sp.price IS NOT NULL
         AND (tier = 2 OR sp.in_stock)
         AND su.use_for_pricing AND su.priority <> 'inactive' AND coalesce(pf.mode,'') <> 'blocked'
    ),
    m AS (
      SELECT CASE WHEN bool_or(pref) THEN min(price) FILTER (WHERE pref)
                  ELSE round((percentile_cont(0.5) WITHIN GROUP (ORDER BY price::double precision))::numeric, 2)
             END AS price
        FROM c
    )
    SELECT m.price,
           (SELECT c.supplier_id FROM c ORDER BY c.pref DESC, abs(c.price - m.price), c.price LIMIT 1) AS supplier_id
      INTO best FROM m;
    EXIT WHEN best.price IS NOT NULL;
  END LOOP;

  SELECT sum(coalesce(sp.stock_quantity,0)) INTO total_qty
    FROM public.supplier_products sp
    JOIN public.suppliers su ON su.id = sp.supplier_id
    LEFT JOIN public.supplier_product_preferences pf ON pf.product_id = p_product_id AND pf.supplier_id = sp.supplier_id
    LEFT JOIN public.supplier_offer_catalog oc ON oc.supplier_product_id = sp.id
    WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock
      AND su.use_for_availability AND su.priority <> 'inactive' AND coalesce(pf.mode,'') <> 'blocked'
      AND public.supplier_offer_public(su.catalog_mode, oc.decision);

  INSERT INTO public.product_costs (product_id, best_cost, best_supplier_id, updated_at)
  VALUES (p_product_id, best.price, best.supplier_id, now())
  ON CONFLICT (product_id) DO UPDATE
    SET best_cost = EXCLUDED.best_cost, best_supplier_id = EXCLUDED.best_supplier_id, updated_at = now();

  base_retail := coalesce(o.fixed_retail_price, best.price + coalesce(o.retail_markup, s.retail_markup));
  base_wholesale := coalesce(o.fixed_wholesale_price, best.price + coalesce(o.wholesale_markup, s.wholesale_markup));

  UPDATE public.products p SET
    supplier_available = EXISTS (
      SELECT 1 FROM public.supplier_products sp
      JOIN public.suppliers su ON su.id = sp.supplier_id
      LEFT JOIN public.supplier_product_preferences pf ON pf.product_id = p_product_id AND pf.supplier_id = sp.supplier_id
      LEFT JOIN public.supplier_offer_catalog oc ON oc.supplier_product_id = sp.id
      WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock
        AND su.use_for_availability AND su.priority <> 'inactive' AND coalesce(pf.mode,'') <> 'blocked'
        AND public.supplier_offer_public(su.catalog_mode, oc.decision)),
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
$function$;
