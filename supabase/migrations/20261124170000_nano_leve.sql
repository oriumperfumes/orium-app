-- Orium no Supabase Nano (grátis) sem quedas.
-- 1) "Ao vivo": uma chamada por batida e nenhuma gravação quando nada mudou.
-- 2) Sinais leves (broadcast) no lugar do realtime pesado (postgres_changes).
-- 3) Ponte do WhatsApp: sinal de vida só grava a cada ~1 min.
-- 4) Tarefas automáticas em horário calmo, limpeza de logs e freio automático.

-- ─────────────────────────── 1) Ao vivo ───────────────────────────
create or replace function public.live_ping(p jsonb, p_user uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text := nullif(p->>'session_key', '');
  v_visitor text := nullif(p->>'visitor_id', '');
  v_ended boolean := coalesce((p->>'ended')::boolean, false);
  vis record;
  prev public.live_sessions%rowtype;
  v_customer uuid;
  v_name text;
  v_phone text;
  v_product uuid := nullif(p->>'current_product_id', '')::uuid;
  v_product_name text := nullif(p->>'current_product_name', '');
  v_last_action text;
  v_activity timestamptz := case when v_ended then now() - interval '10 minutes' else now() end;
  v_same boolean;
  v_had boolean;
begin
  if v_key is null or v_visitor is null then return '[]'::jsonb; end if;

  select customer_id, first_source, device, sessions_count, first_seen_at into vis
    from public.analytics_visitors where visitor_id = v_visitor;
  v_customer := vis.customer_id;
  if v_customer is null and p_user is not null then
    select id into v_customer from public.crm_customers where user_id = p_user limit 1;
  end if;
  if v_customer is not null then
    select left(nullif(trim(name), ''), 80), left(nullif(trim(phone), ''), 20) into v_name, v_phone
      from public.crm_customers where id = v_customer;
  end if;

  select * into prev from public.live_sessions where session_key = v_key;
  v_had := prev.session_key is not null;

  if v_product is not null and v_product_name is null then
    if prev.current_product_id = v_product and prev.current_product_name is not null then
      v_product_name := prev.current_product_name;
    else
      select canonical_name into v_product_name from public.products where id = v_product;
    end if;
  end if;
  v_last_action := case
    when v_product_name is not null then 'Visualizou ' || v_product_name
    when prev.current_product_name is not null then 'Visualizou ' || prev.current_product_name
    else prev.last_action end;

  -- Batida sem novidade (mesma página, mesma sacola) e recente: não grava nada.
  v_same := v_had
    and not v_ended
    and prev.is_active
    and prev.last_activity_at > now() - interval '75 seconds'
    and prev.customer_id is not distinct from v_customer
    and prev.display_name is not distinct from v_name
    and prev.current_route is not distinct from nullif(p->>'current_route', '')
    and prev.current_product_id is not distinct from v_product
    and prev.current_variant is not distinct from nullif(p->>'current_variant', '')
    and prev.current_decant_ml is not distinct from nullif(p->>'current_decant_ml', '')::int
    and prev.cart_items = coalesce((p->>'cart_items')::int, 0)
    and prev.cart_total = coalesce((p->>'cart_total')::numeric, 0)
    and prev.favorites_count = coalesce((p->>'favorites_count')::int, 0)
    and prev.views_count = coalesce((p->>'views_count')::int, 0)
    and prev.in_checkout = coalesce((p->>'in_checkout')::boolean, false)
    and prev.intent = coalesce(p->>'intent', 'baixa')
    and prev.last_query is not distinct from nullif(p->>'last_query', '');

  if not v_same then
    insert into public.live_sessions as s (
      session_key, visitor_id, customer_id, user_id, identified, display_name, phone, device, source,
      current_route, current_product_id, current_product_name, current_variant, current_decant_ml,
      cart_items, cart_total, favorites_count, views_count, in_checkout, intent,
      browser, os, standalone, viewport, timezone, language, theme, connection,
      first_source, visitor_sessions, visitor_first_seen, last_query, last_activity_at, is_active, last_action)
    values (
      v_key, v_visitor, v_customer, p_user, v_name is not null, v_name, v_phone,
      coalesce(nullif(p->>'device', ''), vis.device), coalesce(nullif(p->>'source', ''), vis.first_source),
      nullif(p->>'current_route', ''), v_product, v_product_name, nullif(p->>'current_variant', ''),
      nullif(p->>'current_decant_ml', '')::int,
      coalesce((p->>'cart_items')::int, 0), coalesce((p->>'cart_total')::numeric, 0),
      coalesce((p->>'favorites_count')::int, 0), coalesce((p->>'views_count')::int, 0),
      coalesce((p->>'in_checkout')::boolean, false), coalesce(p->>'intent', 'baixa'),
      nullif(p->>'browser', ''), nullif(p->>'os', ''), (p->>'standalone')::boolean, nullif(p->>'viewport', ''),
      nullif(p->>'timezone', ''), nullif(p->>'language', ''), nullif(p->>'theme', ''), nullif(p->>'connection', ''),
      vis.first_source, vis.sessions_count, vis.first_seen_at, nullif(p->>'last_query', ''),
      v_activity, not v_ended, v_last_action)
    on conflict (session_key) do update set
      visitor_id = excluded.visitor_id, customer_id = excluded.customer_id, user_id = excluded.user_id,
      identified = excluded.identified, display_name = excluded.display_name, phone = excluded.phone,
      device = excluded.device, source = excluded.source, current_route = excluded.current_route,
      current_product_id = excluded.current_product_id, current_product_name = excluded.current_product_name,
      current_variant = excluded.current_variant, current_decant_ml = excluded.current_decant_ml,
      cart_items = excluded.cart_items, cart_total = excluded.cart_total, favorites_count = excluded.favorites_count,
      views_count = excluded.views_count, in_checkout = excluded.in_checkout, intent = excluded.intent,
      browser = excluded.browser, os = excluded.os, standalone = excluded.standalone, viewport = excluded.viewport,
      timezone = excluded.timezone, language = excluded.language, theme = excluded.theme, connection = excluded.connection,
      first_source = excluded.first_source, visitor_sessions = excluded.visitor_sessions,
      visitor_first_seen = excluded.visitor_first_seen, last_query = excluded.last_query,
      last_activity_at = excluded.last_activity_at, is_active = excluded.is_active, last_action = excluded.last_action;

    -- Uma pessoa + um aparelho = um card: só quando a sessão nasce.
    if not v_had then
      update public.live_sessions o set is_active = false
       where o.is_active and o.session_key <> v_key
         and o.device is not distinct from coalesce(nullif(p->>'device', ''), vis.device)
         and case when v_customer is not null then o.customer_id = v_customer
                  when p_user is not null then o.user_id = p_user
                  else o.visitor_id = v_visitor end;
    end if;
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(i) order by i.created_at desc) from (
      select id, kind, message, coupon_code, product_id, created_at, seen_at, accepted_at, dismissed_at
        from public.live_interactions
       where session_key = v_key and dismissed_at is null and accepted_at is null
       order by created_at desc limit 3) i), '[]'::jsonb);
end $$;
revoke all on function public.live_ping(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.live_ping(jsonb, uuid) to service_role;

create index if not exists live_interactions_session_open_idx
  on public.live_interactions (session_key, created_at desc)
  where dismissed_at is null and accepted_at is null;

-- ─────────────────── 2) Sinais leves no lugar do realtime ───────────────────
-- Um sinal por comando (não por linha), sem dados de cliente: a tela só sabe "mudou X" e busca o que precisa.
create or replace function public.orium_signal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send('{}'::jsonb, tg_argv[0], 'orium-admin', false);
    if tg_argv[0] = 'wa_outbox' then
      perform realtime.send('{}'::jsonb, 'outbox', 'orium-bridge', false);
    end if;
  exception when others then
    null; -- sinal é só um aviso: nunca derruba a gravação
  end;
  return null;
end $$;
revoke all on function public.orium_signal() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['wa_contacts', 'wa_outbox', 'wa_insights', 'live_sessions', 'live_interactions'] loop
    execute format('drop trigger if exists orium_signal on public.%I', t);
    execute format('create trigger orium_signal after insert or update or delete on public.%I for each statement execute function public.orium_signal(%L)', t, t);
  end loop;
end $$;

-- wa_bridge_state: só avisa quando o status muda (o sinal de vida não acorda as telas).
drop trigger if exists orium_signal on public.wa_bridge_state;
create trigger orium_signal after update on public.wa_bridge_state
  for each row when (old.status is distinct from new.status or old.qr is distinct from new.qr)
  execute function public.orium_signal('wa_bridge_state');

do $$
declare t text;
begin
  foreach t in array array['live_sessions', 'live_interactions', 'wa_contacts', 'wa_outbox', 'wa_insights', 'wa_bridge_state'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

-- ─────────────────── 3) Sinal de vida da ponte ───────────────────
create or replace function public.wa_bridge_heartbeat(p_token text, p_status text, p_qr text default null, p_phone text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  update public.wa_bridge_state
     set status = p_status, qr = case when p_status = 'qr' then p_qr else null end,
         phone = coalesce(p_phone, phone), last_seen = now(), updated_at = now()
   where id
     and (status is distinct from p_status
          or qr is distinct from (case when p_status = 'qr' then p_qr else null end)
          or (p_phone is not null and phone is distinct from p_phone)
          or last_seen is null or last_seen < now() - interval '50 seconds');
end $$;

-- ─────────────────── 4) Ritmo leve, limpeza e freio ───────────────────
-- Horários em UTC (Brasília = UTC-3).
-- Fornecedores: 3 ciclos por dia (03h, 09h, 15h de Brasília); a continuação só roda nessas janelas, a cada 2 min.
select cron.alter_job((select jobid from cron.job where jobname = 'sync-suppliers-3h'), schedule := '0 6,12,18 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'sync-suppliers-continue'), schedule := '1-59/2 6-8,12-14,18-20 * * *');
-- Fichas dos perfumes: madrugada (01h20 e 02h20).
select cron.alter_job((select jobid from cron.job where jobname = 'enrich-fragrances-hourly'), schedule := '20 4,5 * * *');
-- Fornecedores de consulta: uma vez por noite (02h35).
select cron.alter_job((select jobid from cron.job where jobname = 'consult-enrich-match'), schedule := '35 5 * * *');
-- Análise das conversas: a cada 15 min, das 08h às 23h59.
select cron.alter_job((select jobid from cron.job where jobname = 'wa-insights-5min'), schedule := '7-59/15 0-2,11-23 * * *');

-- Limpeza diária (04h10): logs e eventos antigos.
create or replace function public.orium_housekeeping()
returns jsonb language plpgsql security definer set search_path = public, cron as $$
declare r jsonb := '{}'::jsonb; n bigint;
begin
  delete from cron.job_run_details where end_time < now() - interval '2 days' or (end_time is null and start_time < now() - interval '2 days');
  get diagnostics n = row_count; r := r || jsonb_build_object('cron_log', n);
  delete from public.supplier_sync_events where created_at < now() - interval '14 days';
  get diagnostics n = row_count; r := r || jsonb_build_object('supplier_sync_events', n);
  delete from public.fragrantica_search_log where created_at < now() - interval '30 days';
  get diagnostics n = row_count; r := r || jsonb_build_object('fragrantica_search_log', n);
  delete from public.live_sessions where last_activity_at < now() - interval '30 days' and customer_id is null;
  get diagnostics n = row_count; r := r || jsonb_build_object('live_sessions', n);
  delete from public.db_guard_log where at < now() - interval '30 days';
  return r;
end $$;
revoke all on function public.orium_housekeeping() from public, anon, authenticated;

-- Freio automático: a cada 5 min mede as gravações; se passar do limite, pausa as tarefas pesadas por 1 h.
create table if not exists public.db_guard_log (
  at timestamptz not null default now(),
  writes_5min bigint not null,
  action text not null,
  detail jsonb
);
alter table public.db_guard_log enable row level security;
create policy "staff lê o freio" on public.db_guard_log for select to authenticated using (public.is_staff(auth.uid()));

create table if not exists public.db_guard_state (
  id boolean primary key default true check (id),
  last_writes bigint,
  last_at timestamptz,
  paused_until timestamptz,
  limit_5min bigint not null default 40000
);
insert into public.db_guard_state (id) values (true) on conflict do nothing;
alter table public.db_guard_state enable row level security;

create or replace function public.orium_db_guard()
returns jsonb language plpgsql security definer set search_path = public, cron as $$
declare
  st public.db_guard_state%rowtype;
  v_total bigint;
  v_delta bigint;
  heavy text[] := array['sync-suppliers-3h', 'sync-suppliers-continue', 'enrich-fragrances-hourly', 'consult-enrich-match', 'wa-insights-5min'];
begin
  select * into st from public.db_guard_state where id;
  select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) into v_total from pg_stat_user_tables;
  -- reinício do banco zera os contadores
  v_delta := case when st.last_writes is null or v_total < st.last_writes then 0 else v_total - st.last_writes end;
  update public.db_guard_state set last_writes = v_total, last_at = now() where id;

  if v_delta > st.limit_5min and (st.paused_until is null or st.paused_until < now()) then
    perform cron.alter_job(jobid, active := false) from cron.job where jobname = any(heavy) and active;
    update public.db_guard_state set paused_until = now() + interval '1 hour' where id;
    insert into public.db_guard_log (writes_5min, action, detail)
      values (v_delta, 'pausou', jsonb_build_object('limite', st.limit_5min, 'top', (
        select jsonb_agg(jsonb_build_object('tabela', relname, 'escritas', w)) from (
          select relname, n_tup_ins + n_tup_upd + n_tup_del w from pg_stat_user_tables order by 2 desc limit 5) x)));
  elsif st.paused_until is not null and st.paused_until < now() and v_delta <= st.limit_5min then
    perform cron.alter_job(jobid, active := true) from cron.job where jobname = any(heavy) and not active;
    update public.db_guard_state set paused_until = null where id;
    insert into public.db_guard_log (writes_5min, action) values (v_delta, 'retomou');
  end if;
  return jsonb_build_object('escritas_5min', v_delta, 'limite', st.limit_5min);
end $$;
revoke all on function public.orium_db_guard() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('orium-housekeeping', 'orium-db-guard');
select cron.schedule('orium-housekeeping', '10 7 * * *', $$select public.orium_housekeeping()$$);
select cron.schedule('orium-db-guard', '*/5 * * * *', $$select public.orium_db_guard()$$);
