-- Controle de pedidos: dia combinado para o cliente pagar e compra agendada no fornecedor.
alter table public.catalog_orders add column if not exists payment_due_date date;
alter table public.restock_items add column if not exists planned_purchase_date date;
alter table public.restock_items add column if not exists purchased_at timestamptz;
alter table public.restock_items add column if not exists received_at timestamptz;
comment on column public.catalog_orders.payment_due_date is 'Dia combinado com o cliente para pagar (alerta de atraso no painel).';
comment on column public.restock_items.planned_purchase_date is 'Dia agendado para comprar no fornecedor.';
