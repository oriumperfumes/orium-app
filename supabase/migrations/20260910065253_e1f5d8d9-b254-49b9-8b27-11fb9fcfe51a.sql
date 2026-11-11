CREATE OR REPLACE FUNCTION public.fragrance_publicly_visible(p_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id AND p.active = true AND p.catalog_eligible = true
  ) OR EXISTS (
    SELECT 1 FROM public.negotiation_items ni
    WHERE ni.product_id = p_product_id
      AND (ni.status = 'AVAILABLE' OR (ni.status = 'NEGOTIATING' AND ni.show_when_negotiating))
  );
$$;

REVOKE ALL ON FUNCTION public.fragrance_publicly_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fragrance_publicly_visible(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS fragrance_details_public_read ON public.fragrance_details;
CREATE POLICY fragrance_details_public_read ON public.fragrance_details
  FOR SELECT TO anon, authenticated
  USING (public.fragrance_publicly_visible(product_id));

DROP POLICY IF EXISTS fragrance_notes_public_read ON public.fragrance_notes;
CREATE POLICY fragrance_notes_public_read ON public.fragrance_notes
  FOR SELECT TO anon, authenticated
  USING (public.fragrance_publicly_visible(product_id));

DROP POLICY IF EXISTS fragrance_accords_public_read ON public.fragrance_accords;
CREATE POLICY fragrance_accords_public_read ON public.fragrance_accords
  FOR SELECT TO anon, authenticated
  USING (public.fragrance_publicly_visible(product_id));