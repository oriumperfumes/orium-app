CREATE OR REPLACE FUNCTION public.decant_vial_cost(p_ml numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN p_ml IS NULL THEN 0 WHEN p_ml >= 10 THEN 2.50 ELSE 1.50 END
$$;
CREATE OR REPLACE FUNCTION public.store_sale_commit(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      v_unit_cost := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_cost / v_product.volume_ml * v_ml + public.decant_vial_cost(v_ml), 4) END;
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
$function$;

CREATE OR REPLACE FUNCTION public.store_sale_update(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT coalesce(jsonb_object_agg(t.k, to_jsonb(t.c)), '{}'::jsonb) INTO v_costs
    FROM (
      SELECT i.product_id::text || '|' || i.variant || '|' || coalesce(i.decant_ml, 0)::text AS k,
             min(i.unit_cost_snapshot) AS c
        FROM public.store_sale_items i
       WHERE i.sale_id = v_id AND i.unit_cost_snapshot IS NOT NULL
       GROUP BY 1
    ) t;

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

    v_key := v_product.id::text || '|' || v_variant || '|' || coalesce(v_ml, 0)::text;
    IF v_costs ? v_key THEN
      v_unit_cost := (v_costs->>v_key)::numeric;
      v_kept := true;
    ELSE
      v_cost := public.store_product_cost(v_product.id);
      IF v_variant = 'DECANT' THEN
        v_unit_cost := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_cost / v_product.volume_ml * v_ml + public.decant_vial_cost(v_ml), 4) END;
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
$function$;