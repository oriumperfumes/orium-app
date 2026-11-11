ALTER TABLE public.fragrance_details ADD COLUMN IF NOT EXISTS import_method text;
ALTER TABLE public.fragrantica_import_logs ADD COLUMN IF NOT EXISTS import_method text;
COMMENT ON COLUMN public.fragrance_details.import_method IS 'AUTO_URL | MANUAL_ASSISTED | MANUAL_EDIT';