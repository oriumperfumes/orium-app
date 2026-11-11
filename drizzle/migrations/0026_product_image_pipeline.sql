CREATE TABLE IF NOT EXISTS public.product_image_cache (
  source_url text PRIMARY KEY,
  optimized_url text,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error')),
  original_bytes integer,
  optimized_bytes integer,
  card_bytes integer,
  thumb_bytes integer,
  width integer,
  height integer,
  processing_ms integer,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.product_image_cache TO service_role;
ALTER TABLE public.product_image_cache ENABLE ROW LEVEL SECURITY;

-- Toda gravação de image_url (sync, escolha manual, cadastro) passa por aqui:
-- se a foto de origem já foi otimizada, o público recebe a versão da Orium.
CREATE OR REPLACE FUNCTION public.products_use_optimized_image()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE opt text;
BEGIN
  IF NEW.image_url IS NULL OR NEW.image_url LIKE '/api/public/produto-foto%' THEN
    RETURN NEW;
  END IF;
  SELECT optimized_url INTO opt FROM public.product_image_cache
   WHERE source_url = NEW.image_url AND status = 'ok' AND optimized_url IS NOT NULL;
  IF opt IS NOT NULL THEN
    IF NEW.image_urls IS NOT NULL AND array_length(NEW.image_urls, 1) > 0 AND NEW.image_urls[1] = NEW.image_url THEN
      NEW.image_urls[1] := opt;
    END IF;
    NEW.image_url := opt;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS products_zz_optimized_image ON public.products;
CREATE TRIGGER products_zz_optimized_image
BEFORE INSERT OR UPDATE OF image_url, image_urls ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_use_optimized_image();