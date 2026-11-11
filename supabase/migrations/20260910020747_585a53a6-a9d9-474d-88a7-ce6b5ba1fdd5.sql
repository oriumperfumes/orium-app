-- 1) Rotinas internas: só quem realmente precisa pode executar.
REVOKE EXECUTE ON FUNCTION public.new_arrivals_audit(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_abandoned_carts(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.new_arrivals(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_search_miss(text) FROM anon;

-- 2) Fotos da Negociação: regras explícitas no armazenamento (somente equipe).
DROP POLICY IF EXISTS "negociacao_staff_select" ON storage.objects;
DROP POLICY IF EXISTS "negociacao_staff_insert" ON storage.objects;
DROP POLICY IF EXISTS "negociacao_staff_update" ON storage.objects;
DROP POLICY IF EXISTS "negociacao_staff_delete" ON storage.objects;

CREATE POLICY "negociacao_staff_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'negociacao' AND public.is_staff(auth.uid()));

CREATE POLICY "negociacao_staff_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'negociacao' AND public.is_staff(auth.uid()));

CREATE POLICY "negociacao_staff_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'negociacao' AND public.is_staff(auth.uid()))
  WITH CHECK (bucket_id = 'negociacao' AND public.is_staff(auth.uid()));

CREATE POLICY "negociacao_staff_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'negociacao' AND public.is_staff(auth.uid()));