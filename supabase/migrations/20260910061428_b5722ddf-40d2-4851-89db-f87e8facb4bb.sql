-- 1) pricing_settings: remove public read, keep staff-only read
DROP POLICY IF EXISTS "anyone reads pricing settings" ON public.pricing_settings;
REVOKE SELECT ON public.pricing_settings FROM anon;

CREATE POLICY "staff reads pricing settings"
  ON public.pricing_settings FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

-- 2) storefront-safe subset
CREATE OR REPLACE FUNCTION public.public_pricing_settings()
RETURNS TABLE(
  wholesale_min_quantity integer,
  pix_discount_percent numeric,
  pix_discount_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.wholesale_min_quantity, s.pix_discount_percent, s.pix_discount_active
  FROM public.pricing_settings s
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.public_pricing_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_pricing_settings() TO anon, authenticated, service_role;

-- 3) tighten overly broad EXECUTE grants on public RPCs
REVOKE ALL ON FUNCTION public.public_coupons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_coupons() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.public_promotions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_promotions() TO anon, authenticated, service_role;