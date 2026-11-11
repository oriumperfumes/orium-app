-- Regra única: frasco lacrado no estoque da loja > 0 → Pronta entrega (override manual "available" também vale; "blocked" sempre vence).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ready_to_deliver boolean
  GENERATED ALWAYS AS (
    coalesce(availability_override, 'none') <> 'blocked'
    AND (coalesce(local_stock, 0) > 0 OR availability_override = 'available')
  ) STORED;
CREATE INDEX IF NOT EXISTS products_ready_to_deliver_idx ON public.products (id) WHERE ready_to_deliver;
COMMENT ON COLUMN public.products.ready_to_deliver IS 'Derivado: frasco lacrado local > 0 (ou override manual). Fonte única do selo Pronta entrega.';