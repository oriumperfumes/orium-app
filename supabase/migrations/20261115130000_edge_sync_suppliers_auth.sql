-- Autenticação da Edge Function `sync-suppliers` (chamada pelo Supabase Cron).
-- O segredo nasce no banco (Vault) e nunca é exibido; o cron o lê a cada chamada e a função
-- o confere por esta RPC (só service_role executa). verify_jwt fica desligado na função
-- porque as chaves novas do Supabase (sb_secret_/sb_publishable_) não são JWT.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'orium_edge_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'orium_edge_cron_secret',
      'Autentica o Supabase Cron na Edge Function sync-suppliers'
    );
  end if;
end $$;

create or replace function public.orium_check_edge_cron_secret(token text)
returns boolean
language sql
security definer
set search_path = public, vault
as $$
  select coalesce(
    exists (select 1 from vault.decrypted_secrets where name = 'orium_edge_cron_secret' and decrypted_secret = token),
    false
  );
$$;

revoke all on function public.orium_check_edge_cron_secret(text) from public, anon, authenticated;
grant execute on function public.orium_check_edge_cron_secret(text) to service_role;
