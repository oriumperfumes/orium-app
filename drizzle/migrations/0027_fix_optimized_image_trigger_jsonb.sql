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
    IF jsonb_typeof(NEW.image_urls) = 'array' AND NEW.image_urls->>0 = NEW.image_url THEN
      NEW.image_urls := jsonb_set(NEW.image_urls, '{0}', to_jsonb(opt));
    END IF;
    NEW.image_url := opt;
  END IF;
  RETURN NEW;
END $$;