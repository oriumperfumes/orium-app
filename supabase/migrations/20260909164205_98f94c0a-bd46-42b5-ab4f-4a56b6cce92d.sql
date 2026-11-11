CREATE TABLE public.negotiation_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  brand text,
  volume_ml integer,
  description text,
  condition_note text NOT NULL DEFAULT 'Praticamente cheio',
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','NEGOTIATING','SOLD','HIDDEN')),
  show_when_negotiating boolean NOT NULL DEFAULT true,
  image_url text,
  fragrantica_url text,
  olfactory_family text,
  accords jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.negotiation_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.negotiation_items TO authenticated;
GRANT ALL ON public.negotiation_items TO service_role;

ALTER TABLE public.negotiation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Negotiation items publicly visible when offered"
  ON public.negotiation_items FOR SELECT
  USING (status = 'AVAILABLE' OR (status = 'NEGOTIATING' AND show_when_negotiating));

CREATE POLICY "Staff read all negotiation items"
  ON public.negotiation_items FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff manage negotiation items"
  ON public.negotiation_items FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER negotiation_items_touch
  BEFORE UPDATE ON public.negotiation_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX negotiation_items_public_idx ON public.negotiation_items (status, priority DESC, created_at DESC);