-- Configuração base da Orium (projeto remixado veio sem dados operacionais)

-- NOTA: a gravação inicial de public.admin_allowlist foi removida desta cópia
-- (continha e-mails pessoais). Provisionar owners/admins por processo separado.

INSERT INTO public.pricing_settings (id, retail_markup, wholesale_markup, wholesale_min_quantity)
VALUES (true, 120, 50, 6)
ON CONFLICT (id) DO UPDATE
  SET retail_markup = 120, wholesale_markup = 50, wholesale_min_quantity = 6, updated_at = now();

INSERT INTO public.shipping_settings (id, store_name, city, state, provider, local_delivery_cities)
VALUES (true, 'Orium Perfumes', 'Itaguaí', 'RJ', 'superfrete', ARRAY['Itaguaí','Mangaratiba'])
ON CONFLICT (id) DO UPDATE
  SET store_name = 'Orium Perfumes', city = 'Itaguaí', state = 'RJ', provider = 'superfrete',
      local_delivery_cities = ARRAY['Itaguaí','Mangaratiba'], updated_at = now();

INSERT INTO public.suppliers (name, slug, website, adapter, active, sync_interval_minutes)
VALUES
  ('MRX Perfumaria', 'mrx', 'https://mrxperfumaria.com.br/', 'mrx', true, 30),
  ('Smart Mania', 'smart-mania', 'https://smartmaniaoficial.kyte.site/pt-BR', 'smart-mania', true, 30)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, website = EXCLUDED.website, adapter = EXCLUDED.adapter, active = true;