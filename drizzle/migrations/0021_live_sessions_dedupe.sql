ALTER TABLE public.live_sessions ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.live_sessions ADD COLUMN IF NOT EXISTS last_action text;
CREATE INDEX IF NOT EXISTS live_sessions_active_idx ON public.live_sessions (is_active, last_activity_at DESC);

UPDATE public.live_sessions s SET is_active = false
FROM (
  SELECT session_key, row_number() OVER (
    PARTITION BY coalesce(customer_id::text, user_id::text, visitor_id), coalesce(device,'?')
    ORDER BY last_activity_at DESC) rn
  FROM public.live_sessions
) d
WHERE d.session_key = s.session_key AND d.rn > 1;