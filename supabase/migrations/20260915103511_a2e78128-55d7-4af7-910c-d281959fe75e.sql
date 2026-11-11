drop function if exists public.admin_dashboard_guard();

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.is_staff(auth.uid()) $$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated, service_role;