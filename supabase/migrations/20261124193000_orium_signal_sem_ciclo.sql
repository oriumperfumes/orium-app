-- Aplicada direto no banco em 24/11 (nomes: orium_signal_so_o_que_aparece, orium_signal_so_quando_muda).
-- 1) Sinal só quando alguma linha mudou de verdade: a ponte pedia a fila de saída, o UPDATE sem linhas
--    disparava "outbox", a ponte pedia de novo... (~2 sinais/s e o Admin recarregando a conversa sem parar).
-- 2) A ponte só acorda com mensagem NOVA na fila (INSERT).
-- 3) Conversas: foto de perfil e nome da agenda não acordam o Admin.
-- 4) Tarefas pesadas só de madrugada (Brasília): fornecedores 02h e 05h, fichas 00h20 e 01h20, consulta 04h35.

create or replace function public.orium_signal_rows()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from changed) then return null; end if;
  begin
    perform realtime.send('{}'::jsonb, tg_argv[0], 'orium-admin', false);
    if tg_argv[0] = 'wa_outbox' and tg_op = 'INSERT' then
      perform realtime.send('{}'::jsonb, 'outbox', 'orium-bridge', false);
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function public.orium_signal_rows() from public, anon, authenticated;

create or replace function public.orium_signal_contacts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from changed n join changed_old o using (jid)
    where (n.stage, n.unread, n.pinned, n.archived, n.last_message_at, n.last_message_preview, n.last_from_me, n.customer_id, n.assigned_to)
      is distinct from (o.stage, o.unread, o.pinned, o.archived, o.last_message_at, o.last_message_preview, o.last_from_me, o.customer_id, o.assigned_to)
  ) then return null; end if;
  begin
    perform realtime.send('{}'::jsonb, 'wa_contacts', 'orium-admin', false);
  exception when others then null;
  end;
  return null;
end $$;
revoke all on function public.orium_signal_contacts() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['wa_contacts', 'wa_outbox', 'wa_insights', 'live_sessions', 'live_interactions'] loop
    execute format('drop trigger if exists orium_signal on public.%I', t);
    execute format('drop trigger if exists orium_signal_upd on public.%I', t);
    execute format('drop trigger if exists orium_signal_ins on public.%I', t);
    execute format('drop trigger if exists orium_signal_del on public.%I', t);
    execute format('create trigger orium_signal_ins after insert on public.%I referencing new table as changed for each statement execute function public.orium_signal_rows(%L)', t, t);
    execute format('create trigger orium_signal_del after delete on public.%I referencing old table as changed for each statement execute function public.orium_signal_rows(%L)', t, t);
    if t <> 'wa_contacts' then
      execute format('create trigger orium_signal_upd after update on public.%I referencing new table as changed for each statement execute function public.orium_signal_rows(%L)', t, t);
    end if;
  end loop;
end $$;
create trigger orium_signal_upd after update on public.wa_contacts
  referencing new table as changed old table as changed_old
  for each statement execute function public.orium_signal_contacts();

select cron.alter_job((select jobid from cron.job where jobname = 'sync-suppliers-3h'), schedule := '0 5,8 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'sync-suppliers-continue'), schedule := '1-59/2 5-6,8-9 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'enrich-fragrances-hourly'), schedule := '20 3,4 * * *');
select cron.alter_job((select jobid from cron.job where jobname = 'consult-enrich-match'), schedule := '35 7 * * *');
