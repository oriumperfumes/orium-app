-- ============ histórico e ignorados ============
CREATE TABLE public.brand_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_brand_name text NOT NULL,
  to_brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  to_brand_name text NOT NULL,
  products_moved integer NOT NULL DEFAULT 0,
  aliases_moved integer NOT NULL DEFAULT 0,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.brand_merges TO authenticated;
GRANT ALL ON public.brand_merges TO service_role;
ALTER TABLE public.brand_merges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand_merges staff" ON public.brand_merges FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.brand_duplicate_ignores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_key text NOT NULL UNIQUE,
  brand_a uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  brand_b uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.brand_duplicate_ignores TO authenticated;
GRANT ALL ON public.brand_duplicate_ignores TO service_role;
ALTER TABLE public.brand_duplicate_ignores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand_dup_ignores staff" ON public.brand_duplicate_ignores FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ============ chave de marca (igual à do app) ============
CREATE OR REPLACE FUNCTION public.brand_key(txt text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(lower(extensions.unaccent(coalesce(txt, ''))), '[^a-z0-9]+', '', 'g')
$$;

CREATE OR REPLACE FUNCTION public.brand_slug(txt text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(
    nullif(
      btrim(
        regexp_replace(
          regexp_replace(lower(extensions.unaccent(coalesce(txt, ''))), '[^a-z0-9]+', '-', 'g'),
          '(^-|-$)', '', 'g'
        ),
        '-'
      ),
      ''
    ),
    public.brand_key(txt)
  )
$$;

-- ============ listagem ============
CREATE OR REPLACE FUNCTION public.admin_brand_list(p_q text DEFAULT NULL, p_filter text DEFAULT 'all', p_category text DEFAULT 'all')
RETURNS TABLE(
  id uuid, canonical_name text, segment text, allow_perfumes boolean,
  total integer, perfumes integer, others integer, publicos integer,
  other_types text[], aliases text[]
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH agg AS (
    SELECT b.id, b.canonical_name, b.segment, b.allow_perfumes,
      count(p.id)::int AS total,
      count(p.id) FILTER (WHERE p.product_type = 'PERFUME')::int AS perfumes,
      count(p.id) FILTER (WHERE p.product_type IS DISTINCT FROM 'PERFUME')::int AS others,
      count(p.id) FILTER (WHERE p.active AND p.catalog_eligible)::int AS publicos,
      coalesce(array_agg(DISTINCT p.product_type) FILTER (WHERE p.product_type IS NOT NULL AND p.product_type <> 'PERFUME'), '{}')::text[] AS other_types
    FROM public.brands b
    LEFT JOIN public.products p ON p.brand_id = b.id
    WHERE public.is_staff(auth.uid())
    GROUP BY b.id, b.canonical_name, b.segment, b.allow_perfumes
  )
  SELECT a.id, a.canonical_name, a.segment, a.allow_perfumes, a.total, a.perfumes, a.others, a.publicos, a.other_types,
    coalesce((
      SELECT array_agg(al.alias ORDER BY al.alias) FROM public.brand_aliases al
      WHERE al.brand_id = a.id AND public.brand_key(al.alias) <> public.brand_key(a.canonical_name)
    ), '{}')::text[] AS aliases
  FROM agg a
  WHERE (p_q IS NULL OR btrim(p_q) = '' OR public.brand_key(a.canonical_name) LIKE '%' || public.brand_key(p_q) || '%')
    AND (
      p_filter = 'all'
      OR (p_filter = 'public' AND a.publicos > 0)
      OR (p_filter = 'nopublic' AND a.total > 0 AND a.publicos = 0)
      OR (p_filter = 'empty' AND a.total = 0)
    )
    AND (
      p_category = 'all'
      OR (p_category = 'perfume' AND a.perfumes > 0)
      OR (p_category = 'other' AND a.others > 0)
    )
  ORDER BY a.canonical_name
$$;

-- ============ renomear ============
CREATE OR REPLACE FUNCTION public.admin_brand_rename(p_brand_id uuid, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old text; v_new text; v_key text; v_clash uuid; v_updated int;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Apenas a equipe pode alterar marcas.'; END IF;
  v_new := btrim(coalesce(p_name, ''));
  IF length(v_new) < 2 THEN RAISE EXCEPTION 'Informe o nome da marca.'; END IF;
  SELECT canonical_name INTO v_old FROM public.brands WHERE id = p_brand_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Marca não encontrada.'; END IF;
  v_key := public.brand_key(v_new);

  SELECT id INTO v_clash FROM public.brands WHERE public.brand_key(canonical_name) = v_key AND id <> p_brand_id LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe uma marca com esse nome. Use Mesclar para unificar.';
  END IF;

  UPDATE public.brands
     SET canonical_name = v_new, slug = public.brand_slug(v_new), normalized_name = v_key
   WHERE id = p_brand_id;

  UPDATE public.products SET brand = v_new WHERE brand_id = p_brand_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.brand_aliases (brand_id, alias, alias_key, source)
  VALUES (p_brand_id, v_old, public.brand_key(v_old), 'painel')
  ON CONFLICT (alias_key) DO UPDATE SET brand_id = EXCLUDED.brand_id, alias = EXCLUDED.alias;
  INSERT INTO public.brand_aliases (brand_id, alias, alias_key, source)
  VALUES (p_brand_id, v_new, v_key, 'painel')
  ON CONFLICT (alias_key) DO UPDATE SET brand_id = EXCLUDED.brand_id, alias = EXCLUDED.alias;

  RETURN jsonb_build_object('ok', true, 'name', v_new, 'products', v_updated);
END $$;

-- ============ mover produtos ============
CREATE OR REPLACE FUNCTION public.admin_brand_move_products(p_from uuid, p_to uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_to text; v_moved int;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Apenas a equipe pode alterar marcas.'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'Escolha uma marca de destino diferente.'; END IF;
  SELECT canonical_name INTO v_to FROM public.brands WHERE id = p_to;
  IF v_to IS NULL THEN RAISE EXCEPTION 'Marca de destino não encontrada.'; END IF;

  UPDATE public.products
     SET brand_id = p_to, brand = v_to, brand_review_required = false
   WHERE brand_id = p_from;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  UPDATE public.supplier_products SET brand_id = p_to WHERE brand_id = p_from;
  UPDATE public.perfume_identity_registry SET brand_id = p_to WHERE brand_id = p_from;

  RETURN jsonb_build_object('ok', true, 'moved', v_moved, 'to', v_to);
END $$;

-- ============ mesclar ============
CREATE OR REPLACE FUNCTION public.admin_brand_merge(p_from uuid, p_to uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from text; v_to text; v_moved int; v_aliases int;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Apenas a equipe pode alterar marcas.'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'Escolha duas marcas diferentes.'; END IF;
  SELECT canonical_name INTO v_from FROM public.brands WHERE id = p_from;
  SELECT canonical_name INTO v_to FROM public.brands WHERE id = p_to;
  IF v_from IS NULL OR v_to IS NULL THEN RAISE EXCEPTION 'Marca não encontrada.'; END IF;

  UPDATE public.products SET brand_id = p_to, brand = v_to, brand_review_required = false WHERE brand_id = p_from;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  UPDATE public.supplier_products SET brand_id = p_to WHERE brand_id = p_from;
  UPDATE public.perfume_identity_registry SET brand_id = p_to WHERE brand_id = p_from;
  UPDATE public.product_identity_suggestions SET suggested_brand_id = p_to WHERE suggested_brand_id = p_from;

  UPDATE public.brand_aliases SET brand_id = p_to WHERE brand_id = p_from;
  GET DIAGNOSTICS v_aliases = ROW_COUNT;

  INSERT INTO public.brand_aliases (brand_id, alias, alias_key, source)
  VALUES (p_to, v_from, public.brand_key(v_from), 'painel')
  ON CONFLICT (alias_key) DO UPDATE SET brand_id = EXCLUDED.brand_id, alias = EXCLUDED.alias;

  DELETE FROM public.brands WHERE id = p_from;

  INSERT INTO public.brand_merges (from_brand_name, to_brand_id, to_brand_name, products_moved, aliases_moved, actor)
  VALUES (v_from, p_to, v_to, v_moved, v_aliases, auth.uid());

  RETURN jsonb_build_object('ok', true, 'moved', v_moved, 'from', v_from, 'to', v_to);
END $$;

-- ============ excluir ============
CREATE OR REPLACE FUNCTION public.admin_brand_delete(p_brand_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text; v_products int;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Apenas a equipe pode alterar marcas.'; END IF;
  SELECT canonical_name INTO v_name FROM public.brands WHERE id = p_brand_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Marca não encontrada.'; END IF;
  SELECT count(*) INTO v_products FROM public.products WHERE brand_id = p_brand_id;
  IF v_products > 0 THEN
    RAISE EXCEPTION 'Esta marca tem % produto(s). Mova ou mescle antes de excluir.', v_products;
  END IF;
  UPDATE public.supplier_products SET brand_id = NULL WHERE brand_id = p_brand_id;
  DELETE FROM public.brand_aliases WHERE brand_id = p_brand_id;
  DELETE FROM public.brands WHERE id = p_brand_id;
  RETURN jsonb_build_object('ok', true, 'name', v_name);
END $$;

-- ============ duplicadas prováveis ============
CREATE OR REPLACE FUNCTION public.brand_near(a text, b text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE i int; la int; lb int; s text; t text;
BEGIN
  IF a IS NULL OR b IS NULL OR a = b THEN RETURN false; END IF;
  la := length(a); lb := length(b);
  IF abs(la - lb) > 1 THEN RETURN false; END IF;
  IF la = lb THEN
    -- uma única letra trocada
    FOR i IN 1..la LOOP
      IF substr(a, 1, i - 1) || substr(b, i, 1) || substr(a, i + 1) = b THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
  END IF;
  -- uma letra a mais/a menos
  IF la > lb THEN s := a; t := b; ELSE s := b; t := a; END IF;
  FOR i IN 1..length(s) LOOP
    IF substr(s, 1, i - 1) || substr(s, i + 1) = t THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.admin_brand_duplicates(p_limit integer DEFAULT 30)
RETURNS TABLE(
  a_id uuid, a_name text, a_products integer,
  b_id uuid, b_name text, b_products integer, reason text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH b AS (
    SELECT br.id, br.canonical_name, public.brand_key(br.canonical_name) AS k,
      (SELECT count(*) FROM public.products p WHERE p.brand_id = br.id)::int AS products
    FROM public.brands br
    WHERE public.is_staff(auth.uid())
  )
  SELECT x.id, x.canonical_name, x.products, y.id, y.canonical_name, y.products,
    CASE WHEN x.k = y.k THEN 'mesmo nome' ELSE 'nomes muito parecidos' END AS reason
  FROM b x JOIN b y ON x.id < y.id
  WHERE (x.k = y.k OR (length(x.k) >= 4 AND length(y.k) >= 4 AND x.k <> y.k
         AND (x.k LIKE y.k || '%' OR y.k LIKE x.k || '%' OR public.brand_near(x.k, y.k))))
    AND NOT EXISTS (
      SELECT 1 FROM public.brand_duplicate_ignores i
      WHERE i.pair_key = least(x.id::text, y.id::text) || ':' || greatest(x.id::text, y.id::text)
    )
  ORDER BY (x.products + y.products) DESC, x.canonical_name
  LIMIT greatest(1, coalesce(p_limit, 30))
$$;

REVOKE ALL ON FUNCTION public.admin_brand_list(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_brand_rename(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_brand_move_products(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_brand_merge(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_brand_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_brand_duplicates(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_brand_list(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_brand_rename(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_brand_move_products(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_brand_merge(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_brand_delete(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_brand_duplicates(integer) TO authenticated, service_role;