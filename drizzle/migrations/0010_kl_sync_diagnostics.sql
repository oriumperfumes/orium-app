ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS sync_stage text,
  ADD COLUMN IF NOT EXISTS sync_error_code text,
  ADD COLUMN IF NOT EXISTS consecutive_sync_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS circuit_open_until timestamptz,
  ADD COLUMN IF NOT EXISTS current_sync_run_id uuid,
  ADD COLUMN IF NOT EXISTS last_health_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_health_check jsonb;

ALTER TABLE public.sync_runs
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS raw_products integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parsed_products integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_products integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS matched_products integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_products integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ignored_products integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS response_meta jsonb,
  ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS availability_status text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS supplier_promotional_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS raw_payload_hash text;

UPDATE public.supplier_products
SET availability_status = CASE WHEN in_stock THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END
WHERE availability_status = 'UNKNOWN';

CREATE INDEX IF NOT EXISTS sync_runs_supplier_started_idx
  ON public.sync_runs (supplier_id, started_at DESC);
CREATE INDEX IF NOT EXISTS supplier_products_supplier_external_idx
  ON public.supplier_products (supplier_id, supplier_sku);

CREATE TABLE public.supplier_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.sync_runs(id) ON DELETE CASCADE NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE CASCADE NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  stage text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  code text,
  message text NOT NULL,
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_meta jsonb
);

GRANT SELECT ON public.supplier_sync_events TO authenticated;
GRANT ALL ON public.supplier_sync_events TO service_role;
ALTER TABLE public.supplier_sync_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read supplier sync events"
  ON public.supplier_sync_events FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

COMMENT ON TABLE public.supplier_sync_events IS 'Limited technical diagnostics for supplier synchronization runs; admin-only.';
COMMENT ON COLUMN public.supplier_sync_events.response_meta IS 'Safe bounded response metadata/sample; never full catalog payloads.';