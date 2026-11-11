CREATE TABLE public.identity_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  v3_enabled boolean NOT NULL DEFAULT false,
  engine_version text NOT NULL DEFAULT 'v3.0',
  max_new_canonical_ratio numeric NOT NULL DEFAULT 0.15,
  max_auto_merges_per_run integer NOT NULL DEFAULT 50,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.identity_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE public.supplier_raw_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  supplier_product_id uuid REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  supplier_sku text,
  title text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_hash text NOT NULL,
  attributes jsonb,
  engine_version text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, raw_hash)
);
CREATE INDEX ON public.supplier_raw_items (supplier_product_id);

CREATE TABLE public.identity_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_product_id uuid NOT NULL UNIQUE REFERENCES public.supplier_products(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('AUTO_MATCHED','REVIEW_REQUIRED','NEW_CANONICAL','MANUALLY_MATCHED','MANUALLY_SEPARATED','BLOCKED','ERROR')),
  score numeric,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  attributes jsonb,
  engine_version text NOT NULL DEFAULT 'v3.0',
  decided_by uuid,
  decided_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.identity_mappings (product_id);
CREATE INDEX ON public.identity_mappings (state);

CREATE TABLE public.identity_negative_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_a uuid NOT NULL,
  product_b uuid NOT NULL,
  reason text,
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (product_a < product_b),
  UNIQUE (product_a, product_b)
);

CREATE TABLE public.identity_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('POSSIBLE_DUPLICATE_CANONICAL','CANONICAL_INCONSISTENCY','UNMATCHED_OFFER','MISSING_BRAND')),
  product_a uuid,
  product_b uuid,
  supplier_product_id uuid,
  recommendation text NOT NULL CHECK (recommendation IN ('SAME','DIFFERENT','REVIEW','LINK','NEW')),
  score numeric,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed','later')),
  resolution text,
  pair_key text NOT NULL,
  run_id uuid,
  engine_version text NOT NULL DEFAULT 'v3.0',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, pair_key)
);
CREATE INDEX ON public.identity_review_items (status, kind);

CREATE TABLE public.identity_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('dry_run','audit','apply','sync')),
  status text NOT NULL DEFAULT 'running',
  engine_version text NOT NULL DEFAULT 'v3.0',
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  anomaly text,
  started_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE public.identity_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.identity_runs(id) ON DELETE SET NULL,
  label text NOT NULL,
  data jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.identity_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('merge','split','link','unlink','undo')),
  source_product_ids uuid[] NOT NULL DEFAULT '{}',
  target_product_id uuid,
  reason text,
  score numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reverted_at timestamptz,
  reverted_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.product_field_provenance (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  field text NOT NULL,
  source text NOT NULL,
  locked boolean NOT NULL DEFAULT false,
  value jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, field)
);

CREATE TABLE public.catalog_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_type text NOT NULL CHECK (alias_type IN ('brand','product','supplier','voice','search')),
  alias text NOT NULL,
  alias_key text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE CASCADE,
  confirmations integer NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alias_type, alias_key, product_id, brand_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['identity_settings','supplier_raw_items','identity_mappings','identity_negative_pairs','identity_review_items','identity_runs','identity_snapshots','identity_merge_log','product_field_provenance','catalog_aliases'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "staff only" ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))', t);
  END LOOP;
END $$;