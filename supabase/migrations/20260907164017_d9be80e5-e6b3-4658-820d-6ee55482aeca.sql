CREATE TABLE public.fragrantica_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  url text,
  http_status integer,
  parser_version text NOT NULL,
  strategy_used text,
  strategies jsonb NOT NULL DEFAULT '[]'::jsonb,
  accords_found integer NOT NULL DEFAULT 0,
  notes_found integer NOT NULL DEFAULT 0,
  structure text NOT NULL DEFAULT 'NONE',
  status text NOT NULL,
  completeness integer NOT NULL DEFAULT 0,
  match_confidence integer,
  duration_ms integer,
  applied boolean NOT NULL DEFAULT false,
  quality_before integer,
  quality_after integer,
  blocked_reason text,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fragrantica_import_logs_product_idx ON public.fragrantica_import_logs (product_id, created_at DESC);
CREATE INDEX fragrantica_import_logs_created_idx ON public.fragrantica_import_logs (created_at DESC);

GRANT SELECT ON public.fragrantica_import_logs TO authenticated;
GRANT ALL ON public.fragrantica_import_logs TO service_role;

ALTER TABLE public.fragrantica_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read import logs" ON public.fragrantica_import_logs
FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()));