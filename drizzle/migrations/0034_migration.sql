
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'secondary',
  ADD COLUMN IF NOT EXISTS use_for_purchasing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS use_for_pricing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_in_comparison boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS use_for_availability boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_sync boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS creates_catalog_products boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS supply_mode text NOT NULL DEFAULT 'a_combinar',
  ADD COLUMN IF NOT EXISTS prep_days integer,
  ADD COLUMN IF NOT EXISTS transit_days integer,
  ADD COLUMN IF NOT EXISTS shipping_cost numeric,
  ADD COLUMN IF NOT EXISTS min_order numeric,
  ADD COLUMN IF NOT EXISTS operating_days text,
  ADD COLUMN IF NOT EXISTS pickup_schedule text,
  ADD COLUMN IF NOT EXISTS travel_cost numeric,
  ADD COLUMN IF NOT EXISTS logistics_notes text;

ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_priority_chk;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_priority_chk CHECK (priority IN ('preferred','secondary','reference','inactive'));
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_supply_mode_chk;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_supply_mode_chk CHECK (supply_mode IN ('pickup','carrier','supplier_delivery','a_combinar'));

CREATE TABLE IF NOT EXISTS public.supplier_product_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('preferred','blocked')),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, supplier_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_pref_one_preferred ON public.supplier_product_preferences(product_id) WHERE mode = 'preferred';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_product_preferences TO authenticated;
GRANT ALL ON public.supplier_product_preferences TO service_role;
ALTER TABLE public.supplier_product_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage supplier prefs" ON public.supplier_product_preferences FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.supplier_sync_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  run_id uuid,
  supplier_product_id uuid REFERENCES public.supplier_products(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('new','price_changed','unavailable','not_found','review')),
  product_name text,
  old_price numeric,
  new_price numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_sync_changes_sup_idx ON public.supplier_sync_changes(supplier_id, created_at DESC);
GRANT SELECT ON public.supplier_sync_changes TO authenticated;
GRANT ALL ON public.supplier_sync_changes TO service_role;
ALTER TABLE public.supplier_sync_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read supplier changes" ON public.supplier_sync_changes FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- Pricing/availability: only suppliers enabled for it; per-product block/preference wins.
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
    WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock
      AND su.use_for_availability AND su.priority <> 'inactive' AND coalesce(pf.mode,'') <> 'blocked';

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
      WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock
        AND su.use_for_availability AND su.priority <> 'inactive' AND coalesce(pf.mode,'') <> 'blocked'),
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

-- Recompute when supplier flags or per-product preferences change.
CREATE OR REPLACE FUNCTION public.supplier_flags_recompute()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'suppliers' THEN
    IF NEW.use_for_pricing IS DISTINCT FROM OLD.use_for_pricing
       OR NEW.use_for_availability IS DISTINCT FROM OLD.use_for_availability
       OR NEW.priority IS DISTINCT FROM OLD.priority THEN
      FOR pid IN SELECT DISTINCT product_id FROM public.supplier_products WHERE supplier_id = NEW.id AND product_id IS NOT NULL LOOP
        PERFORM public.recompute_product_pricing(pid);
      END LOOP;
    END IF;
    RETURN NEW;
  END IF;
  PERFORM public.recompute_product_pricing(coalesce(NEW.product_id, OLD.product_id));
  RETURN coalesce(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS suppliers_flags_recompute ON public.suppliers;
CREATE TRIGGER suppliers_flags_recompute AFTER UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.supplier_flags_recompute();
DROP TRIGGER IF EXISTS supplier_prefs_recompute ON public.supplier_product_preferences;
CREATE TRIGGER supplier_prefs_recompute AFTER INSERT OR UPDATE OR DELETE ON public.supplier_product_preferences
  FOR EACH ROW EXECUTE FUNCTION public.supplier_flags_recompute();
