-- Regras de venda da Resposta ideal (IA): limites de desconto, kit e parcelamento.
create table if not exists public.crm_sales_settings (
  id boolean primary key default true check (id),
  discount_suggested numeric not null default 5 check (discount_suggested between 0 and 30),
  discount_max numeric not null default 10 check (discount_max between 0 and 30),
  multi_buy_discount numeric not null default 5 check (multi_buy_discount between 0 and 30),
  installments_max integer not null default 3 check (installments_max between 1 and 12),
  installments_no_interest boolean not null default true,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.crm_sales_settings (id) values (true) on conflict do nothing;
alter table public.crm_sales_settings enable row level security;
drop policy if exists crm_sales_settings_staff_read on public.crm_sales_settings;
create policy crm_sales_settings_staff_read on public.crm_sales_settings for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists crm_sales_settings_staff_write on public.crm_sales_settings;
create policy crm_sales_settings_staff_write on public.crm_sales_settings for update to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
