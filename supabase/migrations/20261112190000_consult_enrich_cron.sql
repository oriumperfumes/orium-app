-- Fotos e ligação dos fornecedores de consulta (Rasha…), sem custo.
-- (a etapa "brand" — página da marca na Fragrantica — ficou desligada: a Fragrantica está recusando leituras automáticas)
select cron.schedule('consult-enrich-match', '35 * * * *', $$
  select net.http_post(
    url := 'https://project--633eef1d-9142-480d-9ccf-dc7ef4e44af1-dev.lovable.app/api/public/hooks/consult-enrich',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select value from private.automation_secrets where name = 'LOVABLE_CRON_SECRET')),
    body := '{"step":"match"}'::jsonb, timeout_milliseconds := 120000);
$$);
