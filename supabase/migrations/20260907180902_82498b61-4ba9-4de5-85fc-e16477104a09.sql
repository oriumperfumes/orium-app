CREATE TABLE public.fragrantica_index (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url text NOT NULL UNIQUE,
  brand text,
  brand_norm text,
  name text NOT NULL,
  normalized_name text NOT NULL,
  flanker text,
  concentration text,
  gender text,
  year integer,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fragrantica_index_brand_norm_idx ON public.fragrantica_index (brand_norm);
CREATE INDEX fragrantica_index_norm_name_idx ON public.fragrantica_index (normalized_name);
GRANT SELECT ON public.fragrantica_index TO authenticated;
GRANT ALL ON public.fragrantica_index TO service_role;
ALTER TABLE public.fragrantica_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read fragrantica index" ON public.fragrantica_index FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE TABLE public.fragrantica_brand_pages (
  brand_norm text NOT NULL PRIMARY KEY,
  brand text NOT NULL,
  url text,
  perfumes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fragrantica_brand_pages TO authenticated;
GRANT ALL ON public.fragrantica_brand_pages TO service_role;
ALTER TABLE public.fragrantica_brand_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read fragrantica brand pages" ON public.fragrantica_brand_pages FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE TABLE public.fragrantica_search_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  status text NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  url text,
  query text,
  stage text,
  from_cache boolean NOT NULL DEFAULT false,
  requests integer NOT NULL DEFAULT 0,
  duration_ms integer,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fragrantica_search_log_created_idx ON public.fragrantica_search_log (created_at DESC);
GRANT SELECT ON public.fragrantica_search_log TO authenticated;
GRANT ALL ON public.fragrantica_search_log TO service_role;
ALTER TABLE public.fragrantica_search_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read fragrantica search log" ON public.fragrantica_search_log FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

ALTER TABLE public.fragrance_details
  ADD COLUMN IF NOT EXISTS search_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS fragrantica_match_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_search_at timestamptz,
  ADD COLUMN IF NOT EXISTS search_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description_source text,
  ADD COLUMN IF NOT EXISTS description_generated_at timestamptz;
CREATE INDEX IF NOT EXISTS fragrance_details_search_status_idx ON public.fragrance_details (search_status);