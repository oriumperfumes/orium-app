ALTER TABLE public.catalog_orders ADD COLUMN IF NOT EXISTS crm_customer_id uuid REFERENCES public.crm_customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS catalog_orders_crm_customer_idx ON public.catalog_orders(crm_customer_id);

-- vínculo: pedido escolhido no Admin já vem com crm_customer_id e não mexe na ficha global;
-- pedido sem vínculo cria/encontra a ficha pelo telefone (comportamento antigo) e passa a guardar o id.
CREATE OR REPLACE FUNCTION public.crm_link_order_customer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.crm_customer_id IS NULL THEN
    NEW.crm_customer_id := public.crm_upsert_customer(NEW.customer_user_id, NEW.customer_name, NEW.customer_phone, NULL);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS crm_sync_order_customer_trg ON public.catalog_orders;
CREATE TRIGGER crm_link_order_customer_trg BEFORE INSERT OR UPDATE OF customer_user_id, customer_name, customer_phone, crm_customer_id ON public.catalog_orders
FOR EACH ROW EXECUTE FUNCTION public.crm_link_order_customer();

-- pedidos antigos: só vincula quando o telefone aponta para exatamente uma ficha
UPDATE public.catalog_orders o SET crm_customer_id = m.id
FROM (
  SELECT phone_normalized, min(id::text)::uuid id FROM public.crm_customers
  WHERE phone_normalized IS NOT NULL GROUP BY phone_normalized HAVING count(*) = 1
) m
WHERE o.crm_customer_id IS NULL AND public.norm_phone(o.customer_phone) = m.phone_normalized;

-- seletor de clientes (staff): vazio = recentes; senão nome, parte do nome ou dígitos do telefone
CREATE OR REPLACE FUNCTION public.crm_customer_pick(p_q text DEFAULT NULL, p_limit int DEFAULT 12)
RETURNS TABLE(id uuid, name text, phone text, phone_normalized text, orders int, last_order_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q text := nullif(btrim(coalesce(p_q,'')),''); d text := regexp_replace(coalesce(p_q,''),'[^0-9]','','g');
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF length(d) > 11 AND left(d,2) = '55' THEN d := right(d, 11); END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.phone, c.phone_normalized,
         count(o.id)::int, max(o.created_at)
  FROM public.crm_customers c
  LEFT JOIN public.catalog_orders o ON o.crm_customer_id = c.id AND o.deleted_at IS NULL
  WHERE c.archived_at IS NULL
    AND (q IS NULL
      OR unaccent_safe(c.name) ILIKE '%' || unaccent_safe(q) || '%'
      OR (length(d) >= 3 AND c.phone_normalized LIKE '%' || d || '%'))
  GROUP BY c.id
  ORDER BY (q IS NULL AND max(o.created_at) IS NULL), max(o.created_at) DESC NULLS LAST, c.updated_at DESC
  LIMIT greatest(1, least(p_limit, 50));
END $$;
GRANT EXECUTE ON FUNCTION public.crm_customer_pick(text, int) TO authenticated;