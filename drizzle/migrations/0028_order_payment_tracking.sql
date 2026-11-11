ALTER TABLE public.catalog_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_due numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_percent numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE OR REPLACE FUNCTION public.catalog_orders_payment_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE t numeric;
BEGIN
  t := round(coalesce(NEW.final_total, NEW.grand_total, NEW.sales_total, 0)::numeric, 2);
  NEW.amount_paid := round(greatest(coalesce(NEW.amount_paid, 0), 0)::numeric, 2);
  NEW.amount_due := greatest(t - NEW.amount_paid, 0);
  NEW.payment_status := CASE
    WHEN NEW.amount_paid <= 0 THEN 'unpaid'
    WHEN NEW.amount_paid >= t THEN 'paid'
    ELSE 'partial' END;
  IF NEW.payment_status = 'paid' AND NEW.paid_at IS NULL THEN NEW.paid_at := now(); END IF;
  IF NEW.payment_status <> 'paid' THEN NEW.paid_at := NULL; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS catalog_orders_payment_sync ON public.catalog_orders;
CREATE TRIGGER catalog_orders_payment_sync
BEFORE INSERT OR UPDATE ON public.catalog_orders
FOR EACH ROW EXECUTE FUNCTION public.catalog_orders_payment_sync();

UPDATE public.catalog_orders SET amount_paid = amount_paid;

CREATE INDEX IF NOT EXISTS catalog_orders_payment_idx ON public.catalog_orders (payment_status) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.admin_payment_summary(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT jsonb_build_object(
    'received', coalesce((SELECT sum((e.details->>'amount')::numeric) FROM public.order_events e
       JOIN public.catalog_orders o ON o.id = e.order_id AND o.deleted_at IS NULL
       WHERE e.event LIKE 'pagamento_%' AND e.created_at >= p_from AND e.created_at < p_to), 0),
    'receivable', coalesce((SELECT sum(amount_due) FROM public.catalog_orders
       WHERE deleted_at IS NULL AND canceled_at IS NULL AND status <> 'cancelado' AND amount_paid > 0 AND amount_due > 0), 0),
    'receivable_orders', (SELECT count(*) FROM public.catalog_orders
       WHERE deleted_at IS NULL AND canceled_at IS NULL AND status <> 'cancelado' AND amount_paid > 0 AND amount_due > 0)
  ) INTO r;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_payment_summary(timestamptz, timestamptz) TO authenticated;