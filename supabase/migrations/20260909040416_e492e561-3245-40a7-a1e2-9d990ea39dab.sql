-- 1. Profile update: add WITH CHECK so id cannot be reassigned
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "own profile update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 2. Revoke EXECUTE on SECURITY DEFINER functions that must not be callable via the API
REVOKE ALL ON FUNCTION public.recompute_all_pricing() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_product_pricing(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.supplier_products_after_change() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_sync_order_customer() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_abandoned_carts(integer) FROM anon, authenticated;

-- 3. Admin-only reporting: not for anonymous visitors
REVOKE ALL ON FUNCTION public.admin_top_viewed(integer, integer) FROM anon;

-- 4. Role helpers: only needed by signed-in policy evaluation
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_profile() FROM anon;

GRANT EXECUTE ON FUNCTION public.recompute_all_pricing() TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_product_pricing(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_carts(integer) TO service_role;