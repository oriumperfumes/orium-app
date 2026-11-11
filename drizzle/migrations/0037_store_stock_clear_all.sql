-- Limpa somente estoque físico e acompanhamento, preservando catálogo,
-- fornecedores, reposição e histórico de movimentos. Deve ser aplicada no banco.
CREATE OR REPLACE FUNCTION public.store_stock_clear_all(p_confirmation text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record;
  v_products integer := 0;
  v_zeroed integer := 0;
  v_units bigint := 0;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para limpar o estoque.';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'LIMPAR ESTOQUE' THEN
    RAISE EXCEPTION 'Confirmação incorreta.';
  END IF;

  -- Um único comando RPC/uma transação: nenhum estado de limpeza parcial.
  FOR r IN
    SELECT id, coalesce(local_stock,0) AS units
      FROM public.products
     WHERE stock_tracked OR coalesce(local_stock,0) > 0
     FOR UPDATE
  LOOP
    v_products := v_products + 1;
    IF r.units > 0 THEN
      v_zeroed := v_zeroed + 1;
      v_units := v_units + r.units;
      INSERT INTO public.inventory_movements
        (product_id, delta, before_qty, after_qty, mode, reason, source, actor)
      VALUES
        (r.id, -r.units, r.units, 0, 'set',
         'Limpeza geral do estoque físico', 'estoque_limpeza', auth.uid());
    END IF;
    UPDATE public.products
       SET local_stock = 0, stock_tracked = false, updated_at = now()
     WHERE id = r.id;
  END LOOP;

  RETURN jsonb_build_object(
    'products', v_products,
    'units', v_units,
    'zeroed_products', v_zeroed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.store_stock_clear_all(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_stock_clear_all(text) TO authenticated;
