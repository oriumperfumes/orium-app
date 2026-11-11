CREATE TABLE public.ai_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  provider text NOT NULL DEFAULT 'openai',
  enabled boolean NOT NULL DEFAULT true,
  model_economy text NOT NULL DEFAULT 'gpt-5-mini',
  model_advanced text NOT NULL DEFAULT 'gpt-5',
  model_voice text NOT NULL DEFAULT 'gpt-4o-mini-transcribe',
  daily_limit_usd numeric,
  monthly_limit_usd numeric,
  alert_pct integer NOT NULL DEFAULT 80,
  limit_policy text NOT NULL DEFAULT 'block' CHECK (limit_policy IN ('block','economy_only')),
  prices jsonb NOT NULL DEFAULT '{
    "gpt-5": {"in": 1.25, "out": 10},
    "gpt-5-mini": {"in": 0.25, "out": 2},
    "gpt-5-nano": {"in": 0.05, "out": 0.4},
    "gpt-4.1": {"in": 2, "out": 8},
    "gpt-4.1-mini": {"in": 0.4, "out": 1.6},
    "gpt-4.1-nano": {"in": 0.1, "out": 0.4},
    "gpt-4o": {"in": 2.5, "out": 10},
    "gpt-4o-mini": {"in": 0.15, "out": 0.6},
    "gpt-4o-transcribe": {"min": 0.006},
    "gpt-4o-mini-transcribe": {"min": 0.003},
    "whisper-1": {"min": 0.006}
  }'::jsonb,
  last_check_status text,
  last_check_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, UPDATE ON public.ai_settings TO authenticated;
GRANT ALL ON public.ai_settings TO service_role;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ai settings" ON public.ai_settings FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "owner updates ai settings" ON public.ai_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'owner')) WITH CHECK (public.has_role(auth.uid(),'owner'));
INSERT INTO public.ai_settings (id) VALUES (true);

CREATE TABLE public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  feature text NOT NULL,
  profile text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  audio_seconds numeric NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  latency_ms integer,
  ok boolean NOT NULL DEFAULT true,
  error_code text
);
CREATE INDEX ai_usage_created_idx ON public.ai_usage (created_at DESC);
GRANT SELECT ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ai usage" ON public.ai_usage FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));