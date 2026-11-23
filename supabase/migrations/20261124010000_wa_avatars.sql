-- Fotos de perfil e nomes do WhatsApp no CRM.
-- A ponte (ao conectar e aos poucos depois) busca a foto de cada conversa e de cada
-- cliente do CRM que tem WhatsApp, e o nome salvo na agenda do celular da loja.
-- Foto guardada pequena (miniatura) como data URL; renovada a cada 7 dias.

alter table public.wa_contacts
  add column if not exists saved_name text,
  add column if not exists avatar text,
  add column if not exists avatar_at timestamptz;

alter table public.crm_customers
  add column if not exists wa_avatar text,
  add column if not exists wa_checked_at timestamptz,
  add column if not exists on_whatsapp boolean;

-- Nomes da agenda / perfil: atualiza conversas existentes e completa nome vazio no CRM.
-- p_contacts: [{jid, saved_name, push_name}]
create or replace function public.wa_bridge_contacts(p_token text, p_contacts jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare c jsonb; n integer := 0; v_phone text;
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb)) loop
    continue when coalesce(c->>'jid', '') !~ '@s\.whatsapp\.net$';
    update public.wa_contacts
       set saved_name = coalesce(nullif(btrim(c->>'saved_name'), ''), saved_name),
           push_name = coalesce(nullif(btrim(c->>'push_name'), ''), push_name)
     where jid = c->>'jid';
    if found then n := n + 1; end if;
    v_phone := public.wa_norm_phone(split_part(c->>'jid', '@', 1));
    update public.crm_customers
       set name = coalesce(nullif(btrim(c->>'saved_name'), ''), nullif(btrim(c->>'push_name'), ''))
     where phone_normalized = v_phone and (name is null or btrim(name) = '')
       and coalesce(nullif(btrim(c->>'saved_name'), ''), nullif(btrim(c->>'push_name'), '')) is not null;
  end loop;
  return n;
end $$;

-- Quem precisa de foto agora: conversas primeiro, depois clientes do CRM com celular.
create or replace function public.wa_bridge_avatar_targets(p_token text, p_limit integer default 20)
returns table (kind text, id text, jid text) language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  return query
  (select 'contact'::text, w.jid, w.jid
     from public.wa_contacts w
    where w.avatar_at is null or w.avatar_at < now() - interval '7 days'
    order by w.last_message_at desc nulls last
    limit p_limit)
  union all
  (select 'customer'::text, c.id::text, '55' || c.phone_normalized || '@s.whatsapp.net'
     from public.crm_customers c
    where c.archived_at is null and length(c.phone_normalized) = 11
      and (c.wa_checked_at is null or c.wa_checked_at < now() - interval '7 days')
      and not exists (select 1 from public.wa_contacts w where w.customer_id = c.id and w.avatar_at > now() - interval '7 days')
    order by c.created_at desc
    limit p_limit);
end $$;

-- Grava a foto (ou a falta dela). p_exists=false: o número não tem WhatsApp.
create or replace function public.wa_bridge_set_avatar(p_token text, p_kind text, p_id text, p_avatar text, p_exists boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_avatar text := case when p_avatar like 'data:image/%' and length(p_avatar) < 200000 then p_avatar end;
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  if p_kind = 'contact' then
    update public.wa_contacts set avatar = v_avatar, avatar_at = now() where jid = p_id;
    update public.crm_customers c set wa_avatar = v_avatar, wa_checked_at = now(), on_whatsapp = true
      from public.wa_contacts w where w.jid = p_id and w.customer_id = c.id;
  elsif p_kind = 'customer' then
    update public.crm_customers set wa_avatar = v_avatar, wa_checked_at = now(), on_whatsapp = p_exists where id = p_id::uuid;
  end if;
end $$;

grant execute on function public.wa_bridge_contacts(text, jsonb) to anon, authenticated;
grant execute on function public.wa_bridge_avatar_targets(text, integer) to anon, authenticated;
grant execute on function public.wa_bridge_set_avatar(text, text, text, text, boolean) to anon, authenticated;

-- crm_leads: foto do WhatsApp em cada cliente.
do $$
declare d text := pg_get_functiondef('public.crm_leads'::regproc);
begin
  if position('''avatar''' in d) = 0 then
    d := replace(d, '''id'', c.id, ''name'', c.name,',
      '''id'', c.id, ''avatar'', coalesce((select w2.avatar from public.wa_contacts w2 where w2.customer_id = c.id and w2.avatar is not null order by w2.last_message_at desc nulls last limit 1), c.wa_avatar), ''name'', c.name,');
    execute d;
  end if;
end $$;
