ALTER TABLE public.negotiation_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS negotiation_items_product_id_idx ON public.negotiation_items(product_id);