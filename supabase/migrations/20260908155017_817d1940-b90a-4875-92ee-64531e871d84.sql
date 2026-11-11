ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS announce_title text,
  ADD COLUMN IF NOT EXISTS announce_message text,
  ADD COLUMN IF NOT EXISTS announce_cta text,
  ADD COLUMN IF NOT EXISTS announce_footnote text,
  ADD COLUMN IF NOT EXISTS announce_theme text NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS announce_reset_at timestamptz;

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS announce_title text,
  ADD COLUMN IF NOT EXISTS announce_message text,
  ADD COLUMN IF NOT EXISTS announce_cta text,
  ADD COLUMN IF NOT EXISTS announce_footnote text,
  ADD COLUMN IF NOT EXISTS announce_theme text NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS announce_reset_at timestamptz;

ALTER TABLE public.promotions
  ADD CONSTRAINT promotions_announce_theme_chk CHECK (announce_theme IN ('DEFAULT','PROMO','DECANT','FULL'));
ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_announce_theme_chk CHECK (announce_theme IN ('DEFAULT','PROMO','DECANT','FULL'));