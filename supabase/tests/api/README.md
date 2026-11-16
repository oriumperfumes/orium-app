# Validação pela API (PostgREST) por perfil

Complementa `20261113_products_internal_columns.test.sql` e `20261113_products_flow_queries.test.sql` (que rodam direto no banco). Aqui as mesmas
regras são exercitadas por HTTP, com o PostgREST real, com tokens de **visitante** (sem token), **cliente** (`authenticated`, sem equipe) e
**equipe** (`authenticated` + `user_roles` admin), mais o **caminho do servidor** (`service_role`, o que as server functions usam depois do
portão `is_staff`). 55 verificações (40 de produtos + 15 dos objetos novos de 13/11: price_on_request, busca, pedidos a fornecedor, reposição, chaves de widget, pago por item); a ordem importa (a equipe age no meio e a loja é relida no fim).

## Como rodar (tudo local e fechado)
1. Rede Docker **interna** (sem saída para a internet): `docker network create --internal orium-api-net`. **Nada é publicado na máquina.**
2. Banco: imagem `supabase/postgres` (a mesma do `supabase start`), na rede interna, sem `-p`; com o GoTrue na mesma rede (ele cria `auth` e as funções modernas) ou, sem ele, um *stand-in* de `auth`. Aplicar, nesta ordem, 
   (`auth.users` mínimo, `auth.jwt()` e as versões modernas de `auth.uid()`/`auth.role()`, que o GoTrue instala), `00-prerequisites.sql`,
   `generated/baseline.sql`, `40-acl-hardened.sql` e as duas migrações `20261113…`. Semear os dados fictícios com `seed.sql` (4 produtos, marca, 2 papéis).
3. `authenticator` com senha aleatória; PostgREST (`postgrest:v16.5`) na mesma rede: `PGRST_DB_SCHEMAS=public`, `PGRST_DB_ANON_ROLE=anon`,
   `PGRST_JWT_SECRET=<aleatório>`, `PGRST_DB_EXTRA_SEARCH_PATH=public,extensions`.
4. `node run-api-checks.mjs build <dir> <jwt-secret>` gera `plan.jsonl` com tokens HS256 efêmeros; `http.pl` (a imagem não tem curl) executa o
   plano **de dentro** da rede interna (`docker run --rm --network orium-api-net -v <dir>:/api:ro --entrypoint perl <imagem com perl> /api/http.pl /api/plan.jsonl rest 3000 > results.jsonl`);
   `node run-api-checks.mjs verify <dir>` confere cada caso.
5. Encerrar: remover contêineres e rede; apagar segredos.

Não usa dados de produção. Os segredos e tokens são gerados na hora e descartados.
