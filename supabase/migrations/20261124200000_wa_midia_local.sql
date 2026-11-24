-- Leitura de mídia grátis no servidor da ponte (whisper.cpp + Tesseract): áudio e vídeo viram texto,
-- foto do cliente vira "texto na imagem". O texto vai em wa_messages.transcript (sem custo de IA).

-- A ponte grava o texto lido de uma mídia.
create or replace function public.wa_bridge_set_transcript(p_token text, p_id text, p_text text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  -- Não força nova análise: a análise só roda 10 min depois da última mensagem, quando o texto já está aqui;
  -- mídias antigas lidas agora entram na próxima análise da conversa (sem gastar tokens à toa).
  update public.wa_messages
     set transcript = left(coalesce(nullif(trim(p_text), ''), '(sem fala)'), 4000)
   where id = p_id and transcript is null;
end $$;
revoke all on function public.wa_bridge_set_transcript(text, text, text) from public;
grant execute on function public.wa_bridge_set_transcript(text, text, text) to anon, authenticated;

-- Mídias já guardadas que ainda não foram lidas (dos últimos 30 dias), as mais novas primeiro.
create or replace function public.wa_bridge_media_todo(p_token text, p_limit integer default 5)
returns table (id text, kind text, media_path text, media_mime text, media_seconds integer, from_me boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_bridge_ok(p_token) then raise exception 'token inválido' using errcode = '42501'; end if;
  return query
    select m.id, m.kind, m.media_path, m.media_mime, m.media_seconds, m.from_me
      from public.wa_messages m
     where m.media_path is not null and m.transcript is null
       and (m.kind in ('audio', 'video') or (m.kind = 'image' and not m.from_me))
       and m.ts > now() - interval '30 days'
       and coalesce(m.media_seconds, 0) <= 600
     order by m.ts desc
     limit least(greatest(p_limit, 1), 20);
end $$;
revoke all on function public.wa_bridge_media_todo(text, integer) from public;
grant execute on function public.wa_bridge_media_todo(text, integer) to anon, authenticated;

create index if not exists wa_messages_media_todo_idx
  on public.wa_messages (ts desc)
  where media_path is not null and transcript is null;

-- Conversa em que o cliente só mandou áudio também entra na análise (quando o áudio já virou texto).
create or replace function public.wa_insights_due(p_limit integer default 10, p_quiet_min integer default 10)
returns table (jid text) language sql stable security definer set search_path = public as $$
  select w.jid
    from public.wa_contacts w
    left join public.wa_insights i on i.jid = w.jid
   where w.last_message_at is not null
     and w.last_message_at < now() - make_interval(mins => p_quiet_min)
     and exists (select 1 from public.wa_messages m where m.jid = w.jid and not m.from_me
                  and (coalesce(m.body, '') <> '' or coalesce(m.transcript, '') not in ('', '(sem fala)')))
     and (i.jid is null or i.last_msg_ts is null or w.last_message_at > i.last_msg_ts)
     and (i.error is null or i.analyzed_at < now() - interval '2 hours')
   order by w.last_message_at desc
   limit p_limit
$$;
revoke all on function public.wa_insights_due(integer, integer) from public, anon, authenticated;
