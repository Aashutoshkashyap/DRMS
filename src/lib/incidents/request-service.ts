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
  /** Originating WhatsApp configuration/session, when this began in WhatsApp. */
  sourceWhatsAppConfigId?: string | null;
  /** Persisted CRM message carrying the citizen's text/media/location evidence. */
  sourceMessageId?: string | null;
}

export interface IncidentRequestSummary {
  id: string;
  request_id: string;
  category: IncidentCategory;
  incident_status: IncidentStatus;
  assigned_team: string | null;
  assigned_resource: string | null;
  conversation_id: string | null;
  created_at?: string;
  updated_at?: string;
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
      source_whatsapp_config_id: input.sourceWhatsAppConfigId ?? null,
      people_affected: input.peopleAffected,
      priority: input.priority,
      description: input.description,
      value: 0,
      currency: "NPR",
    })
    .select("id, request_id, category, incident_status, assigned_team, assigned_resource, conversation_id, created_at, updated_at")
    .single();
  if (error || !data) throw new Error(`Could not create incident request: ${error?.message ?? "unknown error"}`);
  const request = data as IncidentRequestSummary;
  if (input.sourceMessageId) {
    const { error: linkError } = await db.from("incident_message_links").upsert({
      account_id: input.accountId,
      deal_id: request.id,
      message_id: input.sourceMessageId,
    }, { onConflict: "deal_id,message_id", ignoreDuplicates: true });
    if (linkError) console.error("Could not link incident evidence:", linkError.message);
    const { data: message, error: evidenceReadError } = await db.from("messages")
      .select("media_storage_path,media_type,conversation_id").eq("id", input.sourceMessageId).maybeSingle();
    if (evidenceReadError) console.error("Could not inspect incident evidence:", evidenceReadError.message);
    if (message?.media_storage_path) {
      const { error: evidenceError } = await db.from("incident_evidence").upsert({
        account_id: input.accountId,
        deal_id: request.id,
        conversation_id: message.conversation_id,
        message_id: input.sourceMessageId,
        storage_path: message.media_storage_path,
        media_type: message.media_type,
      }, { onConflict: "deal_id,message_id", ignoreDuplicates: true });
      if (evidenceError) console.error("Could not associate incident evidence:", evidenceError.message);
    }
  }
  return request;
}

export async function findCitizenIncident(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  requestId?: string,
): Promise<IncidentRequestSummary | null> {
  let query = db
    .from("deals")
    .select("id, request_id, category, incident_status, assigned_team, assigned_resource, conversation_id, created_at, updated_at")
    .eq("account_id", accountId)
    .eq("contact_id", contactId);
  if (requestId) query = query.eq("request_id", requestId.trim().toUpperCase());
  else query = query.neq("incident_status", "resolved").order("created_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not retrieve request status: ${error.message}`);
  return (data as IncidentRequestSummary | null) ?? null;
}

export type PossibleRelatedIncident = Pick<IncidentRequestSummary, "id" | "request_id" | "incident_status" | "category"> & {
  distanceKm: number | null;
  sharedTokens: string[];
};

type MatchPolicy = { radius_km: number; time_window_hours: number; text_token_threshold: number };
const defaultPolicy: MatchPolicy = { radius_km: 1, time_window_hours: 24, text_token_threshold: 2 };
const ignoredTokens = new Set(["about", "after", "again", "area", "being", "from", "have", "help", "here", "into", "near", "need", "people", "please", "that", "their", "there", "this", "with", "your"]);

function tokens(value: string | null | undefined) {
  return new Set((value ?? "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter((word) => !ignoredTokens.has(word)) ?? []);
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1); const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Finds, but never merges, plausible unresolved reports. Every result is
 * recorded as coordinator-reviewable `possible_related` evidence. */
export async function findPossibleRelatedIncidents(db: SupabaseClient, accountId: string, dealId: string): Promise<PossibleRelatedIncident[]> {
  const [{ data: policyRow }, { data: current, error: currentError }] = await Promise.all([
    db.from("incident_matching_policies").select("radius_km,time_window_hours,text_token_threshold").eq("account_id", accountId).maybeSingle(),
    db.from("deals").select("id,request_id,category,incident_status,description,location,municipality,district,latitude,longitude,created_at").eq("account_id", accountId).eq("id", dealId).single(),
  ]);
  if (currentError || !current) return [];
  const policy = { ...defaultPolicy, ...(policyRow as Partial<MatchPolicy> | null ?? {}) };
  const since = new Date(Date.now() - Number(policy.time_window_hours) * 3_600_000).toISOString();
  const { data: candidates, error } = await db.from("deals")
    .select("id,request_id,category,incident_status,description,location,municipality,district,latitude,longitude,created_at")
    .eq("account_id", accountId).neq("id", dealId).neq("incident_status", "resolved").gte("created_at", since).limit(100);
  if (error) throw new Error(`Could not find related incidents: ${error.message}`);
  const currentTokens = tokens(`${current.description ?? ""} ${current.location ?? ""} ${current.municipality ?? ""} ${current.district ?? ""}`);
  const matches: PossibleRelatedIncident[] = [];
  for (const candidate of candidates ?? []) {
    const candidateTokens = tokens(`${candidate.description ?? ""} ${candidate.location ?? ""} ${candidate.municipality ?? ""} ${candidate.district ?? ""}`);
    const sharedTokens = [...currentTokens].filter((word) => candidateTokens.has(word));
    const hasCoordinates = current.latitude != null && current.longitude != null && candidate.latitude != null && candidate.longitude != null;
    const distanceKm = hasCoordinates ? haversineKm(Number(current.latitude), Number(current.longitude), Number(candidate.latitude), Number(candidate.longitude)) : null;
    const locationMatch = Boolean(current.location && candidate.location && current.location.trim().toLowerCase() === candidate.location.trim().toLowerCase());
    const categoryMatch = current.category === candidate.category;
    const closeEnough = distanceKm !== null && distanceKm <= Number(policy.radius_km);
    const textEnough = sharedTokens.length >= Number(policy.text_token_threshold);
    if (!(closeEnough || locationMatch || (categoryMatch && textEnough))) continue;
    const signals = { distance_km: distanceKm, shared_tokens: sharedTokens, location_match: locationMatch, category_match: categoryMatch, policy };
    await db.from("incident_relationships").upsert({ account_id: accountId, source_deal_id: dealId, related_deal_id: candidate.id, relationship: "possible_related", match_signals: signals }, { onConflict: "source_deal_id,related_deal_id", ignoreDuplicates: true });
    matches.push({ id: candidate.id, request_id: candidate.request_id, category: candidate.category, incident_status: candidate.incident_status, distanceKm, sharedTokens });
  }
  return matches;
}
