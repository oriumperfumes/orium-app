-- Custo/margem interna não podem ser lidos por clientes autenticados comuns.
REVOKE SELECT ON public.products FROM authenticated;

GRANT SELECT (
  id, canonical_name, brand, gender, concentration, volume_ml, image_url, slug,
  active, in_stock, stock_quantity, retail_price, wholesale_price, suspicious_price,
  created_at, updated_at, image_urls, brand_id, product_type, gender_norm,
  gender_confidence, catalog_eligible, brand_review_required, raw_name, dedupe_key,
  catalog_eligibility_reason, weight_g, height_cm, width_cm, length_cm,
  canonical_identity_locked, identity_source, identity_confidence, identity_status,
  flanker, search_aliases, search_text, product_line, search_norm, identity_verified,
  identity_verified_by, identity_verified_at, decant_available, decant_price_2ml,
  decant_price_5ml, decant_price_10ml, identity_key, image_signature,
  catalog_excluded_manually, source, sale_mode, full_bottle_available, visibility_status
) ON public.products TO authenticated;
