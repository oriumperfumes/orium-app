# Edge Function `sync-suppliers`

Sincronização automática dos fornecedores (preços, estoque, ofertas) direto no Supabase de produção
(`OriumProducao`, ref `onazmlxfrstrdefbekle`), **sem depender da hospedagem da loja**. Substitui a rota
`/api/public/hooks/sync-suppliers` do Worker, que não cabe no plano Free do Cloudflare (50 chamadas externas
por requisição).

## Como funciona

- **Código-fonte**: `supabase/edge-src/sync-suppliers.ts` (entrada) + o motor do app em `src/lib/suppliers/*`
  (`engine.server.ts`, adaptadores, `sync-schedule.ts`). `supabase/edge-src/client.edge.ts` troca o cliente do app
  pelo cliente da função.
- **`index.ts` nesta pasta é GERADO** (minificado, sem o `supabase-js`, que a Deno resolve via `npm:`). Não edite:
  altere a fonte e gere de novo.
- **Uma chamada = até 5 rodadas** (≈ 40 s) de um fornecedor por vez, por causa do limite de 2 s de CPU por requisição do
  plano gratuito (tempo máximo de parede: 150 s). O progresso fica no fornecedor (`sync_cursor`, `sync_status`):
  a chamada seguinte retoma de onde parou.
- **Falha é falha**: erro do fornecedor, rodada que não avança, catálogo incompleto ou ciclo parado há mais de 3 h devolvem
  HTTP 500 e o fornecedor nunca fica preso em "sincronizando".
- **MRX**: o custo é o preço de lista menos o desconto à vista/Pix. Se a leitura ao vivo do desconto falhar, usa o último
  desconto gravado em `suppliers.payment_discount_percent`; sem nenhum, interrompe a rodada (nunca grava preço de lista como custo).
- Parâmetros: `?supplier=<slug>` · `?force=1` (ignora pausa e intervalo — usar só em teste, reinicia o ciclo ao terminar) ·
  `?since=<ISO>` (cada fornecedor é tentado uma vez por abertura do job de 3 h).

## Agendamento (Supabase Cron)

Migrações em `supabase/migrations/`:

- `20261115130000_edge_sync_suppliers_auth.sql` — segredo no Vault (`orium_edge_cron_secret`, gerado no banco, nunca exibido)
  e RPC `orium_check_edge_cron_secret(token)` (só `service_role`).
- `20261115133000_cron_sync_suppliers_edge.sql` — jobs:
  - `sync-suppliers-3h` (`0 */3 * * *`, UTC): abre o ciclo da janela de 3 h.
  - `sync-suppliers-continue` (`* * * * *`): só chama a função quando há fornecedor parcial ou ainda não tentado na janela,
    e só com o job de 3 h ativo. Pausar o de 3 h pausa os dois: `select cron.alter_job(<id do sync-suppliers-3h>, active := false);`

Os jobs leem o segredo do Vault a cada chamada; nenhum segredo está neste repositório.

## Publicar uma nova versão

1. Gerar o arquivo: `node scripts/build-edge-sync.mjs` (usa o `esbuild` já presente no projeto).
2. Publicar — escolha um:
   - **CLI** (`npx supabase@latest login` uma vez): `npx supabase functions deploy sync-suppliers --project-ref onazmlxfrstrdefbekle --no-verify-jwt`
     (rodar a partir da raiz; a pasta `supabase/functions/sync-suppliers/` é a publicada).
   - **Painel**: Edge Functions → `sync-suppliers` → Code → colar o conteúdo de `index.ts` → Deploy updates. Em Settings,
     deixar **Verify JWT with legacy secret = OFF** (a autenticação é feita pela própria função; as chaves novas do Supabase não são JWT).
3. Conferir: chamada sem segredo → 401; `select * from cron.job_run_details where jobid in (...) order by start_time desc limit 5;`.

## Testar à mão (sem expor o segredo)

No SQL do Supabase (o segredo é lido do Vault dentro do banco):

```sql
select net.http_post(
  url := 'https://onazmlxfrstrdefbekle.supabase.co/functions/v1/sync-suppliers?supplier=smart-mania',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='orium_edge_cron_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 150000);
-- depois de ~1 min:
select status_code, content from net._http_response order by id desc limit 1;
```

## Verificações úteis

```sql
select slug, sync_status, sync_cursor, last_sync_at, last_successful_sync_at, sync_message from suppliers order by slug;
select supplier_id, status, started_at, finished_at, products_processed, error_code from sync_runs order by started_at desc limit 10;
select count(*) from sync_runs where finished_at is null;  -- deve ser 0 fora de um ciclo em andamento
```

## Limites conhecidos

- Rasha devolve HTTP 403 (a loja bloqueia a leitura automática a partir de Cloudflare e Supabase): a chamada correspondente
  termina com HTTP 500 a cada 12 h e os dados anteriores são mantidos.
- Os valores `x-kyte-cdn-secret`/`kyte_prod_*` nos adaptadores são as chaves públicas da API de vitrine da Kyte (já estavam
  no código do app); não são credenciais da Orium.
