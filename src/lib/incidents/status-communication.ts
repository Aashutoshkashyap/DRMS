import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncidentStatus } from "@/types";
import { sendMessageToConversation } from "@/lib/whatsapp/send-message";
import { recordHealthFailure, recordHealthRecovery } from "@/lib/operations/health";

type IncidentRow = {
  id: string;
  request_id: string;
  incident_status: IncidentStatus;
  assigned_team: string | null;
  assigned_resource: string | null;
  conversation_id: string | null;
};

function statusLabel(status: IncidentStatus): string {
  return status.replaceAll("_", " ").toUpperCase();
}

async function verifiedAssignmentLines(db: SupabaseClient, accountId: string, incident: IncidentRow): Promise<string[]> {
  const lines: string[] = [];
  if (incident.assigned_team) {
    const { data } = await db.from("response_teams").select("name").eq("account_id", accountId).eq("name", incident.assigned_team).maybeSingle();
    if (data) lines.push(`Team: ${data.name}`);
  }
  if (incident.assigned_resource) {
    const { data } = await db.from("vehicles").select("identifier, vehicle_type").eq("account_id", accountId).eq("identifier", incident.assigned_resource).maybeSingle();
    if (data) lines.push(`Vehicle: ${data.vehicle_type} (${data.identifier})`);
  }
  return lines;
}

export async function formatIncidentStatusMessage(
  db: SupabaseClient,
  accountId: string,
  incident: IncidentRow,
): Promise<string> {
  const request = incident.request_id;
  switch (incident.incident_status) {
    case "received": return `✅ Request ${request} has been received.`;
    case "verified": return `🟡 Request ${request} has been verified.`;
    case "assigned": {
      const lines = await verifiedAssignmentLines(db, accountId, incident);
      return [`👥 A response team has been assigned to request ${request}.`, ...lines].join("\n");
    }
    case "dispatched": {
      const lines = await verifiedAssignmentLines(db, accountId, incident);
      return [`🚑 Response dispatched for request ${request}.`, ...lines].join("\n");
    }
    case "in_progress": return `🟢 Response team is handling request ${request}.`;
    case "resolved": return `✅ Request ${request} has been resolved.`;
    default: return `Request ${request} status: ${statusLabel(incident.incident_status)}.`;
  }
}

/** Deliver one queued status update. Status and assignment data are read from
 * the database at send time; this service never infers dispatch or resources. */
export async function deliverIncidentStatusUpdate(
  db: SupabaseClient,
  accountId: string,
  dealId: string,
): Promise<{ delivered: boolean; reason?: string }> {
  const { data: incidentData, error: incidentError } = await db
    .from("deals")
    .select("id,request_id,incident_status,assigned_team,assigned_resource,conversation_id")
    .eq("account_id", accountId)
    .eq("id", dealId)
    .maybeSingle();
  if (incidentError) throw new Error(`Could not load incident: ${incidentError.message}`);
  if (!incidentData || !incidentData.conversation_id) return { delivered: false, reason: "no_conversation" };
  const incident = incidentData as IncidentRow;
  if (!incident.conversation_id) return { delivered: false, reason: "no_conversation" };
  const conversationId = incident.conversation_id;

  const { data: delivery, error: deliveryError } = await db
    .from("incident_status_deliveries")
    .select("id, delivery_status")
    .eq("deal_id", dealId)
    .eq("channel", "whatsapp")
    .eq("incident_status", incident.incident_status)
    .maybeSingle();
  if (deliveryError) throw new Error(`Could not load status delivery: ${deliveryError.message}`);
  if (!delivery) return { delivered: false, reason: "not_queued" };
  if (delivery.delivery_status === "sent") return { delivered: true, reason: "already_sent" };

  try {
    const contentText = await formatIncidentStatusMessage(db, accountId, incident);
    const result = await sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: "text",
      contentText,
      senderType: "bot",
    });
    const { error } = await db.from("incident_status_deliveries").update({
      delivery_status: "sent",
      whatsapp_message_id: result.whatsappMessageId,
      sent_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", delivery.id);
    if (error) throw new Error(`Could not record status delivery: ${error.message}`);
    await recordHealthRecovery(db, accountId, "outbound");
    return { delivered: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown WhatsApp delivery failure";
    await db.from("incident_status_deliveries").update({ delivery_status: "failed", error_message: message }).eq("id", delivery.id);
    await recordHealthFailure(db, accountId, "outbound", "WhatsApp communication unavailable; citizen notification failed.");
    throw error;
  }
}

/** Coordinator-only retry claim. A failed row is atomically returned to the
 * existing pending outbox state before the normal delivery service is used.
 * A second click cannot claim the same failed row, so it cannot create a
 * second explicit retry. There is deliberately no background retry loop. */
export async function retryFailedIncidentStatusUpdate(
  db: SupabaseClient,
  accountId: string,
  dealId: string,
): Promise<{ delivered: boolean; reason?: string }> {
  const { data: incident, error: incidentError } = await db
    .from("deals")
    .select("incident_status")
    .eq("account_id", accountId)
    .eq("id", dealId)
    .maybeSingle();
  if (incidentError) throw new Error(`Could not load incident: ${incidentError.message}`);
  if (!incident) return { delivered: false, reason: "not_found" };

  const { data: failedDelivery, error: deliveryError } = await db
    .from("incident_status_deliveries")
    .select("id,delivery_status")
    .eq("deal_id", dealId)
    .eq("channel", "whatsapp")
    .eq("incident_status", incident.incident_status)
    .maybeSingle();
  if (deliveryError) throw new Error(`Could not load status delivery: ${deliveryError.message}`);
  if (!failedDelivery || failedDelivery.delivery_status !== "failed") return { delivered: false, reason: "not_failed" };

  const { data: claimed, error: claimError } = await db
    .from("incident_status_deliveries")
    .update({ delivery_status: "pending", error_message: null })
    .eq("id", failedDelivery.id)
    .eq("delivery_status", "failed")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(`Could not request delivery retry: ${claimError.message}`);
  if (!claimed) return { delivered: false, reason: "retry_in_progress" };

  return deliverIncidentStatusUpdate(db, accountId, dealId);
}
