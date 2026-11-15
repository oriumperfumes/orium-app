-- Sincronização dos fornecedores pela Edge Function `sync-suppliers` (ver supabase/functions/sync-suppliers/README.md).
-- Aplicada em produção como migração `cron_sync_suppliers_edge`. Nenhum segredo aqui: o cron lê o Vault a cada chamada.

-- Job de 3 h: abre o ciclo da janela atual de 3 h (UTC).
select cron.alter_job(
  (select jobid from cron.job where jobname = 'sync-suppliers-3h'),
  schedule := '0 */3 * * *',
  command := $cmd$
    select net.http_post(
      url := 'https://onazmlxfrstrdefbekle.supabase.co/functions/v1/sync-suppliers?since='
             || to_char(date_bin('3 hours', now(), timestamptz '2000-01-01 00:00:00+00') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orium_edge_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000);
  $cmd$,
  active := false
);

-- Continuação: a função faz poucas rodadas por chamada (limite de CPU do plano gratuito); este job só
-- chama quando há fornecedor parcial ou ainda não tentado na janela de 3 h, e só com o job de 3 h ativo.
select cron.schedule(
  'sync-suppliers-continue',
  '* * * * *',
  $cmd$
    select net.http_post(
      url := 'https://onazmlxfrstrdefbekle.supabase.co/functions/v1/sync-suppliers?since='
             || to_char(date_bin('3 hours', now(), timestamptz '2000-01-01 00:00:00+00') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orium_edge_cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000)
    where exists (select 1 from cron.job where jobname = 'sync-suppliers-3h' and active)
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

-- Reativar o job de 3 h só depois de conferir a função publicada:
--   select cron.alter_job((select jobid from cron.job where jobname = 'sync-suppliers-3h'), active := true);
