-- Análise de cada conversa do WhatsApp pela IA (o que o cliente quer, estilo, por que
-- não comprou, chance de compra, próximo passo). Roda sozinha a cada 5 minutos
-- (pg_cron → /api/public/hooks/wa-insights) e reanalisa quando chegam mensagens novas.

create table if not exists public.wa_insights (
  jid text primary key references public.wa_contacts(jid) on delete cascade,
  customer_id uuid references public.crm_customers(id) on delete set null,
  analyzed_at timestamptz not null default now(),
  last_msg_ts timestamptz,
  msg_count integer not null default 0,
  status text,
  chance integer,
  motivo text,
  resumo text,
  data jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists wa_insights_customer_idx on public.wa_insights (customer_id);

alter table public.wa_insights enable row level security;
drop policy if exists wa_insights_staff on public.wa_insights;
create policy wa_insights_staff on public.wa_insights for select to authenticated using (public.is_staff(auth.uid()));

do $$ begin
  begin alter publication supabase_realtime add table public.wa_insights; exception when duplicate_object then null; end;
end $$;

-- Conversas que precisam de (re)análise: nunca analisadas ou com mensagem nova,
-- e com a conversa parada há pelo menos p_quiet_min minutos (não analisa no meio do papo).
create or replace function public.wa_insights_due(p_limit integer default 10, p_quiet_min integer default 10)
returns table (jid text) language sql stable security definer set search_path = public as $$
  select w.jid
    from public.wa_contacts w
    left join public.wa_insights i on i.jid = w.jid
   where w.last_message_at is not null
     and w.last_message_at < now() - make_interval(mins => p_quiet_min)
     and exists (select 1 from public.wa_messages m where m.jid = w.jid and not m.from_me and m.body is not null and m.body <> '')
     and (i.jid is null or i.last_msg_ts is null or w.last_message_at > i.last_msg_ts)
     and (i.error is null or i.analyzed_at < now() - interval '2 hours')
   order by w.last_message_at desc
   limit p_limit
$$;
revoke all on function public.wa_insights_due(integer, integer) from public, anon, authenticated;

-- crm_leads: a análise mais recente da conversa de cada cliente.
do $$
declare d text := pg_get_functiondef('public.crm_leads'::regproc);
begin
  if position('''insight''' in d) = 0 then
    d := replace(d, '''id'', c.id, ''avatar'',',
      '''id'', c.id, ''insight'', (select jsonb_build_object(''status'', i.status, ''chance'', i.chance, ''motivo'', i.motivo, ''resumo'', i.resumo, ''analyzed_at'', i.analyzed_at, ''data'', i.data) from public.wa_insights i join public.wa_contacts w3 on w3.jid = i.jid where w3.customer_id = c.id and i.resumo is not null order by i.analyzed_at desc limit 1), ''avatar'',');
    execute d;
  end if;
end $$;
