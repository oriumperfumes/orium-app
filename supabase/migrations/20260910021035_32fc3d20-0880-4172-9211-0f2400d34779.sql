-- Tarefas automáticas passam a se autenticar com o segredo interno (nunca com a chave pública).
SELECT cron.alter_job(
  1,
  command := $cmd$
  select net.http_post(
    url := 'https://project--633eef1d-9142-480d-9ccf-dc7ef4e44af1-dev.lovable.app/api/public/hooks/sync-suppliers',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select value from private.automation_secrets where name = 'LOVABLE_CRON_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);

SELECT cron.alter_job(
  2,
  command := $cmd$
  select net.http_post(
    url := 'https://project--633eef1d-9142-480d-9ccf-dc7ef4e44af1-dev.lovable.app/api/public/hooks/enrich-fragrances',
    headers := jsonb_build_object(
      'content-type','application/json',
      'Authorization','Bearer ' || (select value from private.automation_secrets where name = 'LOVABLE_CRON_SECRET')
    ),
    body := jsonb_build_object('mode','all','limit',25),
    timeout_milliseconds := 60000
  );
  $cmd$
);