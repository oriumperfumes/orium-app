-- Dashboard por canal: app (pedidos) + loja (vendas físicas) na mesma fonte financeira.
-- O funil digital (analytics_funnel) continua intocado.

CREATE OR REPLACE FUNCTION public.admin_dashboard(p_from timestamptz, p_to timestamptz, p_channel text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_span interval := greatest(p_to - p_from, interval '1 hour');
  v_prev_from timestamptz := p_from - v_span;
  v_hourly boolean := (p_to - p_from) <= interval '36 hours';
  v_channel text := coalesce(nullif(p_channel,''), 'all');
  v_app boolean := v_channel in ('all','app');
  v_store boolean := v_channel in ('all','store');
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
           coalesce(i.cost, c.cost_total, 0)::numeric as cost,
           'app'::text as channel
    from catalog_orders c
    left join items i on i.order_id = c.id
    where v_app
      and c.deleted_at is null
      and c.canceled_at is null
      and coalesce(lower(c.status),'') <> 'cancelado'
    union all
    select s.id, 'concluida'::text as status, true as is_confirmed, s.sold_at as created_at,
           s.customer_name, s.sale_number, null::text as customer_phone_normalized, s.payment_method,
           0::numeric as shipping, s.total::numeric as revenue, s.cost_total::numeric as cost,
           'store'::text as channel
    from store_sales s
    where v_store and s.status = 'confirmada'
  ),
  cur as (select * from o where created_at >= p_from and created_at < p_to),
  prev as (select * from o where created_at >= v_prev_from and created_at < p_from),
  cur_items as (
    select i.product_id, i.quantity, i.subtotal, i.unit_cost_snapshot, i.variant, i.decant_ml,
           c.created_at as order_at
    from catalog_order_items i
    join cur c on c.id = i.order_id and c.channel = 'app'
    union all
    select si.product_id, si.quantity, si.subtotal, si.unit_cost_snapshot, si.variant, si.decant_ml,
           c.created_at as order_at
    from store_sale_items si
    join cur c on c.id = si.sale_id and c.channel = 'store'
  ),
  totals as (
    select
      (select count(*) from cur) as orders,
      (select coalesce(sum(revenue),0) from cur) as revenue,
      (select coalesce(sum(cost),0) from cur) as cost,
      (select coalesce(sum(shipping),0) from cur) as shipping,
      (select count(*) from prev) as prev_orders,
      (select coalesce(sum(revenue),0) from prev) as prev_revenue,
      (select coalesce(sum(revenue - cost),0) from prev) as prev_profit,
      (select count(*) from cur where channel = 'app') as app_orders,
      (select coalesce(sum(revenue),0) from cur where channel = 'app') as app_revenue,
      (select count(*) from cur where channel = 'store') as store_sales,
      (select coalesce(sum(revenue),0) from cur where channel = 'store') as store_revenue
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
           coalesce(p.canonical_name, 'Perfume') as name,
           p.brand,
           p.image_url,
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
    select * from o where channel = 'app' and lower(coalesce(status,'')) = 'pendente'
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
    'channel', v_channel,
    'bucket', case when v_hourly then 'hour' else 'day' end,
    'period', (
      select jsonb_build_object(
        'orders', t.orders,
        'app_orders', t.app_orders,
        'store_sales', t.store_sales,
        'app_revenue', round(t.app_revenue,2),
        'store_revenue', round(t.store_revenue,2),
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
$function$;

-- A versão de dois argumentos passa a delegar para todos os canais.
CREATE OR REPLACE FUNCTION public.admin_dashboard(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.admin_dashboard(p_from, p_to, 'all');
$$;

-- Mais vendidos passa a somar app + loja.
CREATE OR REPLACE FUNCTION public.top_sold_products(p_days integer DEFAULT 30, p_limit integer DEFAULT 12)
RETURNS TABLE(id uuid, slug text, canonical_name text, brand text, gender_norm text, product_type text, concentration text, volume_ml integer, image_url text, in_stock boolean, retail_price numeric, wholesale_price numeric, decant_available boolean, decant_price_2ml numeric, decant_price_5ml numeric, decant_price_10ml numeric, sold integer, period_days integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 12), 24));
  v_days integer := greatest(1, least(coalesce(p_days, 30), 3650));
  v_window integer;
  v_min_products constant integer := 4;
BEGIN
  SELECT w INTO v_window FROM (
    SELECT x.w, (
      SELECT count(DISTINCT v.product_id)
        FROM (
          SELECT i.product_id, i.quantity, o.created_at
            FROM public.catalog_order_items i
            JOIN public.catalog_orders o ON o.id = i.order_id
           WHERE o.is_confirmed AND o.deleted_at IS NULL AND o.canceled_at IS NULL
          UNION ALL
          SELECT si.product_id, si.quantity, s.sold_at
            FROM public.store_sale_items si
            JOIN public.store_sales s ON s.id = si.sale_id
           WHERE s.status = 'confirmada'
        ) v
        JOIN public.products p ON p.id = v.product_id
       WHERE v.quantity > 0
         AND p.active AND p.catalog_eligible AND p.retail_price IS NOT NULL
         AND (x.w IS NULL OR v.created_at > now() - (x.w || ' days')::interval)
    ) AS n, x.ord
      FROM (VALUES (v_days, 1), (90, 2), (NULL::integer, 3)) AS x(w, ord)
  ) q
  WHERE q.n >= v_min_products
  ORDER BY q.ord
  LIMIT 1;

  IF NOT FOUND THEN
    v_window := NULL;
  END IF;

  RETURN QUERY
  WITH v AS (
    SELECT i.product_id, i.quantity, o.created_at
      FROM public.catalog_order_items i
      JOIN public.catalog_orders o ON o.id = i.order_id
     WHERE o.is_confirmed AND o.deleted_at IS NULL AND o.canceled_at IS NULL
    UNION ALL
    SELECT si.product_id, si.quantity, s.sold_at
      FROM public.store_sale_items si
      JOIN public.store_sales s ON s.id = si.sale_id
     WHERE s.status = 'confirmada'
  ),
  s AS (
    SELECT v.product_id, sum(v.quantity)::int AS sold, max(v.created_at) AS last_sale
      FROM v
     WHERE v.quantity > 0
       AND (v_window IS NULL OR v.created_at > now() - (v_window || ' days')::interval)
     GROUP BY v.product_id
  )
  SELECT p.id, p.slug, p.canonical_name, p.brand, p.gender_norm, p.product_type,
         p.concentration, p.volume_ml, p.image_url, p.in_stock,
         p.retail_price, p.wholesale_price,
         (p.product_type = 'PERFUME' AND p.decant_available) AS decant_available,
         p.decant_price_2ml, p.decant_price_5ml, p.decant_price_10ml,
         s.sold, coalesce(v_window, 0) AS period_days
    FROM s
    JOIN public.products p ON p.id = s.product_id
   WHERE p.active AND p.catalog_eligible AND p.retail_price IS NOT NULL
   ORDER BY s.sold DESC, s.last_sale DESC, p.in_stock DESC
   LIMIT v_limit;
END;
$function$;
