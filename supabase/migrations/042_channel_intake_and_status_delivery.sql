-- Channel-neutral incident intake state and delivery outbox.
-- WhatsApp is the first adapter. Future SMS can reuse these records without
-- duplicating incident creation, status, or resource decision logic.

CREATE TABLE IF NOT EXISTS communication_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  state TEXT NOT NULL DEFAULT 'start',
  collected_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_request_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  last_inbound_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_communication_sessions_contact_channel
  ON communication_sessions(account_id, contact_id, channel);

ALTER TABLE communication_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS communication_sessions_select ON communication_sessions;
DROP POLICY IF EXISTS communication_sessions_write ON communication_sessions;
CREATE POLICY communication_sessions_select ON communication_sessions
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY communication_sessions_write ON communication_sessions
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON communication_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS incident_status_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  incident_status incident_status_enum NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  whatsapp_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(deal_id, incident_status, channel)
);

CREATE INDEX IF NOT EXISTS idx_incident_status_deliveries_pending
  ON incident_status_deliveries(account_id, channel, created_at)
  WHERE delivery_status IN ('pending', 'failed');

ALTER TABLE incident_status_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_status_deliveries_select ON incident_status_deliveries;
DROP POLICY IF EXISTS incident_status_deliveries_write ON incident_status_deliveries;
CREATE POLICY incident_status_deliveries_select ON incident_status_deliveries
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY incident_status_deliveries_write ON incident_status_deliveries
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON incident_status_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Persist a channel-agnostic delivery request whenever a coordinator changes
-- an incident status. This trigger does not call Meta and never changes the
-- incident; delivery is handled by an authenticated channel adapter.
CREATE OR REPLACE FUNCTION public.queue_incident_status_delivery()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.incident_status IS DISTINCT FROM OLD.incident_status
     AND NEW.conversation_id IS NOT NULL THEN
    INSERT INTO incident_status_deliveries (
      account_id, deal_id, conversation_id, channel, incident_status
    ) VALUES (
      NEW.account_id, NEW.id, NEW.conversation_id, 'whatsapp', NEW.incident_status
    ) ON CONFLICT (deal_id, incident_status, channel) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS queue_incident_status_delivery ON deals;
CREATE TRIGGER queue_incident_status_delivery
  AFTER UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.queue_incident_status_delivery();
