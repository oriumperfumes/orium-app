-- FICTITIOUS seed for the API validation (committed, lives only in the throwaway container). No production data.
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-4000-8000-000000000001', 'admin'), ('00000000-0000-4000-8000-000000000002', 'client');
INSERT INTO public.profiles (id, name, email) VALUES ('00000000-0000-4000-8000-000000000002', 'Cliente Ficticio', 'cliente@exemplo.invalid'), ('00000000-0000-4000-8000-000000000001', 'Equipe Ficticia', 'equipe@exemplo.invalid');
INSERT INTO public.brands (id, canonical_name, slug, segment) VALUES ('00000000-0000-4000-8000-0000000000b1', 'Marca Ficticia', 'marca-ficticia', 'ARABIC');
INSERT INTO public.products (id, canonical_name, slug, brand, brand_id, product_type, concentration, volume_ml, gender_norm, retail_price, wholesale_price, manual_cost, base_retail_price,
                             active, catalog_eligible, stock_quantity, local_stock, availability_override, decant_available, decant_price_5ml) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Perfume Ficticio A', 'perfume-ficticio-a', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 'EDP', 100, 'masculino', 250, 200, 100, 180, true,  true,  5, 3, 'none', true, 39.9),
  ('00000000-0000-4000-8000-0000000000a2', 'Perfume Ficticio B', 'perfume-ficticio-b', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 'EDP', 100, 'feminino',  260, 210, 110, 190, true,  false, 5, 2, 'none', true, 39.9),
  ('00000000-0000-4000-8000-0000000000a3', 'Perfume Ficticio C', 'perfume-ficticio-c', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 'EDP', 100, 'masculino', 270, 220, 120, 200, true,  true,  5, 0, 'none', true, 39.9),
  ('00000000-0000-4000-8000-0000000000a4', 'Perfume Ficticio D', 'perfume-ficticio-d', 'Marca Ficticia', '00000000-0000-4000-8000-0000000000b1', 'PERFUME', 'EDP', 100, 'masculino', 280, 230, 130, 210, false, true,  5, 2, 'none', true, 39.9);
INSERT INTO public.fragrance_accords (product_id, accord_name, position) VALUES ('00000000-0000-4000-8000-0000000000a1', 'amadeirado', 1), ('00000000-0000-4000-8000-0000000000a3', 'floral', 1);
