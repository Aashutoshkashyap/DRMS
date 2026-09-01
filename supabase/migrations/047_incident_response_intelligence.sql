-- Phase 8: narrow operational-response additions.
--
-- `deals` remains the incident record and its existing display assignment
-- fields remain intact. The nullable references make a coordinator-confirmed
-- selection durable without introducing a parallel assignment system.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS municipality TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS assigned_team_id UUID REFERENCES response_teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_location_id UUID REFERENCES operational_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_inventory_id UUID REFERENCES relief_inventory(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_account_municipality
  ON deals(account_id, municipality)
  WHERE municipality IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_account_district
  ON deals(account_id, district)
  WHERE district IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_assigned_team_id
  ON deals(assigned_team_id)
  WHERE assigned_team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_assigned_vehicle_id
  ON deals(assigned_vehicle_id)
  WHERE assigned_vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_assigned_location_id
  ON deals(assigned_location_id)
  WHERE assigned_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_assigned_inventory_id
  ON deals(assigned_inventory_id)
  WHERE assigned_inventory_id IS NOT NULL;

-- Append-only audit stream for an existing incident. It records actions but
-- never changes an incident, resource, workflow stage, or notification.
CREATE TABLE IF NOT EXISTS incident_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN (
    'incident_created',
    'status_changed',
    'assignment_confirmed',
    'notification_queued',
    'notification_sent',
    'notification_failed',
    'case_note_added'
  )),
  previous_value TEXT,
  next_value TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_activity_account_deal_created
  ON incident_activity(account_id, deal_id, created_at DESC);

ALTER TABLE incident_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_activity_select ON incident_activity;
DROP POLICY IF EXISTS incident_activity_insert ON incident_activity;
CREATE POLICY incident_activity_select ON incident_activity
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY incident_activity_insert ON incident_activity
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

-- There intentionally are no UPDATE or DELETE policies: ordinary users can
-- read and append activity, but cannot edit or remove historical records.
CREATE OR REPLACE FUNCTION public.validate_incident_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  incident_account_id UUID;
BEGIN
  SELECT account_id INTO incident_account_id FROM deals WHERE id = NEW.deal_id;
  IF incident_account_id IS NULL OR incident_account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'Incident activity must belong to the incident account';
  END IF;

  IF NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.actor_user_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'Incident activity actor is not a member of this account';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_incident_activity ON incident_activity;
CREATE TRIGGER validate_incident_activity
  BEFORE INSERT ON incident_activity
  FOR EACH ROW EXECUTE FUNCTION public.validate_incident_activity();

CREATE OR REPLACE FUNCTION public.record_incident_lifecycle_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_incident_lifecycle_activity ON deals;
CREATE TRIGGER record_incident_lifecycle_activity
  AFTER INSERT OR UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.record_incident_lifecycle_activity();

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

DROP TRIGGER IF EXISTS record_incident_delivery_activity ON incident_status_deliveries;
CREATE TRIGGER record_incident_delivery_activity
  AFTER INSERT OR UPDATE OF delivery_status ON incident_status_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.record_incident_delivery_activity();

CREATE OR REPLACE FUNCTION public.record_incident_note_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO incident_activity (account_id, deal_id, actor_user_id, action, metadata)
  VALUES (NEW.account_id, NEW.deal_id, NEW.user_id, 'case_note_added', jsonb_build_object('note_id', NEW.id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_incident_note_activity ON incident_notes;
CREATE TRIGGER record_incident_note_activity
  AFTER INSERT ON incident_notes
  FOR EACH ROW EXECUTE FUNCTION public.record_incident_note_activity();

-- A coordinator-confirmed assignment is one database transaction. It locks
-- only the incident and specifically selected rows, rejects stale resources,
-- changes no unrelated availability, and moves the incident only to ASSIGNED.
CREATE OR REPLACE FUNCTION public.confirm_incident_response(
  p_deal_id UUID,
  p_team_id UUID DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_inventory_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  incident deals%ROWTYPE;
  selected_team response_teams%ROWTYPE;
  selected_vehicle vehicles%ROWTYPE;
  selected_location operational_locations%ROWTYPE;
  selected_inventory relief_inventory%ROWTYPE;
  assigned_stage_id UUID;
  selected_resource_label TEXT;
  old_team_id UUID;
  old_vehicle_id UUID;
  old_location_id UUID;
  old_inventory_id UUID;
BEGIN
  IF p_team_id IS NULL AND p_vehicle_id IS NULL AND p_location_id IS NULL AND p_inventory_id IS NULL THEN
    RAISE EXCEPTION 'Select at least one team, vehicle, location, or inventory resource.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO incident FROM deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND OR NOT is_account_member(incident.account_id, 'agent') THEN
    RAISE EXCEPTION 'Incident was not found for this account.' USING ERRCODE = 'P0001';
  END IF;
  IF incident.incident_status NOT IN ('verified', 'assigned') THEN
    RAISE EXCEPTION 'Verify the incident before confirming a response.' USING ERRCODE = 'P0001';
  END IF;

  old_team_id := incident.assigned_team_id;
  old_vehicle_id := incident.assigned_vehicle_id;
  old_location_id := incident.assigned_location_id;
  old_inventory_id := incident.assigned_inventory_id;

  IF p_team_id IS NOT NULL THEN
    SELECT * INTO selected_team FROM response_teams WHERE id = p_team_id AND account_id = incident.account_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected team was not found for this account.' USING ERRCODE = 'P0001'; END IF;
    IF selected_team.availability <> 'available' AND incident.assigned_team_id IS DISTINCT FROM p_team_id THEN
      RAISE EXCEPTION 'Resource is no longer available. Please select another resource.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_vehicle_id IS NOT NULL THEN
    SELECT * INTO selected_vehicle FROM vehicles WHERE id = p_vehicle_id AND account_id = incident.account_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected vehicle was not found for this account.' USING ERRCODE = 'P0001'; END IF;
    IF selected_vehicle.availability <> 'available' AND incident.assigned_vehicle_id IS DISTINCT FROM p_vehicle_id THEN
      RAISE EXCEPTION 'Resource is no longer available. Please select another resource.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_location_id IS NOT NULL THEN
    SELECT * INTO selected_location FROM operational_locations WHERE id = p_location_id AND account_id = incident.account_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected location was not found for this account.' USING ERRCODE = 'P0001'; END IF;
    IF selected_location.availability <> 'available' AND incident.assigned_location_id IS DISTINCT FROM p_location_id THEN
      RAISE EXCEPTION 'Resource is no longer available. Please select another resource.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF p_inventory_id IS NOT NULL THEN
    SELECT * INTO selected_inventory FROM relief_inventory WHERE id = p_inventory_id AND account_id = incident.account_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected inventory was not found for this account.' USING ERRCODE = 'P0001'; END IF;
    IF selected_inventory.availability <> 'available' AND incident.assigned_inventory_id IS DISTINCT FROM p_inventory_id THEN
      RAISE EXCEPTION 'Resource is no longer available. Please select another resource.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT id INTO assigned_stage_id
  FROM pipeline_stages
  WHERE pipeline_id = incident.pipeline_id AND incident_status = 'assigned'
  LIMIT 1;
  IF assigned_stage_id IS NULL THEN
    RAISE EXCEPTION 'This incident pipeline has no ASSIGNED stage.' USING ERRCODE = 'P0001';
  END IF;

  IF p_team_id IS NOT NULL THEN UPDATE response_teams SET availability = 'assigned' WHERE id = p_team_id; END IF;
  IF p_vehicle_id IS NOT NULL THEN UPDATE vehicles SET availability = 'assigned' WHERE id = p_vehicle_id; END IF;
  IF p_location_id IS NOT NULL THEN UPDATE operational_locations SET availability = 'assigned' WHERE id = p_location_id; END IF;
  IF p_inventory_id IS NOT NULL THEN UPDATE relief_inventory SET availability = 'assigned' WHERE id = p_inventory_id; END IF;

  selected_resource_label := COALESCE(selected_vehicle.identifier, selected_inventory.item_name, selected_location.name, incident.assigned_resource);
  UPDATE deals
  SET stage_id = assigned_stage_id,
      assigned_team = COALESCE(selected_team.name, assigned_team),
      assigned_resource = selected_resource_label,
      assigned_team_id = COALESCE(p_team_id, assigned_team_id),
      assigned_vehicle_id = COALESCE(p_vehicle_id, assigned_vehicle_id),
      assigned_location_id = COALESCE(p_location_id, assigned_location_id),
      assigned_inventory_id = COALESCE(p_inventory_id, assigned_inventory_id)
  WHERE id = incident.id;

  -- Release only a previous selection owned solely by this incident. This
  -- cannot change any resource still referenced by another active incident.
  IF old_team_id IS NOT NULL AND old_team_id IS DISTINCT FROM p_team_id AND NOT EXISTS (SELECT 1 FROM deals WHERE assigned_team_id = old_team_id AND id <> incident.id AND incident_status <> 'resolved') THEN UPDATE response_teams SET availability = 'available' WHERE id = old_team_id AND availability = 'assigned'; END IF;
  IF old_vehicle_id IS NOT NULL AND old_vehicle_id IS DISTINCT FROM p_vehicle_id AND NOT EXISTS (SELECT 1 FROM deals WHERE assigned_vehicle_id = old_vehicle_id AND id <> incident.id AND incident_status <> 'resolved') THEN UPDATE vehicles SET availability = 'available' WHERE id = old_vehicle_id AND availability = 'assigned'; END IF;
  IF old_location_id IS NOT NULL AND old_location_id IS DISTINCT FROM p_location_id AND NOT EXISTS (SELECT 1 FROM deals WHERE assigned_location_id = old_location_id AND id <> incident.id AND incident_status <> 'resolved') THEN UPDATE operational_locations SET availability = 'available' WHERE id = old_location_id AND availability = 'assigned'; END IF;
  IF old_inventory_id IS NOT NULL AND old_inventory_id IS DISTINCT FROM p_inventory_id AND NOT EXISTS (SELECT 1 FROM deals WHERE assigned_inventory_id = old_inventory_id AND id <> incident.id AND incident_status <> 'resolved') THEN UPDATE relief_inventory SET availability = 'available' WHERE id = old_inventory_id AND availability = 'assigned'; END IF;

  INSERT INTO incident_activity (account_id, deal_id, actor_user_id, action, previous_value, next_value, metadata)
  VALUES (
    incident.account_id,
    incident.id,
    auth.uid(),
    'assignment_confirmed',
    incident.incident_status::text,
    'assigned',
    jsonb_strip_nulls(jsonb_build_object(
      'team_id', p_team_id,
      'team', selected_team.name,
      'vehicle_id', p_vehicle_id,
      'vehicle', selected_vehicle.identifier,
      'location_id', p_location_id,
      'location', selected_location.name,
      'inventory_id', p_inventory_id,
      'inventory', selected_inventory.item_name
    ))
  );

  RETURN jsonb_build_object('deal_id', incident.id, 'incident_status', 'assigned');
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_incident_response(UUID, UUID, UUID, UUID, UUID) TO authenticated;
