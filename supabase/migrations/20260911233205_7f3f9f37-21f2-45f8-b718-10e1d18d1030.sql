ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'supplier',
  ADD COLUMN IF NOT EXISTS sale_mode text NOT NULL DEFAULT 'BOTH',
  ADD COLUMN IF NOT EXISTS full_bottle_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS manual_pricing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_cost numeric,
  ADD COLUMN IF NOT EXISTS visibility_status text NOT NULL DEFAULT 'ATIVO';

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sale_mode_check;
ALTER TABLE public.products ADD CONSTRAINT products_sale_mode_check CHECK (sale_mode IN ('DECANT','FULL','BOTH'));
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_visibility_status_check;
ALTER TABLE public.products ADD CONSTRAINT products_visibility_status_check CHECK (visibility_status IN ('ATIVO','OCULTO','INDISPONIVEL'));
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_source_check;
ALTER TABLE public.products ADD CONSTRAINT products_source_check CHECK (source IN ('supplier','manual'));

GRANT SELECT (sale_mode, full_bottle_available, source) ON public.products TO anon;
GRANT SELECT ON public.products TO authenticated;

CREATE OR REPLACE FUNCTION public.products_sale_mode_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sale_mode = 'DECANT' THEN
    NEW.decant_available := true;
    NEW.full_bottle_available := false;
  ELSIF NEW.sale_mode = 'FULL' THEN
    NEW.decant_available := false;
    NEW.full_bottle_available := true;
  ELSE
    NEW.full_bottle_available := true;
  END IF;

  IF NEW.source = 'manual' THEN
    IF NEW.visibility_status = 'OCULTO' THEN
      NEW.active := false;
    ELSIF NEW.visibility_status = 'INDISPONIVEL' THEN
      NEW.active := true;
      NEW.in_stock := false;
    ELSE
      NEW.active := true;
      IF NEW.sale_mode = 'DECANT' THEN
        NEW.in_stock := true;
      ELSE
        NEW.in_stock := coalesce(NEW.stock_quantity, 0) > 0;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_sale_mode_sync_trg ON public.products;
CREATE TRIGGER products_sale_mode_sync_trg
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_sale_mode_sync();

CREATE OR REPLACE FUNCTION public.recompute_product_pricing(p_product_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record; o record; best record; total_qty integer;
  base_retail numeric; base_wholesale numeric; src text;
BEGIN
  IF p_product_id IS NULL THEN RETURN; END IF;
  -- Produto cadastrado manualmente pela Orium: preço e estoque são definidos no
  -- painel e nunca podem ser recalculados a partir de ofertas de fornecedor.
  SELECT source INTO src FROM public.products WHERE id = p_product_id;
  IF src = 'manual' THEN RETURN; END IF;

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
$function$;

-- Lista pública mínima: quais produtos NÃO vendem das duas formas.
CREATE OR REPLACE FUNCTION public.public_sale_modes()
RETURNS TABLE(product_id uuid, sale_mode text, full_bottle_available boolean, decant_available boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.sale_mode, p.full_bottle_available, p.decant_available
  FROM public.products p
  WHERE p.active AND p.sale_mode <> 'BOTH'
$$;

GRANT EXECUTE ON FUNCTION public.public_sale_modes() TO anon, authenticated;