-- Enriquecimento Fragrantica passa a rodar na Edge Function enrich-fragrances (lote com prazo de 100 s).
-- Horário (minuto 20 de cada hora) e parâmetros ({"mode":"all","limit":25}) preservados. Nenhum segredo aqui.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'enrich-fragrances-hourly'),
  schedule := '20 * * * *',
  command := $cmd$
    select net.http_post(
      url := 'https://onazmlxfrstrdefbekle.supabase.co/functions/v1/enrich-fragrances',
      headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orium_edge_cron_secret')),
      body := '{"mode":"all","limit":25}'::jsonb,
      timeout_milliseconds := 150000);
  $cmd$,
  active := true
);
