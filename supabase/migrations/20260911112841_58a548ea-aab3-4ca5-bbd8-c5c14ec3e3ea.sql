-- Restrict anonymous (public visitor) column access to public catalog fields only.
REVOKE SELECT ON public.products FROM anon;
GRANT SELECT (
  id, slug, canonical_name, brand, brand_id, gender, gender_norm, concentration,
  volume_ml, image_url, image_urls, product_line, flanker, product_type,
  active, catalog_eligible, in_stock, stock_quantity,
  retail_price, wholesale_price,
  decant_available, decant_price_2ml, decant_price_5ml, decant_price_10ml,
  weight_g, height_cm, width_cm, length_cm,
  search_text, search_norm, search_aliases,
  created_at, updated_at
) ON public.products TO anon;

-- Negotiation listings: hide internal staff identifier from public visitors.
REVOKE SELECT ON public.negotiation_items FROM anon;
GRANT SELECT (
  id, product_id, name, brand, volume_ml, description, condition_note, status,
  show_when_negotiating, image_url, fragrantica_url, olfactory_family,
  accords, notes, priority, created_at, updated_at
) ON public.negotiation_items TO anon;