-- Phase 13B: shared DRMS coordination keeps the existing account/workspace
-- model and its append-only incident_activity stream. This adds the missing
-- many-to-many relationship between existing response teams and existing
-- workspace members, plus a team snapshot for each attributable activity.
--
-- No incident, conversation, citizen message, or account membership is
-- duplicated or moved. Existing activity remains immutable; historic rows
-- without a contemporaneous team retain a NULL team and render as an
-- individual coordinator/system action.

CREATE TABLE IF NOT EXISTS response_team_members (
  team_id UUID NOT NULL REFERENCES response_teams(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_response_team_members_account_user
  ON response_team_members(account_id, user_id);
CREATE INDEX IF NOT EXISTS idx_response_team_members_team
  ON response_team_members(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_response_team_members_one_primary
  ON response_team_members(account_id, user_id)
  WHERE is_primary;

ALTER TABLE response_team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS response_team_members_select ON response_team_members;
DROP POLICY IF EXISTS response_team_members_write ON response_team_members;
CREATE POLICY response_team_members_select ON response_team_members
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY response_team_members_write ON response_team_members
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.validate_response_team_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  team_account_id UUID;
  member_account_id UUID;
BEGIN
  SELECT account_id INTO team_account_id FROM response_teams WHERE id = NEW.team_id;
  SELECT account_id INTO member_account_id FROM profiles WHERE user_id = NEW.user_id;
  IF team_account_id IS NULL OR member_account_id IS NULL
     OR team_account_id <> NEW.account_id
     OR member_account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'Team membership must use a member and team from the same workspace';
  END IF;
  -- The first team recorded for a coordinator is their operational default.
  -- Admins may add further teams; activity derivation then prefers an
  -- incident's assigned team whenever that membership is relevant.
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM response_team_members
    WHERE account_id = NEW.account_id AND user_id = NEW.user_id
  ) THEN
    NEW.is_primary := TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_response_team_member ON response_team_members;
CREATE TRIGGER validate_response_team_member
  BEFORE INSERT OR UPDATE ON response_team_members
  FOR EACH ROW EXECUTE FUNCTION public.validate_response_team_member();

ALTER TABLE incident_activity
  ADD COLUMN IF NOT EXISTS actor_team_id UUID REFERENCES response_teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_incident_activity_account_actor_team_created
  ON incident_activity(account_id, actor_team_id, created_at DESC)
  WHERE actor_team_id IS NOT NULL;

-- The existing validation trigger is the single write gateway for the audit
-- table. Enrich actions with the actor's primary team when one exists. When
-- an incident is already assigned to a team that the actor belongs to, that
-- team is more relevant than the user's default team.
CREATE OR REPLACE FUNCTION public.validate_incident_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  incident_account_id UUID;
  incident_team_id UUID;
  selected_team_account_id UUID;
BEGIN
  SELECT account_id, assigned_team_id
  INTO incident_account_id, incident_team_id
  FROM deals WHERE id = NEW.deal_id;
  IF incident_account_id IS NULL OR incident_account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'Incident activity must belong to the incident account';
  END IF;

  IF NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.actor_user_id AND account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'Incident activity actor is not a member of this account';
  END IF;

  IF NEW.actor_team_id IS NULL AND NEW.actor_user_id IS NOT NULL THEN
    SELECT membership.team_id INTO NEW.actor_team_id
    FROM response_team_members membership
    WHERE membership.account_id = NEW.account_id
      AND membership.user_id = NEW.actor_user_id
    ORDER BY
      CASE WHEN membership.team_id = incident_team_id THEN 0 ELSE 1 END,
      CASE WHEN membership.is_primary THEN 0 ELSE 1 END,
      membership.created_at ASC
    LIMIT 1;
  END IF;

  IF NEW.actor_team_id IS NOT NULL THEN
    SELECT account_id INTO selected_team_account_id
    FROM response_teams WHERE id = NEW.actor_team_id;
    IF selected_team_account_id IS NULL OR selected_team_account_id <> NEW.account_id THEN
      RAISE EXCEPTION 'Incident activity team is not in this workspace';
    END IF;
    IF NEW.actor_user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM response_team_members
      WHERE team_id = NEW.actor_team_id
        AND account_id = NEW.account_id
        AND user_id = NEW.actor_user_id
    ) THEN
      RAISE EXCEPTION 'Incident activity team does not belong to its actor';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
