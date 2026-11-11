ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS app_exclusive boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS app_badge_label text;

UPDATE public.promotions SET app_exclusive = true WHERE app_exclusive IS DISTINCT FROM true;