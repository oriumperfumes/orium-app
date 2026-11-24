-- Ingestão do WhatsApp em lote: o histórico (milhares de mensagens) não pode travar o banco.
-- * contatos: um upsert por conversa, e só quando algo muda (menos eventos de tempo real)
-- * conversa (prévia, não lidas, datas): um update por conversa no fim do lote, não um por mensagem
-- * wa_messages sai do tempo real (o painel acompanha pela wa_contacts, que muda junto)

create or replace function public.wa_bridge_ingest(p_token text, p_messages jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare m jsonb; v_ts timestamptz; v_new boolean; v_by uuid; v_ids text[] := '{}';
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;

  -- 1) contatos (um por conversa)
  insert into public.wa_contacts as w (jid, phone_normalized, push_name, customer_id)
  select x.jid, x.phone, x.push_name,
         (select c.id from public.crm_customers c where c.phone_normalized = x.phone and c.archived_at is null order by c.created_at limit 1)
  from (
    select distinct on (jid) jid, public.wa_norm_phone(split_part(jid, '@', 1)) as phone, push_name
    from (
      select e->>'jid' as jid,
             case when not coalesce((e->>'from_me')::boolean, false) then nullif(e->>'push_name', '') end as push_name,
             (e->>'ts')::double precision as ts
      from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) e
      where coalesce(e->>'jid', '') ~ '@s\.whatsapp\.net$'
    ) r
    order by jid, (push_name is null), ts desc
  ) x
  order by x.jid
  on conflict (jid) do update
     set push_name = coalesce(excluded.push_name, w.push_name),
         customer_id = coalesce(w.customer_id, excluded.customer_id)
   where (excluded.push_name is not null and excluded.push_name is distinct from w.push_name)
      or (w.customer_id is null and excluded.customer_id is not null);

  -- 2) mensagens
  for m in select * from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) loop
    continue when coalesce(m->>'jid', '') !~ '@s\.whatsapp\.net$';
    v_ts := to_timestamp((m->>'ts')::double precision);
    v_by := case when coalesce((m->>'from_me')::boolean, false)
                 then (select o.created_by from public.wa_outbox o where o.wa_id = m->>'id' limit 1) end;
    v_new := null;
    insert into public.wa_messages (id, jid, from_me, body, kind, ts, media_path, media_mime, media_size, media_seconds, media_w, media_h, file_name, sent_by)
    values (m->>'id', m->>'jid', coalesce((m->>'from_me')::boolean, false), left(m->>'body', 8000), coalesce(m->>'kind', 'text'), v_ts,
            nullif(m->>'media_path', ''), nullif(m->>'media_mime', ''), (m->>'media_size')::integer, (m->>'media_seconds')::integer,
            (m->>'media_w')::integer, (m->>'media_h')::integer, nullif(m->>'file_name', ''), v_by)
    on conflict (id) do update
       set media_path = coalesce(wa_messages.media_path, excluded.media_path),
           media_mime = coalesce(wa_messages.media_mime, excluded.media_mime),
           media_size = coalesce(wa_messages.media_size, excluded.media_size),
           media_seconds = coalesce(wa_messages.media_seconds, excluded.media_seconds),
           media_w = coalesce(wa_messages.media_w, excluded.media_w),
           media_h = coalesce(wa_messages.media_h, excluded.media_h),
           file_name = coalesce(wa_messages.file_name, excluded.file_name),
           sent_by = coalesce(wa_messages.sent_by, excluded.sent_by)
    returning (xmax = 0) into v_new;
    if coalesce(v_new, false) then v_ids := v_ids || (m->>'id'); end if;
  end loop;

  if cardinality(v_ids) = 0 then return 0; end if;

  -- 3) resumo da conversa, uma vez por contato
  with x as (
    select e->>'jid' as jid,
           to_timestamp((e->>'ts')::double precision) as ts,
           coalesce((e->>'from_me')::boolean, false) as fm,
           coalesce((e->>'history')::boolean, false) as hist,
           left(coalesce(nullif(e->>'body', ''), case e->>'kind' when 'audio' then '🎤 Áudio' when 'image' then '📷 Foto'
             when 'video' then '🎬 Vídeo' when 'sticker' then 'Figurinha' when 'document' then '📄 Documento'
             else '[' || coalesce(e->>'kind', 'mídia') || ']' end), 140) as preview
    from jsonb_array_elements(p_messages) e
    where e->>'id' = any(v_ids)
  ), a as (
    select jid,
           max(ts) as last_ts,
           (array_agg(preview order by ts desc))[1] as preview,
           (array_agg(fm order by ts desc))[1] as last_fm,
           max(ts) filter (where not fm) as in_ts,
           max(ts) filter (where fm) as out_ts
    from x group by jid
  ), b as (
    select a.*, (select count(*) from x where x.jid = a.jid and not x.fm and not x.hist
                   and (a.out_ts is null or x.ts > a.out_ts))::integer as new_in
    from a
  )
  update public.wa_contacts c set
    last_message_preview = case when c.last_message_at is null or b.last_ts >= c.last_message_at then b.preview else c.last_message_preview end,
    last_from_me = case when c.last_message_at is null or b.last_ts >= c.last_message_at then b.last_fm else c.last_from_me end,
    last_message_at = greatest(coalesce(c.last_message_at, b.last_ts), b.last_ts),
    last_inbound_at = case when b.in_ts is null then c.last_inbound_at else greatest(coalesce(c.last_inbound_at, b.in_ts), b.in_ts) end,
    last_outbound_at = case when b.out_ts is null then c.last_outbound_at else greatest(coalesce(c.last_outbound_at, b.out_ts), b.out_ts) end,
    unread = case when b.out_ts is not null then b.new_in else c.unread + b.new_in end,
    archived = false,
    updated_at = now()
  from b
  where c.jid = b.jid;

  return cardinality(v_ids);
end $function$;

-- nomes da agenda: só grava (e só avisa o painel) quando muda
create or replace function public.wa_bridge_contacts(p_token text, p_contacts jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare c jsonb; n integer := 0; v_phone text; v_saved text; v_push text;
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb)) loop
    continue when coalesce(c->>'jid', '') !~ '@s\.whatsapp\.net$';
    v_saved := nullif(btrim(c->>'saved_name'), '');
    v_push := nullif(btrim(c->>'push_name'), '');
    continue when v_saved is null and v_push is null;
    update public.wa_contacts
       set saved_name = coalesce(v_saved, saved_name),
           push_name = coalesce(v_push, push_name)
     where jid = c->>'jid'
       and (saved_name is distinct from coalesce(v_saved, saved_name) or push_name is distinct from coalesce(v_push, push_name));
    if found then n := n + 1; end if;
    v_phone := public.wa_norm_phone(split_part(c->>'jid', '@', 1));
    update public.crm_customers
       set name = coalesce(v_saved, v_push)
     where phone_normalized = v_phone and (name is null or btrim(name) = '');
  end loop;
  return n;
end $function$;

create index if not exists wa_outbox_wa_id_idx on public.wa_outbox (wa_id) where wa_id is not null;

do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wa_messages') then
    alter publication supabase_realtime drop table public.wa_messages;
  end if;
end $$;
