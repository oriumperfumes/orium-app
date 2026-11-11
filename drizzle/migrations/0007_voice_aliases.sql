-- Apelidos de voz: fala normalizada -> perfume real. Interno, nunca nome público.
CREATE TABLE IF NOT EXISTS public.voice_product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_normalized text NOT NULL,
  phonetic_key text,
  canonical_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  confirmation_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_product_aliases_unique
  ON public.voice_product_aliases (transcript_normalized, canonical_product_id);
CREATE INDEX IF NOT EXISTS voice_product_aliases_phonetic
  ON public.voice_product_aliases (phonetic_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_product_aliases TO authenticated;
GRANT ALL ON public.voice_product_aliases TO service_role;

ALTER TABLE public.voice_product_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage voice aliases" ON public.voice_product_aliases;
CREATE POLICY "staff manage voice aliases"
  ON public.voice_product_aliases FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- Qualidade interna do reconhecimento por voz (nunca exposto na tela principal).
CREATE TABLE IF NOT EXISTS public.voice_match_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  transcript text,
  spoken_name text,
  suggested_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  confirmed_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  confidence text,
  corrected boolean NOT NULL DEFAULT false,
  latency_ms integer,
  sale_id uuid REFERENCES public.store_sales(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS voice_match_log_created ON public.voice_match_log (created_at DESC);

GRANT SELECT, INSERT ON public.voice_match_log TO authenticated;
GRANT ALL ON public.voice_match_log TO service_role;

ALTER TABLE public.voice_match_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read voice log" ON public.voice_match_log;
CREATE POLICY "staff read voice log"
  ON public.voice_match_log FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff write voice log" ON public.voice_match_log;
CREATE POLICY "staff write voice log"
  ON public.voice_match_log FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

-- Aprendizado idempotente: só chamado depois da confirmação do Admin.
CREATE OR REPLACE FUNCTION public.voice_alias_learn(
  p_transcript text,
  p_phonetic text,
  p_product_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_transcript IS NULL OR length(btrim(p_transcript)) < 3 OR p_product_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  INSERT INTO public.voice_product_aliases (transcript_normalized, phonetic_key, canonical_product_id)
  VALUES (btrim(lower(p_transcript)), p_phonetic, p_product_id)
  ON CONFLICT (transcript_normalized, canonical_product_id) DO UPDATE
    SET confirmation_count = public.voice_product_aliases.confirmation_count + 1,
        last_used_at = now(),
        phonetic_key = COALESCE(EXCLUDED.phonetic_key, public.voice_product_aliases.phonetic_key);
END;
$$;

REVOKE ALL ON FUNCTION public.voice_alias_learn(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voice_alias_learn(text, text, uuid) TO authenticated, service_role;
