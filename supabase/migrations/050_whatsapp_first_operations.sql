-- Phase 12: keep the existing CRM entities, but make their WhatsApp origin
-- explicit and add coordinator-reviewed related-report records. All changes
-- are additive except replacing the former one-WhatsApp-config-per-account
-- uniqueness rule with a single optional primary config per account.

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing accounts keep their established configuration as the fallback.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY account_id ORDER BY created_at, id) AS position
  FROM whatsapp_config
)
UPDATE whatsapp_config config
SET is_primary = TRUE
FROM ranked
WHERE ranked.id = config.id AND ranked.position = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_primary_per_account
  ON whatsapp_config (account_id) WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_phone_number
  ON whatsapp_config (phone_number_id) WHERE phone_number_id IS NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE RESTRICT;

-- Backfill safely only where an account has one known config. Older generic
-- CRM conversations remain nullable rather than being attributed incorrectly.
UPDATE conversations conversation
SET whatsapp_config_id = config.id
FROM whatsapp_config config
WHERE conversation.account_id = config.account_id
  AND config.is_primary
  AND conversation.whatsapp_config_id IS NULL;

DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_unbound
  ON conversations (account_id, contact_id) WHERE whatsapp_config_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_whatsapp
  ON conversations (account_id, contact_id, whatsapp_config_id)
  WHERE whatsapp_config_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id) WHERE whatsapp_config_id IS NOT NULL;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS source_whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_deals_source_whatsapp_config
  ON deals(source_whatsapp_config_id) WHERE source_whatsapp_config_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS incident_message_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(deal_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_incident_message_links_deal ON incident_message_links(deal_id, created_at);
ALTER TABLE incident_message_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_message_links_select ON incident_message_links;
DROP POLICY IF EXISTS incident_message_links_write ON incident_message_links;
CREATE POLICY incident_message_links_select ON incident_message_links
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY incident_message_links_write ON incident_message_links
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS incident_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  related_deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'possible_related'
    CHECK (relationship IN ('possible_related', 'related', 'separate')),
  match_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_deal_id <> related_deal_id),
  UNIQUE(source_deal_id, related_deal_id)
);
CREATE INDEX IF NOT EXISTS idx_incident_relationships_source ON incident_relationships(account_id, source_deal_id);
CREATE INDEX IF NOT EXISTS idx_incident_relationships_related ON incident_relationships(account_id, related_deal_id);
ALTER TABLE incident_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_relationships_select ON incident_relationships;
DROP POLICY IF EXISTS incident_relationships_write ON incident_relationships;
CREATE POLICY incident_relationships_select ON incident_relationships
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY incident_relationships_write ON incident_relationships
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS incident_matching_policies (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  radius_km NUMERIC(5,2) NOT NULL DEFAULT 1.00 CHECK (radius_km > 0 AND radius_km <= 25),
  time_window_hours INTEGER NOT NULL DEFAULT 24 CHECK (time_window_hours > 0 AND time_window_hours <= 168),
  text_token_threshold INTEGER NOT NULL DEFAULT 2 CHECK (text_token_threshold >= 1 AND text_token_threshold <= 10),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE incident_matching_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_matching_policies_select ON incident_matching_policies;
DROP POLICY IF EXISTS incident_matching_policies_write ON incident_matching_policies;
CREATE POLICY incident_matching_policies_select ON incident_matching_policies
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY incident_matching_policies_write ON incident_matching_policies
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE CASCADE;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'incident_created'));
CREATE INDEX IF NOT EXISTS idx_notifications_deal ON notifications(deal_id) WHERE deal_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notify_incident_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id, deal_id, title, body)
  SELECT NEW.account_id, profile.user_id, 'incident_created', NEW.conversation_id, NEW.contact_id, NEW.id,
    'New incident received',
    COALESCE(NEW.request_id, 'New request') || ' · ' || COALESCE(NULLIF(NEW.location, ''), 'Information missing')
  FROM profiles profile
  WHERE profile.account_id = NEW.account_id
    AND profile.account_role IN ('owner', 'admin', 'agent');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create incident notifications for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.notify_incident_created() OWNER TO postgres;
DROP TRIGGER IF EXISTS on_incident_created_notify_coordinators ON deals;
CREATE TRIGGER on_incident_created_notify_coordinators
  AFTER INSERT ON deals FOR EACH ROW EXECUTE FUNCTION public.notify_incident_created();
