-- Confere o segredo das tarefas automáticas (pg_cron → site) contra o cofre do banco.
create or replace function public.orium_cron_ok(p_token text)
returns boolean language sql stable security definer set search_path = public, extensions, vault as $$
  select coalesce(length(p_token) >= 32 and exists (
    select 1 from vault.decrypted_secrets s
     where s.name = 'orium_cron_secret'
       and encode(digest(s.decrypted_secret, 'sha256'), 'hex') = encode(digest(p_token, 'sha256'), 'hex')
  ), false)
$$;
revoke all on function public.orium_cron_ok(text) from public, anon, authenticated;

-- Análise das conversas a cada 5 minutos.
select cron.schedule(
  'wa-insights-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://oriumperfumes.com/api/public/hooks/wa-insights',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'orium_cron_secret')),
    body := '{"limit":8}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
