ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS pickup_address text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS opening_hours text,
  ADD COLUMN IF NOT EXISTS allows_pickup boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS adapter_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS update_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS ingestion_stats jsonb;

ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS offer_source text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS manual_lock boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS link_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS link_decided_by uuid,
  ADD COLUMN IF NOT EXISTS stock_reliable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_data jsonb;

ALTER TABLE public.restock_items
  ADD COLUMN IF NOT EXISTS manual_choice boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comparison_id uuid;

CREATE TABLE IF NOT EXISTS public.purchase_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  origin_address text,
  origin_latitude double precision,
  origin_longitude double precision,
  return_to_origin boolean NOT NULL DEFAULT true,
  cost_per_km numeric,
  fuel_km_per_liter numeric,
  fuel_price numeric,
  stale_after_hours integer NOT NULL DEFAULT 24,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.purchase_settings TO authenticated;
GRANT ALL ON public.purchase_settings TO service_role;
ALTER TABLE public.purchase_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage purchase settings" ON public.purchase_settings
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
INSERT INTO public.purchase_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.purchase_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_text text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  chosen_option text,
  applied_to_restock_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.purchase_comparisons TO authenticated;
GRANT ALL ON public.purchase_comparisons TO service_role;
ALTER TABLE public.purchase_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage purchase comparisons" ON public.purchase_comparisons
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

ALTER TABLE public.supplier_price_history
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'auto';
CREATE INDEX IF NOT EXISTS supplier_price_history_offer_idx ON public.supplier_price_history (supplier_product_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS supplier_products_product_idx ON public.supplier_products (product_id);