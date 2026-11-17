-- "De R$ 400 por R$ 299,90": o Admin converte o preço final em percentual.
-- Com 5 casas decimais o preço final volta exato ao centavo.
ALTER TABLE public.promotions ALTER COLUMN discount_percent TYPE numeric(8,5);
