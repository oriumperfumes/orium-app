ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS image_manual_url text,
  ADD COLUMN IF NOT EXISTS image_source_supplier_id uuid,
  ADD COLUMN IF NOT EXISTS image_source_offer_id uuid,
  ADD COLUMN IF NOT EXISTS image_manual_broken boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_manual_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS image_manual_set_by uuid;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_image_mode_chk;
ALTER TABLE public.products ADD CONSTRAINT products_image_mode_chk CHECK (image_mode IN ('auto','supplier','upload'));

COMMENT ON COLUMN public.products.image_mode IS 'auto = sync decide; supplier = foto de fornecedor escolhida pelo Admin; upload = foto enviada pelo Admin. Manual sempre vence a sync.';

-- Escolha manual do Admin sempre vence: qualquer escrita (sync, dedupe, merge) é corrigida aqui.
CREATE OR REPLACE FUNCTION public.products_enforce_manual_image()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.image_mode <> 'auto' AND NEW.image_manual_url IS NOT NULL AND NOT NEW.image_manual_broken THEN
    NEW.image_url := NEW.image_manual_url;
    NEW.image_urls := jsonb_build_array(NEW.image_manual_url) || COALESCE(
      (SELECT jsonb_agg(v) FROM jsonb_array_elements(COALESCE(NEW.image_urls,'[]'::jsonb)) v
        WHERE v <> to_jsonb(NEW.image_manual_url)), '[]'::jsonb);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS products_enforce_manual_image ON public.products;
CREATE TRIGGER products_enforce_manual_image
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_enforce_manual_image();