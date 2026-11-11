ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS catalog_mode text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS origin_cep text,
  ADD COLUMN IF NOT EXISTS freight_services text,
  ADD COLUMN IF NOT EXISTS pkg_height_cm numeric,
  ADD COLUMN IF NOT EXISTS pkg_width_cm numeric,
  ADD COLUMN IF NOT EXISTS pkg_length_cm numeric,
  ADD COLUMN IF NOT EXISTS unit_weight_g numeric,
  ADD COLUMN IF NOT EXISTS units_per_package integer,
  ADD COLUMN IF NOT EXISTS declared_value numeric,
  ADD COLUMN IF NOT EXISTS min_margin_pct numeric,
  ADD COLUMN IF NOT EXISTS freight_cost_affects_pricing boolean NOT NULL DEFAULT false;
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_catalog_mode_chk;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_catalog_mode_chk CHECK (catalog_mode IN ('all','selected','none'));

ALTER TABLE public.shipping_settings ADD COLUMN IF NOT EXISTS receiving_cep text;
ALTER TABLE public.purchase_settings
  ADD COLUMN IF NOT EXISTS min_margin_pct numeric,
  ADD COLUMN IF NOT EXISTS block_below_margin boolean NOT NULL DEFAULT false;

-- Per-offer public catalog decision (survives re-linking; sync never writes here).
CREATE TABLE IF NOT EXISTS public.supplier_offer_catalog (
  supplier_product_id uuid PRIMARY KEY REFERENCES public.supplier_products(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('allow','deny')),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_offer_catalog_sup_idx ON public.supplier_offer_catalog(supplier_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_offer_catalog TO authenticated;
GRANT ALL ON public.supplier_offer_catalog TO service_role;
ALTER TABLE public.supplier_offer_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage offer catalog" ON public.supplier_offer_catalog FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.supplier_freight_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('superfrete','supplier')),
  status text NOT NULL DEFAULT 'estimated' CHECK (status IN ('estimated','confirmed')),
  origin_cep text,
  destination_cep text,
  units integer,
  weight_kg numeric,
  service text,
  carrier text,
  price numeric NOT NULL,
  days integer,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_freight_quotes_sup_idx ON public.supplier_freight_quotes(supplier_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_freight_quotes TO authenticated;
GRANT ALL ON public.supplier_freight_quotes TO service_role;
ALTER TABLE public.supplier_freight_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage freight quotes" ON public.supplier_freight_quotes FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.supplier_offer_public(p_mode text, p_decision text)
 RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE coalesce(p_decision,'') WHEN 'allow' THEN true WHEN 'deny' THEN false ELSE coalesce(p_mode,'all') = 'all' END
$$;

CREATE OR REPLACE FUNCTION public.recompute_product_pricing(p_product_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  s record; o record; best record; total_qty integer;
  base_retail numeric; base_wholesale numeric; src text;
BEGIN
  IF p_product_id IS NULL THEN RETURN; END IF;
  SELECT source INTO src FROM public.products WHERE id = p_product_id;
  IF src = 'manual' THEN RETURN; END IF;

  SELECT * INTO s FROM public.pricing_settings WHERE id;
  SELECT * INTO o FROM public.pricing_overrides WHERE product_id = p_product_id;

  SELECT sp.price, sp.supplier_id INTO best
    FROM public.supplier_products sp
    JOIN public.suppliers su ON su.id = sp.supplier_id
    LEFT JOIN public.supplier_product_preferences pf ON pf.product_id = p_product_id AND pf.supplier_id = sp.supplier_id
    WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock AND sp.price IS NOT NULL
      AND su.use_for_pricing AND su.priority <> 'inactive' AND coalesce(pf.mode,'') <> 'blocked'
    ORDER BY (pf.mode = 'preferred') DESC NULLS LAST, sp.price ASC LIMIT 1;
  IF best.price IS NULL THEN
    SELECT sp.price, sp.supplier_id INTO best
      FROM public.supplier_products sp
      JOIN public.suppliers su ON su.id = sp.supplier_id
      LEFT JOIN public.supplier_product_preferences pf ON pf.product_id = p_product_id AND pf.supplier_id = sp.supplier_id
      WHERE sp.product_id = p_product_id AND sp.active AND sp.price IS NOT NULL
        AND su.use_for_pricing AND su.priority <> 'inactive' AND coalesce(pf.mode,'') <> 'blocked'
      ORDER BY (pf.mode = 'preferred') DESC NULLS LAST, sp.price ASC LIMIT 1;
  END IF;
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

CREATE OR REPLACE FUNCTION public.supplier_flags_recompute()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'suppliers' THEN
    IF NEW.use_for_pricing IS DISTINCT FROM OLD.use_for_pricing
       OR NEW.use_for_availability IS DISTINCT FROM OLD.use_for_availability
       OR NEW.catalog_mode IS DISTINCT FROM OLD.catalog_mode
       OR NEW.priority IS DISTINCT FROM OLD.priority THEN
      FOR pid IN SELECT DISTINCT product_id FROM public.supplier_products WHERE supplier_id = NEW.id AND product_id IS NOT NULL LOOP
        PERFORM public.recompute_product_pricing(pid);
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'supplier_offer_catalog' THEN
    SELECT product_id INTO pid FROM public.supplier_products WHERE id = coalesce(NEW.supplier_product_id, OLD.supplier_product_id);
    PERFORM public.recompute_product_pricing(pid);
    RETURN coalesce(NEW, OLD);
  END IF;
  PERFORM public.recompute_product_pricing(coalesce(NEW.product_id, OLD.product_id));
  RETURN coalesce(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS supplier_offer_catalog_recompute ON public.supplier_offer_catalog;
CREATE TRIGGER supplier_offer_catalog_recompute AFTER INSERT OR UPDATE OR DELETE ON public.supplier_offer_catalog
  FOR EACH ROW EXECUTE FUNCTION public.supplier_flags_recompute();