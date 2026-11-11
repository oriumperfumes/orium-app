ALTER TABLE public.restock_items
  ADD COLUMN IF NOT EXISTS extra_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_locked boolean NOT NULL DEFAULT false;