-- A continuação não dispara no minuto em que o job de 3 h abre a janela (00:00, 03:00, ... UTC): os dois largavam no mesmo
-- segundo e abriam o mesmo ciclo duas vezes. Fora isso, o comportamento é o mesmo. Aplicada como `cron_sync_continue_sem_largada_simultanea`.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'sync-suppliers-continue'),
  command := $cmd$
    select net.http_post(
      url := 'https://onazmlxfrstrdefbekle.supabase.co/functions/v1/sync-suppliers?since='
             || to_char(date_bin('3 hours', now(), timestamptz '2000-01-01 00:00:00+00') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orium_edge_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000)
    where not (extract(hour from now() at time zone 'utc')::int % 3 = 0 and extract(minute from now() at time zone 'utc')::int = 0)
      and exists (select 1 from cron.job where jobname = 'sync-suppliers-3h' and active)
      and exists (
        select 1 from public.suppliers s
        where s.active and s.auto_sync is not false and s.priority is distinct from 'inactive'
          and (
            (s.sync_status in ('parcial', 'sincronizando') and s.sync_cursor is not null)
            or (coalesce(s.last_sync_at, 'epoch') < date_bin('3 hours', now(), timestamptz '2000-01-01 00:00:00+00')
                and coalesce(s.last_successful_sync_at, 'epoch') < now() - make_interval(mins => greatest(coalesce(s.sync_interval_minutes, 30) - 5, 0)))
          )
      );
  $cmd$
);
