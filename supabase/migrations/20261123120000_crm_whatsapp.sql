-- CRM Orium: WhatsApp (ponte não oficial) + inteligência de leads.
-- A ponte nunca recebe a chave secreta: só chama as funções wa_bridge_* com um token
-- cujo hash fica em wa_bridge_state. Tudo o mais é só para a equipe (is_staff).

create extension if not exists pgcrypto with schema extensions;

-- Telefone canônico BR (11 dígitos). jid antigo sem o 9 (55 + DDD + 8) ganha o 9.
create or replace function public.wa_norm_phone(txt text)
returns text language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(txt, ''), '[^0-9]', '', 'g');
begin
  if d like '55%' and length(d) in (12, 13) then d := substr(d, 3); end if;
  if length(d) = 10 and substr(d, 3, 1) in ('6','7','8','9') then
    d := substr(d, 1, 2) || '9' || substr(d, 3);
  end if;
  return nullif(right(d, 11), '');
end $$;

create table if not exists public.wa_bridge_state (
  id boolean primary key default true check (id),
  status text not null default 'offline' check (status in ('offline','qr','connecting','online')),
  qr text,
  phone text,
  token_hash text,
  last_seen timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.wa_bridge_state (id) values (true) on conflict do nothing;

create table if not exists public.wa_contacts (
  jid text primary key,
  phone_normalized text,
  push_name text,
  customer_id uuid references public.crm_customers(id) on delete set null,
  stage text not null default 'novo' check (stage in ('novo','interessado','negociando','comprou','perdido')),
  unread integer not null default 0,
  pinned boolean not null default false,
  archived boolean not null default false,
  last_message_at timestamptz,
  last_message_preview text,
  last_from_me boolean,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wa_contacts_last_idx on public.wa_contacts (last_message_at desc);
create index if not exists wa_contacts_phone_idx on public.wa_contacts (phone_normalized);
create index if not exists wa_contacts_customer_idx on public.wa_contacts (customer_id);

create table if not exists public.wa_messages (
  id text primary key,
  jid text not null references public.wa_contacts(jid) on delete cascade,
  from_me boolean not null,
  body text,
  kind text not null default 'text',
  ts timestamptz not null,
  status text,
  created_at timestamptz not null default now()
);
create index if not exists wa_messages_jid_ts_idx on public.wa_messages (jid, ts desc);

create table if not exists public.wa_outbox (
  id uuid primary key default gen_random_uuid(),
  jid text not null references public.wa_contacts(jid) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  error text,
  wa_id text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists wa_outbox_pending_idx on public.wa_outbox (created_at) where status in ('pending','sending');

alter table public.wa_bridge_state enable row level security;
alter table public.wa_contacts enable row level security;
alter table public.wa_messages enable row level security;
alter table public.wa_outbox enable row level security;

drop policy if exists wa_state_staff on public.wa_bridge_state;
create policy wa_state_staff on public.wa_bridge_state for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists wa_contacts_staff on public.wa_contacts;
create policy wa_contacts_staff on public.wa_contacts for all to authenticated
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
drop policy if exists wa_messages_staff on public.wa_messages;
create policy wa_messages_staff on public.wa_messages for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists wa_outbox_staff_read on public.wa_outbox;
create policy wa_outbox_staff_read on public.wa_outbox for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists wa_outbox_staff_insert on public.wa_outbox;
create policy wa_outbox_staff_insert on public.wa_outbox for insert to authenticated with check (public.is_staff(auth.uid()));

-- o token_hash nunca sai para o navegador
revoke select on public.wa_bridge_state from authenticated, anon;
grant select (id, status, qr, phone, last_seen, updated_at) on public.wa_bridge_state to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.wa_contacts; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.wa_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.wa_bridge_state; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.wa_outbox; exception when duplicate_object then null; end;
end $$;

-- ---------- funções da ponte ----------
create or replace function public.wa_bridge_ok(p_token text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce(length(p_token) >= 32 and token_hash = encode(digest(p_token, 'sha256'), 'hex'), false)
    from public.wa_bridge_state where id
$$;
revoke all on function public.wa_bridge_ok(text) from public, anon, authenticated;

create or replace function public.wa_bridge_heartbeat(p_token text, p_status text, p_qr text default null, p_phone text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  update public.wa_bridge_state
     set status = p_status, qr = case when p_status = 'qr' then p_qr else null end,
         phone = coalesce(p_phone, phone), last_seen = now(), updated_at = now()
   where id;
end $$;

-- p_messages: [{id, jid, from_me, body, kind, ts (epoch s), push_name}]
create or replace function public.wa_bridge_ingest(p_token text, p_messages jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare m jsonb; n integer := 0; v_ts timestamptz; v_phone text; v_new boolean;
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  for m in select * from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) loop
    continue when coalesce(m->>'jid', '') !~ '@s\.whatsapp\.net$';
    v_ts := to_timestamp((m->>'ts')::double precision);
    v_phone := public.wa_norm_phone(split_part(m->>'jid', '@', 1));
    insert into public.wa_contacts (jid, phone_normalized, push_name, customer_id)
    values (m->>'jid', v_phone, case when not coalesce((m->>'from_me')::boolean, false) then nullif(m->>'push_name', '') end,
            (select id from public.crm_customers c where c.phone_normalized = v_phone and c.archived_at is null
              order by c.created_at limit 1))
    on conflict (jid) do update
       set push_name = coalesce(excluded.push_name, wa_contacts.push_name),
           customer_id = coalesce(wa_contacts.customer_id, excluded.customer_id);

    v_new := null;
    insert into public.wa_messages (id, jid, from_me, body, kind, ts)
    values (m->>'id', m->>'jid', coalesce((m->>'from_me')::boolean, false), left(m->>'body', 8000), coalesce(m->>'kind', 'text'), v_ts)
    on conflict (id) do nothing
    returning true into v_new;
    continue when v_new is null;
    n := n + 1;

    update public.wa_contacts set
      last_message_preview = case when last_message_at is null or v_ts >= last_message_at
        then left(coalesce(nullif(m->>'body', ''), '['||coalesce(m->>'kind','mídia')||']'), 140) else last_message_preview end,
      last_from_me = case when last_message_at is null or v_ts >= last_message_at
        then coalesce((m->>'from_me')::boolean, false) else last_from_me end,
      last_message_at = greatest(coalesce(last_message_at, v_ts), v_ts),
      last_inbound_at = case when not coalesce((m->>'from_me')::boolean, false) then greatest(coalesce(last_inbound_at, v_ts), v_ts) else last_inbound_at end,
      last_outbound_at = case when coalesce((m->>'from_me')::boolean, false) then greatest(coalesce(last_outbound_at, v_ts), v_ts) else last_outbound_at end,
      unread = case when coalesce((m->>'from_me')::boolean, false) then 0
                    when coalesce((m->>'history')::boolean, false) then unread else unread + 1 end,
      archived = false,
      updated_at = now()
    where jid = m->>'jid';
  end loop;
  return n;
end $$;

create or replace function public.wa_bridge_claim_outbox(p_token text)
returns table (id uuid, jid text, body text) language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  -- "sending" parado há mais de 2 min volta para a fila (ponte caiu no meio)
  update public.wa_outbox o set status = 'pending' where o.status = 'sending' and o.created_at < now() - interval '2 minutes' and o.sent_at is null;
  return query
  update public.wa_outbox o set status = 'sending'
   where o.id in (select x.id from public.wa_outbox x where x.status = 'pending' order by x.created_at limit 10 for update skip locked)
  returning o.id, o.jid, o.body;
end $$;

create or replace function public.wa_bridge_outbox_result(p_token text, p_id uuid, p_ok boolean, p_wa_id text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  update public.wa_outbox set status = case when p_ok then 'sent' else 'failed' end,
         wa_id = p_wa_id, error = left(p_error, 300), sent_at = case when p_ok then now() end
   where id = p_id;
end $$;

grant execute on function public.wa_bridge_heartbeat(text, text, text, text) to anon, authenticated;
grant execute on function public.wa_bridge_ingest(text, jsonb) to anon, authenticated;
grant execute on function public.wa_bridge_claim_outbox(text) to anon, authenticated;
grant execute on function public.wa_bridge_outbox_result(text, uuid, boolean, text, text) to anon, authenticated;

-- Staff gera um token novo para a ponte (mostrado uma vez).
create or replace function public.wa_bridge_new_token()
returns text language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(24), 'hex');
begin
  if not public.is_staff(auth.uid()) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.wa_bridge_state set token_hash = encode(digest(t, 'sha256'), 'hex'), updated_at = now() where id;
  return t;
end $$;
revoke all on function public.wa_bridge_new_token() from public, anon;
grant execute on function public.wa_bridge_new_token() to authenticated;

-- Cliente novo no CRM com o mesmo número: liga as conversas soltas.
create or replace function public.wa_link_on_customer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone_normalized is not null then
    update public.wa_contacts set customer_id = new.id
     where customer_id is null and phone_normalized = new.phone_normalized;
  end if;
  return new;
end $$;
drop trigger if exists wa_link_on_customer on public.crm_customers;
create trigger wa_link_on_customer after insert or update of phone_normalized on public.crm_customers
  for each row execute function public.wa_link_on_customer();

-- ---------- inteligência de leads ----------
-- Um objeto por cliente com tudo que o CRM precisa para pontuar e explicar.
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
    select cid, jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'decant', is_decant, 'at', at) order by at desc) as recent_items
      from (select *, row_number() over (partition by cid order by at desc) rk from items) x where rk <= 6 group by cid
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
                                    'last_at', max(v2.viewed_at), 'price', p.retail_price, 'in_stock', p.in_stock,
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
             'names', coalesce((select jsonb_agg(ci.product_name) from public.cart_items ci where ci.cart_id = sc.id), '[]')) as cart
      from public.shopping_carts sc
     where sc.status in ('active', 'abandoned') and sc.items_count > 0 and sc.converted_at is null
       and ((c.user_id is not null and sc.user_id = c.user_id)
         or (c.phone_normalized is not null and sc.phone_normalized = c.phone_normalized)
         or (sc.anonymous_id is not null and sc.anonymous_id = any(c.devs)))
     order by sc.last_activity_at desc limit 1
  ) cart on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.canonical_name, 'in_stock', p.in_stock, 'price', p.retail_price)) as favs
      from (select distinct f.product_id from public.favorites f
             where (c.user_id is not null and f.user_id = c.user_id) or (f.anonymous_id is not null and f.anonymous_id = any(c.devs))) f
      join public.products p on p.id = f.product_id
  ) fav on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.canonical_name, 'in_stock', p.in_stock, 'since', s.created_at)) as waiting
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
