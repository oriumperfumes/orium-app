-- 1. Public showcase views without internal metrics
CREATE OR REPLACE VIEW public.promotions_public
WITH (security_invoker = false) AS
SELECT id, name, discount_percent, applies_to, product_ids, decant_sizes,
       starts_at, ends_at, active, stackable, announce, headline, cta_label,
       announce_title, announce_message, announce_cta, announce_footnote,
       announce_theme, announce_reset_at, app_exclusive, app_badge_label
  FROM public.promotions
 WHERE active
   AND (starts_at IS NULL OR starts_at <= now())
   AND (ends_at IS NULL OR ends_at > now());

CREATE OR REPLACE VIEW public.coupons_public
WITH (security_invoker = false) AS
SELECT id, code, discount_percent, applies_to, product_ids, decant_sizes,
       starts_at, ends_at, active, stackable, announce,
       announce_title, announce_message, announce_cta, announce_footnote,
       announce_theme, announce_reset_at
  FROM public.coupons
 WHERE visibility = 'PUBLIC'
   AND active
   AND (starts_at IS NULL OR starts_at <= now())
   AND (ends_at IS NULL OR ends_at > now());

GRANT SELECT ON public.promotions_public TO anon, authenticated;
GRANT SELECT ON public.coupons_public TO anon, authenticated;

-- 2. Remove broad public row access to the base tables
DROP POLICY IF EXISTS promotions_public_read ON public.promotions;
DROP POLICY IF EXISTS coupons_public_read ON public.coupons;
REVOKE SELECT ON public.promotions FROM anon;
REVOKE SELECT ON public.coupons FROM anon;

-- 3. Each customer manages only their own push devices
DROP POLICY IF EXISTS "Staff manage their own push devices" ON public.push_devices;
CREATE POLICY "Users manage their own push devices"
  ON public.push_devices FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4. crm_upsert_customer cannot be used to write into another account
CREATE OR REPLACE FUNCTION public.crm_upsert_customer(p_user_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ph text := public.norm_phone(p_phone);
  em text := public.norm_email(p_email);
  caller uuid := auth.uid();
  cid uuid;
BEGIN
  IF p_user_id IS NOT NULL AND caller IS NOT NULL
     AND p_user_id <> caller AND NOT public.is_staff(caller) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_user_id IS NULL AND ph IS NULL AND em IS NULL THEN RETURN NULL; END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT id INTO cid FROM public.crm_customers WHERE user_id = p_user_id;
  END IF;
  IF cid IS NULL AND ph IS NOT NULL THEN
    SELECT id INTO cid FROM public.crm_customers WHERE phone_normalized = ph;
  END IF;
  IF cid IS NULL AND em IS NOT NULL THEN
    SELECT id INTO cid FROM public.crm_customers WHERE email = em AND phone_normalized IS NULL;
  END IF;

  IF cid IS NULL THEN
    INSERT INTO public.crm_customers (user_id, name, phone, phone_normalized, email)
    VALUES (p_user_id, nullif(btrim(coalesce(p_name,'')),''), nullif(btrim(coalesce(p_phone,'')),''), ph, em)
    RETURNING id INTO cid;
    RETURN cid;
  END IF;

  UPDATE public.crm_customers c SET
    user_id = coalesce(c.user_id, p_user_id),
    name = coalesce(nullif(btrim(coalesce(p_name,'')),''), c.name),
    phone = coalesce(c.phone, nullif(btrim(coalesce(p_phone,'')),'')),
    phone_normalized = coalesce(c.phone_normalized, ph),
    email = coalesce(c.email, em),
    updated_at = now()
  WHERE c.id = cid
    AND (c.user_id IS NULL OR p_user_id IS NULL OR c.user_id = p_user_id);
  RETURN cid;
END;
$function$;

-- 5. mark_abandoned_carts: staff check lives in the database
REVOKE ALL ON FUNCTION public.mark_abandoned_carts(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_carts(integer) TO authenticated;
