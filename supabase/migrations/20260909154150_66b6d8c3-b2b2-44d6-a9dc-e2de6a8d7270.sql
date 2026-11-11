CREATE OR REPLACE FUNCTION public.search_intent(p_q text)
RETURNS TABLE (
  intent text,
  confidence numeric,
  line_label text,
  product_id uuid,
  slug text,
  canonical_name text,
  brand text,
  gender_norm text,
  product_type text,
  concentration text,
  volume_ml integer,
  image_url text,
  in_stock boolean,
  stock_quantity integer,
  retail_price numeric,
  wholesale_price numeric,
  decant_available boolean,
  decant_price_2ml numeric,
  decant_price_5ml numeric,
  decant_price_10ml numeric
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH q AS (SELECT catalog_norm(p_q) AS qq),
  -- Um registro por perfume canônico: o mesmo perfume vindo de fornecedores
  -- diferentes não compete consigo mesmo.
  g AS (
    SELECT DISTINCT ON (s.gkey) s.gkey, s.name_norm, s.score, s.id
    FROM (
      SELECT
        p.id,
        catalog_norm(coalesce(p.brand, '') || ' ' || p.canonical_name) AS gkey,
        catalog_norm(p.canonical_name) AS name_norm,
        GREATEST(
          CASE WHEN catalog_norm(p.canonical_name) = q.qq THEN 1 ELSE 0 END::numeric,
          similarity(catalog_norm(p.canonical_name), q.qq)::numeric,
          similarity(catalog_norm(coalesce(p.brand, '') || ' ' || p.canonical_name), q.qq)::numeric
        ) AS score,
        p.in_stock,
        p.retail_price
      FROM products p, q
      WHERE p.active
        AND p.catalog_eligible
        AND length(q.qq) >= 3
        AND (
          p.search_norm % q.qq
          OR catalog_norm(p.canonical_name) LIKE '%' || q.qq || '%'
          OR catalog_norm(coalesce(p.brand, '') || ' ' || p.canonical_name) % q.qq
        )
    ) s
    ORDER BY s.gkey, s.in_stock DESC, s.retail_price ASC NULLS LAST
  ),
  best AS (SELECT * FROM g ORDER BY score DESC LIMIT 1),
  stats AS (
    SELECT
      b.id,
      b.score,
      coalesce((SELECT max(x.score) FROM g x WHERE x.gkey <> b.gkey), 0) AS second_score,
      -- quantos perfumes canônicos continuam o texto digitado ("Club de Nuit ...")
      (SELECT count(*) FROM g x, q WHERE x.name_norm <> q.qq AND x.name_norm LIKE q.qq || ' %') AS prefix_count
    FROM best b
  ),
  decision AS (
    SELECT
      s.id,
      s.score,
      CASE
        WHEN s.score >= 0.90 AND s.prefix_count = 0 THEN 'EXACT_PRODUCT_SEARCH'
        WHEN s.prefix_count >= 2 THEN 'LINE_SEARCH'
        WHEN s.score >= 0.62 AND (s.score - s.second_score) >= 0.08 THEN 'EXACT_PRODUCT_SEARCH'
        ELSE 'LINE_SEARCH'
      END AS intent
    FROM stats s
  )
  SELECT
    d.intent,
    round(d.score, 4) AS confidence,
    CASE WHEN d.intent = 'LINE_SEARCH' THEN btrim(p_q) END AS line_label,
    p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type, p.concentration,
    p.volume_ml, p.image_url, p.in_stock, p.stock_quantity, p.retail_price, p.wholesale_price,
    p.decant_available, p.decant_price_2ml, p.decant_price_5ml, p.decant_price_10ml
  FROM decision d
  LEFT JOIN products p ON p.id = d.id AND d.intent = 'EXACT_PRODUCT_SEARCH';
$$;

GRANT EXECUTE ON FUNCTION public.search_intent(text) TO anon, authenticated, service_role;