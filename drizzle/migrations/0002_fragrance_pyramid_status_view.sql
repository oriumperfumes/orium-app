CREATE OR REPLACE VIEW public.fragrance_pyramid_status
WITH (security_invoker = true) AS
SELECT
  p.id AS product_id,
  COALESCE(d.status, 'pendente') AS status,
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