-- Follow-up for 051: coordinator-originated delivery failures must be able
-- to create and resolve their grouped health signal without service-role use.

DROP POLICY IF EXISTS operational_health_events_insert ON operational_health_events;
CREATE POLICY operational_health_events_insert ON operational_health_events FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS operational_health_events_update ON operational_health_events;
CREATE POLICY operational_health_events_update ON operational_health_events FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
