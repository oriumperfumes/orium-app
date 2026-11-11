ALTER TABLE public.catalog_orders
  ADD COLUMN IF NOT EXISTS expected_delivery_date date,
  ADD COLUMN IF NOT EXISTS expected_delivery_time time,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_notes text;

CREATE OR REPLACE FUNCTION public.catalog_orders_delivered_at_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'entregue' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'entregue') THEN
    NEW.delivered_at := COALESCE(NEW.delivered_at, now());
  ELSIF NEW.status IS DISTINCT FROM 'entregue' THEN
    NEW.delivered_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS catalog_orders_delivered_at ON public.catalog_orders;
CREATE TRIGGER catalog_orders_delivered_at BEFORE INSERT OR UPDATE OF status ON public.catalog_orders
FOR EACH ROW EXECUTE FUNCTION public.catalog_orders_delivered_at_sync();

CREATE INDEX IF NOT EXISTS catalog_orders_expected_delivery_idx ON public.catalog_orders (expected_delivery_date) WHERE deleted_at IS NULL;