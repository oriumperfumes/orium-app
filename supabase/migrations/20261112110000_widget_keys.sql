-- Chaves dos widgets (iPhone/Windows/Android): cada aparelho lê o resumo dos
-- pedidos com uma chave própria. Guardamos só o hash (sha-256); a chave aparece
-- uma única vez, na hora de gerar. Desligar = revoked_at.
create table if not exists public.widget_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  token_hint text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.widget_keys enable row level security;
create policy "widget_keys staff" on public.widget_keys
  for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
