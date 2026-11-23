-- CRM: fotos dos perfumes no retrato do cliente (vistos, favoritos, carrinho, compras).
create or replace function public.crm_leads()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.is_staff(auth.uid()) then raise exception 'sem permissão' using errcode = '42501'; end if;

  with c as (
    select c.*, coalesce((select array_agg(d.device_id) from public.crm_customer_devices d where d.customer_id = c.id), '{}') as devs
      from public.crm_customers c where c.archived_at is null
  ),
  items as (
    select o.crm_customer_id as cid, o.id as oid, coalesce(o.confirmed_at, o.created_at) as at,
           coalesce(o.final_total, o.grand_total, o.sales_total, 0) as order_total,
           i.product_id, coalesce(i.product_name_snapshot, '') as name,
           (upper(coalesce(i.variant, '')) = 'DECANT' or i.decant_ml is not null) as is_decant,
           i.quantity, coalesce(i.unit_sale_price, 0) as unit_price,
           (i.promotion_id is not null or coalesce(i.coupon_discount, 0) > 0 or o.coupon_id is not null) as promo
      from public.catalog_orders o join public.catalog_order_items i on i.order_id = o.id
     where o.crm_customer_id is not null and o.deleted_at is null and o.canceled_at is null and o.status <> 'cancelado'
    union all
    select s.customer_id, s.id, s.sold_at, coalesce(s.total, 0),
           i.product_id, coalesce(i.product_name_snapshot, ''),
           (upper(coalesce(i.variant, '')) = 'DECANT' or i.decant_ml is not null),
           i.quantity, coalesce(i.unit_price, 0), coalesce(s.discount, 0) > 0
      from public.store_sales s join public.store_sale_items i on i.sale_id = s.id
     where s.customer_id is not null and s.deleted_at is null and s.canceled_at is null
  ),
  orders as (
    select cid, oid, min(at) as at, max(order_total) as total from items group by cid, oid
  ),
  buy as (
    select o.cid,
           count(*)::int as orders_count,
           round(sum(o.total), 2) as spent,
           min(o.at) as first_order_at, max(o.at) as last_order_at,
           case when count(*) > 1 then round(extract(epoch from (max(o.at) - min(o.at))) / 86400 / (count(*) - 1)) end as avg_interval_days
      from orders o group by o.cid
  ),
  buyi as (
    select cid,
           sum(quantity) filter (where is_decant)::int as decant_units,
           sum(quantity) filter (where not is_decant)::int as bottle_units,
           round(avg(unit_price) filter (where not is_decant), 2) as avg_bottle_price,
           round(avg(unit_price) filter (where is_decant), 2) as avg_decant_price,
           max(unit_price) as max_item_price,
           (count(*) filter (where promo))::int as promo_items,
           count(*)::int as total_items,
           max(at) filter (where is_decant) as last_decant_at,
           array_agg(distinct product_id) filter (where product_id is not null) as bought_ids
      from items group by cid
  ),
  brands as (
    select cid, jsonb_agg(brand order by n desc) as top_brands from (
      select i.cid, p.brand, sum(i.quantity) as n,
             row_number() over (partition by i.cid order by sum(i.quantity) desc) as rk
        from items i join public.products p on p.id = i.product_id
       where p.brand is not null group by i.cid, p.brand) b
     where rk <= 3 group by cid
  ),
  last_items as (
    select x.cid, jsonb_agg(jsonb_build_object('product_id', x.product_id, 'name', x.name, 'decant', x.is_decant, 'at', x.at, 'image_url', p.image_url) order by x.at desc) as recent_items
      from (select *, row_number() over (partition by cid order by at desc) rk from items) x
      left join public.products p on p.id = x.product_id
     where x.rk <= 6 group by x.cid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone_normalized, 'user_id', c.user_id, 'created_at', c.created_at,
    'first_source', c.first_source, 'lead_trigger', c.lead_trigger, 'optin', c.marketing_optin,
    'orders_count', coalesce(b.orders_count, 0), 'spent', coalesce(b.spent, 0),
    'first_order_at', b.first_order_at, 'last_order_at', b.last_order_at, 'avg_interval_days', b.avg_interval_days,
    'decant_units', coalesce(bi.decant_units, 0), 'bottle_units', coalesce(bi.bottle_units, 0),
    'avg_bottle_price', bi.avg_bottle_price, 'avg_decant_price', bi.avg_decant_price, 'max_item_price', bi.max_item_price,
    'promo_items', coalesce(bi.promo_items, 0), 'total_items', coalesce(bi.total_items, 0),
    'last_decant_at', bi.last_decant_at, 'top_brands', coalesce(br.top_brands, '[]'), 'recent_items', coalesce(li.recent_items, '[]'),
    'views', v.views,
    'cart', cart.cart,
    'favorites', fav.favs,
    'waiting', w.waiting,
    'live', live.live,
    'wa', wa.wa
  ) order by c.created_at desc), '[]'::jsonb) into out
  from c
  left join buy b on b.cid = c.id
  left join buyi bi on bi.cid = c.id
  left join brands br on br.cid = c.id
  left join last_items li on li.cid = c.id
  left join lateral (
    select jsonb_build_object(
      'd7', count(*) filter (where pv.viewed_at > now() - interval '7 days'),
      'd30', count(*),
      'last_at', max(pv.viewed_at),
      'top', coalesce((select jsonb_agg(t) from (
          select jsonb_build_object('product_id', p.id, 'name', p.canonical_name, 'brand', p.brand, 'views', count(*)::int,
                                    'last_at', max(v2.viewed_at), 'price', p.retail_price, 'in_stock', p.in_stock, 'image_url', p.image_url,
                                    'bought', p.id = any(coalesce(bi.bought_ids, '{}'))) t
            from public.product_views v2 join public.products p on p.id = v2.product_id
           where v2.viewed_at > now() - interval '30 days'
             and ((c.user_id is not null and v2.user_id = c.user_id) or (v2.anonymous_id is not null and v2.anonymous_id = any(c.devs)))
           group by p.id order by count(*) desc, max(v2.viewed_at) desc limit 5) z), '[]')) as views
      from public.product_views pv
     where pv.viewed_at > now() - interval '30 days'
       and ((c.user_id is not null and pv.user_id = c.user_id) or (pv.anonymous_id is not null and pv.anonymous_id = any(c.devs)))
  ) v on true
  left join lateral (
    select jsonb_build_object('id', sc.id, 'status', sc.status, 'items', sc.items_count, 'total', sc.estimated_total,
             'last_at', sc.last_activity_at, 'abandoned_at', sc.abandoned_at,
             'names', coalesce((select jsonb_agg(ci.product_name) from public.cart_items ci where ci.cart_id = sc.id), '[]'),
             'products', coalesce((select jsonb_agg(jsonb_build_object('product_id', ci.product_id, 'name', ci.product_name, 'image_url', ci.image_url, 'decant_ml', ci.decant_ml, 'price', ci.unit_price)) from public.cart_items ci where ci.cart_id = sc.id), '[]')) as cart
      from public.shopping_carts sc
     where sc.status in ('active', 'abandoned') and sc.items_count > 0 and sc.converted_at is null
       and ((c.user_id is not null and sc.user_id = c.user_id)
         or (c.phone_normalized is not null and sc.phone_normalized = c.phone_normalized)
         or (sc.anonymous_id is not null and sc.anonymous_id = any(c.devs)))
     order by sc.last_activity_at desc limit 1
  ) cart on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.canonical_name, 'in_stock', p.in_stock, 'price', p.retail_price, 'image_url', p.image_url)) as favs
      from (select distinct f.product_id from public.favorites f
             where (c.user_id is not null and f.user_id = c.user_id) or (f.anonymous_id is not null and f.anonymous_id = any(c.devs))) f
      join public.products p on p.id = f.product_id
  ) fav on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.canonical_name, 'in_stock', p.in_stock, 'since', s.created_at, 'image_url', p.image_url)) as waiting
      from public.back_in_stock_subscriptions s join public.products p on p.id = s.product_id
     where s.active and s.canceled_at is null
       and ((c.user_id is not null and s.user_id = c.user_id)
         or (c.phone_normalized is not null and s.phone_normalized = c.phone_normalized)
         or (s.anonymous_id is not null and s.anonymous_id = any(c.devs)))
  ) w on true
  left join lateral (
    select jsonb_build_object('active', ls.is_active, 'product', ls.current_product_name, 'intent', ls.intent,
             'checkout', ls.in_checkout, 'cart_total', ls.cart_total, 'at', ls.last_activity_at) as live
      from public.live_sessions ls
     where ls.customer_id = c.id and ls.last_activity_at > now() - interval '30 minutes'
     order by ls.last_activity_at desc limit 1
  ) live on true
  left join lateral (
    select jsonb_build_object('jid', wc.jid, 'stage', wc.stage, 'unread', wc.unread,
             'last_inbound_at', wc.last_inbound_at, 'last_outbound_at', wc.last_outbound_at,
             'last_from_me', wc.last_from_me, 'preview', wc.last_message_preview) as wa
      from public.wa_contacts wc where wc.customer_id = c.id
     order by wc.last_message_at desc nulls last limit 1
  ) wa on true;

  return out;
end $$;
revoke all on function public.crm_leads() from public, anon;
grant execute on function public.crm_leads() to authenticated;
