-- Recalcula rapidamente os preços usando o custo apurado da fonte oficial,
-- sem reconsultar ~700 ofertas uma a uma. Nenhum produto manual é alterado.
-- Essa função exige sessão autenticada da equipe e é usada na edição de margens.
CREATE OR REPLACE FUNCTION public.bulk_reprice_from_cached_costs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_changed integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para atualizar preços.';
  END IF;

  WITH proposed AS (
    SELECT p.id,
      round(coalesce(o.fixed_retail_price, c.best_cost + coalesce(o.retail_markup,s.retail_markup)), 2) AS new_base_retail,
      round(coalesce(o.fixed_wholesale_price, c.best_cost + coalesce(o.wholesale_markup,s.wholesale_markup)), 2) AS new_base_wholesale,
      CASE WHEN o.fixed_retail_price IS NOT NULL
        THEN round(o.fixed_retail_price,2)
        ELSE public.commercial_price(c.best_cost + coalesce(o.retail_markup,s.retail_markup),s.psych_pricing_active,s.psych_max_reduction)
      END AS new_retail,
      CASE WHEN o.fixed_wholesale_price IS NOT NULL
        THEN round(o.fixed_wholesale_price,2)
        ELSE public.commercial_price(c.best_cost + coalesce(o.wholesale_markup,s.wholesale_markup),s.psych_pricing_active,s.psych_max_reduction)
      END AS new_wholesale
    FROM public.products p
    JOIN public.product_costs c ON c.product_id=p.id
    CROSS JOIN public.pricing_settings s
    LEFT JOIN public.pricing_overrides o ON o.product_id=p.id
    WHERE s.id IS TRUE AND p.manual_pricing IS FALSE AND p.source <> 'manual'
      AND c.best_cost IS NOT NULL
  )
  UPDATE public.products p
  SET base_retail_price = x.new_base_retail,
      base_wholesale_price = x.new_base_wholesale,
      retail_price = x.new_retail,
      wholesale_price = x.new_wholesale,
      updated_at = now()
  FROM proposed x
  WHERE p.id=x.id
    AND (p.base_retail_price IS DISTINCT FROM x.new_base_retail
      OR p.base_wholesale_price IS DISTINCT FROM x.new_base_wholesale
      OR p.retail_price IS DISTINCT FROM x.new_retail
      OR p.wholesale_price IS DISTINCT FROM x.new_wholesale);
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$function$;
REVOKE ALL ON FUNCTION public.bulk_reprice_from_cached_costs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_reprice_from_cached_costs() TO authenticated;
