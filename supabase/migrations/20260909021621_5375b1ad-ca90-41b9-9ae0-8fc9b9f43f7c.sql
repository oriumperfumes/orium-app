-- consolida duplicados por (user_id, product_id), mantendo o registro mais antigo
DELETE FROM public.favorites f
USING public.favorites keep
WHERE f.user_id = keep.user_id
  AND f.product_id = keep.product_id
  AND (keep.created_at, keep.id) < (f.created_at, f.id);

CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_product_key
  ON public.favorites (user_id, product_id);

-- favorito é do perfume, não da variante: a marcação de decant deixa de ser usada
ALTER TABLE public.favorites ALTER COLUMN want_decant SET DEFAULT false;
UPDATE public.favorites SET want_decant = false WHERE want_decant;