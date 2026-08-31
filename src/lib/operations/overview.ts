import type { SupabaseClient } from "@supabase/supabase-js";

export type OperationsIncident = {
  id: string;
  request_id: string;
  title: string;
  requester_name: string | null;
  category: string;
  priority: string;
  incident_status: string;
  location: string | null;
  assigned_to: string | null;
  assigned_team: string | null;
  assigned_resource: string | null;
  created_at: string;
  updated_at: string;
};

export type FollowUpSettings = {
  received_after_hours: number | null;
  assigned_after_hours: number | null;
  dispatched_after_hours: number | null;
} | null;

export function isAgeFollowUp(incident: OperationsIncident, settings: FollowUpSettings, now = new Date()): boolean {
  if (!settings) return false;
  const hours = incident.incident_status === "received"
    ? settings.received_after_hours
    : incident.incident_status === "assigned"
      ? settings.assigned_after_hours
      : incident.incident_status === "dispatched"
        ? settings.dispatched_after_hours
        : null;
  if (!hours) return false;
  return now.getTime() - new Date(incident.updated_at || incident.created_at).getTime() >= hours * 60 * 60 * 1000;
}

export function isUnassigned(incident: OperationsIncident): boolean {
  return !incident.assigned_to && !incident.assigned_team && !incident.assigned_resource;
}

export async function loadOperationsOverview(db: SupabaseClient) {
  const [incidentsResult, settingsResult, deliveriesResult, messagesResult] = await Promise.all([
    db.from("deals").select("id,request_id,title,requester_name,category,priority,incident_status,location,assigned_to,assigned_team,assigned_resource,created_at,updated_at").order("updated_at", { ascending: false }),
    db.from("incident_follow_up_settings").select("received_after_hours,assigned_after_hours,dispatched_after_hours").maybeSingle(),
    db.from("incident_status_deliveries").select("id,deal_id,error_message,incident_status,updated_at").eq("delivery_status", "failed").order("updated_at", { ascending: false }),
    db.from("messages").select("id,content_text,sender_type,created_at,conversation_id,conversations(contact_id,contacts(name,phone))").order("created_at", { ascending: false }).limit(8),
  ]);
  if (incidentsResult.error) throw incidentsResult.error;
  if (settingsResult.error) throw settingsResult.error;
  if (deliveriesResult.error) throw deliveriesResult.error;
  if (messagesResult.error) throw messagesResult.error;

  const incidents = (incidentsResult.data ?? []) as OperationsIncident[];
  const settings = (settingsResult.data ?? null) as FollowUpSettings;
  const active = incidents.filter((incident) => incident.incident_status !== "resolved");
  const locationSummary = Array.from(active.reduce((groups, incident) => {
    const label = incident.location?.trim() || "Location not recorded";
    groups.set(label, (groups.get(label) ?? 0) + 1);
    return groups;
  }, new Map<string, number>()).entries()).sort((left, right) => right[1] - left[1]).slice(0, 5);
  const ageFollowUps = active.filter((incident) => isAgeFollowUp(incident, settings));

  return {
    incidents,
    active,
    counts: {
      active: active.length,
      critical: active.filter((incident) => incident.priority === "critical").length,
      received: active.filter((incident) => incident.incident_status === "received").length,
      unassigned: active.filter(isUnassigned).length,
      dispatched: active.filter((incident) => incident.incident_status === "dispatched").length,
      resolved: incidents.filter((incident) => incident.incident_status === "resolved").length,
      followUp: new Set([...active.filter(isUnassigned).map((incident) => incident.id), ...ageFollowUps.map((incident) => incident.id), ...(deliveriesResult.data ?? []).map((delivery) => delivery.deal_id)]).size,
    },
    failedDeliveries: deliveriesResult.data ?? [],
    ageFollowUps,
    locationSummary,
    recentMessages: messagesResult.data ?? [],
    followUpSettingsConfigured: Boolean(settings?.received_after_hours || settings?.assigned_after_hours || settings?.dispatched_after_hours),
  };
}
