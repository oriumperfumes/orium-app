CREATE TABLE IF NOT EXISTS public.copilot_voice_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  thread_id uuid,
  source text NOT NULL DEFAULT 'voice',
  speech_ms integer,
  audio_bytes integer,
  auth_ms integer,
  transcription_ms integer,
  resolve_ms integer,
  total_ms integer,
  transcript_raw text,
  transcript_normalized text,
  intent text,
  fast_path boolean NOT NULL DEFAULT false,
  entities jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.copilot_voice_metrics TO authenticated;
GRANT ALL ON public.copilot_voice_metrics TO service_role;
ALTER TABLE public.copilot_voice_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff insert own voice metrics" ON public.copilot_voice_metrics
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()) AND user_id = auth.uid());
CREATE POLICY "staff read voice metrics" ON public.copilot_voice_metrics
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE INDEX IF NOT EXISTS copilot_voice_metrics_created_idx ON public.copilot_voice_metrics (created_at DESC);