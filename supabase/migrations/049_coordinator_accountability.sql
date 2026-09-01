-- Phase 10A: coordinator accountability stays within the existing
-- append-only incident_activity stream. No existing incident, contact,
-- message, or transport data is changed by this migration.

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
  'follow_up_cleared',
  'coordinator_remark',
  'coordinator_assigned',
  'incident_details_updated'
));

-- Preserve the existing lifecycle activity while also attributing explicit
-- coordinator ownership changes made through the established incident form.
CREATE OR REPLACE FUNCTION public.record_incident_lifecycle_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  changed_fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO incident_activity (account_id, deal_id, actor_user_id, action, next_value)
    VALUES (NEW.account_id, NEW.id, auth.uid(), 'incident_created', NEW.incident_status::text);
  ELSIF NEW.incident_status IS DISTINCT FROM OLD.incident_status THEN
    INSERT INTO incident_activity (account_id, deal_id, actor_user_id, action, previous_value, next_value)
    VALUES (
      NEW.account_id,
      NEW.id,
      auth.uid(),
      'status_changed',
      OLD.incident_status::text,
      NEW.incident_status::text
    );
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.title IS DISTINCT FROM OLD.title THEN changed_fields := array_append(changed_fields, 'title'); END IF;
    IF NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN changed_fields := array_append(changed_fields, 'citizen'); END IF;
    IF NEW.category IS DISTINCT FROM OLD.category THEN changed_fields := array_append(changed_fields, 'service'); END IF;
    IF NEW.priority IS DISTINCT FROM OLD.priority THEN changed_fields := array_append(changed_fields, 'priority'); END IF;
    IF NEW.location IS DISTINCT FROM OLD.location OR NEW.landmark IS DISTINCT FROM OLD.landmark OR NEW.municipality IS DISTINCT FROM OLD.municipality OR NEW.district IS DISTINCT FROM OLD.district OR NEW.latitude IS DISTINCT FROM OLD.latitude OR NEW.longitude IS DISTINCT FROM OLD.longitude THEN changed_fields := array_append(changed_fields, 'location'); END IF;
    IF NEW.people_affected IS DISTINCT FROM OLD.people_affected THEN changed_fields := array_append(changed_fields, 'people_affected'); END IF;
    IF NEW.description IS DISTINCT FROM OLD.description THEN changed_fields := array_append(changed_fields, 'description'); END IF;
    IF cardinality(changed_fields) > 0 THEN
      INSERT INTO incident_activity (account_id, deal_id, actor_user_id, action, metadata)
      VALUES (NEW.account_id, NEW.id, auth.uid(), 'incident_details_updated', jsonb_build_object('changed_fields', changed_fields));
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO incident_activity (account_id, deal_id, actor_user_id, action, metadata)
    VALUES (
      NEW.account_id,
      NEW.id,
      auth.uid(),
      'coordinator_assigned',
      jsonb_strip_nulls(jsonb_build_object('assigned_to_user_id', NEW.assigned_to))
    );
  END IF;
  RETURN NEW;
END;
$$;

-- A remark is an activity entry linked to the action it explains. It is not
-- editable and cannot be inserted for an incident outside the caller's account.
CREATE OR REPLACE FUNCTION public.record_incident_coordinator_remark(
  p_deal_id UUID,
  p_related_action TEXT,
  p_remark TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  incident deals%ROWTYPE;
  normalized_remark TEXT;
BEGIN
  normalized_remark := NULLIF(BTRIM(COALESCE(p_remark, '')), '');
  IF normalized_remark IS NULL THEN RETURN; END IF;
  IF LENGTH(normalized_remark) > 1000 THEN
    RAISE EXCEPTION 'Coordinator remark must be 1000 characters or fewer.' USING ERRCODE = 'P0001';
  END IF;
  IF p_related_action NOT IN ('status_changed', 'assignment_confirmed') THEN
    RAISE EXCEPTION 'Unsupported coordinator remark action.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO incident FROM deals WHERE id = p_deal_id FOR KEY SHARE;
  IF NOT FOUND OR NOT is_account_member(incident.account_id, 'agent') THEN
    RAISE EXCEPTION 'Incident was not found for this account.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO incident_activity (account_id, deal_id, actor_user_id, action, metadata)
  VALUES (
    incident.account_id,
    incident.id,
    auth.uid(),
    'coordinator_remark',
    jsonb_build_object('related_action', p_related_action, 'remark', normalized_remark)
  );
END;
$$;

-- This wrapper preserves the established atomic resource-confirmation RPC,
-- while recording an optional coordinator remark in the same transaction.
CREATE OR REPLACE FUNCTION public.confirm_incident_response_with_remark(
  p_deal_id UUID,
  p_team_id UUID DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_inventory_id UUID DEFAULT NULL,
  p_remark TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  result := public.confirm_incident_response(
    p_deal_id,
    p_team_id,
    p_vehicle_id,
    p_location_id,
    p_inventory_id
  );
  PERFORM public.record_incident_coordinator_remark(
    p_deal_id,
    'assignment_confirmed',
    p_remark
  );
  RETURN result;
END;
$$;

-- The pipeline remains configurable. This RPC only permits a coordinator to
-- select a stage belonging to the incident's own pipeline; stage triggers
-- retain the existing incident-status and notification-outbox behavior.
CREATE OR REPLACE FUNCTION public.transition_incident_response_status(
  p_deal_id UUID,
  p_stage_id UUID,
  p_remark TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  incident deals%ROWTYPE;
  target_stage pipeline_stages%ROWTYPE;
  previous_status TEXT;
BEGIN
  SELECT * INTO incident FROM deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND OR NOT is_account_member(incident.account_id, 'agent') THEN
    RAISE EXCEPTION 'Incident was not found for this account.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO target_stage
  FROM pipeline_stages
  WHERE id = p_stage_id AND pipeline_id = incident.pipeline_id;
  IF NOT FOUND OR target_stage.incident_status IS NULL THEN
    RAISE EXCEPTION 'Select a configured incident workflow stage.' USING ERRCODE = 'P0001';
  END IF;

  previous_status := incident.incident_status::text;
  IF incident.stage_id IS DISTINCT FROM target_stage.id THEN
    UPDATE deals SET stage_id = target_stage.id WHERE id = incident.id;
  END IF;

  PERFORM public.record_incident_coordinator_remark(
    incident.id,
    'status_changed',
    p_remark
  );

  RETURN jsonb_build_object(
    'deal_id', incident.id,
    'previous_status', previous_status,
    'incident_status', target_stage.incident_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_incident_coordinator_remark(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_incident_response_with_remark(UUID, UUID, UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_incident_response_status(UUID, UUID, TEXT) TO authenticated;
