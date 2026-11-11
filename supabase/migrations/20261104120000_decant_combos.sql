-- COMBO DE DECANTS ("leve 3 por R$ 100"): promoção por quantidade, configurável no Admin.
-- O cálculo oficial roda no servidor (priceCart); o navegador só lê a regra pela consulta segura.
CREATE TABLE IF NOT EXISTS public.decant_combos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Promoção da semana',
  quantity integer NOT NULL CHECK (quantity BETWEEN 2 AND 20),
  combo_price numeric(10,2) NOT NULL CHECK (combo_price > 0),
  decant_sizes integer[] NOT NULL DEFAULT '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  orders_count integer NOT NULL DEFAULT 0,
  sales_total numeric(12,2) NOT NULL DEFAULT 0,
  discount_total numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.decant_combos TO authenticated;
GRANT ALL ON public.decant_combos TO service_role;
ALTER TABLE public.decant_combos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decant_combos_staff_all" ON public.decant_combos FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- leitura pública: só o que o cliente precisa ver, e só combos em vigor
CREATE OR REPLACE FUNCTION public.public_decant_combos()
RETURNS TABLE (
  id uuid, name text, quantity integer, combo_price numeric, decant_sizes integer[],
  starts_at timestamptz, ends_at timestamptz, active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.id, c.name, c.quantity, c.combo_price, c.decant_sizes, c.starts_at, c.ends_at, c.active
    FROM public.decant_combos c
   WHERE c.active
     AND (c.starts_at IS NULL OR c.starts_at <= now())
     AND (c.ends_at IS NULL OR c.ends_at > now())
$function$;

REVOKE ALL ON FUNCTION public.public_decant_combos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_decant_combos() TO anon, authenticated, service_role;

-- promoção desta semana: 3 decants de 5 ml por R$ 100 (editável/pausável no Admin)
INSERT INTO public.decant_combos (name, quantity, combo_price, decant_sizes, active)
SELECT 'Promoção da semana', 3, 100, '{5}', true
WHERE NOT EXISTS (SELECT 1 FROM public.decant_combos);

CREATE TRIGGER decant_combos_touch BEFORE UPDATE ON public.decant_combos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
