import type { SupabaseClient } from "@supabase/supabase-js";

export const DISASTER_PIPELINE_NAME = "Disaster Response Coordination";

export const DISASTER_PIPELINE_STAGES = [
  { name: "RECEIVED", color: "#3b82f6", position: 0, incident_status: "received" },
  { name: "VERIFIED", color: "#eab308", position: 1, incident_status: "verified" },
  { name: "ASSIGNED", color: "#8b5cf6", position: 2, incident_status: "assigned" },
  { name: "DISPATCHED", color: "#f97316", position: 3, incident_status: "dispatched" },
  { name: "IN PROGRESS", color: "#ef4444", position: 4, incident_status: "in_progress" },
  { name: "RESOLVED", color: "#22c55e", position: 5, incident_status: "resolved" },
] as const;

/**
 * Resolve the coordinator pipeline used by every channel. It only creates
 * the stock pipeline when an account has not configured one yet; it never
 * rewrites a user-created pipeline.
 */
export async function ensureDisasterPipeline(
  db: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<{ pipelineId: string; receivedStageId: string }> {
  const { data: existingPipeline, error } = await db
    .from("pipelines")
    .select("id")
    .eq("account_id", accountId)
    .eq("name", DISASTER_PIPELINE_NAME)
    .maybeSingle();

  if (error) throw new Error(`Could not load disaster pipeline: ${error.message}`);
  let pipeline = existingPipeline;

  if (!pipeline) {
    const created = await db
      .from("pipelines")
      .insert({ account_id: accountId, user_id: userId, name: DISASTER_PIPELINE_NAME })
      .select("id")
      .single();
    if (created.error || !created.data) {
      throw new Error(`Could not create disaster pipeline: ${created.error?.message ?? "unknown error"}`);
    }
    pipeline = created.data;
  }

  const { data: stages, error: stageError } = await db
    .from("pipeline_stages")
    .select("id, incident_status")
    .eq("pipeline_id", pipeline.id);
  if (stageError) throw new Error(`Could not load disaster stages: ${stageError.message}`);

  let received = stages?.find((stage) => stage.incident_status === "received");
  if (!received) {
    const inserted = await db
      .from("pipeline_stages")
      .insert(DISASTER_PIPELINE_STAGES.map((stage) => ({ ...stage, pipeline_id: pipeline!.id })))
      .select("id, incident_status");
    if (inserted.error || !inserted.data) {
      throw new Error(`Could not create disaster stages: ${inserted.error?.message ?? "unknown error"}`);
    }
    received = inserted.data.find((stage) => stage.incident_status === "received");
  }

  if (!received) throw new Error("Disaster pipeline has no RECEIVED stage");
  return { pipelineId: pipeline.id, receivedStageId: received.id };
}
