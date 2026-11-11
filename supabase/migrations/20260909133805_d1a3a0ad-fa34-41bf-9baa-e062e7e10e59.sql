DROP POLICY IF EXISTS "anyone logs decant events" ON public.decant_events;
CREATE POLICY "visitors log own decant events" ON public.decant_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "anyone reads shipping settings" ON public.shipping_settings;
CREATE POLICY "staff reads shipping settings" ON public.shipping_settings
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

REVOKE ALL ON FUNCTION public.waiting_count(uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.waiting_count(uuid) TO service_role;