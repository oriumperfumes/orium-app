ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS payment_discount_percent numeric(5,2) NOT NULL DEFAULT 0;

ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS raw_supplier_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS normalized_cost numeric(10,2),
  ADD COLUMN IF NOT EXISTS cost_source text,
  ADD COLUMN IF NOT EXISTS cost_captured_at timestamptz;

ALTER TABLE public.pricing_settings
  ADD COLUMN IF NOT EXISTS psych_pricing_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS psych_strategy text NOT NULL DEFAULT 'ends_90',
  ADD COLUMN IF NOT EXISTS psych_max_reduction numeric(10,2) NOT NULL DEFAULT 0.10;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS base_retail_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS base_wholesale_price numeric(10,2);