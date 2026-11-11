CREATE OR REPLACE FUNCTION public.search_catalog(p_q text DEFAULT ''::text, p_type text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_brand text DEFAULT NULL::text, p_only_available boolean DEFAULT false, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0, p_availability text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, slug text, canonical_name text, brand text, gender_norm text, product_type text, concentration text, volume_ml integer, image_url text, in_stock boolean, stock_quantity integer, retail_price numeric, wholesale_price numeric, rank real, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with params as (
    select public.catalog_norm(p_q) as q,
           replace(public.catalog_norm(p_q), ' ', '') as qs
  ),
  base as (
    select p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type,
           p.concentration, p.volume_ml, p.image_url, p.in_stock, p.stock_quantity,
           p.retail_price, p.wholesale_price,
           coalesce(p.search_norm, public.catalog_norm(p.canonical_name)) as norm,
           public.catalog_norm(p.canonical_name) as name_norm,
           public.catalog_norm(coalesce(p.brand, '')) as brand_norm,
           params.q, params.qs
      from public.products p, params
     where p.active and p.catalog_eligible
       and (p_type is null or p.product_type = p_type)
       and (p_gender is null or p.gender_norm = p_gender)
       and (p_brand is null or p.brand = p_brand)
       and (not p_only_available or p.in_stock)
       and (p_availability is null or p_availability = 'todos'
            or (p_availability = 'em-estoque' and p.in_stock)
            or (p_availability = 'sem-estoque' and not p.in_stock))
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
    from base b
  ),
  filtered as (
    select * from scored where q = '' or score >= 14
  )
  select id, slug, canonical_name, brand, gender_norm, product_type, concentration, volume_ml,
         image_url, in_stock, stock_quantity, retail_price, wholesale_price,
         score::real as rank,
         count(*) over () as total
    from filtered
   order by (case when q = '' then 0 else score end) desc, in_stock desc, canonical_name asc
   limit greatest(1, least(coalesce(p_limit, 24), 96))
  offset greatest(0, coalesce(p_offset, 0));
$function$;