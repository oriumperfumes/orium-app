ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS catalog_excluded_manually boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.catalog_excluded_manually IS
  'Decisão manual do painel: produto nunca deve voltar ao catálogo público, mesmo após sincronização ou limpeza automática.';

UPDATE public.products
   SET catalog_excluded_manually = true
 WHERE catalog_eligibility_reason = 'excluido-manualmente';

CREATE INDEX IF NOT EXISTS products_catalog_excluded_manually_idx
  ON public.products (catalog_excluded_manually)
  WHERE catalog_excluded_manually;