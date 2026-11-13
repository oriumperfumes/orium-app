-- Fornecedor escolhido na mão no "Novo pedido": a Compras usa este fornecedor
-- em vez do melhor custo do momento.
alter table public.catalog_order_items add column if not exists supplier_chosen boolean not null default false;
comment on column public.catalog_order_items.supplier_chosen is 'true = a equipe escolheu o fornecedor no pedido; a Compras usa supplier_id deste item em vez do melhor custo.';
