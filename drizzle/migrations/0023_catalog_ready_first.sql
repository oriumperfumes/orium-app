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
  base as (
    select p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type,
           p.concentration, p.volume_ml, p.image_url, p.in_stock, p.stock_quantity,
           p.retail_price, p.wholesale_price, p.created_at,
           p.pinned_at, coalesce(p.pinned_new, false) as pinned_new, coalesce(p.ready_to_deliver, false) as ready,
           (p.product_type = 'PERFUME' and p.decant_available) as decant_available, p.decant_price_2ml, p.decant_price_5ml, p.decant_price_10ml,
           (select array_agg(a.accord_name order by a.position) from (
              select accord_name, position from public.fragrance_accords fa where fa.product_id = p.id order by position limit 3
            ) a) as accords,
           coalesce(s.sold, 0) as sold,
           coalesce(vw.views, 0) as views,
           p.retail_price as base_price,
           coalesce(p.search_norm, public.catalog_norm(p.canonical_name)) as norm,
           public.catalog_norm(p.canonical_name) as name_norm,
           public.catalog_norm(coalesce(p.brand, '')) as brand_norm,
           params.q, params.qs
      from public.products p
      left join sales s on s.product_id = p.id
      left join views30 vw on vw.product_id = p.id, params
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
   order by (case when coalesce(p_sort,'') not in ('preco-asc','preco-desc') and ready then 1 else 0 end) desc,
            (case when q = '' and coalesce(p_sort, 'relevantes') = 'relevantes' and pinned_at is not null then 1 else 0 end) desc,
            (case when q = '' and coalesce(p_sort, 'relevantes') = 'relevantes' then pinned_at end) desc nulls last,
            (case when p_sort = 'preco-asc' then eff_price end) asc nulls last,
            (case when p_sort = 'preco-desc' then eff_price end) desc nulls last,
            (case when p_sort = 'mais-acessados' then views else 0 end) desc,
            (case when p_sort = 'novidades' then created_at else timestamptz 'epoch' end) desc,
            (case when p_sort = 'mais-vendidos' then sold else 0 end) desc,
            (case when q = '' then 0 else score end) desc, in_stock desc, canonical_name asc, id asc
   limit greatest(1, least(coalesce(p_limit, 24), 96))
  offset greatest(0, coalesce(p_offset, 0));
$function$;