-- EDITAR E EXCLUIR VENDAS DA LOJA -------------------------------------------
-- Editar = reverter o impacto antigo e aplicar o novo.
-- Excluir = reverter tudo, preservando auditoria (soft delete).

ALTER TABLE public.store_sales ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.store_sales ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.store_sales ADD COLUMN IF NOT EXISTS deletion_reason text;
ALTER TABLE public.store_sales ADD COLUMN IF NOT EXISTS edit_seq integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS store_sales_live_idx ON public.store_sales(sold_at DESC) WHERE deleted_at IS NULL;

-- Edição atômica: estorna o efeito atual, aplica o novo, recalcula e audita.
CREATE OR REPLACE FUNCTION public.store_sale_update(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid := nullif(p_payload->>'id','')::uuid;
  v_expected integer := nullif(p_payload->>'expected_seq','')::integer;
  v_sale record;
  v_old record;
  v_item jsonb;
  v_product record;
  v_variant text;
  v_ml integer;
  v_qty integer;
  v_price numeric;
  v_cost numeric;
  v_unit_cost numeric;
  v_key text;
  v_costs jsonb;
  v_policy text := 'atual';
  v_kept boolean := false;
  v_new boolean := false;
  v_subtotal numeric := 0;
  v_cost_total numeric := 0;
  v_cost_complete boolean := true;
  v_discount numeric := 0;
  v_total numeric;
  v_wanted_total numeric := nullif(p_payload->>'total','')::numeric;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'venda não informada'; END IF;

  SELECT * INTO v_sale FROM public.store_sales WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'venda não encontrada'; END IF;
  IF v_sale.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'venda excluída'; END IF;

  -- idempotência otimista: o mesmo salvamento repetido não aplica movimentação de novo
  IF v_expected IS NOT NULL AND v_expected <> v_sale.edit_seq THEN
    RETURN jsonb_build_object('id', v_id, 'already', true, 'edit_seq', v_sale.edit_seq);
  END IF;

  IF jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'venda sem itens';
  END IF;

  v_before := jsonb_build_object(
    'payment_method', v_sale.payment_method,
    'customer_id', v_sale.customer_id,
    'customer_name', v_sale.customer_name,
    'sold_at', v_sale.sold_at,
    'discount', v_sale.discount,
    'total', v_sale.total,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'name', i.product_name_snapshot, 'variant', i.variant, 'decant_ml', i.decant_ml,
        'quantity', i.quantity, 'unit_price', i.unit_price
      ) ORDER BY i.created_at), '[]'::jsonb)
      FROM public.store_sale_items i WHERE i.sale_id = v_id
    )
  );

  -- custos gravados no momento da venda, por produto+variante+tamanho
  SELECT coalesce(jsonb_object_agg(t.k, to_jsonb(t.c)), '{}'::jsonb) INTO v_costs
    FROM (
      SELECT i.product_id::text || '|' || i.variant || '|' || coalesce(i.decant_ml, 0)::text AS k,
             min(i.unit_cost_snapshot) AS c
        FROM public.store_sale_items i
       WHERE i.sale_id = v_id AND i.unit_cost_snapshot IS NOT NULL
       GROUP BY 1
    ) t;

  -- estorna o impacto de estoque atual
  IF v_sale.status = 'confirmada' THEN
    FOR v_old IN SELECT * FROM public.store_sale_items WHERE sale_id = v_id LOOP
      PERFORM public.store_sale_apply_stock(
        v_old.product_id,
        CASE WHEN v_old.variant = 'FULL' THEN -v_old.quantity ELSE 0 END,
        -coalesce(v_old.ml_consumed, 0)
      );
    END LOOP;
  END IF;

  DELETE FROM public.store_sale_items WHERE sale_id = v_id;

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

    -- política de custo: item inalterado mantém o snapshot da venda; novo/alterado usa o custo atual
    v_key := v_product.id::text || '|' || v_variant || '|' || coalesce(v_ml, 0)::text;
    IF v_costs ? v_key THEN
      v_unit_cost := (v_costs->>v_key)::numeric;
      v_kept := true;
    ELSE
      v_cost := public.store_product_cost(v_product.id);
      IF v_variant = 'DECANT' THEN
        v_unit_cost := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_cost / v_product.volume_ml * v_ml, 4) END;
      ELSE
        v_unit_cost := v_cost;
      END IF;
      v_new := true;
    END IF;
    IF v_unit_cost IS NULL THEN v_cost_complete := false; END IF;

    INSERT INTO public.store_sale_items (
      sale_id, product_id, product_name_snapshot, brand_snapshot, image_snapshot,
      variant, decant_ml, quantity, unit_price, unit_cost_snapshot, ml_consumed, subtotal
    ) VALUES (
      v_id, v_product.id, v_product.canonical_name, v_product.brand, v_product.image_url,
      v_variant, v_ml, v_qty, v_price, v_unit_cost,
      CASE WHEN v_variant = 'DECANT' THEN v_ml * v_qty ELSE 0 END,
      round(v_price * v_qty, 2)
    );

    v_subtotal := v_subtotal + round(v_price * v_qty, 2);
    v_cost_total := v_cost_total + coalesce(v_unit_cost, 0) * v_qty;

    IF v_sale.status = 'confirmada' THEN
      PERFORM public.store_sale_apply_stock(
        v_product.id,
        CASE WHEN v_variant = 'FULL' THEN v_qty ELSE 0 END,
        CASE WHEN v_variant = 'DECANT' THEN v_ml * v_qty ELSE 0 END
      );
    END IF;
  END LOOP;

  IF v_wanted_total IS NOT NULL AND v_wanted_total < v_subtotal THEN
    v_discount := round(v_subtotal - v_wanted_total, 2);
  ELSE
    v_discount := round(coalesce(nullif(p_payload->>'discount','')::numeric, 0), 2);
  END IF;
  v_discount := greatest(least(v_discount, v_subtotal), 0);
  v_total := round(v_subtotal - v_discount, 2);

  v_policy := CASE WHEN v_kept AND v_new THEN 'misto' WHEN v_kept THEN 'snapshot' ELSE 'atual' END;

  UPDATE public.store_sales SET
    payment_method = coalesce(nullif(p_payload->>'payment_method',''), payment_method),
    customer_id = CASE WHEN p_payload ? 'customer_id' THEN nullif(p_payload->>'customer_id','')::uuid ELSE customer_id END,
    customer_name = CASE WHEN p_payload ? 'customer_name' THEN nullif(p_payload->>'customer_name','') ELSE customer_name END,
    sold_at = coalesce(nullif(p_payload->>'sold_at','')::timestamptz, sold_at),
    subtotal = round(v_subtotal, 2),
    discount = v_discount,
    total = v_total,
    cost_total = round(v_cost_total, 2),
    gross_profit = round(v_total - v_cost_total, 2),
    cost_complete = v_cost_complete,
    edit_seq = edit_seq + 1,
    updated_at = now()
  WHERE id = v_id;

  SELECT jsonb_build_object(
    'payment_method', s.payment_method,
    'customer_id', s.customer_id,
    'customer_name', s.customer_name,
    'sold_at', s.sold_at,
    'discount', s.discount,
    'total', s.total,
    'items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'name', i.product_name_snapshot, 'variant', i.variant, 'decant_ml', i.decant_ml,
        'quantity', i.quantity, 'unit_price', i.unit_price
      ) ORDER BY i.created_at), '[]'::jsonb)
      FROM public.store_sale_items i WHERE i.sale_id = v_id
    )
  ) INTO v_after FROM public.store_sales s WHERE s.id = v_id;

  INSERT INTO public.store_sale_events (sale_id, event, details, created_by)
  VALUES (v_id, 'editada', jsonb_build_object('before', v_before, 'after', v_after, 'cost_policy', v_policy), auth.uid());

  RETURN jsonb_build_object('id', v_id, 'already', false, 'edit_seq', v_sale.edit_seq + 1);
END;
$$;

-- Exclusão: reverte tudo uma única vez e preserva o rastro.
CREATE OR REPLACE FUNCTION public.store_sale_delete(p_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sale record;
  v_item record;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_sale FROM public.store_sales WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'venda não encontrada'; END IF;
  IF v_sale.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('id', p_id, 'already', true);
  END IF;

  IF v_sale.status = 'confirmada' THEN
    FOR v_item IN SELECT * FROM public.store_sale_items WHERE sale_id = p_id LOOP
      PERFORM public.store_sale_apply_stock(
        v_item.product_id,
        CASE WHEN v_item.variant = 'FULL' THEN -v_item.quantity ELSE 0 END,
        -coalesce(v_item.ml_consumed, 0)
      );
    END LOOP;
  END IF;

  UPDATE public.store_sales
     SET status = 'excluida',
         deleted_at = now(),
         deleted_by = auth.uid(),
         deletion_reason = nullif(p_reason, ''),
         updated_at = now()
   WHERE id = p_id;

  INSERT INTO public.store_sale_events (sale_id, event, details, created_by)
  VALUES (p_id, 'excluida', jsonb_build_object('reason', nullif(p_reason,''), 'total', v_sale.total), auth.uid());

  RETURN jsonb_build_object('id', p_id, 'already', false);
END;
$$;

-- Listagem: vendas excluídas saem da operação normal.
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
      WHERE status = 'confirmada' AND deleted_at IS NULL AND sold_at >= date_trunc('day', now())
    ),
    'period', (
      SELECT jsonb_build_object(
        'total', round(coalesce(sum(total),0),2),
        'count', count(*),
        'profit', round(coalesce(sum(gross_profit),0),2)
      ) FROM public.store_sales
      WHERE status = 'confirmada' AND deleted_at IS NULL AND sold_at >= p_from AND sold_at < p_to
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
        WHERE s.sold_at >= p_from AND s.sold_at < p_to AND s.deleted_at IS NULL
        ORDER BY s.sold_at DESC
        LIMIT 100
      ) q
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

-- Detalhe: inclui sequência de edição, histórico com detalhes e marca de exclusão.
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
    'edit_seq', s.edit_seq, 'deleted_at', s.deleted_at,
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
