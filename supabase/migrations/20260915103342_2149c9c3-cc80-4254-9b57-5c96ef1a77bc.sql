create or replace function public.admin_dashboard(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_span interval := greatest(p_to - p_from, interval '1 hour');
  v_prev_from timestamptz := p_from - v_span;
  v_hourly boolean := (p_to - p_from) <= interval '36 hours';
  v_out jsonb;
begin
  if not public.is_staff() then
    raise exception 'forbidden';
  end if;

  with items as (
    select order_id,
           sum(subtotal) as rev,
           sum(coalesce(unit_cost_snapshot,0) * quantity) as cost
    from catalog_order_items
    group by order_id
  ),
  o as (
    select c.id, c.status, c.is_confirmed, c.created_at, c.customer_name, c.order_number,
           c.customer_phone_normalized, c.payment_method,
           coalesce(c.shipping_price,0)::numeric as shipping,
           coalesce(i.rev, nullif(c.items_subtotal,0), c.sales_total, c.grand_total, 0)::numeric as revenue,
           coalesce(i.cost, c.cost_total, 0)::numeric as cost
    from catalog_orders c
    left join items i on i.order_id = c.id
    where c.deleted_at is null
      and c.canceled_at is null
      and coalesce(lower(c.status),'') <> 'cancelado'
  ),
  cur as (select * from o where created_at >= p_from and created_at < p_to),
  prev as (select * from o where created_at >= v_prev_from and created_at < p_from),
  cur_items as (
    select i.*, c.created_at as order_at
    from catalog_order_items i
    join cur c on c.id = i.order_id
  ),
  totals as (
    select
      (select count(*) from cur) as orders,
      (select coalesce(sum(revenue),0) from cur) as revenue,
      (select coalesce(sum(cost),0) from cur) as cost,
      (select coalesce(sum(shipping),0) from cur) as shipping,
      (select count(*) from prev) as prev_orders,
      (select coalesce(sum(revenue),0) from prev) as prev_revenue,
      (select coalesce(sum(revenue - cost),0) from prev) as prev_profit
  ),
  buckets as (
    select gs as bucket_start,
           gs + (case when v_hourly then interval '1 hour' else interval '1 day' end) as bucket_end
    from generate_series(
      date_trunc(case when v_hourly then 'hour' else 'day' end, p_from),
      p_to - interval '1 second',
      case when v_hourly then interval '1 hour' else interval '1 day' end
    ) gs
  ),
  series as (
    select b.bucket_start,
           count(c.id) as orders,
           coalesce(sum(c.revenue),0) as revenue,
           coalesce(sum(c.revenue - c.cost),0) as profit
    from buckets b
    left join cur c on c.created_at >= b.bucket_start and c.created_at < b.bucket_end
    group by b.bucket_start
    order by b.bucket_start
  ),
  top_products as (
    select i.product_id,
           coalesce(p.canonical_name, max(i.product_name_snapshot)) as name,
           p.brand,
           coalesce(p.image_url, max(i.image_snapshot)) as image_url,
           sum(i.quantity)::int as units,
           sum(i.subtotal)::numeric as revenue,
           sum(i.subtotal - coalesce(i.unit_cost_snapshot,0) * i.quantity)::numeric as profit,
           sum(case when upper(coalesce(i.variant,'FULL')) = 'DECANT' then i.quantity else 0 end)::int as decants,
           sum(case when upper(coalesce(i.variant,'FULL')) <> 'DECANT' then i.quantity else 0 end)::int as bottles
    from cur_items i
    left join products p on p.id = i.product_id
    group by i.product_id, p.canonical_name, p.brand, p.image_url
  ),
  pending as (
    select * from o where lower(coalesce(status,'')) = 'pendente'
  ),
  restock as (
    select ri.quantity, ri.unit_cost, coalesce(ri.extra_fee,0) as extra_fee,
           s.name as supplier, p.canonical_name as product, p.stock_quantity
    from restock_items ri
    join restock_lists rl on rl.id = ri.restock_list_id and rl.status = 'aberta'
    left join suppliers s on s.id = ri.supplier_id
    left join products p on p.id = ri.product_id
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'bucket', case when v_hourly then 'hour' else 'day' end,
    'period', (
      select jsonb_build_object(
        'orders', t.orders,
        'revenue', round(t.revenue,2),
        'cost', round(t.cost,2),
        'profit', round(t.revenue - t.cost,2),
        'margin', case when t.revenue > 0 then round((t.revenue - t.cost) / t.revenue * 100, 1) else null end,
        'ticket', case when t.orders > 0 then round(t.revenue / t.orders, 2) else null end,
        'shipping', round(t.shipping,2),
        'previous', jsonb_build_object(
          'orders', t.prev_orders,
          'revenue', round(t.prev_revenue,2),
          'profit', round(t.prev_profit,2),
          'ticket', case when t.prev_orders > 0 then round(t.prev_revenue / t.prev_orders, 2) else null end
        )
      ) from totals t
    ),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'at', bucket_start, 'orders', orders,
        'revenue', round(revenue,2), 'profit', round(profit,2)
      ) order by bucket_start), '[]'::jsonb) from series
    ),
    'top_products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', product_id, 'name', name, 'brand', brand, 'image_url', image_url,
        'units', units, 'revenue', round(revenue,2), 'profit', round(profit,2),
        'decants', decants, 'bottles', bottles
      ) order by units desc, revenue desc), '[]'::jsonb) from top_products
    ),
    'pending', (
      select jsonb_build_object(
        'count', (select count(*) from pending),
        'total', (select round(coalesce(sum(revenue),0),2) from pending),
        'recent', (
          select coalesce(jsonb_agg(x), '[]'::jsonb) from (
            select jsonb_build_object(
              'id', id, 'order_number', order_number, 'customer', customer_name,
              'total', round(revenue,2), 'at', created_at, 'status', status
            ) as x
            from pending order by created_at desc limit 3
          ) s
        )
      )
    ),
    'status_counts', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', n) order by n desc), '[]'::jsonb)
      from (select coalesce(status,'—') as status, count(*) as n from o group by 1) s
    ),
    'attention', jsonb_build_object(
      'pending_orders', (select count(*) from pending),
      'restock_items', (select count(*) from restock),
      'review_products', (select count(*) from product_matches where status = 'pending'),
      'negotiation_interests', (select count(*) from negotiation_interests where notified is not true)
    ),
    'restock', jsonb_build_object(
      'items', (select count(*) from restock),
      'units', (select coalesce(sum(quantity),0) from restock),
      'cost', (select round(coalesce(sum(quantity * coalesce(unit_cost,0) + extra_fee),0),2) from restock),
      'suppliers', (
        select coalesce(jsonb_agg(jsonb_build_object('supplier', supplier, 'units', units, 'cost', round(cost,2)) order by cost desc), '[]'::jsonb)
        from (
          select coalesce(supplier,'Sem fornecedor') as supplier,
                 sum(quantity) as units,
                 sum(quantity * coalesce(unit_cost,0) + extra_fee) as cost
          from restock group by 1
        ) s
      ),
      'low_stock', (
        select coalesce(jsonb_agg(jsonb_build_object('product', product, 'stock', stock_quantity) order by stock_quantity asc nulls last), '[]'::jsonb)
        from (
          select distinct product, stock_quantity from restock
          where product is not null and coalesce(stock_quantity,0) <= 1
          order by stock_quantity asc nulls last limit 3
        ) s
      )
    ),
    'customers', jsonb_build_object(
      'new', (select count(*) from crm_customers where created_at >= p_from and created_at < p_to),
      'leads', (select count(*) from crm_customers where lead_trigger is not null and created_at >= p_from and created_at < p_to),
      'returning', (
        select count(*) from (
          select customer_phone_normalized from o
          where customer_phone_normalized is not null
          group by 1 having count(*) > 1
        ) s
      ),
      'total', (select count(*) from crm_customers where archived_at is null)
    ),
    'live', (
      select jsonb_build_object(
        'visitors', count(*),
        'with_cart', count(*) filter (where coalesce(cart_items,0) > 0),
        'in_checkout', count(*) filter (where in_checkout is true)
      )
      from live_sessions
      where last_activity_at > now() - interval '5 minutes'
    ),
    'stock', (
      select jsonb_build_object(
        'available', count(*) filter (where p.in_stock),
        'cost', round(coalesce(sum(case when p.in_stock then coalesce(pc.best_cost, p.manual_cost, 0) else 0 end),0),2)
      )
      from products p
      left join product_costs pc on pc.product_id = p.id
      where p.active
    ),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object('method', method, 'orders', n, 'revenue', round(rev,2)) order by n desc), '[]'::jsonb)
      from (
        select coalesce(upper(payment_method),'—') as method, count(*) as n, sum(revenue) as rev
        from cur group by 1
      ) s
    ),
    'variants', (
      select jsonb_build_object(
        'bottles', coalesce(sum(case when upper(coalesce(variant,'FULL')) <> 'DECANT' then quantity else 0 end),0),
        'decants', coalesce(sum(case when upper(coalesce(variant,'FULL')) = 'DECANT' then quantity else 0 end),0),
        'ml_2', coalesce(sum(case when decant_ml = 2 then quantity else 0 end),0),
        'ml_5', coalesce(sum(case when decant_ml = 5 then quantity else 0 end),0),
        'ml_10', coalesce(sum(case when decant_ml = 10 then quantity else 0 end),0)
      ) from cur_items
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.admin_dashboard(timestamptz, timestamptz) from public;
grant execute on function public.admin_dashboard(timestamptz, timestamptz) to authenticated, service_role;