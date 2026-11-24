-- Registro de cada lote do enriquecimento Fragrantica rodado pela Edge Function `enrich-fragrances`:
-- progresso, erros e o motivo de o lote ter parado antes do fim (prazo, 403/429, falhas seguidas).
-- Só a função (service_role) lê e grava: RLS ligada, sem políticas.

create table if not exists public.enrichment_batch_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  mode text,
  requested_limit integer,
  processed integer not null default 0,
  verified integer not null default 0,
  candidates integer not null default 0,
  review integer not null default 0,
  not_found integer not null default 0,
  temporary_failure integer not null default 0,
  not_started integer not null default 0,
  descriptions_written integer not null default 0,
  requests integer not null default 0,
  duration_ms integer,
  stop_reason text,
  http_status integer,
  detail text,
  response_code integer
);

alter table public.enrichment_batch_runs enable row level security;
revoke all on public.enrichment_batch_runs from anon, authenticated;
create index if not exists enrichment_batch_runs_started_idx on public.enrichment_batch_runs (started_at desc);
