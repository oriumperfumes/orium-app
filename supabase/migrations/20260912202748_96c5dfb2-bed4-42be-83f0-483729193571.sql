CREATE TABLE public.live_sessions (
  session_key text PRIMARY KEY,
  visitor_id text NOT NULL,
  customer_id uuid REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  user_id uuid,
  identified boolean NOT NULL DEFAULT false,
  display_name text,
  phone text,
  device text,
  source text,
  current_route text,
  current_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  current_product_name text,
  current_variant text,
  current_decant_ml integer,
  cart_items integer NOT NULL DEFAULT 0,
  cart_total numeric NOT NULL DEFAULT 0,
  favorites_count integer NOT NULL DEFAULT 0,
  views_count integer NOT NULL DEFAULT 0,
  intent text NOT NULL DEFAULT 'baixa',
  in_checkout boolean NOT NULL DEFAULT false,
  declined_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX live_sessions_activity_idx ON public.live_sessions (last_activity_at DESC);
CREATE INDEX live_sessions_visitor_idx ON public.live_sessions (visitor_id);

GRANT SELECT ON public.live_sessions TO authenticated;
GRANT ALL ON public.live_sessions TO service_role;
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe ve sessoes ao vivo" ON public.live_sessions
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE TABLE public.live_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key text NOT NULL,
  visitor_id text NOT NULL,
  customer_id uuid REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('mensagem', 'cupom', 'ajuda', 'salvar_escolhas')),
  message text,
  coupon_code text,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz,
  accepted_at timestamptz,
  dismissed_at timestamptz
);

CREATE INDEX live_interactions_session_idx ON public.live_interactions (session_key, created_at DESC);
CREATE INDEX live_interactions_visitor_idx ON public.live_interactions (visitor_id, created_at DESC);

GRANT SELECT ON public.live_interactions TO authenticated;
GRANT ALL ON public.live_interactions TO service_role;
ALTER TABLE public.live_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe ve interacoes ao vivo" ON public.live_interactions
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE TRIGGER live_sessions_touch BEFORE UPDATE ON public.live_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_interactions;