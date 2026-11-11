-- ORIUM ATENDIMENTO: estrutura própria, sem integrar credenciais ao banco ou expor DMs ao público.
CREATE TABLE IF NOT EXISTS public.omni_channels (
  id text PRIMARY KEY CHECK (id IN ('whatsapp','instagram','tiktok','site')),
  name text NOT NULL,
  connection_status text NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('disconnected','connected','error')),
  ai_mode text NOT NULL DEFAULT 'assistant' CHECK (ai_mode IN ('assistant','supervised','controlled')),
  automation_enabled boolean NOT NULL DEFAULT false,
  external_account_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.omni_channels (id, name) VALUES
  ('whatsapp','WhatsApp Business'),
  ('instagram','Instagram profissional'),
  ('tiktok','TikTok'),
  ('site','Chat do site')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.omni_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL REFERENCES public.omni_channels(id),
  external_thread_id text NOT NULL,
  customer_name text,
  contact_phone text,
  crm_customer_id uuid,
  assigned_to uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','needs_help','closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  important boolean NOT NULL DEFAULT false,
  interest text,
  ai_active boolean NOT NULL DEFAULT false,
  last_preview text NOT NULL DEFAULT '',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_inbound_at timestamptz,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, external_thread_id)
);
CREATE INDEX IF NOT EXISTS omni_inbox_idx ON public.omni_conversations (status,last_message_at DESC);
CREATE INDEX IF NOT EXISTS omni_assignee_idx ON public.omni_conversations (assigned_to,status);

CREATE TABLE IF NOT EXISTS public.omni_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.omni_conversations(id) ON DELETE CASCADE,
  external_message_id text UNIQUE,
  client_operation_id uuid UNIQUE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_kind text NOT NULL CHECK (sender_kind IN ('customer','staff','ai')),
  sender_id uuid,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4096),
  delivery_status text NOT NULL DEFAULT 'received' CHECK (delivery_status IN ('received','pending','sent','delivered','read','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS omni_msg_thread_idx ON public.omni_messages (conversation_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.omni_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  guidance text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  approved_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.omni_knowledge_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id uuid NOT NULL REFERENCES public.omni_knowledge(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  topic text NOT NULL,
  guidance text NOT NULL,
  active boolean NOT NULL,
  edited_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.omni_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.omni_conversations(id) ON DELETE SET NULL,
  actor_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS omni_audit_idx ON public.omni_audit (conversation_id,created_at DESC);

-- Exclusivamente equipe: nenhuma leitura, escrita ou subscrição pública das conversas.
ALTER TABLE public.omni_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_knowledge_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omni_audit ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.omni_channels, public.omni_conversations, public.omni_messages,
  public.omni_knowledge, public.omni_knowledge_history, public.omni_audit TO authenticated;
GRANT ALL ON public.omni_channels, public.omni_conversations, public.omni_messages,
  public.omni_knowledge, public.omni_knowledge_history, public.omni_audit TO service_role;
CREATE POLICY omni_channels_read_staff ON public.omni_channels FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY omni_conversations_read_staff ON public.omni_conversations FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY omni_messages_read_staff ON public.omni_messages FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY omni_knowledge_read_staff ON public.omni_knowledge FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY omni_knowledge_history_read_staff ON public.omni_knowledge_history FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY omni_audit_read_staff ON public.omni_audit FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- Inserção transacional de inbound: idempotência por message_id e contador sem perda por corrida.
CREATE OR REPLACE FUNCTION public.omni_receive_whatsapp(
  p_wa_id text, p_name text, p_message_id text, p_body text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_conversation uuid; v_inserted uuid; v_now timestamptz := now();
BEGIN
  IF length(p_wa_id) NOT BETWEEN 8 AND 18 OR p_wa_id !~ '^[0-9]+$'
     OR length(p_message_id) NOT BETWEEN 5 AND 255
     OR length(p_body) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'Invalid inbound payload';
  END IF;
  INSERT INTO public.omni_conversations (channel_id,external_thread_id,customer_name,contact_phone)
    VALUES ('whatsapp', p_wa_id, left(nullif(p_name,''),120), p_wa_id)
    ON CONFLICT (channel_id,external_thread_id) DO NOTHING;
  SELECT id INTO v_conversation FROM public.omni_conversations
    WHERE channel_id='whatsapp' AND external_thread_id=p_wa_id FOR UPDATE;
  INSERT INTO public.omni_messages (conversation_id,external_message_id,direction,sender_kind,body)
    VALUES (v_conversation,p_message_id,'inbound','customer',p_body)
    ON CONFLICT (external_message_id) DO NOTHING RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    UPDATE public.omni_conversations SET
      last_preview=left(p_body,180), last_message_at=v_now, last_inbound_at=v_now,
      customer_name=coalesce(nullif(left(p_name,120),''),customer_name),
      unread_count=unread_count+1,
      status=CASE WHEN status='closed' THEN 'open' ELSE status END,
      updated_at=v_now
    WHERE id=v_conversation;
  END IF;
  RETURN v_conversation;
END $$;
REVOKE ALL ON FUNCTION public.omni_receive_whatsapp(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.omni_receive_whatsapp(text,text,text,text) TO service_role;
