CREATE OR REPLACE FUNCTION public.crm_customer_delete(p_customer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  -- Remove somente a ficha do CRM (anotações/eventos caem em cascata).
  DELETE FROM public.crm_customers WHERE id = p_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_customer_delete(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crm_customer_delete(uuid) TO authenticated, service_role;