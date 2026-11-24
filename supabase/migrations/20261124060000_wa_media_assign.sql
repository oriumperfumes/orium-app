-- Conversas: mídia (foto, vídeo, áudio, figurinha, documento), atendente responsável
-- e quem da equipe enviou cada mensagem.

-- mídia e autor das mensagens
alter table public.wa_messages
  add column if not exists media_path text,
  add column if not exists media_mime text,
  add column if not exists media_size integer,
  add column if not exists media_seconds integer,
  add column if not exists media_w integer,
  add column if not exists media_h integer,
  add column if not exists file_name text,
  add column if not exists transcript text,
  add column if not exists sent_by uuid;

-- atendente responsável pela conversa
alter table public.wa_contacts
  add column if not exists assigned_to uuid,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid;
create index if not exists wa_contacts_assigned_idx on public.wa_contacts (assigned_to);

-- equipe que atende (dono/admin), com nome
create or replace function public.crm_staff()
returns table (id uuid, name text, role text) language sql stable security definer set search_path = public as $$
  select distinct on (ur.user_id) ur.user_id, coalesce(nullif(btrim(p.name), ''), split_part(p.email, '@', 1)), ur.role::text
    from public.user_roles ur join public.profiles p on p.id = ur.user_id
   where ur.role::text in ('owner', 'admin') and public.is_staff(auth.uid())
   order by ur.user_id, case ur.role::text when 'owner' then 0 else 1 end
$$;
grant execute on function public.crm_staff() to authenticated;

-- arquivos de mídia: bucket privado; só a equipe lê (link assinado)
insert into storage.buckets (id, name, public, file_size_limit)
values ('wa-media', 'wa-media', false, 31457280)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "wa_media_staff_read" on storage.objects;
create policy "wa_media_staff_read" on storage.objects for select to authenticated
  using (bucket_id = 'wa-media' and public.is_staff(auth.uid()));

-- ingest com mídia e autor (mensagem enviada pelo CRM leva quem enviou)
create or replace function public.wa_bridge_ingest(p_token text, p_messages jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare m jsonb; n integer := 0; v_ts timestamptz; v_phone text; v_new boolean; v_by uuid;
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

    v_by := (select o.created_by from public.wa_outbox o where o.wa_id = m->>'id' limit 1);
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
    continue when not coalesce(v_new, false);
    n := n + 1;

    update public.wa_contacts set
      last_message_preview = case when last_message_at is null or v_ts >= last_message_at
        then left(coalesce(nullif(m->>'body', ''), case m->>'kind' when 'audio' then '🎤 Áudio' when 'image' then '📷 Foto' when 'video' then '🎬 Vídeo' when 'sticker' then 'Figurinha' when 'document' then '📄 Documento' else '['||coalesce(m->>'kind','mídia')||']' end), 140) else last_message_preview end,
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
