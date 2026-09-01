import type { SupabaseClient } from "@supabase/supabase-js";

export type OperationsIncident = {
  id: string;
  request_id: string;
  title: string;
  requester_name: string | null;
  contact_phone: string | null;
  category: string;
  priority: string;
  people_affected: number | null;
  incident_status: string;
  location: string | null;
  municipality: string | null;
  district: string | null;
  assigned_to: string | null;
  assigned_team: string | null;
  assigned_resource: string | null;
  assigned_team_id: string | null;
  assigned_vehicle_id: string | null;
  assigned_location_id: string | null;
  assigned_inventory_id: string | null;
  created_at: string;
  updated_at: string;
};

export type FollowUpSettings = {
  received_after_hours: number | null;
  assigned_after_hours: number | null;
  dispatched_after_hours: number | null;
} | null;

export type FollowUpReason = "unassigned" | "communication_failed" | "overdue" | "coordinator_action_required";

export type IncidentFollowUp = {
  id: string;
  account_id: string;
  deal_id: string;
  status: "active" | "reviewed" | "cleared";
  reason_codes: FollowUpReason[];
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  cleared_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FailedDelivery = {
  id: string;
  deal_id: string;
  incident_status: string;
  error_message: string | null;
  delivery_status: "pending" | "sent" | "failed";
  created_at: string;
  updated_at: string;
};

export type IncidentAttentionItem = {
  incident: OperationsIncident;
  reasons: FollowUpReason[];
  failedDelivery: FailedDelivery | null;
  followUp: IncidentFollowUp | null;
};

const REASON_ORDER: Record<FollowUpReason, number> = {
  communication_failed: 0,
  unassigned: 1,
  overdue: 2,
  coordinator_action_required: 3,
};

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const FOLLOW_UP_REASON_LABEL: Record<FollowUpReason, string> = {
  unassigned: "No response team or verified resource has been assigned.",
  communication_failed: "Citizen status notification could not be delivered.",
  overdue: "Configured response follow-up threshold has been exceeded.",
  coordinator_action_required: "A configured coordinator action is required.",
};

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
  return !incident.assigned_to && !incident.assigned_team && !incident.assigned_resource && !incident.assigned_team_id && !incident.assigned_vehicle_id && !incident.assigned_location_id && !incident.assigned_inventory_id;
}

/** Assignment becomes an operational requirement only after a coordinator has
 * verified the incident. RECEIVED cases remain in intake. */
export function requiresAssignment(incident: OperationsIncident): boolean {
  return incident.incident_status === "verified" && isUnassigned(incident);
}

function latestDeliveryByIncident(deliveries: FailedDelivery[]): Map<string, FailedDelivery> {
  const result = new Map<string, FailedDelivery>();
  for (const delivery of [...deliveries].sort((left, right) => right.created_at.localeCompare(left.created_at))) {
    if (!result.has(delivery.deal_id)) result.set(delivery.deal_id, delivery);
  }
  return result;
}

/** The one deterministic definition of an operational attention item. Every
 * dashboard, queue, and case-centre surface consumes these results. */
export function deriveIncidentAttention({
  incidents,
  settings,
  deliveries,
  followUps = [],
  now = new Date(),
}: {
  incidents: OperationsIncident[];
  settings: FollowUpSettings;
  deliveries: FailedDelivery[];
  followUps?: IncidentFollowUp[];
  now?: Date;
}): IncidentAttentionItem[] {
  const active = incidents.filter((incident) => incident.incident_status !== "resolved");
  const followUpsByDeal = new Map(followUps.map((followUp) => [followUp.deal_id, followUp]));
  const latestDeliveries = latestDeliveryByIncident(deliveries);
  const items = new Map<string, IncidentAttentionItem>();

  const add = (incident: OperationsIncident, reason: FollowUpReason, failedDelivery: FailedDelivery | null = null) => {
    const existing = items.get(incident.id);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      if (failedDelivery) existing.failedDelivery = failedDelivery;
      return;
    }
    items.set(incident.id, { incident, reasons: [reason], failedDelivery, followUp: followUpsByDeal.get(incident.id) ?? null });
  };

  for (const incident of active) {
    if (requiresAssignment(incident)) add(incident, "unassigned");
    if (isAgeFollowUp(incident, settings, now)) add(incident, "overdue");
  }

  const allIncidents = new Map(incidents.map((incident) => [incident.id, incident]));
  for (const [dealId, delivery] of latestDeliveries) {
    const incident = allIncidents.get(dealId);
    if (incident && delivery.delivery_status === "failed") add(incident, "communication_failed", delivery);
  }

  return [...items.values()]
    .map((item) => ({ ...item, reasons: [...item.reasons].sort((left, right) => REASON_ORDER[left] - REASON_ORDER[right]) }))
    .sort((left, right) => {
      const priority = (PRIORITY_ORDER[left.incident.priority] ?? 99) - (PRIORITY_ORDER[right.incident.priority] ?? 99);
      if (priority) return priority;
      const reason = REASON_ORDER[left.reasons[0]] - REASON_ORDER[right.reasons[0]];
      if (reason) return reason;
      return left.incident.created_at.localeCompare(right.incident.created_at);
    });
}

export type LocationGrouping = "exact" | "municipality" | "district";

export function groupIncidentsByLocation(incidents: OperationsIncident[], grouping: LocationGrouping): Array<[string, number]> {
  const field = grouping === "exact" ? "location" : grouping;
  const fallback = grouping === "exact" ? "Location not recorded" : `${grouping[0].toUpperCase()}${grouping.slice(1)} not recorded`;
  return Array.from(incidents.reduce((groups, incident) => {
    const label = incident[field]?.trim() || fallback;
    groups.set(label, (groups.get(label) ?? 0) + 1);
    return groups;
  }, new Map<string, number>()).entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8);
}

export async function loadOperationsOverview(db: SupabaseClient) {
  const [incidentsResult, settingsResult, deliveriesResult, followUpsResult, messagesResult] = await Promise.all([
    db.from("deals").select("id,request_id,title,requester_name,category,priority,people_affected,incident_status,location,municipality,district,assigned_to,assigned_team,assigned_resource,assigned_team_id,assigned_vehicle_id,assigned_location_id,assigned_inventory_id,created_at,updated_at,contact:contacts(phone)").order("updated_at", { ascending: false }),
    db.from("incident_follow_up_settings").select("received_after_hours,assigned_after_hours,dispatched_after_hours").maybeSingle(),
    db.from("incident_status_deliveries").select("id,deal_id,error_message,incident_status,delivery_status,created_at,updated_at").order("created_at", { ascending: false }),
    db.from("incident_follow_ups").select("id,account_id,deal_id,status,reason_codes,reviewed_at,reviewed_by_user_id,cleared_at,created_at,updated_at"),
    db.from("messages").select("id,content_text,sender_type,created_at,conversation_id,conversations(contact_id,contacts(name,phone))").order("created_at", { ascending: false }).limit(8),
  ]);
  if (incidentsResult.error) throw incidentsResult.error;
  if (settingsResult.error) throw settingsResult.error;
  if (deliveriesResult.error) throw deliveriesResult.error;
  if (followUpsResult.error) throw followUpsResult.error;
  if (messagesResult.error) throw messagesResult.error;

  const incidents = (incidentsResult.data ?? []).map((row) => {
    const incident = row as unknown as Omit<OperationsIncident, "contact_phone"> & { contact: Array<{ phone: string | null }> | { phone: string | null } | null };
    const contact = Array.isArray(incident.contact) ? incident.contact[0] : incident.contact;
    return { ...incident, contact_phone: contact?.phone ?? null };
  }) as OperationsIncident[];
  const settings = (settingsResult.data ?? null) as FollowUpSettings;
  const deliveries = (deliveriesResult.data ?? []) as FailedDelivery[];
  const followUps = (followUpsResult.data ?? []) as IncidentFollowUp[];
  const active = incidents.filter((incident) => incident.incident_status !== "resolved");
  const attentionItems = deriveIncidentAttention({ incidents, settings, deliveries, followUps });
  const failedDeliveries = attentionItems.flatMap((item) => item.failedDelivery ? [item.failedDelivery] : []);
  const ageFollowUps = attentionItems.filter((item) => item.reasons.includes("overdue")).map((item) => item.incident);
  const locationSummary = groupIncidentsByLocation(active, "exact");

  return {
    incidents,
    active,
    attentionItems,
    followUps,
    counts: {
      active: active.length,
      critical: active.filter((incident) => incident.priority === "critical").length,
      received: active.filter((incident) => incident.incident_status === "received").length,
      verified: active.filter((incident) => incident.incident_status === "verified").length,
      assigned: active.filter((incident) => incident.incident_status === "assigned").length,
      unassigned: active.filter(requiresAssignment).length,
      dispatched: active.filter((incident) => incident.incident_status === "dispatched").length,
      inProgress: active.filter((incident) => incident.incident_status === "in_progress").length,
      resolved: incidents.filter((incident) => incident.incident_status === "resolved").length,
      followUp: attentionItems.length,
      criticalFollowUp: attentionItems.filter((item) => item.incident.priority === "critical").length,
      communicationFollowUp: attentionItems.filter((item) => item.reasons.includes("communication_failed")).length,
      overdueFollowUp: attentionItems.filter((item) => item.reasons.includes("overdue")).length,
    },
    failedDeliveries,
    ageFollowUps,
    locationSummary,
    recentMessages: messagesResult.data ?? [],
    followUpSettingsConfigured: Boolean(settings?.received_after_hours || settings?.assigned_after_hours || settings?.dispatched_after_hours),
  };
}
