ALTER TABLE public.fragrance_details
  ADD COLUMN IF NOT EXISTS fragrantica_url text,
  ADD COLUMN IF NOT EXISTS fragrantica_match_confidence numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audit_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS audited_at timestamptz;

CREATE TABLE IF NOT EXISTS public.fragrance_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  fragrantica_url text,
  match_confidence numeric NOT NULL DEFAULT 0,
  status text NOT NULL,
  changed boolean NOT NULL DEFAULT false,
  before jsonb NOT NULL DEFAULT '{}'::jsonb,
  after jsonb NOT NULL DEFAULT '{}'::jsonb,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fragrance_audit_log_product_idx ON public.fragrance_audit_log (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fragrance_audit_log_created_idx ON public.fragrance_audit_log (created_at DESC);

GRANT SELECT ON public.fragrance_audit_log TO authenticated;
GRANT ALL ON public.fragrance_audit_log TO service_role;

ALTER TABLE public.fragrance_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read fragrance audit log" ON public.fragrance_audit_log;
CREATE POLICY "staff read fragrance audit log"
ON public.fragrance_audit_log
FOR SELECT
TO authenticated
USING (public.is_staff(auth.uid()));

DROP VIEW IF EXISTS public.fragrance_pyramid_status;

CREATE VIEW public.fragrance_pyramid_status
WITH (security_invoker = true) AS
SELECT
  p.id AS product_id,
  COALESCE(d.status, 'pendente') AS status,
  COALESCE(d.audit_status, 'PENDING') AS audit_status,
  d.fragrantica_url,
  COALESCE(d.fragrantica_match_confidence, 0) AS match_confidence,
  d.audited_at,
  COALESCE(d.locked, false) AS locked,
  COALESCE(d.verified, false) AS verified,
  d.confidence,
  d.enriched_at,
  (d.description IS NOT NULL AND length(btrim(d.description)) > 20) AS has_description,
  COALESCE(a.accords, 0) AS accords_count,
  COALESCE(n.top_count, 0) AS top_count,
  COALESCE(n.heart_count, 0) AS heart_count,
  COALESCE(n.base_count, 0) AS base_count,
  COALESCE(n.without_image, 0) AS notes_without_image
FROM public.products p
LEFT JOIN public.fragrance_details d ON d.product_id = p.id
LEFT JOIN LATERAL (
  SELECT count(*)::int AS accords FROM public.fragrance_accords fa WHERE fa.product_id = p.id
) a ON true
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE fn.pyramid_level = 'TOP')::int AS top_count,
    count(*) FILTER (WHERE fn.pyramid_level = 'HEART')::int AS heart_count,
    count(*) FILTER (WHERE fn.pyramid_level = 'BASE')::int AS base_count,
    count(*) FILTER (WHERE o.image_url IS NULL)::int AS without_image
  FROM public.fragrance_notes fn
  LEFT JOIN public.olfactory_notes o ON o.id = fn.note_id
  WHERE fn.product_id = p.id
) n ON true
WHERE p.product_type = 'PERFUME';

GRANT SELECT ON public.fragrance_pyramid_status TO authenticated;
GRANT SELECT ON public.fragrance_pyramid_status TO anon;
GRANT SELECT ON public.fragrance_pyramid_status TO service_role;