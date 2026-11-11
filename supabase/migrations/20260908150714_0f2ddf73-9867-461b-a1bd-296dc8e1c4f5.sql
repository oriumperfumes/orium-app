-- ============ PROMOÇÕES ============
CREATE TABLE public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  discount_percent numeric(5,2) NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 90),
  applies_to text NOT NULL DEFAULT 'BOTH' CHECK (applies_to IN ('BOTH','DECANT','FULL')),
  product_ids uuid[] NOT NULL DEFAULT '{}',
  decant_sizes integer[] NOT NULL DEFAULT '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  stackable boolean NOT NULL DEFAULT false,
  announce boolean NOT NULL DEFAULT false,
  headline text,
  cta_label text,
  views integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  orders_count integer NOT NULL DEFAULT 0,
  sales_total numeric(12,2) NOT NULL DEFAULT 0,
  discount_total numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.promotions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promotions TO authenticated;
GRANT ALL ON public.promotions TO service_role;

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "promotions_public_read" ON public.promotions FOR SELECT TO anon, authenticated
  USING (active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()));
CREATE POLICY "promotions_staff_read" ON public.promotions FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "promotions_staff_write" ON public.promotions FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "promotions_staff_update" ON public.promotions FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "promotions_staff_delete" ON public.promotions FOR DELETE TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE TRIGGER promotions_touch BEFORE UPDATE ON public.promotions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX promotions_active_idx ON public.promotions (active, starts_at, ends_at);

-- ============ CUPONS ============
CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  discount_percent numeric(5,2) NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 90),
  visibility text NOT NULL DEFAULT 'SECRET' CHECK (visibility IN ('PUBLIC','SECRET')),
  applies_to text NOT NULL DEFAULT 'BOTH' CHECK (applies_to IN ('BOTH','DECANT','FULL')),
  product_ids uuid[] NOT NULL DEFAULT '{}',
  decant_sizes integer[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer,
  max_per_user integer,
  stackable boolean NOT NULL DEFAULT false,
  announce boolean NOT NULL DEFAULT false,
  redemptions integer NOT NULL DEFAULT 0,
  sales_total numeric(12,2) NOT NULL DEFAULT 0,
  discount_total numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX coupons_code_key ON public.coupons (upper(code));

GRANT SELECT ON public.coupons TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- cupons secretos NUNCA são legíveis pelo cliente
CREATE POLICY "coupons_public_read" ON public.coupons FOR SELECT TO anon, authenticated
  USING (visibility = 'PUBLIC' AND active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()));
CREATE POLICY "coupons_staff_read" ON public.coupons FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "coupons_staff_write" ON public.coupons FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "coupons_staff_update" ON public.coupons FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "coupons_staff_delete" ON public.coupons FOR DELETE TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE TRIGGER coupons_touch BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ USOS DE CUPOM ============
CREATE TABLE public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.catalog_orders(id) ON DELETE SET NULL,
  user_id uuid,
  device_id text,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  order_total numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coupon_redemptions_staff_read" ON public.coupon_redemptions FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE INDEX coupon_redemptions_coupon_idx ON public.coupon_redemptions (coupon_id);
CREATE INDEX coupon_redemptions_user_idx ON public.coupon_redemptions (coupon_id, user_id);
CREATE INDEX coupon_redemptions_device_idx ON public.coupon_redemptions (coupon_id, device_id);

-- ============ CAMPANHA VISTA UMA ÚNICA VEZ ============
CREATE TABLE public.promotion_impressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid REFERENCES public.promotions(id) ON DELETE CASCADE,
  coupon_id uuid REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id uuid,
  device_id text,
  clicked boolean NOT NULL DEFAULT false,
  seen_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.promotion_impressions TO authenticated;
GRANT ALL ON public.promotion_impressions TO service_role;

ALTER TABLE public.promotion_impressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "promotion_impressions_staff_read" ON public.promotion_impressions FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE INDEX promotion_impressions_promo_idx ON public.promotion_impressions (promotion_id, device_id);
CREATE INDEX promotion_impressions_promo_user_idx ON public.promotion_impressions (promotion_id, user_id);
CREATE INDEX promotion_impressions_coupon_idx ON public.promotion_impressions (coupon_id, device_id);
CREATE INDEX promotion_impressions_coupon_user_idx ON public.promotion_impressions (coupon_id, user_id);

-- ============ SNAPSHOT NO PEDIDO ============
ALTER TABLE public.catalog_orders
  ADD COLUMN items_subtotal numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN promotion_discount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN coupon_discount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN coupon_code text,
  ADD COLUMN coupon_percent numeric(5,2);

ALTER TABLE public.catalog_order_items
  ADD COLUMN unit_base_price numeric(12,2),
  ADD COLUMN promotion_id uuid REFERENCES public.promotions(id) ON DELETE SET NULL,
  ADD COLUMN promotion_percent numeric(5,2),
  ADD COLUMN promotion_discount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN coupon_discount numeric(12,2) NOT NULL DEFAULT 0;