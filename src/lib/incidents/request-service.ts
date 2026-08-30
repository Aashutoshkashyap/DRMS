import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncidentCategory, IncidentPriority, IncidentStatus } from "@/types";
import { ensureDisasterPipeline } from "./pipeline-service";

export interface CreateIncidentRequestInput {
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  requesterName: string;
  category: IncidentCategory;
  location: string;
  landmark?: string | null;
  peopleAffected: number;
  priority: IncidentPriority;
  description: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface IncidentRequestSummary {
  id: string;
  request_id: string;
  category: IncidentCategory;
  incident_status: IncidentStatus;
  assigned_team: string | null;
  assigned_resource: string | null;
  conversation_id: string | null;
}

/** Channel-independent incident creation. The caller supplies an existing
 * contact and communication thread; no provider-specific data is stored. */
export async function createIncidentRequest(
  db: SupabaseClient,
  input: CreateIncidentRequestInput,
): Promise<IncidentRequestSummary> {
  const pipeline = await ensureDisasterPipeline(db, input.accountId, input.userId);
  const { data, error } = await db
    .from("deals")
    .insert({
      account_id: input.accountId,
      user_id: input.userId,
      pipeline_id: pipeline.pipelineId,
      stage_id: pipeline.receivedStageId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      title: input.requesterName,
      requester_name: input.requesterName,
      category: input.category,
      location: input.location,
      landmark: input.landmark ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      people_affected: input.peopleAffected,
      priority: input.priority,
      description: input.description,
      value: 0,
      currency: "NPR",
    })
    .select("id, request_id, category, incident_status, assigned_team, assigned_resource, conversation_id")
    .single();
  if (error || !data) throw new Error(`Could not create incident request: ${error?.message ?? "unknown error"}`);
  return data as IncidentRequestSummary;
}

export async function findCitizenIncident(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  requestId?: string,
): Promise<IncidentRequestSummary | null> {
  let query = db
    .from("deals")
    .select("id, request_id, category, incident_status, assigned_team, assigned_resource, conversation_id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId);
  if (requestId) query = query.eq("request_id", requestId.trim().toUpperCase());
  else query = query.neq("incident_status", "resolved").order("created_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not retrieve request status: ${error.message}`);
  return (data as IncidentRequestSummary | null) ?? null;
}
