-- Pagamento por perfume: o cliente pode pagar só alguns itens do pedido.
alter table public.catalog_order_items add column if not exists paid boolean not null default false;
comment on column public.catalog_order_items.paid is 'true = o cliente já pagou este item (pagamento marcado por perfume no Admin).';
