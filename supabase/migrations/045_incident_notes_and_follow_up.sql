-- Narrow additions for coordinator-managed incident operations.
-- No dispatch is performed by these records and no follow-up threshold is
-- created by default: coordinators opt in by explicitly setting a value.

CREATE TABLE IF NOT EXISTS incident_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  note_text TEXT NOT NULL CHECK (length(trim(note_text)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_notes_account_deal_created
  ON incident_notes(account_id, deal_id, created_at DESC);

ALTER TABLE incident_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_notes_select ON incident_notes;
DROP POLICY IF EXISTS incident_notes_insert ON incident_notes;
DROP POLICY IF EXISTS incident_notes_delete ON incident_notes;
CREATE POLICY incident_notes_select ON incident_notes
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY incident_notes_insert ON incident_notes
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY incident_notes_delete ON incident_notes
  FOR DELETE USING (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS incident_follow_up_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  received_after_hours INTEGER CHECK (received_after_hours IS NULL OR received_after_hours > 0),
  assigned_after_hours INTEGER CHECK (assigned_after_hours IS NULL OR assigned_after_hours > 0),
  dispatched_after_hours INTEGER CHECK (dispatched_after_hours IS NULL OR dispatched_after_hours > 0),
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE incident_follow_up_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_follow_up_settings_select ON incident_follow_up_settings;
DROP POLICY IF EXISTS incident_follow_up_settings_write ON incident_follow_up_settings;
CREATE POLICY incident_follow_up_settings_select ON incident_follow_up_settings
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY incident_follow_up_settings_write ON incident_follow_up_settings
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON incident_follow_up_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
