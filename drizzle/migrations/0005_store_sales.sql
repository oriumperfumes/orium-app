-- VENDAS DA LOJA (canal físico) ------------------------------------------------
-- Vendas presenciais: mesma fonte financeira da Orium, sem tocar no funil digital.

CREATE SEQUENCE IF NOT EXISTS public.store_sale_number_seq;

CREATE TABLE public.store_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number text NOT NULL UNIQUE DEFAULT ('LV-' || lpad(nextval('public.store_sale_number_seq')::text, 4, '0')),
  sale_channel text NOT NULL DEFAULT 'physical_store',
  entry_method text NOT NULL DEFAULT 'manual',
  payment_method text,
  customer_id uuid REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  customer_name text,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  cost_total numeric NOT NULL DEFAULT 0,
  gross_profit numeric NOT NULL DEFAULT 0,
  cost_complete boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'confirmada',
  sold_at timestamptz NOT NULL DEFAULT now(),
  transcript text,
  idempotency_key text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  canceled_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_sales TO authenticated;
GRANT ALL ON public.store_sales TO service_role;
ALTER TABLE public.store_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage store sales" ON public.store_sales FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.store_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.store_sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot text,
  brand_snapshot text,
  image_snapshot text,
  variant text NOT NULL DEFAULT 'FULL',
  decant_ml integer,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  unit_cost_snapshot numeric,
  ml_consumed numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX store_sale_items_sale_idx ON public.store_sale_items(sale_id);
CREATE INDEX store_sale_items_product_idx ON public.store_sale_items(product_id);
CREATE INDEX store_sales_sold_at_idx ON public.store_sales(sold_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_sale_items TO authenticated;
GRANT ALL ON public.store_sale_items TO service_role;
ALTER TABLE public.store_sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage store sale items" ON public.store_sale_items FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.store_sale_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.store_sales(id) ON DELETE CASCADE,
  event text NOT NULL,
  details jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX store_sale_events_sale_idx ON public.store_sale_events(sale_id);
GRANT SELECT, INSERT ON public.store_sale_events TO authenticated;
GRANT ALL ON public.store_sale_events TO service_role;
ALTER TABLE public.store_sale_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read store sale events" ON public.store_sale_events FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write store sale events" ON public.store_sale_events FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

-- Consumo parcial de frasco por decants vendidos na loja.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS decant_ml_consumed numeric NOT NULL DEFAULT 0;

-- Custo válido do produto no momento da venda.
CREATE OR REPLACE FUNCTION public.store_product_cost(p_product_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT nullif(coalesce(pc.best_cost, p.manual_cost, 0), 0)
    FROM public.products p
    LEFT JOIN public.product_costs pc ON pc.product_id = p.id
   WHERE p.id = p_product_id;
$$;

-- Aplica o consumo de estoque de um item (sinal +1 venda, -1 estorno).
CREATE OR REPLACE FUNCTION public.store_sale_apply_stock(p_product_id uuid, p_bottles integer, p_ml numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_volume numeric;
  v_consumed numeric;
  v_stock integer;
BEGIN
  IF p_product_id IS NULL THEN RETURN; END IF;

  SELECT coalesce(nullif(volume_ml, 0), 100), coalesce(decant_ml_consumed, 0), coalesce(stock_quantity, 0)
    INTO v_volume, v_consumed, v_stock
    FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_stock := v_stock - coalesce(p_bottles, 0);
  v_consumed := v_consumed + coalesce(p_ml, 0);

  -- ml acumulados que completam um frasco inteiro saem do estoque
  WHILE v_consumed >= v_volume LOOP
    v_consumed := v_consumed - v_volume;
    v_stock := v_stock - 1;
  END LOOP;
  -- estorno de decant devolve o frasco quando o consumo fica negativo
  WHILE v_consumed < 0 LOOP
    v_consumed := v_consumed + v_volume;
    v_stock := v_stock + 1;
  END LOOP;

  UPDATE public.products
     SET decant_ml_consumed = v_consumed,
         stock_quantity = greatest(v_stock, 0),
         in_stock = (greatest(v_stock, 0) > 0)
   WHERE id = p_product_id;
END;
$$;

-- Registro atômico e idempotente da venda física.
CREATE OR REPLACE FUNCTION public.store_sale_commit(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_key text := nullif(p_payload->>'idempotency_key', '');
  v_sale_id uuid;
  v_item jsonb;
  v_product record;
  v_variant text;
  v_ml integer;
  v_qty integer;
  v_price numeric;
  v_cost numeric;
  v_unit_cost numeric;
  v_subtotal numeric := 0;
  v_cost_total numeric := 0;
  v_cost_complete boolean := true;
  v_discount numeric := 0;
  v_total numeric;
  v_spoken_total numeric := nullif(p_payload->>'total', '')::numeric;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT id INTO v_sale_id FROM public.store_sales WHERE idempotency_key = v_key;
    IF v_sale_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_sale_id, 'duplicate', true);
    END IF;
  END IF;

  IF jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'venda sem itens';
  END IF;

  INSERT INTO public.store_sales (
    entry_method, payment_method, customer_id, customer_name,
    sold_at, transcript, idempotency_key, created_by
  ) VALUES (
    coalesce(nullif(p_payload->>'entry_method',''), 'manual'),
    nullif(p_payload->>'payment_method',''),
    nullif(p_payload->>'customer_id','')::uuid,
    nullif(p_payload->>'customer_name',''),
    coalesce(nullif(p_payload->>'sold_at','')::timestamptz, now()),
    nullif(p_payload->>'transcript',''),
    v_key,
    auth.uid()
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    SELECT id, canonical_name, brand, image_url, coalesce(nullif(volume_ml,0),100) AS volume_ml
      INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'produto não encontrado'; END IF;

    v_variant := CASE WHEN upper(coalesce(v_item->>'variant','FULL')) = 'DECANT' THEN 'DECANT' ELSE 'FULL' END;
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
    v_price := coalesce((v_item->>'unit_price')::numeric, 0);
    IF v_price < 0 THEN RAISE EXCEPTION 'preço inválido'; END IF;

    v_ml := NULL;
    IF v_variant = 'DECANT' THEN
      v_ml := coalesce((v_item->>'decant_ml')::int, 0);
      IF v_ml NOT IN (2, 5, 10) THEN RAISE EXCEPTION 'tamanho de decant inválido'; END IF;
    END IF;

    v_cost := public.store_product_cost(v_product.id);
    IF v_variant = 'DECANT' THEN
      v_unit_cost := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_cost / v_product.volume_ml * v_ml, 4) END;
    ELSE
      v_unit_cost := v_cost;
    END IF;
    IF v_unit_cost IS NULL THEN v_cost_complete := false; END IF;

    INSERT INTO public.store_sale_items (
      sale_id, product_id, product_name_snapshot, brand_snapshot, image_snapshot,
      variant, decant_ml, quantity, unit_price, unit_cost_snapshot, ml_consumed, subtotal
    ) VALUES (
      v_sale_id, v_product.id, v_product.canonical_name, v_product.brand, v_product.image_url,
      v_variant, v_ml, v_qty, v_price, v_unit_cost,
      CASE WHEN v_variant = 'DECANT' THEN v_ml * v_qty ELSE 0 END,
      round(v_price * v_qty, 2)
    );

    v_subtotal := v_subtotal + round(v_price * v_qty, 2);
    v_cost_total := v_cost_total + coalesce(v_unit_cost, 0) * v_qty;

    PERFORM public.store_sale_apply_stock(
      v_product.id,
      CASE WHEN v_variant = 'FULL' THEN v_qty ELSE 0 END,
      CASE WHEN v_variant = 'DECANT' THEN v_ml * v_qty ELSE 0 END
    );
  END LOOP;

  -- total falado vira desconto explícito; itens nunca são alterados em silêncio
  IF v_spoken_total IS NOT NULL AND v_spoken_total < v_subtotal THEN
    v_discount := round(v_subtotal - v_spoken_total, 2);
  ELSE
    v_discount := round(coalesce(nullif(p_payload->>'discount','')::numeric, 0), 2);
  END IF;
  v_discount := greatest(least(v_discount, v_subtotal), 0);
  v_total := round(v_subtotal - v_discount, 2);

  UPDATE public.store_sales SET
    subtotal = round(v_subtotal, 2),
    discount = v_discount,
    total = v_total,
    cost_total = round(v_cost_total, 2),
    gross_profit = round(v_total - v_cost_total, 2),
    cost_complete = v_cost_complete,
    updated_at = now()
  WHERE id = v_sale_id;

  INSERT INTO public.store_sale_events (sale_id, event, details, created_by)
  VALUES (v_sale_id, 'criada', jsonb_build_object('entry_method', coalesce(p_payload->>'entry_method','manual')), auth.uid());

  RETURN jsonb_build_object('id', v_sale_id, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.store_sale_cancel(p_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_status text;
  v_item record;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT status INTO v_status FROM public.store_sales WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'venda não encontrada'; END IF;
  IF v_status = 'cancelada' THEN RETURN jsonb_build_object('id', p_id, 'already', true); END IF;

  FOR v_item IN SELECT * FROM public.store_sale_items WHERE sale_id = p_id LOOP
    PERFORM public.store_sale_apply_stock(
      v_item.product_id,
      CASE WHEN v_item.variant = 'FULL' THEN -v_item.quantity ELSE 0 END,
      -coalesce(v_item.ml_consumed, 0)
    );
  END LOOP;

  UPDATE public.store_sales
     SET status = 'cancelada', canceled_at = now(), updated_at = now()
   WHERE id = p_id;

  INSERT INTO public.store_sale_events (sale_id, event, details, created_by)
  VALUES (p_id, 'cancelada', jsonb_build_object('reason', p_reason), auth.uid());

  RETURN jsonb_build_object('id', p_id, 'already', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.store_sale_list(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_build_object(
    'today', (
      SELECT jsonb_build_object(
        'total', round(coalesce(sum(total),0),2),
        'count', count(*),
        'profit', round(coalesce(sum(gross_profit),0),2)
      ) FROM public.store_sales
      WHERE status = 'confirmada' AND sold_at >= date_trunc('day', now())
    ),
    'period', (
      SELECT jsonb_build_object(
        'total', round(coalesce(sum(total),0),2),
        'count', count(*),
        'profit', round(coalesce(sum(gross_profit),0),2)
      ) FROM public.store_sales
      WHERE status = 'confirmada' AND sold_at >= p_from AND sold_at < p_to
    ),
    'sales', (
      SELECT coalesce(jsonb_agg(x ORDER BY sold_at DESC), '[]'::jsonb) FROM (
        SELECT s.sold_at, jsonb_build_object(
          'id', s.id, 'sale_number', s.sale_number, 'sold_at', s.sold_at,
          'payment_method', s.payment_method, 'total', round(s.total,2),
          'gross_profit', round(s.gross_profit,2), 'cost_complete', s.cost_complete,
          'status', s.status, 'entry_method', s.entry_method,
          'customer_name', s.customer_name,
          'items', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'name', i.product_name_snapshot, 'brand', i.brand_snapshot,
              'image_url', i.image_snapshot, 'variant', i.variant,
              'decant_ml', i.decant_ml, 'quantity', i.quantity
            )), '[]'::jsonb) FROM public.store_sale_items i WHERE i.sale_id = s.id
          )
        ) AS x
        FROM public.store_sales s
        WHERE s.sold_at >= p_from AND s.sold_at < p_to
        ORDER BY s.sold_at DESC
        LIMIT 100
      ) q
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_sale_detail(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT jsonb_build_object(
    'id', s.id, 'sale_number', s.sale_number, 'sold_at', s.sold_at,
    'status', s.status, 'entry_method', s.entry_method, 'sale_channel', s.sale_channel,
    'payment_method', s.payment_method, 'customer_id', s.customer_id, 'customer_name', s.customer_name,
    'subtotal', round(s.subtotal,2), 'discount', round(s.discount,2), 'total', round(s.total,2),
    'cost_total', round(s.cost_total,2), 'gross_profit', round(s.gross_profit,2),
    'cost_complete', s.cost_complete, 'transcript', s.transcript,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'product_id', i.product_id, 'name', i.product_name_snapshot,
        'brand', i.brand_snapshot, 'image_url', i.image_snapshot, 'variant', i.variant,
        'decant_ml', i.decant_ml, 'quantity', i.quantity, 'unit_price', round(i.unit_price,2),
        'unit_cost', i.unit_cost_snapshot, 'ml_consumed', i.ml_consumed,
        'subtotal', round(i.subtotal,2)
      ) ORDER BY i.created_at), '[]'::jsonb) FROM public.store_sale_items i WHERE i.sale_id = s.id
    ),
    'events', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'event', e.event, 'at', e.created_at, 'details', e.details
      ) ORDER BY e.created_at DESC), '[]'::jsonb) FROM public.store_sale_events e WHERE e.sale_id = s.id
    )
  ) INTO v_out
  FROM public.store_sales s WHERE s.id = p_id;

  IF v_out IS NULL THEN RAISE EXCEPTION 'venda não encontrada'; END IF;
  RETURN v_out;
END;
$$;
