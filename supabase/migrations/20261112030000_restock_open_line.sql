-- Um perfume só "junta" com o que ainda vai ser pedido: a linha única vale
-- apenas para itens "a comprar". Itens já pedidos/recebidos ficam como estão
-- e uma venda nova cria uma linha nova "a comprar" (volta para Compras).
drop index if exists public.restock_items_unique_line;
create unique index if not exists restock_items_unique_open_line
  on public.restock_items (restock_list_id, product_id, coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'a comprar';
