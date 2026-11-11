-- Ordem padrão do catálogo: mais populares primeiro.
-- popularidade = hype (ranking editorial de perfumes árabes mais vendidos/virais,
-- cruzado de varias fontes) + vendas confirmadas da Orium + acessos dos ultimos 30 dias.
CREATE TABLE IF NOT EXISTS public.perfume_hype (
  brand_norm text NOT NULL,
  key text NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  PRIMARY KEY (brand_norm, key)
);
ALTER TABLE public.perfume_hype ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff manage perfume_hype" ON public.perfume_hype;
CREATE POLICY "staff manage perfume_hype" ON public.perfume_hype FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

INSERT INTO public.perfume_hype (brand_norm, key, score)
SELECT public.catalog_norm(b), public.catalog_norm(k), s FROM (VALUES
  ('Lattafa', 'khamrah', 100),
  ('Lattafa', 'khamrah qahwa', 95),
  ('Lattafa', 'khamrah dukhan', 82),
  ('Lattafa', 'khamrah duhkan', 82),
  ('Lattafa', 'khamrah waha', 70),
  ('Lattafa', 'yara', 100),
  ('Lattafa', 'yara candy', 90),
  ('Lattafa', 'yara tous', 90),
  ('Lattafa', 'yara moi', 85),
  ('Lattafa', 'yara elixir', 80),
  ('Lattafa', 'yara dalal', 70),
  ('Lattafa', 'asad', 100),
  ('Lattafa', 'asad tradicional', 100),
  ('Lattafa', 'asad bourbon', 92),
  ('Lattafa', 'asad elixir', 85),
  ('Lattafa', 'asad zanzibar', 82),
  ('Lattafa', 'fakhar gold', 90),
  ('Lattafa', 'fakhar gol d', 90),
  ('Lattafa', 'fakhar black', 82),
  ('Lattafa', 'fakhar rose', 82),
  ('Lattafa', 'fakhar platinum', 75),
  ('Lattafa', 'bade''e al oud amethyst', 93),
  ('Lattafa', 'amethyst', 93),
  ('Lattafa', 'bade''e al oud noble blush', 88),
  ('Lattafa', 'bade''e al oud honor glory', 86),
  ('Lattafa', 'bade''e al oud sublime', 75),
  ('Lattafa', 'eclaire', 88),
  ('Lattafa', 'eclaire pistache', 80),
  ('Lattafa', 'eclaire banoffi', 80),
  ('Lattafa', 'angham', 80),
  ('Lattafa', 'ameerat al arab', 78),
  ('Lattafa', 'queen of arabia', 75),
  ('Lattafa', 'queen of roses', 70),
  ('Lattafa', 'his confession', 72),
  ('Lattafa', 'her confession', 72),
  ('Lattafa', 'hayaati', 70),
  ('Lattafa', 'mayar', 70),
  ('Lattafa', 'ana abiyedh', 68),
  ('Lattafa', 'qaed al fursan', 68),
  ('Lattafa', 'musamam', 65),
  ('Lattafa', 'teriaq', 60),
  ('Lattafa', 'fahad', 60),
  ('Lattafa', 'noble ameer', 60),
  ('Afnan', '9pm', 96),
  ('Afnan', '9pm elixir', 86),
  ('Afnan', '9pm night out', 76),
  ('Afnan', 'supremacy not only intense', 88),
  ('Afnan', 'supremacy gold', 82),
  ('Afnan', 'supremacy noir', 80),
  ('Afnan', 'supremacy pour homme', 75),
  ('Afnan', 'supremacy', 70),
  ('Afnan', '9am dive', 70),
  ('Afnan', 'turathi', 65),
  ('Armaf', 'club de nuit intense man', 100),
  ('Armaf', 'club de nuit woman', 86),
  ('Armaf', 'club de nuit imperiale', 86),
  ('Armaf', 'club de nuit intense woman', 78),
  ('Armaf', 'club de nuit sillage', 78),
  ('Armaf', 'club de nuit untold', 78),
  ('Armaf', 'club de nuit lionheart woman', 76),
  ('Armaf', 'club de nuit milestone', 75),
  ('Armaf', 'club de nuit urban elixir', 75),
  ('Armaf', 'club de nuit iconic', 72),
  ('Armaf', 'club de nuit elite', 70),
  ('Armaf', 'club de nuit', 60),
  ('Armaf', 'odyssey mandarin sky', 75),
  ('Armaf', 'odyssey', 55),
  ('Rasasi', 'hawas for him', 90),
  ('Rasasi', 'hawas ice', 90),
  ('Rasasi', 'hawas black', 82),
  ('Rasasi', 'hawas elixir', 80),
  ('Rasasi', 'hawas for her', 80),
  ('Rasasi', 'hawas eclat', 80),
  ('Rasasi', 'hawas fire', 70),
  ('Rasasi', 'hawas', 72),
  ('Al Haramain', 'l aventure', 90),
  ('Al Haramain', 'l'' aventure', 90),
  ('Al Haramain', 'amber oud gold edition', 86),
  ('Al Haramain', 'amber oud', 75),
  ('Al Haramain', 'detour rouge', 65),
  ('Al Wataniah', 'sabah al ward tradicional', 80),
  ('Al Wataniah', 'sabah al ward', 74),
  ('Al Wataniah', 'durrat aroos', 70),
  ('Al Wataniah', 'attar al wesal', 65),
  ('Maison Alhambra', 'salvo', 72),
  ('Maison Alhambra', 'jean lowe', 72),
  ('Maison Alhambra', 'delilah', 68),
  ('Maison Alhambra', 'philos', 60),
  ('Maison Alhambra', 'glacier', 58),
  ('French Avenue', 'liquid brun', 82),
  ('French Avenue', 'spectre ghost', 70),
  ('French Avenue', 'vulcan feu', 70),
  ('French Avenue', 'royal blend', 65),
  ('French Avenue', 'cocoa morado', 60),
  ('Orientica', 'luxury collection royal amber', 70),
  ('Orientica', 'luxury collection amber noir', 65)
) AS v(b, k, s)
ON CONFLICT (brand_norm, key) DO UPDATE SET score = EXCLUDED.score;

CREATE OR REPLACE FUNCTION public.search_catalog(p_q text DEFAULT ''::text, p_type text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_brand text DEFAULT NULL::text, p_only_available boolean DEFAULT false, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0, p_availability text DEFAULT NULL::text, p_decant boolean DEFAULT false, p_accords text[] DEFAULT NULL::text[], p_sort text DEFAULT NULL::text, p_decant_ml integer DEFAULT NULL::integer, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric)
 RETURNS TABLE(id uuid, slug text, canonical_name text, brand text, gender_norm text, product_type text, concentration text, volume_ml integer, image_url text, in_stock boolean, stock_quantity integer, retail_price numeric, wholesale_price numeric, decant_available boolean, decant_price_2ml numeric, decant_price_5ml numeric, decant_price_10ml numeric, accords text[], sold integer, is_pinned boolean, is_new boolean, rank real, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with params as (
    select public.catalog_norm(p_q) as q,
           replace(public.catalog_norm(p_q), ' ', '') as qs,
           (select array_agg(public.catalog_norm(x)) from unnest(coalesce(p_accords, '{}'::text[])) x) as acc
  ),
  promo as (
    select pr.discount_percent, pr.applies_to, pr.product_ids
      from public.promotions pr
     where pr.active
       and (pr.starts_at is null or pr.starts_at <= now())
       and (pr.ends_at is null or pr.ends_at > now())
  ),
  views30 as (
    select v.product_id, count(*)::int as views
      from public.product_views v
     where v.viewed_at > now() - interval '30 days'
     group by v.product_id
  ),
  sales as (
    select i.product_id, sum(i.quantity)::int as sold
      from public.catalog_order_items i
      join public.catalog_orders o on o.id = i.order_id
     where o.is_confirmed and o.deleted_at is null and o.canceled_at is null
     group by i.product_id
  ),
  hype as (
    select x.id, max(case when x.n = r.key then r.score else round(r.score * 0.8)::int end) as hype
      from (select p0.id,
                   regexp_replace(public.catalog_norm(p0.canonical_name), ' (edp|edt|[0-9]+ ?ml)$', '') as n,
                   public.catalog_norm(coalesce(p0.brand, '')) as b
              from public.products p0
             where p0.active and p0.catalog_eligible and p0.product_type = 'PERFUME') x
      join public.perfume_hype r on r.brand_norm = x.b and (x.n = r.key or x.n like r.key || ' %')
     where x.n !~ '(gift set|capilar|unidades|desodorante|infantil|^kit | kit |creme)'
     group by x.id
  ),
  base as (
    select p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type,
           p.concentration, p.volume_ml, p.image_url, p.in_stock, p.stock_quantity,
           p.retail_price, p.wholesale_price, p.created_at,
           p.pinned_at, coalesce(p.pinned_new, false) as pinned_new,
           (p.product_type = 'PERFUME' and p.decant_available) as decant_available, p.decant_price_2ml, p.decant_price_5ml, p.decant_price_10ml,
           (select array_agg(a.accord_name order by a.position) from (
              select accord_name, position from public.fragrance_accords fa where fa.product_id = p.id order by position limit 3
            ) a) as accords,
           coalesce(s.sold, 0) as sold,
           coalesce(vw.views, 0) as views,
           coalesce(hy.hype, 0) as hype,
           (coalesce(hy.hype, 0) + 6 * least(coalesce(s.sold, 0), 12) + 0.3 * least(coalesce(vw.views, 0), 100))::numeric as pop,
           p.retail_price as base_price,
           coalesce(p.search_norm, public.catalog_norm(p.canonical_name)) as norm,
           public.catalog_norm(p.canonical_name) as name_norm,
           public.catalog_norm(coalesce(p.brand, '')) as brand_norm,
           params.q, params.qs
      from public.products p
      left join sales s on s.product_id = p.id
      left join views30 vw on vw.product_id = p.id
      left join hype hy on hy.id = p.id, params
     where p.active and p.catalog_eligible
       and (p_type is null or p.product_type = any(string_to_array(p_type, ',')))
       and (p_gender is null or p.gender_norm = p_gender)
       and (p_brand is null or p.brand = p_brand)
       and (not p_only_available or p.in_stock)
       and (not p_decant or (p.product_type = 'PERFUME' and p.decant_available))
       and (p_availability is null or p_availability = 'todos'
            or (p_availability = 'em-estoque' and p.in_stock)
            or (p_availability = 'sem-estoque' and not p.in_stock))
       and (p_accords is null or cardinality(p_accords) = 0 or exists (
              select 1 from public.fragrance_accords fa, params pr
               where fa.product_id = p.id and fa.position <= 4
                 and exists (select 1 from unnest(pr.acc) t where public.catalog_norm(fa.accord_name) like t || '%')))
  ),
  priced as (
    select b.*,
      case when b.base_price is null or b.base_price <= 0 then null else
        round(b.base_price * (1 - (
          select coalesce(max(pm.discount_percent), 0)
            from promo pm
           where pm.applies_to in ('BOTH', 'FULL')
             and (cardinality(pm.product_ids) = 0 or b.id = any(pm.product_ids))
        ) / 100.0), 2)
      end as eff_price
    from base b
  ),
  scored as (
    select b.*,
      (case
         when b.q = '' then 0
         when b.name_norm = b.q then 100
         when replace(b.name_norm, ' ', '') = b.qs then 96
         when b.name_norm like b.q || '%' then 90
         when replace(b.norm, ' ', '') like '%' || b.qs || '%' then 80
         else 0
       end)
      + (select coalesce(sum(case when replace(b.norm, ' ', '') like '%' || t || '%' then 9 else 0 end), 0)
           from unnest(string_to_array(b.q, ' ')) t where t <> '')
      + (40 * greatest(
            extensions.similarity(replace(b.norm, ' ', ''), b.qs),
            extensions.similarity(b.name_norm, b.q)))
      + (30 * greatest(
            extensions.similarity(b.brand_norm, b.q),
            (select coalesce(max(extensions.similarity(b.brand_norm, t)), 0)
               from unnest(string_to_array(b.q, ' ')) t where t <> '')))
      + (25 * (select coalesce(max(extensions.word_similarity(t, b.norm)), 0)
                 from unnest(string_to_array(b.q, ' ')) t where t <> ''))
      as score
    from priced b
  ),
  filtered as (
    select * from scored
     where (q = '' or score >= 14)
       and (p_sort is distinct from 'mais-vendidos' or sold > 0)
       and (p_sort is distinct from 'mais-acessados' or views > 0)
       and (p_price_min is null or (eff_price is not null and eff_price >= p_price_min))
       and (p_price_max is null or (eff_price is not null and eff_price <= p_price_max))
  )
  select id, slug, canonical_name, brand, gender_norm, product_type, concentration, volume_ml,
         image_url, in_stock, stock_quantity, retail_price, wholesale_price,
         decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml,
         accords, sold,
         (pinned_at is not null) as is_pinned,
         (pinned_at is not null and pinned_new) as is_new,
         score::real as rank,
         count(*) over () as total
    from filtered
   order by (case when q = '' and coalesce(p_sort, 'relevantes') = 'relevantes' and pinned_at is not null then 1 else 0 end) desc,
            (case when q = '' and coalesce(p_sort, 'relevantes') = 'relevantes' then pinned_at end) desc nulls last,
            (case when p_sort = 'preco-asc' then eff_price end) asc nulls last,
            (case when p_sort = 'preco-desc' then eff_price end) desc nulls last,
            (case when p_sort = 'mais-acessados' then views else 0 end) desc,
            (case when p_sort = 'novidades' then created_at else timestamptz 'epoch' end) desc,
            (case when p_sort = 'mais-vendidos' then sold else 0 end) desc,
            (case when q = '' and coalesce(p_sort, 'relevantes') = 'relevantes' then in_stock::int end) desc nulls last,
            (case when q = '' and coalesce(p_sort, 'relevantes') = 'relevantes' then pop end) desc nulls last,
            (case when q = '' then 0 else score end) desc, pop desc, in_stock desc, canonical_name asc, id asc
   limit greatest(1, least(coalesce(p_limit, 24), 96))
  offset greatest(0, coalesce(p_offset, 0));
$function$;


REVOKE ALL ON FUNCTION public.search_catalog(text, text, text, text, boolean, integer, integer, text, boolean, text[], text, integer, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_catalog(text, text, text, text, boolean, integer, integer, text, boolean, text[], text, integer, numeric, numeric) TO anon, authenticated, service_role;
