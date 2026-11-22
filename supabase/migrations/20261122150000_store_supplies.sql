-- Gerenciamento da loja (Admin → Produtos → Gerenciamento → Itens da loja).
-- Tudo o que a loja física usa e não é perfume à venda: papel higiênico, fitas
-- olfativas, frascos de decant, sacolas... Cada item tem quantidade atual e
-- cada compra, uso ou correção vira uma linha de histórico com o quanto se gastou.
-- Só a equipe (is_staff) lê ou mexe.

CREATE TABLE IF NOT EXISTS public.store_supplies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  category text NOT NULL DEFAULT 'outros'
    CHECK (category IN ('embalagem', 'decant', 'limpeza', 'divulgacao', 'escritorio', 'outros')),
  unit text NOT NULL DEFAULT 'un' CHECK (char_length(btrim(unit)) BETWEEN 1 AND 12),
  quantity numeric(12, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity numeric(12, 2) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

CREATE TABLE IF NOT EXISTS public.store_supply_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_id uuid NOT NULL REFERENCES public.store_supplies (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('compra', 'uso', 'ajuste')),
  delta numeric(12, 2) NOT NULL,
  before_qty numeric(12, 2) NOT NULL,
  after_qty numeric(12, 2) NOT NULL CHECK (after_qty >= 0),
  total_cost numeric(12, 2) CHECK (total_cost IS NULL OR total_cost >= 0),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS store_supply_moves_supply_idx ON public.store_supply_moves (supply_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_supply_moves_cost_idx ON public.store_supply_moves (created_at) WHERE total_cost IS NOT NULL;

ALTER TABLE public.store_supplies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_supply_moves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_supplies_staff ON public.store_supplies;
CREATE POLICY store_supplies_staff ON public.store_supplies
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS store_supply_moves_staff ON public.store_supply_moves;
CREATE POLICY store_supply_moves_staff ON public.store_supply_moves
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

REVOKE ALL ON public.store_supplies, public.store_supply_moves FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_supplies, public.store_supply_moves TO authenticated;

-- Compra (+), uso (−) ou correção (valor final) num passo só: trava o item,
-- recalcula a quantidade e grava o histórico. Uso maior que o que tem é recusado.
CREATE OR REPLACE FUNCTION public.store_supply_move(
  p_supply uuid,
  p_kind text,
  p_quantity numeric,
  p_total_cost numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS public.store_supplies
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  s public.store_supplies;
  v_after numeric(12, 2);
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Só a equipe pode mexer no gerenciamento da loja.' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('compra', 'uso', 'ajuste') THEN
    RAISE EXCEPTION 'Tipo de movimento inválido.';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 0 OR (p_kind <> 'ajuste' AND p_quantity = 0) THEN
    RAISE EXCEPTION 'Informe uma quantidade maior que zero.';
  END IF;

  SELECT * INTO s FROM public.store_supplies WHERE id = p_supply AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item não encontrado.';
  END IF;

  v_after := CASE p_kind
    WHEN 'compra' THEN s.quantity + p_quantity
    WHEN 'uso' THEN s.quantity - p_quantity
    ELSE p_quantity
  END;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'A loja só tem % %. Não dá para usar mais do que isso.', trim(to_char(s.quantity, 'FM999999990.##')), s.unit;
  END IF;

  INSERT INTO public.store_supply_moves (supply_id, kind, delta, before_qty, after_qty, total_cost, note)
  VALUES (
    s.id,
    p_kind,
    v_after - s.quantity,
    s.quantity,
    v_after,
    CASE WHEN p_kind = 'compra' THEN p_total_cost ELSE NULL END,
    NULLIF(btrim(coalesce(p_note, '')), '')
  );

  UPDATE public.store_supplies SET quantity = v_after, updated_at = now() WHERE id = s.id RETURNING * INTO s;
  RETURN s;
END;
$$;

REVOKE ALL ON FUNCTION public.store_supply_move(uuid, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_supply_move(uuid, text, numeric, numeric, text) TO authenticated;
