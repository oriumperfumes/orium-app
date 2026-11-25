-- Vendas (Admin → Pedidos › Vendas): um só livro de todas as vendas da loja.
-- Só LÊ o que já existe — nada é copiado nem gravado:
--   • catalog_orders    → pedidos do site, do WhatsApp e manuais (encomendas)
--   • store_sales       → balcão (frascos e decants, por voz ou catálogo) e peças
--                         do mostruário vendidas pelo balcão
--   • negotiation_sales → peças da Negociação vendidas com controle de pagamento
-- Regras para não contar a mesma venda duas vezes:
--   • pedido cancelado/na lixeira e venda de balcão excluída/cancelada ficam de fora;
--   • pedido ainda "pendente" e sem confirmação aparece como "a confirmar" e não
--     soma no faturamento (counted = false);
--   • peça da Negociação que já foi vendida pelo balcão (mostruário) aparece uma
--     vez só: vale a venda do balcão.
-- `unregistered` = peças marcadas "Vendido" na Negociação sem venda registrada em
-- lugar nenhum (para o Admin informar por quanto vendeu).
-- Só equipe (is_staff). SECURITY DEFINER porque junta tabelas com RLS próprias.

CREATE OR REPLACE FUNCTION public.sales_ledger(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '400 days' THEN
    RAISE EXCEPTION 'periodo invalido';
  END IF;

  WITH showcase_products AS (
    -- produtos de peças da Negociação já vendidas pelo balcão (mostruário)
    SELECT DISTINCT si.product_id
    FROM public.store_sales s
    JOIN public.store_sale_items si ON si.sale_id = s.id
    WHERE s.deleted_at IS NULL
      AND s.status <> 'cancelada'
      AND si.product_id IS NOT NULL
      AND (s.transcript = 'Mostruário da Negociação' OR si.image_snapshot LIKE '%negociacao-foto%')
  ),
  orders AS (
    SELECT
      'order'::text AS source,
      o.id,
      coalesce(o.confirmed_at, o.created_at) AS sold_at,
      CASE
        WHEN coalesce(o.order_origin, o.origin) = 'WHATSAPP' THEN 'whatsapp'
        WHEN coalesce(o.order_origin, o.origin) = 'MANUAL' THEN 'manual'
        ELSE 'site'
      END AS channel,
      o.order_number AS ref,
      o.customer_name,
      round(coalesce(o.final_total, o.grand_total, o.sales_total, 0), 2) AS total,
      round(least(coalesce(o.amount_paid, 0), coalesce(o.final_total, o.grand_total, o.sales_total, 0)), 2) AS paid,
      CASE WHEN coalesce(o.cost_total, 0) > 0
        THEN round(coalesce(o.sales_total, 0) - o.cost_total, 2) END AS profit,
      o.payment_method,
      o.status,
      (coalesce(o.is_confirmed, false) OR coalesce(o.status, '') <> 'pendente') AS counted,
      o.payment_due_date AS due_date,
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'name', i.product_name_snapshot,
          'image_url', i.image_snapshot,
          'variant', i.variant,
          'decant_ml', i.decant_ml,
          'quantity', i.quantity
        ) ORDER BY i.created_at), '[]'::jsonb)
        FROM public.catalog_order_items i WHERE i.order_id = o.id) AS items
    FROM public.catalog_orders o
    WHERE o.deleted_at IS NULL
      AND o.canceled_at IS NULL
      AND coalesce(o.status, '') <> 'cancelado'
      AND coalesce(o.confirmed_at, o.created_at) >= p_from
      AND coalesce(o.confirmed_at, o.created_at) < p_to
  ),
  store AS (
    SELECT
      'store'::text AS source,
      s.id,
      s.sold_at,
      CASE WHEN s.transcript = 'Mostruário da Negociação'
             OR EXISTS (SELECT 1 FROM public.store_sale_items x WHERE x.sale_id = s.id AND x.image_snapshot LIKE '%negociacao-foto%')
        THEN 'negociacao' ELSE 'balcao' END AS channel,
      s.sale_number AS ref,
      s.customer_name,
      round(s.total, 2) AS total,
      round(s.total, 2) AS paid,
      CASE WHEN s.cost_complete THEN round(s.gross_profit, 2) END AS profit,
      s.payment_method,
      s.status,
      true AS counted,
      NULL::date AS due_date,
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'name', i.product_name_snapshot,
          'image_url', i.image_snapshot,
          'variant', i.variant,
          'decant_ml', i.decant_ml,
          'quantity', i.quantity
        ) ORDER BY i.created_at), '[]'::jsonb)
        FROM public.store_sale_items i WHERE i.sale_id = s.id) AS items
    FROM public.store_sales s
    WHERE s.deleted_at IS NULL
      AND s.status <> 'cancelada'
      AND s.sold_at >= p_from
      AND s.sold_at < p_to
  ),
  negotiation AS (
    SELECT
      'negotiation'::text AS source,
      n.id,
      ns.sold_at,
      'negociacao'::text AS channel,
      NULL::text AS ref,
      coalesce(c.name, ns.customer_name) AS customer_name,
      round(ns.sale_price, 2) AS total,
      round(ns.amount_paid, 2) AS paid,
      NULL::numeric AS profit,
      ns.payment_method,
      n.status,
      true AS counted,
      ns.payment_due_date AS due_date,
      jsonb_build_array(jsonb_build_object(
        'name', n.name,
        'image_url', n.image_url,
        'variant', 'FULL',
        'decant_ml', NULL,
        'quantity', 1
      )) AS items
    FROM public.negotiation_sales ns
    JOIN public.negotiation_items n ON n.id = ns.item_id
    LEFT JOIN public.crm_customers c ON c.id = ns.customer_id
    WHERE n.status = 'SOLD'
      AND (n.product_id IS NULL OR n.product_id NOT IN (SELECT product_id FROM showcase_products))
      AND ns.sold_at >= p_from
      AND ns.sold_at < p_to
  ),
  allrows AS (
    SELECT * FROM orders
    UNION ALL SELECT * FROM store
    UNION ALL SELECT * FROM negotiation
  )
  SELECT jsonb_build_object(
    'sales', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'source', r.source,
        'id', r.id,
        'sold_at', r.sold_at,
        'channel', r.channel,
        'ref', r.ref,
        'customer_name', r.customer_name,
        'total', r.total,
        'paid', r.paid,
        'due', greatest(r.total - r.paid, 0),
        'profit', r.profit,
        'payment_method', r.payment_method,
        'status', r.status,
        'counted', r.counted,
        'due_date', r.due_date,
        'items', r.items
      ) ORDER BY r.sold_at DESC)
      FROM (SELECT * FROM allrows ORDER BY sold_at DESC LIMIT 1000) r
    ), '[]'::jsonb),
    -- a receber de qualquer época (não só do período escolhido)
    'receivable', (
      SELECT jsonb_build_object('total', round(coalesce(sum(d.due), 0), 2), 'count', count(*))
      FROM (
        SELECT greatest(coalesce(o.final_total, o.grand_total, o.sales_total, 0) - coalesce(o.amount_paid, 0), 0) AS due
        FROM public.catalog_orders o
        WHERE o.deleted_at IS NULL AND o.canceled_at IS NULL
          AND coalesce(o.status, '') <> 'cancelado'
          AND (coalesce(o.is_confirmed, false) OR coalesce(o.status, '') <> 'pendente')
        UNION ALL
        SELECT greatest(ns.sale_price - ns.amount_paid, 0)
        FROM public.negotiation_sales ns
        JOIN public.negotiation_items n ON n.id = ns.item_id
        WHERE n.status = 'SOLD'
          AND (n.product_id IS NULL OR n.product_id NOT IN (SELECT product_id FROM showcase_products))
      ) d
      WHERE d.due > 0.009
    ),
    'unregistered', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'name', n.name, 'brand', n.brand,
        'image_url', n.image_url, 'updated_at', n.updated_at
      ) ORDER BY n.updated_at DESC)
      FROM public.negotiation_items n
      WHERE n.status = 'SOLD'
        AND NOT EXISTS (SELECT 1 FROM public.negotiation_sales ns WHERE ns.item_id = n.id)
        AND (n.product_id IS NULL OR n.product_id NOT IN (SELECT product_id FROM showcase_products))
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION public.sales_ledger(timestamptz, timestamptz) IS
  'Livro único de vendas (pedidos, balcão, Negociação) para Admin → Vendas. Só leitura, só equipe.';

REVOKE ALL ON FUNCTION public.sales_ledger(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_ledger(timestamptz, timestamptz) TO authenticated;
