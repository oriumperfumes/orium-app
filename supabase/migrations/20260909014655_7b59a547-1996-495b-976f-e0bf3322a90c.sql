REVOKE EXECUTE ON FUNCTION public.crm_customer_list(text, text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.crm_customer_detail(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.crm_overview() FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_abandoned_carts(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.crm_upsert_customer(uuid, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_log_event(uuid, text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.waiting_count(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.products_back_in_stock() FROM anon, authenticated;