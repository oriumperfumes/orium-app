DROP VIEW IF EXISTS public.promotions_public;
DROP VIEW IF EXISTS public.coupons_public;

CREATE OR REPLACE FUNCTION public.public_promotions()
RETURNS TABLE (
  id uuid, name text, discount_percent numeric, applies_to text,
  product_ids uuid[], decant_sizes integer[], starts_at timestamptz, ends_at timestamptz,
  active boolean, stackable boolean, announce boolean, headline text, cta_label text,
  announce_title text, announce_message text, announce_cta text, announce_footnote text,
  announce_theme text, announce_reset_at timestamptz, app_exclusive boolean, app_badge_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id, p.name, p.discount_percent, p.applies_to, p.product_ids, p.decant_sizes,
         p.starts_at, p.ends_at, p.active, p.stackable, p.announce, p.headline, p.cta_label,
         p.announce_title, p.announce_message, p.announce_cta, p.announce_footnote,
         p.announce_theme, p.announce_reset_at, p.app_exclusive, p.app_badge_label
    FROM public.promotions p
   WHERE p.active
     AND (p.starts_at IS NULL OR p.starts_at <= now())
     AND (p.ends_at IS NULL OR p.ends_at > now())
$function$;

CREATE OR REPLACE FUNCTION public.public_coupons()
RETURNS TABLE (
  id uuid, code text, discount_percent numeric, applies_to text,
  product_ids uuid[], decant_sizes integer[], starts_at timestamptz, ends_at timestamptz,
  active boolean, stackable boolean, announce boolean,
  announce_title text, announce_message text, announce_cta text, announce_footnote text,
  announce_theme text, announce_reset_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.id, c.code, c.discount_percent, c.applies_to, c.product_ids, c.decant_sizes,
         c.starts_at, c.ends_at, c.active, c.stackable, c.announce,
         c.announce_title, c.announce_message, c.announce_cta, c.announce_footnote,
         c.announce_theme, c.announce_reset_at
    FROM public.coupons c
   WHERE c.visibility = 'PUBLIC'
     AND c.active
     AND (c.starts_at IS NULL OR c.starts_at <= now())
     AND (c.ends_at IS NULL OR c.ends_at > now())
$function$;

GRANT EXECUTE ON FUNCTION public.public_promotions() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_coupons() TO anon, authenticated;
