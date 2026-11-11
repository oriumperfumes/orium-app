CREATE TABLE public.product_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid,
  anonymous_id text,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_views_product_time_idx ON public.product_views (product_id, viewed_at DESC);
CREATE INDEX product_views_recent_idx ON public.product_views (viewed_at DESC);
CREATE INDEX product_views_dedupe_idx ON public.product_views (product_id, user_id, anonymous_id, viewed_at DESC);

GRANT SELECT ON public.product_views TO authenticated;
GRANT ALL ON public.product_views TO service_role;

ALTER TABLE public.product_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read product views" ON public.product_views
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- Registra uma visualização real da página do produto, com deduplicação de 30 minutos.
CREATE OR REPLACE FUNCTION public.log_product_view(p_product_id uuid, p_anonymous_id text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  anon text := nullif(btrim(coalesce(p_anonymous_id, '')), '');
  exists_recent boolean;
BEGIN
  IF p_product_id IS NULL THEN RETURN; END IF;
  IF uid IS NULL AND anon IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND active) THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.product_views v
     WHERE v.product_id = p_product_id
       AND v.viewed_at > now() - interval '30 minutes'
       AND ((uid IS NOT NULL AND v.user_id = uid) OR (uid IS NULL AND anon IS NOT NULL AND v.anonymous_id = anon))
  ) INTO exists_recent;

  IF exists_recent THEN RETURN; END IF;

  INSERT INTO public.product_views (product_id, user_id, anonymous_id)
  VALUES (p_product_id, uid, anon);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_product_view(uuid, text) TO anon, authenticated;

-- Ranking público dos mais acessados (janela móvel). Fallback: mais vendidos e mais recentes.
CREATE OR REPLACE FUNCTION public.top_viewed_products(p_days integer DEFAULT 30, p_limit integer DEFAULT 12)
RETURNS TABLE(
  id uuid, slug text, canonical_name text, brand text, gender_norm text, product_type text,
  concentration text, volume_ml integer, image_url text, in_stock boolean,
  retail_price numeric, wholesale_price numeric,
  decant_available boolean, decant_price_2ml numeric, decant_price_5ml numeric, decant_price_10ml numeric,
  views integer, sold integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH win AS (
    SELECT greatest(1, least(coalesce(p_days, 30), 3650)) AS days,
           greatest(1, least(coalesce(p_limit, 12), 24)) AS lim
  ),
  v AS (
    SELECT pv.product_id, count(*)::int AS views
      FROM public.product_views pv, win
     WHERE pv.viewed_at > now() - (win.days || ' days')::interval
     GROUP BY pv.product_id
  ),
  s AS (
    SELECT i.product_id, sum(i.quantity)::int AS sold
      FROM public.catalog_order_items i
      JOIN public.catalog_orders o ON o.id = i.order_id
     WHERE o.is_confirmed AND o.deleted_at IS NULL AND o.canceled_at IS NULL
     GROUP BY i.product_id
  )
  SELECT p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type,
         p.concentration, p.volume_ml, p.image_url, p.in_stock,
         p.retail_price, p.wholesale_price,
         (p.product_type = 'PERFUME' AND p.decant_available) AS decant_available,
         p.decant_price_2ml, p.decant_price_5ml, p.decant_price_10ml,
         coalesce(v.views, 0) AS views, coalesce(s.sold, 0) AS sold
    FROM public.products p
    LEFT JOIN v ON v.product_id = p.id
    LEFT JOIN s ON s.product_id = p.id
   WHERE p.active AND p.catalog_eligible AND p.retail_price IS NOT NULL
   ORDER BY coalesce(v.views, 0) DESC, coalesce(s.sold, 0) DESC, p.in_stock DESC, p.created_at DESC
   LIMIT (SELECT lim FROM win);
$$;

GRANT EXECUTE ON FUNCTION public.top_viewed_products(integer, integer) TO anon, authenticated;

-- Ranking com números para o Admin (somente owner/admin).
CREATE OR REPLACE FUNCTION public.admin_top_viewed(p_days integer DEFAULT 30, p_limit integer DEFAULT 20)
RETURNS TABLE(product_id uuid, slug text, canonical_name text, brand text, views integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN QUERY
  SELECT p.id, p.slug, p.canonical_name, p.brand, count(pv.id)::int AS views
    FROM public.product_views pv
    JOIN public.products p ON p.id = pv.product_id
   WHERE (p_days IS NULL OR p_days <= 0 OR pv.viewed_at > now() - (greatest(1, p_days) || ' days')::interval)
   GROUP BY p.id, p.slug, p.canonical_name, p.brand
   ORDER BY count(pv.id) DESC
   LIMIT greatest(1, least(coalesce(p_limit, 20), 50));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_top_viewed(integer, integer) TO authenticated;