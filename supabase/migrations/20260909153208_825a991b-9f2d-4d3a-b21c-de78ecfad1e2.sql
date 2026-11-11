UPDATE public.supplier_products sp
SET first_seen_source = 'backfill',
    first_seen_at = COALESCE(sp.source_updated_at, sp.first_seen_at)
FROM public.suppliers s
WHERE s.id = sp.supplier_id
  AND s.slug = 'smart-mania'
  AND sp.first_seen_source = 'detected'
  AND sp.first_seen_at > now() - interval '6 hours';