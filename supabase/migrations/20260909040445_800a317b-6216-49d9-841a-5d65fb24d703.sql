CREATE OR REPLACE FUNCTION public.mark_abandoned_carts(p_minutes integer DEFAULT 45)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.shopping_carts
     SET status = 'ABANDONED', abandoned_at = now(), updated_at = now()
   WHERE status = 'ACTIVE'
     AND items_count > 0
     AND last_activity_at < now() - (greatest(5, coalesce(p_minutes, 45)) || ' minutes')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_abandoned_carts(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_carts(integer) TO authenticated, service_role;