-- Correct the bootstrap-workspace validator introduced in 054. The prior
-- function body used the pipeline-stage alias `ps` without declaring it in
-- one query. No RLS policy or account data is changed here.

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

  SELECT COUNT(*), COUNT(DISTINCT ps.incident_status)
  INTO stage_count, status_count
  FROM pipeline_stages ps
  WHERE ps.pipeline_id = v_pipeline_id
    AND ps.incident_status IN ('received', 'verified', 'assigned', 'dispatched', 'in_progress', 'resolved');

  RETURN stage_count = 6
    AND status_count = 6
    AND NOT EXISTS (
      SELECT 1 FROM pipeline_stages ps
      WHERE ps.pipeline_id = v_pipeline_id
        AND ps.incident_status NOT IN ('received', 'verified', 'assigned', 'dispatched', 'in_progress', 'resolved')
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

ALTER FUNCTION public.is_empty_disaster_bootstrap_account(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_empty_disaster_bootstrap_account(UUID, UUID) FROM PUBLIC;
