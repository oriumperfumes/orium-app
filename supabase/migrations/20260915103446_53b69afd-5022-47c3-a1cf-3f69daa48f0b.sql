create or replace function public.admin_dashboard_guard() returns void language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'forbidden';
  end if;
end $$;
revoke all on function public.admin_dashboard_guard() from public;
grant execute on function public.admin_dashboard_guard() to authenticated, service_role;