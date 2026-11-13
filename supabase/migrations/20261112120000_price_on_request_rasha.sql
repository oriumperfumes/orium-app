-- Preço sob consulta: o site mostra "Consultar no WhatsApp" no lugar do preço.
alter table public.products add column if not exists price_on_request boolean not null default false;

-- Rasha Fragrâncias (Loja Integrada): fornecedor só de CONSULTA para o Admin.
-- O site dela é preço de atacado: nunca entra em preço, compra ou estoque.
insert into public.suppliers (name, slug, website, active, adapter, platform, priority, use_for_purchasing, use_for_pricing,
  use_for_availability, show_in_comparison, auto_sync, creates_catalog_products, catalog_mode, phone, city, state,
  supply_mode, sync_interval_minutes, notes)
select 'Rasha Fragrâncias', 'rasha', 'https://www.rashafragrancia.com.br', true, 'loja-integrada', 'loja-integrada', 'reference',
  false, false, false, false, true, false, 'none', '21999196700', 'Rio de Janeiro', 'RJ', 'a_combinar', 720,
  'Só consulta: preços do site são de atacado. Perfumes adicionados ao site ficam "sob consulta".'
where not exists (select 1 from public.suppliers where slug = 'rasha');
