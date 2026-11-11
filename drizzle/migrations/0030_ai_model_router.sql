ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS model_copilot text,
  ADD COLUMN IF NOT EXISTS model_vision text,
  ADD COLUMN IF NOT EXISTS auto_route boolean NOT NULL DEFAULT true;
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS task text;
UPDATE public.ai_settings SET
  model_copilot = COALESCE(model_copilot, 'gpt-6-sol'),
  model_vision = COALESCE(model_vision, 'gpt-6-sol'),
  model_advanced = 'gpt-6.1-sol',
  model_economy = 'gpt-5.4-mini',
  model_voice = 'gpt-4o-transcribe'
WHERE id = true;