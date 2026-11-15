# Edge Function `enrich-fragrances`

Enriquecimento Fragrantica (motor V3: busca → leitura da página → acordes, notas, descrição Orium) direto no Supabase
de produção (`OriumProducao`), sem depender da hospedagem da loja. Chamada pelo job `enrich-fragrances-hourly`
(minuto 20 de cada hora, `{"mode":"all","limit":25}`).

## Prazo do lote e erros

- **Prazo do lote inteiro**: `DEADLINE_MS = 100 000` em `supabase/edge-src/enrich-fragrances.ts` (limite do Supabase Free: 150 s).
  Cada leitura continua limitada a 20 s, mas agora também pelo tempo que resta do lote; esperas e tentativas são cortadas
  pelo prazo. Nenhum perfume novo começa com menos de 12 s restantes e nenhuma leitura com menos de 6 s.
- **403/429 da Fragrantica** encerram o lote na hora (sem esperar, sem leitor alternativo). Os dados existentes ficam como
  estão e o motivo é registrado; a função responde HTTP 502.
- **Timeout** é falha temporária: o perfume fica `TEMPORARY_FAILURE` (repetido depois), **nunca** `NOT_FOUND`. Quem estoura 20 s
  não ganha nova tentativa no mesmo lote; 3 leituras seguidas sem resposta útil encerram o lote.
- O modo "com prazo" só vale quando `deadlineMs` é informado; o Admin e o Worker continuam como antes.
- Código: `src/lib/catalog/fragrantica-search.server.ts` (`beginBatch`/`endBatch`, `fetchPage`) e
  `src/lib/catalog/enrichment-v3.server.ts` (`runEnrichmentV3`). Testes: `src/lib/catalog/__tests__/fragrantica-batch.spec.ts`.

## Registro

Cada lote grava uma linha em `public.enrichment_batch_runs` (migração `20261115140000_enrichment_batch_runs.sql`):
processados, verificados, em revisão, não encontrados, falhas temporárias, não iniciados, descrições gravadas, requisições,
duração, `stop_reason` (`deadline`, `blocked`, `consecutive-failures`, `all-failed`, `error`), status HTTP da fonte e código
de resposta. Progresso por perfume continua em `fragrance_details` (`search_status`, `last_search_at`, `search_attempts`).

```sql
select started_at, processed, verified, review, not_found, temporary_failure, not_started, duration_ms, stop_reason, http_status, response_code
from enrichment_batch_runs order by started_at desc limit 10;
```

## Publicar

1. `node scripts/build-edge-sync.mjs enrich-fragrances` (gera `index.ts`, minificado).
2. Publicar: CLI `npx supabase functions deploy enrich-fragrances --project-ref onazmlxfrstrdefbekle --no-verify-jwt`, ou no painel
   (Edge Functions → `enrich-fragrances` → Code → colar `index.ts` → Deploy updates; em Settings, **Verify JWT = OFF**).
3. A autenticação é a mesma da `sync-suppliers` (segredo `orium_edge_cron_secret` no Vault, conferido pela RPC
   `orium_check_edge_cron_secret`; ver o README de `sync-suppliers`).

## Cron

`supabase/migrations/20261115141000_cron_enrich_fragrances_edge.sql` aponta o job existente para esta função (horário e
parâmetros preservados). Pausar: `select cron.alter_job((select jobid from cron.job where jobname='enrich-fragrances-hourly'), active := false);`

## Teste manual (sem expor o segredo)

```sql
select net.http_post(
  url := 'https://onazmlxfrstrdefbekle.supabase.co/functions/v1/enrich-fragrances',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='orium_edge_cron_secret')),
  body := '{"mode":"all","limit":3}'::jsonb, timeout_milliseconds := 150000);
-- ~1 min depois:
select status_code, content from net._http_response order by id desc limit 1;
```

## Validação (15/11/2026)

- Leitura de URL conhecida a partir da Edge Function: `Cool-Ace-136560.html` → HTTP 200, 382 ms, 480 KB;
  página de marca `desenhista/Armaf.html` → HTTP 200, 710 ms, 2,9 MB (sem `cf-mitigated`, sem `retry-after`).
- Lote de 3: 3 verificados, 3 descrições, 6,4 s. Lote de 25 (parâmetros do cron): 25 processados, 4 verificados, 2 em revisão,
  19 não encontrados, 0 falhas temporárias, 18,8 s.
