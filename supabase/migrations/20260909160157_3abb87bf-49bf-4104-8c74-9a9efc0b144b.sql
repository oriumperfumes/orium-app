ALTER TABLE public.pricing_settings
  ADD COLUMN IF NOT EXISTS pix_discount_percent numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS pix_discount_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.catalog_orders
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'PIX',
  ADD COLUMN IF NOT EXISTS payment_discount_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pix_total numeric,
  ADD COLUMN IF NOT EXISTS card_total numeric,
  ADD COLUMN IF NOT EXISTS final_total numeric;

ALTER TABLE public.catalog_orders
  DROP CONSTRAINT IF EXISTS catalog_orders_payment_method_check;
ALTER TABLE public.catalog_orders
  ADD CONSTRAINT catalog_orders_payment_method_check CHECK (payment_method IN ('PIX', 'CARD'));

UPDATE public.catalog_orders
SET pix_total = COALESCE(pix_total, grand_total, sales_total),
    final_total = COALESCE(final_total, grand_total, sales_total)
WHERE pix_total IS NULL OR final_total IS NULL;