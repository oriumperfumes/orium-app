CREATE TABLE IF NOT EXISTS public.olfactory_note_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_note_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  image_url text,
  source_url text,
  source text NOT NULL DEFAULT 'FRAGRANTICA',
  external_id text,
  status text NOT NULL DEFAULT 'ok',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.olfactory_note_assets TO anon;
GRANT SELECT ON public.olfactory_note_assets TO authenticated;
GRANT ALL ON public.olfactory_note_assets TO service_role;

ALTER TABLE public.olfactory_note_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "note assets are public" ON public.olfactory_note_assets;
CREATE POLICY "note assets are public" ON public.olfactory_note_assets FOR SELECT USING (true);

DROP TRIGGER IF EXISTS olfactory_note_assets_touch ON public.olfactory_note_assets;
CREATE TRIGGER olfactory_note_assets_touch BEFORE UPDATE ON public.olfactory_note_assets
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
