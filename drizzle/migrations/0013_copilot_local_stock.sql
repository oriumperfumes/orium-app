-- ===== Estoque da Orium separado do estoque do fornecedor =====
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS local_stock integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS availability_override text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS supplier_available boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS availability_source text;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_local_stock_nonneg;
ALTER TABLE public.products ADD CONSTRAINT products_local_stock_nonneg CHECK (local_stock >= 0);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_availability_override_chk;
ALTER TABLE public.products ADD CONSTRAINT products_availability_override_chk CHECK (availability_override IN ('none','available','blocked'));

COMMENT ON COLUMN public.products.local_stock IS 'Unidades físicas na Orium. Nunca alterado pela sincronização de fornecedores.';
COMMENT ON COLUMN public.products.supplier_available IS 'Algum fornecedor tem o produto (venda sob encomenda).';
COMMENT ON COLUMN public.products.availability_source IS 'Origem da disponibilidade pública: blocked|local|manual|supplier|none';
COMMENT ON COLUMN public.products.in_stock IS 'Disponibilidade pública efetiva, calculada por compute_availability_source.';

-- Regra única de disponibilidade
CREATE OR REPLACE FUNCTION public.compute_availability_source(p_override text, p_local integer, p_supplier boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_override = 'blocked' THEN 'blocked'
    WHEN coalesce(p_local, 0) > 0 THEN 'local'
    WHEN p_override = 'available' THEN 'manual'
    WHEN coalesce(p_supplier, false) THEN 'supplier'
    ELSE 'none'
  END
$$;

CREATE OR REPLACE FUNCTION public.products_effective_availability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE src text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.supplier_available := coalesce(NEW.supplier_available, false) OR coalesce(NEW.in_stock, false);
  ELSIF NEW.in_stock IS DISTINCT FROM OLD.in_stock
     AND NEW.supplier_available IS NOT DISTINCT FROM OLD.supplier_available
     AND NEW.local_stock IS NOT DISTINCT FROM OLD.local_stock
     AND NEW.availability_override IS NOT DISTINCT FROM OLD.availability_override THEN
    -- escritores antigos (cadastro manual etc.) mexem só em in_stock: vira disponibilidade "sob encomenda"
    NEW.supplier_available := coalesce(NEW.in_stock, false);
  END IF;
  src := public.compute_availability_source(NEW.availability_override, NEW.local_stock, NEW.supplier_available);
  NEW.availability_source := src;
  NEW.in_stock := src IN ('local','manual','supplier');
  RETURN NEW;
END;
$$;

-- backfill antes do gatilho
UPDATE public.products SET supplier_available = coalesce(in_stock, false);
UPDATE public.products SET local_stock = greatest(coalesce(stock_quantity, 0), 0) WHERE source = 'manual';
UPDATE public.products SET availability_source = public.compute_availability_source(availability_override, local_stock, supplier_available),
  in_stock = public.compute_availability_source(availability_override, local_stock, supplier_available) IN ('local','manual','supplier');

DROP TRIGGER IF EXISTS trg_products_effective_availability ON public.products;
CREATE TRIGGER trg_products_effective_availability
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_effective_availability();

-- Sincronização passa a escrever só a disponibilidade do fornecedor
CREATE OR REPLACE FUNCTION public.recompute_product_pricing(p_product_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  s record; o record; best record; total_qty integer;
  base_retail numeric; base_wholesale numeric; src text;
BEGIN
  IF p_product_id IS NULL THEN RETURN; END IF;
  SELECT source INTO src FROM public.products WHERE id = p_product_id;
  IF src = 'manual' THEN RETURN; END IF;

  SELECT * INTO s FROM public.pricing_settings WHERE id;
  SELECT * INTO o FROM public.pricing_overrides WHERE product_id = p_product_id;
  SELECT sp.price, sp.supplier_id INTO best
    FROM public.supplier_products sp
    WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock AND sp.price IS NOT NULL
    ORDER BY sp.price ASC LIMIT 1;
  IF best.price IS NULL THEN
    SELECT sp.price, sp.supplier_id INTO best
      FROM public.supplier_products sp
      WHERE sp.product_id = p_product_id AND sp.active AND sp.price IS NOT NULL
      ORDER BY sp.price ASC LIMIT 1;
  END IF;
  SELECT sum(coalesce(sp.stock_quantity,0)) INTO total_qty
    FROM public.supplier_products sp WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock;

  INSERT INTO public.product_costs (product_id, best_cost, best_supplier_id, updated_at)
  VALUES (p_product_id, best.price, best.supplier_id, now())
  ON CONFLICT (product_id) DO UPDATE
    SET best_cost = EXCLUDED.best_cost, best_supplier_id = EXCLUDED.best_supplier_id, updated_at = now();

  base_retail := coalesce(o.fixed_retail_price, best.price + coalesce(o.retail_markup, s.retail_markup));
  base_wholesale := coalesce(o.fixed_wholesale_price, best.price + coalesce(o.wholesale_markup, s.wholesale_markup));

  UPDATE public.products p SET
    supplier_available = EXISTS (SELECT 1 FROM public.supplier_products sp WHERE sp.product_id = p_product_id AND sp.active AND sp.in_stock),
    stock_quantity = NULLIF(total_qty, 0),
    base_retail_price = CASE WHEN base_retail IS NULL THEN NULL ELSE round(base_retail, 2) END,
    base_wholesale_price = CASE WHEN base_wholesale IS NULL THEN NULL ELSE round(base_wholesale, 2) END,
    retail_price = CASE
      WHEN o.fixed_retail_price IS NOT NULL THEN round(o.fixed_retail_price, 2)
      ELSE public.commercial_price(base_retail, s.psych_pricing_active, s.psych_max_reduction)
    END,
    wholesale_price = CASE
      WHEN o.fixed_wholesale_price IS NOT NULL THEN round(o.fixed_wholesale_price, 2)
      ELSE public.commercial_price(base_wholesale, s.psych_pricing_active, s.psych_max_reduction)
    END,
    updated_at = now()
  WHERE p.id = p_product_id;
END;
$function$;

-- ===== Movimentações de estoque =====
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  before_qty integer NOT NULL,
  after_qty integer NOT NULL,
  mode text NOT NULL,
  reason text,
  source text NOT NULL DEFAULT 'painel',
  actor uuid,
  action_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON public.inventory_movements(product_id, created_at DESC);
GRANT SELECT ON public.inventory_movements TO authenticated;
GRANT ALL ON public.inventory_movements TO service_role;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff lê movimentações" ON public.inventory_movements FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- Venda da loja agora consome o estoque da Orium
CREATE OR REPLACE FUNCTION public.store_sale_apply_stock(p_product_id uuid, p_bottles integer, p_ml numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_volume numeric; v_consumed numeric; v_stock integer; v_before integer; v_after integer;
BEGIN
  IF p_product_id IS NULL THEN RETURN; END IF;
  SELECT coalesce(nullif(volume_ml, 0), 100), coalesce(decant_ml_consumed, 0), coalesce(local_stock, 0)
    INTO v_volume, v_consumed, v_stock
    FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_before := v_stock;
  v_stock := v_stock - coalesce(p_bottles, 0);
  v_consumed := v_consumed + coalesce(p_ml, 0);
  WHILE v_consumed >= v_volume LOOP v_consumed := v_consumed - v_volume; v_stock := v_stock - 1; END LOOP;
  WHILE v_consumed < 0 LOOP v_consumed := v_consumed + v_volume; v_stock := v_stock + 1; END LOOP;
  v_after := greatest(v_stock, 0);
  UPDATE public.products SET decant_ml_consumed = v_consumed, local_stock = v_after WHERE id = p_product_id;
  IF v_after <> v_before THEN
    INSERT INTO public.inventory_movements (product_id, delta, before_qty, after_qty, mode, reason, source, actor)
    VALUES (p_product_id, v_after - v_before, v_before, v_after, 'add',
            CASE WHEN v_after < v_before THEN 'Venda da loja' ELSE 'Estorno de venda da loja' END, 'venda_loja', auth.uid());
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.inventory_adjust(p_product_id uuid, p_mode text, p_qty integer, p_reason text DEFAULT NULL, p_source text DEFAULT 'painel', p_action_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_after integer; v_new record;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF p_mode NOT IN ('set','add','remove') THEN RAISE EXCEPTION 'Modo inválido.'; END IF;
  IF p_qty IS NULL OR p_qty < 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;
  SELECT id, canonical_name, local_stock, in_stock, availability_source INTO r FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  v_after := CASE p_mode WHEN 'set' THEN p_qty WHEN 'add' THEN r.local_stock + p_qty ELSE r.local_stock - p_qty END;
  IF v_after < 0 THEN RAISE EXCEPTION 'O estoque ficaria negativo (hoje há % unidade(s)).', r.local_stock; END IF;
  UPDATE public.products SET local_stock = v_after, updated_at = now() WHERE id = p_product_id
    RETURNING in_stock, availability_source INTO v_new;
  IF v_after <> r.local_stock THEN
    INSERT INTO public.inventory_movements (product_id, delta, before_qty, after_qty, mode, reason, source, actor, action_id)
    VALUES (p_product_id, v_after - r.local_stock, r.local_stock, v_after, p_mode, p_reason, coalesce(p_source,'painel'), auth.uid(), p_action_id);
  END IF;
  RETURN jsonb_build_object('product_id', p_product_id, 'name', r.canonical_name,
    'before', r.local_stock, 'after', v_after,
    'available_before', r.in_stock, 'available_after', v_new.in_stock,
    'source_before', r.availability_source, 'source_after', v_new.availability_source);
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_adjust(uuid, text, integer, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_adjust(uuid, text, integer, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_availability_override(p_product_id uuid, p_override text, p_reason text DEFAULT NULL, p_action_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_new record;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
  IF p_override NOT IN ('none','available','blocked') THEN RAISE EXCEPTION 'Opção inválida.'; END IF;
  SELECT id, canonical_name, availability_override, in_stock, availability_source INTO r FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  UPDATE public.products SET availability_override = p_override, updated_at = now() WHERE id = p_product_id
    RETURNING in_stock, availability_source INTO v_new;
  INSERT INTO public.activity_logs (user_id, action, entity, entity_id, details)
  VALUES (auth.uid(), 'disponibilidade manual', 'products', p_product_id,
    jsonb_build_object('from', r.availability_override, 'to', p_override, 'reason', p_reason, 'action_id', p_action_id));
  RETURN jsonb_build_object('product_id', p_product_id, 'name', r.canonical_name,
    'before', r.availability_override, 'after', p_override,
    'available_before', r.in_stock, 'available_after', v_new.in_stock,
    'source_before', r.availability_source, 'source_after', v_new.availability_source);
END;
$$;
REVOKE ALL ON FUNCTION public.set_availability_override(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_availability_override(uuid, text, text, uuid) TO authenticated;

-- ===== Copilot =====
CREATE TABLE IF NOT EXISTS public.copilot_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  title text,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS copilot_threads_user_idx ON public.copilot_threads(user_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_threads TO authenticated;
GRANT ALL ON public.copilot_threads TO service_role;
ALTER TABLE public.copilot_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dono das conversas" ON public.copilot_threads FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.copilot_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  thread_id uuid REFERENCES public.copilot_threads(id) ON DELETE SET NULL,
  tool text NOT NULL,
  intent text NOT NULL DEFAULT 'ACTION',
  risk text NOT NULL DEFAULT 'HIGH',
  utterance text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview jsonb,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  error text,
  undo_of uuid REFERENCES public.copilot_actions(id) ON DELETE SET NULL,
  undone_by uuid,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);
CREATE INDEX IF NOT EXISTS copilot_actions_created_idx ON public.copilot_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS copilot_actions_thread_idx ON public.copilot_actions(thread_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.copilot_actions TO authenticated;
GRANT ALL ON public.copilot_actions TO service_role;
ALTER TABLE public.copilot_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff lê ações" ON public.copilot_actions FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff cria as próprias ações" ON public.copilot_actions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_staff(auth.uid()));
CREATE POLICY "Staff atualiza as próprias ações" ON public.copilot_actions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.copilot_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phrases text[] NOT NULL DEFAULT '{}',
  instructions text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_commands TO authenticated;
GRANT ALL ON public.copilot_commands TO service_role;
ALTER TABLE public.copilot_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff gerencia comandos" ON public.copilot_commands FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.copilot_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase text NOT NULL,
  meaning text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_aliases TO authenticated;
GRANT ALL ON public.copilot_aliases TO service_role;
ALTER TABLE public.copilot_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff gerencia apelidos" ON public.copilot_aliases FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

INSERT INTO public.copilot_commands (name, phrases, instructions, created_by) VALUES
 ('Fechamento', ARRAY['fazer fechamento','fechamento do dia','fechar o dia'],
  'Mostre o resumo de hoje (vendas, lucro bruto, pedidos, vendas da loja, ticket), os pedidos pendentes e o custo da reposição pendente.', NULL),
 ('Resumo da loja', ARRAY['resumo','como está a loja','me atualiza'],
  'Mostre o resumo de hoje comparado com ontem.', NULL);
INSERT INTO public.copilot_aliases (phrase, meaning, created_by) VALUES
 ('dar entrada', 'adicionar unidades ao estoque local (modo add)', NULL),
 ('dar baixa', 'remover unidades do estoque local; se for venda, registrar venda da loja', NULL);