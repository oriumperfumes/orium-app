CREATE TABLE public.brand_segment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'brand' CHECK (kind IN ('brand','line')),
  segment text NOT NULL CHECK (segment IN ('ARABIC','DESIGNER','NICHE','UNKNOWN')),
  target_brand text,
  source text NOT NULL DEFAULT 'seed',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_segment_rules TO authenticated;
GRANT ALL ON public.brand_segment_rules TO service_role;
ALTER TABLE public.brand_segment_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff brand rules" ON public.brand_segment_rules FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS public_visible boolean NOT NULL DEFAULT true;
UPDATE public.products SET public_visible = (active AND catalog_eligible);

ALTER TABLE public.sync_runs ADD COLUMN IF NOT EXISTS eligible_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.sync_runs ADD COLUMN IF NOT EXISTS hidden_segment_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.sync_runs ADD COLUMN IF NOT EXISTS brand_review_count integer NOT NULL DEFAULT 0;

-- Etapa de ELEGIBILIDADE: roda depois da identidade, a partir da marca + categoria.
CREATE OR REPLACE FUNCTION public.apply_catalog_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  seg text;
  brand_reasons text[] := ARRAY['marca-designer-fora-do-posicionamento','marca-nicho-fora-do-posicionamento','marca-em-revisao'];
BEGIN
  SELECT segment INTO seg FROM public.brands WHERE id = NEW.brand_id;
  seg := coalesce(seg, 'UNKNOWN');

  IF NEW.product_type = 'PERFUME' AND seg IN ('DESIGNER','NICHE') THEN
    NEW.catalog_eligible := false;
    NEW.catalog_eligibility_reason := CASE WHEN seg = 'DESIGNER'
      THEN 'marca-designer-fora-do-posicionamento' ELSE 'marca-nicho-fora-do-posicionamento' END;
  ELSIF coalesce(NEW.catalog_eligibility_reason,'') = ANY(brand_reasons) THEN
    IF NEW.product_type <> 'PERFUME' OR seg = 'ARABIC' THEN
      NEW.catalog_eligible := true;
      NEW.catalog_eligibility_reason := CASE WHEN NEW.product_type = 'PERFUME' THEN 'perfume' ELSE lower(NEW.product_type) END;
    ELSE
      NEW.catalog_eligible := false;
      NEW.catalog_eligibility_reason := 'marca-em-revisao';
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.product_type = 'PERFUME' AND seg = 'UNKNOWN' AND NEW.catalog_eligible THEN
    NEW.catalog_eligible := false;
    NEW.catalog_eligibility_reason := 'marca-em-revisao';
  END IF;

  NEW.public_visible := coalesce(NEW.active,false) AND coalesce(NEW.catalog_eligible,false);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_catalog_eligibility ON public.products;
CREATE TRIGGER trg_catalog_eligibility
BEFORE INSERT OR UPDATE OF brand_id, product_type, active, catalog_eligible, catalog_eligibility_reason
ON public.products FOR EACH ROW EXECUTE FUNCTION public.apply_catalog_eligibility();

CREATE OR REPLACE FUNCTION public.brand_segment_reprocess()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.segment IS DISTINCT FROM OLD.segment THEN
    UPDATE public.products SET brand_id = brand_id WHERE brand_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_brand_segment_reprocess ON public.brands;
CREATE TRIGGER trg_brand_segment_reprocess AFTER UPDATE OF segment ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.brand_segment_reprocess();