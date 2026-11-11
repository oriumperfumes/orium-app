ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS allow_perfumes boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS segment_source text,
  ADD COLUMN IF NOT EXISTS segment_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS segment_updated_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.brands ADD CONSTRAINT brands_segment_check
    CHECK (segment IN ('ARABIC','DESIGNER','NICHE','UNKNOWN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS identity_key text,
  ADD COLUMN IF NOT EXISTS image_signature text;

CREATE INDEX IF NOT EXISTS products_identity_key_idx ON public.products (identity_key);
CREATE INDEX IF NOT EXISTS products_image_signature_idx ON public.products (image_signature);

ALTER TABLE public.product_duplicates
  ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'REVIEW_REQUIRED',
  ADD COLUMN IF NOT EXISTS signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.product_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merged_product_id uuid NOT NULL,
  canonical_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  identity_key text,
  dedupe_key text,
  merged_slug text,
  merged_name text,
  score numeric NOT NULL DEFAULT 1,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_merges_merged_idx ON public.product_merges (merged_product_id);
CREATE INDEX IF NOT EXISTS product_merges_identity_idx ON public.product_merges (identity_key);
CREATE INDEX IF NOT EXISTS product_merges_dedupe_idx ON public.product_merges (dedupe_key);

GRANT SELECT ON public.product_merges TO authenticated;
GRANT ALL ON public.product_merges TO service_role;

ALTER TABLE public.product_merges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Equipe ve unificacoes" ON public.product_merges
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));