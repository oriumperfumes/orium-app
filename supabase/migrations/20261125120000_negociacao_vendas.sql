-- Negociação → venda e controle de pagamento (Admin → Negociação → Vendido).
-- Uma linha por peça vendida: para quem, por quanto, quanto já pagou, forma de
-- pagamento e até quando o restante vence. Vive numa tabela à parte (e não em
-- colunas de negotiation_items) porque negotiation_items tem leitura pública
-- da vitrine: nome de cliente e valores nunca podem ficar ao alcance de anon.
-- Só a equipe (is_staff) lê ou mexe. Não mexe em estoque, catálogo nem em
-- Vendas da loja (faturamento continua pelo store_sale_commit, se usado).

CREATE TABLE IF NOT EXISTS public.negotiation_sales (
  item_id uuid PRIMARY KEY REFERENCES public.negotiation_items (id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.crm_customers (id) ON DELETE SET NULL,
  customer_name text CHECK (customer_name IS NULL OR char_length(btrim(customer_name)) BETWEEN 1 AND 120),
  sale_price numeric(12, 2) NOT NULL CHECK (sale_price >= 0),
  amount_paid numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('PIX', 'CARTAO', 'DINHEIRO')),
  payment_due_date date,
  sold_at timestamptz NOT NULL DEFAULT now(),
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT negotiation_sales_paid_le_price CHECK (amount_paid <= sale_price)
);

COMMENT ON TABLE public.negotiation_sales IS 'Venda de uma peça da Negociação: comprador, valor, quanto já foi pago e vencimento do restante. Só equipe.';
COMMENT ON COLUMN public.negotiation_sales.amount_paid IS 'Total já recebido (acumulado, em reais). Falta pagar = sale_price - amount_paid.';

CREATE INDEX IF NOT EXISTS negotiation_sales_open_idx
  ON public.negotiation_sales (payment_due_date NULLS LAST)
  WHERE amount_paid < sale_price;
CREATE INDEX IF NOT EXISTS negotiation_sales_customer_idx
  ON public.negotiation_sales (customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE public.negotiation_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS negotiation_sales_staff ON public.negotiation_sales;
CREATE POLICY negotiation_sales_staff ON public.negotiation_sales
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

REVOKE ALL ON public.negotiation_sales FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.negotiation_sales TO authenticated;
