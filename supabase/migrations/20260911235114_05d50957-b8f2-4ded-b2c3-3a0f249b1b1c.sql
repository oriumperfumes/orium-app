-- Staff/owner-only routines: remove anonymous (and public) execute rights.
REVOKE EXECUTE ON FUNCTION public.crm_cleanup_preview(boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_cleanup_apply(text[], boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_purge_customers_without_orders() FROM anon, PUBLIC;

-- Routines only used by trusted server code: no client role may execute them.
REVOKE EXECUTE ON FUNCTION public.crm_upsert_customer(uuid, text, text, text, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_upsert_customer(uuid, text, text, text, text) TO service_role;

-- Ensure the remaining staff-only routines are never exposed to anonymous callers.
REVOKE EXECUTE ON FUNCTION public.admin_brand_delete(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_brand_duplicates(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_brand_list(text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_brand_merge(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_brand_move_products(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_brand_rename(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_top_viewed(integer, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_customer_delete(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_customer_detail(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_customer_list(text, text, integer, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_customer_set_archived(uuid, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_customer_update(uuid, text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_overview() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_abandoned_carts(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.new_arrivals_audit(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM anon, PUBLIC;