-- ============ identidade de telefone ============
CREATE OR REPLACE FUNCTION public.norm_phone(txt text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(right(regexp_replace(coalesce(txt, ''), '[^0-9]', '', 'g'), 11), '')
$$;

CREATE OR REPLACE FUNCTION public.norm_email(txt text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(lower(btrim(coalesce(txt, ''))), '')
$$;

-- ============ 1. FAVORITOS ============
CREATE TABLE public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  want_decant boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX favorites_user_product_key ON public.favorites (user_id, product_id);
CREATE INDEX favorites_product_idx ON public.favorites (product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites_own_read" ON public.favorites FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "favorites_own_insert" ON public.favorites FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "favorites_own_update" ON public.favorites FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "favorites_own_delete" ON public.favorites FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ============ 2. VOLTA AO ESTOQUE ============
CREATE TABLE public.back_in_stock_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid,
  anonymous_id text,
  email text,
  phone text,
  phone_normalized text GENERATED ALWAYS AS (public.norm_phone(phone)) STORED,
  channel text NOT NULL DEFAULT 'ACCOUNT' CHECK (channel IN ('ACCOUNT','EMAIL','WHATSAPP')),
  active boolean NOT NULL DEFAULT true,
  notified_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX bis_user_product_active ON public.back_in_stock_subscriptions (product_id, user_id)
  WHERE user_id IS NOT NULL AND active;
CREATE UNIQUE INDEX bis_email_product_active ON public.back_in_stock_subscriptions (product_id, public.norm_email(email))
  WHERE user_id IS NULL AND email IS NOT NULL AND active;
CREATE UNIQUE INDEX bis_phone_product_active ON public.back_in_stock_subscriptions (product_id, phone_normalized)
  WHERE user_id IS NULL AND email IS NULL AND phone_normalized IS NOT NULL AND active;
CREATE INDEX bis_product_idx ON public.back_in_stock_subscriptions (product_id) WHERE active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.back_in_stock_subscriptions TO authenticated;
GRANT ALL ON public.back_in_stock_subscriptions TO service_role;
ALTER TABLE public.back_in_stock_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bis_own_read" ON public.back_in_stock_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "bis_own_insert" ON public.back_in_stock_subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "bis_own_update" ON public.back_in_stock_subscriptions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "bis_own_delete" ON public.back_in_stock_subscriptions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER bis_touch BEFORE UPDATE ON public.back_in_stock_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.back_in_stock_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.back_in_stock_subscriptions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid,
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','SKIPPED','READ')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);
CREATE UNIQUE INDEX bisn_pending_once ON public.back_in_stock_notifications (subscription_id)
  WHERE status = 'PENDING';
CREATE INDEX bisn_user_idx ON public.back_in_stock_notifications (user_id, created_at DESC);

GRANT SELECT, UPDATE ON public.back_in_stock_notifications TO authenticated;
GRANT ALL ON public.back_in_stock_notifications TO service_role;
ALTER TABLE public.back_in_stock_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bisn_own_read" ON public.back_in_stock_notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "bisn_staff_update" ON public.back_in_stock_notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_staff(auth.uid()));

-- fila gerada apenas quando o estoque realmente volta
CREATE OR REPLACE FUNCTION public.products_back_in_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.in_stock AND NOT coalesce(OLD.in_stock, false) THEN
    INSERT INTO public.back_in_stock_notifications (subscription_id, product_id, user_id, channel)
    SELECT s.id, s.product_id, s.user_id, s.channel
      FROM public.back_in_stock_subscriptions s
     WHERE s.product_id = NEW.id AND s.active AND s.canceled_at IS NULL
    ON CONFLICT DO NOTHING;

    UPDATE public.back_in_stock_subscriptions
       SET active = false, notified_at = now(), updated_at = now()
     WHERE product_id = NEW.id AND active AND canceled_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_back_in_stock_trg AFTER UPDATE OF in_stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_back_in_stock();

-- ============ 3. CARRINHOS ============
CREATE TABLE public.shopping_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  anonymous_id text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ABANDONED','RECOVERED','CONVERTED')),
  items_count integer NOT NULL DEFAULT 0,
  estimated_total numeric NOT NULL DEFAULT 0,
  customer_name text,
  customer_phone text,
  phone_normalized text GENERATED ALWAYS AS (public.norm_phone(customer_phone)) STORED,
  order_id uuid REFERENCES public.catalog_orders(id) ON DELETE SET NULL,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  abandoned_at timestamptz,
  recovered_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR anonymous_id IS NOT NULL)
);
CREATE UNIQUE INDEX carts_user_open ON public.shopping_carts (user_id)
  WHERE user_id IS NOT NULL AND status IN ('ACTIVE','ABANDONED');
CREATE UNIQUE INDEX carts_anon_open ON public.shopping_carts (anonymous_id)
  WHERE user_id IS NULL AND anonymous_id IS NOT NULL AND status IN ('ACTIVE','ABANDONED');
CREATE INDEX carts_status_idx ON public.shopping_carts (status, last_activity_at DESC);

GRANT SELECT ON public.shopping_carts TO authenticated;
GRANT ALL ON public.shopping_carts TO service_role;
ALTER TABLE public.shopping_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carts_own_read" ON public.shopping_carts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE TABLE public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.shopping_carts(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_key text NOT NULL,
  variant text NOT NULL DEFAULT 'FULL' CHECK (variant IN ('FULL','DECANT')),
  decant_ml integer,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric,
  product_name text,
  brand text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cart_items_variant_key ON public.cart_items (cart_id, variant_key);
CREATE INDEX cart_items_cart_idx ON public.cart_items (cart_id);

GRANT SELECT ON public.cart_items TO authenticated;
GRANT ALL ON public.cart_items TO service_role;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cart_items_own_read" ON public.cart_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shopping_carts c
     WHERE c.id = cart_items.cart_id AND (c.user_id = auth.uid() OR public.is_staff(auth.uid()))
  ));

CREATE TRIGGER carts_touch BEFORE UPDATE ON public.shopping_carts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ 4. CRM ============
CREATE TABLE public.crm_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text,
  phone text,
  phone_normalized text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_customers_user_key ON public.crm_customers (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX crm_customers_phone_key ON public.crm_customers (phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE UNIQUE INDEX crm_customers_email_key ON public.crm_customers (email) WHERE email IS NOT NULL AND phone_normalized IS NULL AND user_id IS NULL;

GRANT SELECT ON public.crm_customers TO authenticated;
GRANT ALL ON public.crm_customers TO service_role;
ALTER TABLE public.crm_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_customers_staff" ON public.crm_customers FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR user_id = auth.uid());

CREATE TRIGGER crm_customers_touch BEFORE UPDATE ON public.crm_customers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.crm_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_notes_customer_idx ON public.crm_notes (customer_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_notes TO authenticated;
GRANT ALL ON public.crm_notes TO service_role;
ALTER TABLE public.crm_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_notes_staff_all" ON public.crm_notes FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER crm_notes_touch BEFORE UPDATE ON public.crm_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.crm_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  user_id uuid,
  event text NOT NULL,
  entity_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_events_customer_idx ON public.crm_events (customer_id, created_at DESC);

GRANT SELECT ON public.crm_events TO authenticated;
GRANT ALL ON public.crm_events TO service_role;
ALTER TABLE public.crm_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_events_staff" ON public.crm_events FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- ============ identidade do cliente ============
CREATE OR REPLACE FUNCTION public.crm_upsert_customer(
  p_user_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ph text := public.norm_phone(p_phone);
  em text := public.norm_email(p_email);
  cid uuid;
BEGIN
  IF p_user_id IS NULL AND ph IS NULL AND em IS NULL THEN RETURN NULL; END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT id INTO cid FROM public.crm_customers WHERE user_id = p_user_id;
  END IF;
  IF cid IS NULL AND ph IS NOT NULL THEN
    SELECT id INTO cid FROM public.crm_customers WHERE phone_normalized = ph;
  END IF;
  IF cid IS NULL AND em IS NOT NULL THEN
    SELECT id INTO cid FROM public.crm_customers WHERE email = em AND phone_normalized IS NULL;
  END IF;

  IF cid IS NULL THEN
    INSERT INTO public.crm_customers (user_id, name, phone, phone_normalized, email)
    VALUES (p_user_id, nullif(btrim(coalesce(p_name,'')),''), nullif(btrim(coalesce(p_phone,'')),''), ph, em)
    RETURNING id INTO cid;
    RETURN cid;
  END IF;

  UPDATE public.crm_customers c SET
    user_id = coalesce(c.user_id, p_user_id),
    name = coalesce(nullif(btrim(coalesce(p_name,'')),''), c.name),
    phone = coalesce(c.phone, nullif(btrim(coalesce(p_phone,'')),'')),
    phone_normalized = coalesce(c.phone_normalized, ph),
    email = coalesce(c.email, em),
    updated_at = now()
  WHERE c.id = cid
    AND (c.user_id IS NULL OR p_user_id IS NULL OR c.user_id = p_user_id);
  RETURN cid;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_upsert_customer(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.crm_upsert_customer(uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_log_event(
  p_customer_id uuid, p_event text, p_entity_id text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.crm_events (customer_id, user_id, event, entity_id, details)
  SELECT p_customer_id, c.user_id, p_event, p_entity_id, p_details
    FROM public.crm_customers c WHERE c.id = p_customer_id;
$$;
REVOKE ALL ON FUNCTION public.crm_log_event(uuid, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.crm_log_event(uuid, text, text, jsonb) TO authenticated, service_role;

-- ficha de cliente a partir dos pedidos já existentes
INSERT INTO public.crm_customers (user_id, name, phone, phone_normalized, email)
SELECT DISTINCT ON (public.norm_phone(o.customer_phone))
       o.customer_user_id, o.customer_name, o.customer_phone, public.norm_phone(o.customer_phone), NULL
  FROM public.catalog_orders o
 WHERE o.deleted_at IS NULL AND public.norm_phone(o.customer_phone) IS NOT NULL
 ORDER BY public.norm_phone(o.customer_phone), o.created_at DESC
ON CONFLICT DO NOTHING;

-- ============ marcação de carrinho abandonado ============
CREATE OR REPLACE FUNCTION public.mark_abandoned_carts(p_minutes integer DEFAULT 45)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.shopping_carts
     SET status = 'ABANDONED', abandoned_at = now(), updated_at = now()
   WHERE status = 'ACTIVE'
     AND items_count > 0
     AND last_activity_at < now() - (greatest(5, coalesce(p_minutes, 45)) || ' minutes')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_abandoned_carts(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_carts(integer) TO authenticated, service_role;

-- ============ contador público de espera (sem dados pessoais) ============
CREATE OR REPLACE FUNCTION public.waiting_count(p_product_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.back_in_stock_subscriptions
   WHERE product_id = p_product_id AND active AND canceled_at IS NULL
$$;
GRANT EXECUTE ON FUNCTION public.waiting_count(uuid) TO anon, authenticated, service_role;