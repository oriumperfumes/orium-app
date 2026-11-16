-- Quantos ml ainda restam no frasco da Negociação. O estado ("Praticamente
-- cheio", "Metade"...) e a barra da loja saem disto + volume_ml.
alter table public.negotiation_items
  add column if not exists remaining_ml integer
  check (remaining_ml is null or remaining_ml >= 0);
comment on column public.negotiation_items.remaining_ml is 'Quantos ml ainda restam no frasco (o estado mostrado na loja é calculado a partir disto e de volume_ml).';
grant select (remaining_ml) on public.negotiation_items to anon;
