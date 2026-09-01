-- Phase 13C: a new user who opens the incident board before redeeming an
-- invitation receives a harmless default Disaster Response Coordination
-- pipeline. Prior invite redemption treated that generated empty scaffold as
-- operational data and permanently refused the join, leaving the person in
-- an empty personal workspace. Allow only that exact scaffold to be cleaned
-- up by the existing redeem_invitation transaction.
--
-- Any incident, contact, conversation, WhatsApp configuration, resource,
-- note, follow-up, evidence, or non-default/custom pipeline still blocks a
-- join. No RLS policy is widened.

CREATE OR REPLACE FUNCTION public.is_empty_disaster_bootstrap_account(
  p_account_id UUID,
  p_owner_user_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id UUID;
  pipeline_count INTEGER;
  stage_count INTEGER;
  status_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pipeline_count
  FROM pipelines
  WHERE account_id = p_account_id;

  IF pipeline_count = 0 THEN RETURN TRUE; END IF;
  IF pipeline_count <> 1 THEN RETURN FALSE; END IF;

  SELECT id INTO v_pipeline_id
  FROM pipelines
  WHERE account_id = p_account_id;

  IF NOT EXISTS (
    SELECT 1 FROM pipelines
    WHERE id = v_pipeline_id
      AND account_id = p_account_id
      AND user_id = p_owner_user_id
      AND name = 'Disaster Response Coordination'
  ) THEN RETURN FALSE; END IF;

  -- Anything other than the stock pipeline/stages is meaningful account data.
  -- Keep this list deliberately conservative: a failed check leaves the
  -- account untouched and asks the person to use a different login instead.
  IF EXISTS (
    SELECT 1 FROM contacts WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM communication_sessions WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM incident_activity WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM incident_follow_ups WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM incident_follow_up_settings WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM incident_notes WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM incident_status_deliveries WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM incident_evidence WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM incident_message_links WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM incident_relationships WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM incident_matching_policies WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM operational_health_events WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM operational_locations WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM response_teams WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM vehicles WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM relief_inventory WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM response_team_members WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM demo_seed_runs WHERE account_id = p_account_id
    UNION ALL SELECT 1 FROM demo_seed_records WHERE account_id = p_account_id
    LIMIT 1
  ) THEN RETURN FALSE; END IF;

  SELECT COUNT(*), COUNT(DISTINCT incident_status)
  INTO stage_count, status_count
  FROM pipeline_stages
  WHERE ps.pipeline_id = v_pipeline_id
    AND incident_status IN ('received', 'verified', 'assigned', 'dispatched', 'in_progress', 'resolved');

  RETURN stage_count = 6
    AND status_count = 6
    AND NOT EXISTS (
      SELECT 1 FROM pipeline_stages WHERE pipeline_id = v_pipeline_id
        AND incident_status NOT IN ('received', 'verified', 'assigned', 'dispatched', 'in_progress', 'resolved')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('RECEIVED', 0, 'received'),
        ('VERIFIED', 1, 'verified'),
        ('ASSIGNED', 2, 'assigned'),
        ('DISPATCHED', 3, 'dispatched'),
        ('IN PROGRESS', 4, 'in_progress'),
        ('RESOLVED', 5, 'resolved')
      ) AS expected(name, position, incident_status)
      WHERE NOT EXISTS (
        SELECT 1 FROM pipeline_stages ps
        WHERE ps.pipeline_id = v_pipeline_id
          AND ps.name = expected.name
          AND ps.position = expected.position
          AND ps.incident_status::TEXT = expected.incident_status
      )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM account_invitations
  WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023'; END IF;
  IF v_inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Invitation has already been redeemed' USING ERRCODE = '22023'; END IF;
  IF v_inv.expires_at <= NOW() THEN RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023'; END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;
  IF v_old_account_id IS NULL THEN RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501'; END IF;
  IF v_old_account_id = v_inv.account_id THEN RAISE EXCEPTION 'You are already a member of this account' USING ERRCODE = '23505'; END IF;
  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one' USING ERRCODE = '23505';
  END IF;

  SELECT NOT public.is_empty_disaster_bootstrap_account(v_old_account_id, v_caller_id) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains operational data; sign up with a different email to join this one' USING ERRCODE = '23505';
  END IF;

  UPDATE profiles SET account_id = v_inv.account_id, account_role = v_inv.role
  WHERE user_id = v_caller_id;
  UPDATE account_invitations SET accepted_at = NOW(), accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;
  DELETE FROM accounts WHERE id = v_old_account_id;
  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.is_empty_disaster_bootstrap_account(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_empty_disaster_bootstrap_account(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
