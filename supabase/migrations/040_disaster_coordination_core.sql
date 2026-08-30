-- Disaster Response & Information Coordination core.
--
-- Extends the existing deals + pipeline engine instead of creating a second
-- request backend. Existing contacts, conversations, assignment, RLS,
-- realtime, and audit timestamps stay in place.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_status_enum') THEN
    CREATE TYPE incident_status_enum AS ENUM (
      'received', 'verified', 'assigned', 'dispatched', 'in_progress', 'resolved'
    );
  END IF;
END $$;

ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS incident_status incident_status_enum;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'information',
  ADD COLUMN IF NOT EXISTS requester_name TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS landmark TEXT,
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS people_affected INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS incident_status incident_status_enum NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS assigned_team TEXT,
  ADD COLUMN IF NOT EXISTS assigned_resource TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Request references are unique, human-readable, and safe under concurrent
-- intake without needing a sequence. They identify a report, not a verified
-- resource or dispatch.
UPDATE deals
SET request_id = 'DRMS-' || UPPER(SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 10))
WHERE request_id IS NULL;

ALTER TABLE deals
  ALTER COLUMN request_id SET DEFAULT
    ('DRMS-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 10))),
  ALTER COLUMN request_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_account_request_id
  ON deals(account_id, request_id);
CREATE INDEX IF NOT EXISTS idx_deals_account_incident_status
  ON deals(account_id, incident_status);
CREATE INDEX IF NOT EXISTS idx_deals_account_category_priority
  ON deals(account_id, category, priority);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_people_affected_nonnegative') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_people_affected_nonnegative CHECK (people_affected >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_incident_priority_check') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_incident_priority_check
      CHECK (priority IN ('low', 'medium', 'high', 'critical'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_incident_category_check') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_incident_category_check
      CHECK (category IN ('rescue', 'food_water', 'medicine', 'shelter', 'missing_person', 'information'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_latitude_range') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_longitude_range') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
  END IF;
END $$;

-- Transform only the stock CRM seed. User-created pipelines remain available
-- and configurable through the existing engine.
UPDATE pipelines
SET name = 'Disaster Response Coordination'
WHERE name = 'Sales Pipeline';

UPDATE pipeline_stages ps
SET name = CASE ps.name
      WHEN 'New Lead' THEN 'RECEIVED'
      WHEN 'Qualified' THEN 'VERIFIED'
      WHEN 'Proposal Sent' THEN 'ASSIGNED'
      WHEN 'Negotiation' THEN 'DISPATCHED'
      WHEN 'Won' THEN 'RESOLVED'
      ELSE ps.name
    END,
    incident_status = CASE ps.name
      WHEN 'New Lead' THEN 'received'::incident_status_enum
      WHEN 'Qualified' THEN 'verified'::incident_status_enum
      WHEN 'Proposal Sent' THEN 'assigned'::incident_status_enum
      WHEN 'Negotiation' THEN 'dispatched'::incident_status_enum
      WHEN 'Won' THEN 'resolved'::incident_status_enum
      WHEN 'IN PROGRESS' THEN 'in_progress'::incident_status_enum
      ELSE incident_status
    END
FROM pipelines p
WHERE ps.pipeline_id = p.id AND p.name = 'Disaster Response Coordination';

UPDATE pipeline_stages ps
SET position = ps.position + 1
FROM pipelines p
WHERE ps.pipeline_id = p.id AND p.name = 'Disaster Response Coordination'
  AND ps.name = 'RESOLVED'
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stages existing
    WHERE existing.pipeline_id = p.id AND existing.incident_status = 'in_progress'
  );

INSERT INTO pipeline_stages (pipeline_id, name, color, position, incident_status)
SELECT p.id, 'IN PROGRESS', '#ef4444', 4, 'in_progress'::incident_status_enum
FROM pipelines p
WHERE p.name = 'Disaster Response Coordination'
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stages ps
    WHERE ps.pipeline_id = p.id AND ps.incident_status = 'in_progress'
  );

UPDATE deals d
SET incident_status = ps.incident_status,
    status = CASE WHEN ps.incident_status = 'resolved' THEN 'won' ELSE 'open' END,
    resolved_at = CASE WHEN ps.incident_status = 'resolved' THEN COALESCE(d.resolved_at, d.updated_at, NOW()) ELSE d.resolved_at END
FROM pipeline_stages ps
WHERE ps.id = d.stage_id AND ps.incident_status IS NOT NULL;

-- The existing drag-and-drop pipeline remains the status UI. This trigger
-- makes the stage mapping the database source of truth and sets resolution
-- time only when a coordinator moves a request to RESOLVED.
CREATE OR REPLACE FUNCTION public.sync_incident_request_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  next_status incident_status_enum;
BEGIN
  SELECT incident_status INTO next_status FROM pipeline_stages WHERE id = NEW.stage_id;
  IF next_status IS NULL THEN RETURN NEW; END IF;

  NEW.incident_status = next_status;
  NEW.status = CASE WHEN next_status = 'resolved' THEN 'won' ELSE 'open' END;
  IF next_status = 'resolved' THEN
    NEW.resolved_at = COALESCE(NEW.resolved_at, NOW());
  ELSIF TG_OP = 'UPDATE' AND OLD.incident_status = 'resolved' THEN
    NEW.resolved_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_incident_request_stage ON deals;
CREATE TRIGGER sync_incident_request_stage
  BEFORE INSERT OR UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION public.sync_incident_request_stage();
