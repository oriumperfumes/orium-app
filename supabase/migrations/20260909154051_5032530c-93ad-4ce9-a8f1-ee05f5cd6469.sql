-- Índices que aceleram a comparação olfativa
CREATE INDEX IF NOT EXISTS fragrance_accords_name_idx ON public.fragrance_accords (lower(accord_name));
CREATE INDEX IF NOT EXISTS fragrance_notes_label_idx ON public.fragrance_notes (lower(note_label));

/*
  Detector de intenção da busca.
  Decide entre LINE_SEARCH (linha/grupo de perfumes) e EXACT_PRODUCT_SEARCH
  (um perfume canônico claramente identificado) usando os produtos reais do
  catálogo — nunca a quantidade de palavras digitadas.
*/
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
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  q text := catalog_norm(p_q);
  v_best record;
  v_second numeric := 0;
  v_prefix integer := 0;
  v_intent text := 'LINE_SEARCH';
BEGIN
  IF length(q) < 3 THEN
    RETURN QUERY SELECT 'LINE_SEARCH'::text, 0::numeric, NULL::text, NULL::uuid, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::text, NULL::boolean,
      NULL::integer, NULL::numeric, NULL::numeric, NULL::boolean, NULL::numeric, NULL::numeric, NULL::numeric;
    RETURN;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _si_groups (
    gkey text, name_norm text, score numeric, pid uuid
  ) ON COMMIT DROP;
  DELETE FROM _si_groups;

  -- Um registro por perfume canônico: MRX e Smart Mania do mesmo perfume não
  -- competem entre si. Representante = o que está disponível/mais barato.
  INSERT INTO _si_groups (gkey, name_norm, score, pid)
  SELECT DISTINCT ON (g.gkey) g.gkey, g.name_norm, g.score, g.id
  FROM (
    SELECT
      p.id,
      catalog_norm(coalesce(p.brand, '') || ' ' || p.canonical_name) AS gkey,
      catalog_norm(p.canonical_name) AS name_norm,
      GREATEST(
        CASE WHEN catalog_norm(p.canonical_name) = q THEN 1 ELSE 0 END::numeric,
        similarity(catalog_norm(p.canonical_name), q)::numeric,
        similarity(catalog_norm(coalesce(p.brand, '') || ' ' || p.canonical_name), q)::numeric
      ) AS score,
      p.in_stock,
      p.retail_price
    FROM products p
    WHERE p.active
      AND p.catalog_eligible
      AND (
        p.search_norm % q
        OR catalog_norm(p.canonical_name) LIKE '%' || q || '%'
        OR catalog_norm(coalesce(p.brand, '') || ' ' || p.canonical_name) % q
      )
  ) g
  ORDER BY g.gkey, g.in_stock DESC, g.retail_price ASC NULLS LAST;

  SELECT * INTO v_best FROM _si_groups ORDER BY score DESC LIMIT 1;
  IF v_best IS NULL THEN
    RETURN QUERY SELECT 'LINE_SEARCH'::text, 0::numeric, NULL::text, NULL::uuid, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::text, NULL::boolean,
      NULL::integer, NULL::numeric, NULL::numeric, NULL::boolean, NULL::numeric, NULL::numeric, NULL::numeric;
    RETURN;
  END IF;

  SELECT coalesce(max(score), 0) INTO v_second FROM _si_groups WHERE gkey <> v_best.gkey;

  -- Quantos perfumes canônicos continuam o texto digitado ("Club de Nuit ...").
  SELECT count(*) INTO v_prefix FROM _si_groups
  WHERE name_norm <> q AND name_norm LIKE q || ' %';

  IF v_best.score >= 0.90 AND v_prefix = 0 THEN
    v_intent := 'EXACT_PRODUCT_SEARCH';
  ELSIF v_prefix >= 2 THEN
    v_intent := 'LINE_SEARCH';
  ELSIF v_best.score >= 0.62 AND (v_best.score - v_second) >= 0.08 THEN
    v_intent := 'EXACT_PRODUCT_SEARCH';
  END IF;

  IF v_intent = 'LINE_SEARCH' THEN
    RETURN QUERY SELECT 'LINE_SEARCH'::text, v_best.score, btrim(p_q), NULL::uuid, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::text, NULL::boolean,
      NULL::integer, NULL::numeric, NULL::numeric, NULL::boolean, NULL::numeric, NULL::numeric, NULL::numeric;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'EXACT_PRODUCT_SEARCH'::text, v_best.score, NULL::text,
    p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type, p.concentration,
    p.volume_ml, p.image_url, p.in_stock, p.stock_quantity, p.retail_price, p.wholesale_price,
    p.decant_available, p.decant_price_2ml, p.decant_price_5ml, p.decant_price_10ml
  FROM products p
  WHERE p.id = v_best.pid;
END;
$$;

/*
  Perfumes parecidos pelo CHEIRO — nunca por nome.
  45% principais acordes (intensidade), 40% notas com peso pela posição na
  pirâmide, 15% família olfativa. Sem dados olfativos suficientes o perfume
  não entra: a Orium não inventa semelhança.
*/
CREATE OR REPLACE FUNCTION public.olfactory_similar(p_product_id uuid, p_limit integer DEFAULT 8)
RETURNS TABLE (
  id uuid,
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
  decant_price_10ml numeric,
  similarity_score numeric,
  shared_accords text[]
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH ref AS (
    SELECT p.id, catalog_norm(coalesce(p.brand, '') || ' ' || p.canonical_name) AS gkey
    FROM products p WHERE p.id = p_product_id
  ),
  ref_acc AS (
    SELECT lower(btrim(a.accord_name)) AS k, max(GREATEST(0.15, coalesce(a.intensity, 0.5))) AS w
    FROM fragrance_accords a WHERE a.product_id = p_product_id GROUP BY 1
  ),
  ref_note AS (
    SELECT lower(btrim(n.note_label)) AS k,
           max(CASE n.pyramid_level WHEN 'HEART' THEN 1.0 WHEN 'BASE' THEN 1.0 ELSE 0.8 END) AS w,
           min(n.pyramid_level) AS lvl
    FROM fragrance_notes n WHERE n.product_id = p_product_id GROUP BY 1
  ),
  ref_fam AS (
    SELECT nullif(nullif(lower(btrim(d.olfactory_family)), ''), 'comparar') AS fam
    FROM fragrance_details d WHERE d.product_id = p_product_id
  ),
  cand AS (
    SELECT DISTINCT ON (catalog_norm(coalesce(p.brand, '') || ' ' || p.canonical_name))
      p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type, p.concentration,
      p.volume_ml, p.image_url, p.in_stock, p.stock_quantity, p.retail_price, p.wholesale_price,
      p.decant_available, p.decant_price_2ml, p.decant_price_5ml, p.decant_price_10ml
    FROM products p
    WHERE p.active AND p.catalog_eligible AND p.product_type = 'PERFUME'
      AND p.id <> p_product_id
      AND catalog_norm(coalesce(p.brand, '') || ' ' || p.canonical_name) <> (SELECT gkey FROM ref)
      AND (
        (SELECT count(*) FROM fragrance_accords a WHERE a.product_id = p.id) >= 3
        OR (SELECT count(*) FROM fragrance_notes n WHERE n.product_id = p.id) >= 4
      )
    ORDER BY catalog_norm(coalesce(p.brand, '') || ' ' || p.canonical_name),
             p.in_stock DESC, p.retail_price ASC NULLS LAST
  ),
  scored AS (
    SELECT c.*,
      -- acordes: interseção ponderada pela intensidade (Jaccard ponderado)
      coalesce((
        SELECT sum(LEAST(coalesce(r.w, 0), coalesce(x.w, 0))) / nullif(sum(GREATEST(coalesce(r.w, 0), coalesce(x.w, 0))), 0)
        FROM ref_acc r
        FULL JOIN (
          SELECT lower(btrim(a.accord_name)) AS k, max(GREATEST(0.15, coalesce(a.intensity, 0.5))) AS w
          FROM fragrance_accords a WHERE a.product_id = c.id GROUP BY 1
        ) x USING (k)
      ), 0) AS acc_sim,
      -- notas: peso pela posição na pirâmide; nível diferente vale menos
      coalesce((
        SELECT sum(
                 CASE WHEN r.k IS NOT NULL AND x.k IS NOT NULL
                      THEN LEAST(r.w, x.w) * (CASE WHEN r.lvl = x.lvl THEN 1 ELSE 0.65 END)
                      ELSE 0 END)
               / nullif(sum(GREATEST(coalesce(r.w, 0), coalesce(x.w, 0))), 0)
        FROM ref_note r
        FULL JOIN (
          SELECT lower(btrim(n.note_label)) AS k,
                 max(CASE n.pyramid_level WHEN 'HEART' THEN 1.0 WHEN 'BASE' THEN 1.0 ELSE 0.8 END) AS w,
                 min(n.pyramid_level) AS lvl
          FROM fragrance_notes n WHERE n.product_id = c.id GROUP BY 1
        ) x USING (k)
      ), 0) AS note_sim,
      -- família olfativa: igual = 1, parcialmente igual = 0.5
      coalesce((
        SELECT CASE
                 WHEN rf.fam IS NULL OR cf.fam IS NULL THEN 0
                 WHEN rf.fam = cf.fam THEN 1
                 WHEN EXISTS (
                   SELECT 1 FROM unnest(string_to_array(rf.fam, ' ')) t
                   WHERE length(t) > 3 AND cf.fam LIKE '%' || t || '%'
                 ) THEN 0.5
                 ELSE 0 END
        FROM ref_fam rf
        CROSS JOIN (
          SELECT nullif(nullif(lower(btrim(d.olfactory_family)), ''), 'comparar') AS fam
          FROM fragrance_details d WHERE d.product_id = c.id
        ) cf
      ), 0) AS fam_sim,
      (SELECT array_agg(a.accord_name ORDER BY a.position)
       FROM fragrance_accords a
       WHERE a.product_id = c.id
         AND lower(btrim(a.accord_name)) IN (SELECT k FROM ref_acc)) AS shared
    FROM cand c
    WHERE EXISTS (SELECT 1 FROM ref_acc) OR EXISTS (SELECT 1 FROM ref_note)
  )
  SELECT s.id, s.slug, s.canonical_name, s.brand, s.gender_norm, s.product_type, s.concentration,
    s.volume_ml, s.image_url, s.in_stock, s.stock_quantity, s.retail_price, s.wholesale_price,
    s.decant_available, s.decant_price_2ml, s.decant_price_5ml, s.decant_price_10ml,
    round(0.45 * s.acc_sim + 0.40 * s.note_sim + 0.15 * s.fam_sim, 4) AS similarity_score,
    coalesce(s.shared, '{}'::text[]) AS shared_accords
  FROM scored s
  WHERE (0.45 * s.acc_sim + 0.40 * s.note_sim + 0.15 * s.fam_sim) >= 0.12
  -- disponíveis ganham leve prioridade, sem destruir a qualidade da semelhança
  ORDER BY (0.45 * s.acc_sim + 0.40 * s.note_sim + 0.15 * s.fam_sim)
           * (CASE WHEN s.in_stock THEN 1.0 ELSE 0.82 END) DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 8), 12));
$$;

GRANT EXECUTE ON FUNCTION public.search_intent(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.olfactory_similar(uuid, integer) TO anon, authenticated, service_role;