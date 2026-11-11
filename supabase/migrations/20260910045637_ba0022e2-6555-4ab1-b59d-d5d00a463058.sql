CREATE TABLE public.permanent_catalog_blocklist (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  identity_key text,
  dedupe_key text,
  canonical_name text,
  brand text,
  slug text,
  supplier_id uuid,
  supplier_sku text,
  supplier_url text,
  normalized_name text,
  reason text,
  created_by uuid,
  created_by_email text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX permanent_catalog_blocklist_identity_idx ON public.permanent_catalog_blocklist (identity_key);
CREATE INDEX permanent_catalog_blocklist_norm_idx ON public.permanent_catalog_blocklist (normalized_name);
CREATE INDEX permanent_catalog_blocklist_sku_idx ON public.permanent_catalog_blocklist (supplier_id, supplier_sku);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.permanent_catalog_blocklist TO authenticated;
GRANT ALL ON public.permanent_catalog_blocklist TO service_role;

ALTER TABLE public.permanent_catalog_blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Equipe gerencia bloqueios permanentes"
ON public.permanent_catalog_blocklist FOR ALL
TO authenticated
USING (public.is_staff(auth.uid()))
WITH CHECK (public.is_staff(auth.uid()));