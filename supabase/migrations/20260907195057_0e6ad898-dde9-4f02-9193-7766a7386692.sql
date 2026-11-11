select cron.unschedule(jobid) from cron.job where jobname in ('enrich-fragrances-15min','enrich-fragrances-hourly');

select cron.schedule(
  'enrich-fragrances-hourly',
  '20 * * * *',
  $$
  select net.http_post(
    url := 'https://project--633eef1d-9142-480d-9ccf-dc7ef4e44af1-dev.lovable.app/api/public/hooks/enrich-fragrances',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'apikey', 'sb_publishable_xUM3wvzcgwslLJSfF4cZhw_ptRkc4YI'
    ),
    body := jsonb_build_object('mode', 'all', 'limit', 25),
    timeout_milliseconds := 60000
  );
  $$
);