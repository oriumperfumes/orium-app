CREATE TABLE public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  device_label text,
  user_agent text,
  enabled boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO authenticated;
GRANT ALL ON public.push_devices TO service_role;

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage their own push devices"
ON public.push_devices FOR ALL TO authenticated
USING (user_id = auth.uid() AND public.is_staff(auth.uid()))
WITH CHECK (user_id = auth.uid() AND public.is_staff(auth.uid()));

CREATE TRIGGER push_devices_touch
BEFORE UPDATE ON public.push_devices
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX push_devices_active_idx ON public.push_devices (user_id) WHERE enabled;

CREATE TABLE public.negotiation_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_item_id uuid REFERENCES public.negotiation_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  visitor_id text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.negotiation_interests TO authenticated;
GRANT ALL ON public.negotiation_interests TO service_role;

ALTER TABLE public.negotiation_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read negotiation interests"
ON public.negotiation_interests FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()));

CREATE INDEX negotiation_interests_recent_idx
ON public.negotiation_interests (negotiation_item_id, visitor_id, created_at DESC);