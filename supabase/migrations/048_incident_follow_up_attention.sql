-- Phase 9: persistent coordinator review state for the deterministic
-- follow-up conditions calculated by the application. This table never
-- changes an incident, dispatches a resource, or sends a citizen message.

ALTER TABLE incident_activity DROP CONSTRAINT IF EXISTS incident_activity_action_check;
ALTER TABLE incident_activity ADD CONSTRAINT incident_activity_action_check CHECK (action IN (
  'incident_created',
  'status_changed',
  'assignment_confirmed',
  'notification_queued',
  'notification_sent',
  'notification_failed',
  'notification_retry_requested',
  'case_note_added',
  'follow_up_created',
  'follow_up_reviewed',
  'follow_up_cleared'
));

CREATE TABLE IF NOT EXISTS incident_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reviewed', 'cleared')),
  reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[] CHECK (
    reason_codes <@ ARRAY['unassigned', 'communication_failed', 'overdue', 'coordinator_action_required']::TEXT[]
  ),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cleared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, deal_id)
);

CREATE INDEX IF NOT EXISTS idx_incident_follow_ups_account_active
  ON incident_follow_ups(account_id, status, updated_at DESC)
  WHERE status IN ('active', 'reviewed');

ALTER TABLE incident_follow_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_follow_ups_select ON incident_follow_ups;
DROP POLICY IF EXISTS incident_follow_ups_write ON incident_follow_ups;
CREATE POLICY incident_follow_ups_select ON incident_follow_ups
  FOR SELECT USING (is_account_member(account_id, 'agent'));
CREATE POLICY incident_follow_ups_write ON incident_follow_ups
  FOR ALL USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.validate_incident_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  incident_account_id UUID;
BEGIN
  SELECT account_id INTO incident_account_id FROM deals WHERE id = NEW.deal_id;
  IF incident_account_id IS NULL OR incident_account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'Incident follow-up must belong to the incident account';
  END IF;

  IF NEW.reviewed_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.reviewed_by_user_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'Follow-up reviewer is not a member of this account';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_incident_follow_up ON incident_follow_ups;
CREATE TRIGGER validate_incident_follow_up
  BEFORE INSERT OR UPDATE ON incident_follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.validate_incident_follow_up();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON incident_follow_ups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Reuse the single append-only incident timeline for follow-up lifecycle
-- events. A review deliberately does not clear the underlying condition.
CREATE OR REPLACE FUNCTION public.record_incident_follow_up_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  activity_action TEXT;
  activity_actor UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    activity_action := 'follow_up_created';
  ELSIF NEW.status = 'cleared' AND OLD.status IS DISTINCT FROM 'cleared' THEN
    activity_action := 'follow_up_cleared';
  ELSIF NEW.reviewed_at IS NOT NULL AND OLD.reviewed_at IS DISTINCT FROM NEW.reviewed_at THEN
    activity_action := 'follow_up_reviewed';
    activity_actor := NEW.reviewed_by_user_id;
  ELSIF NEW.status = 'active' AND OLD.status = 'cleared' THEN
    activity_action := 'follow_up_created';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO incident_activity (account_id, deal_id, actor_user_id, action, metadata)
  VALUES (
    NEW.account_id,
    NEW.deal_id,
    activity_actor,
    activity_action,
    jsonb_build_object('reason_codes', NEW.reason_codes, 'follow_up_status', NEW.status)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_incident_follow_up_activity ON incident_follow_ups;
CREATE TRIGGER record_incident_follow_up_activity
  AFTER INSERT OR UPDATE ON incident_follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.record_incident_follow_up_activity();

-- Extend the existing delivery audit trigger so an explicit coordinator retry
-- is visible without adding a second notification system.
CREATE OR REPLACE FUNCTION public.record_incident_delivery_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  activity_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    activity_action := 'notification_queued';
  ELSIF NEW.delivery_status = 'pending' AND OLD.delivery_status = 'failed' THEN
    activity_action := 'notification_retry_requested';
  ELSIF NEW.delivery_status = 'sent' AND OLD.delivery_status IS DISTINCT FROM 'sent' THEN
    activity_action := 'notification_sent';
  ELSIF NEW.delivery_status = 'failed' AND OLD.delivery_status IS DISTINCT FROM 'failed' THEN
    activity_action := 'notification_failed';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO incident_activity (account_id, deal_id, actor_user_id, action, next_value, metadata)
  VALUES (
    NEW.account_id,
    NEW.deal_id,
    auth.uid(),
    activity_action,
    NEW.incident_status::text,
    jsonb_build_object('channel', NEW.channel, 'delivery_status', NEW.delivery_status, 'error', NEW.error_message)
  );
  RETURN NEW;
END;
$$;
