import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChannelInboundMessage } from "@/lib/communications/channel";
import {
  createIncidentRequest,
  findCitizenIncident,
  findPossibleRelatedIncidents,
  type IncidentRequestSummary,
} from "@/lib/incidents/request-service";
import { BILINGUAL_EMERGENCY_OPENING, classifyCitizenLanguage, isExplicitEmergencyTrigger } from "@/lib/incidents/emergency-entry";
import { sendMessageToConversation } from "./send-message";

type SessionRow = {
  id: string;
  state: string;
  collected_data: Record<string, unknown>;
  active_request_id: string | null;
  last_inbound_message_id: string | null;
};

export interface WhatsAppEmergencyInbound {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  conversationId: string;
  inboundMessageId: string;
  /** Internal CRM message id, used to link supplied evidence to the request. */
  inboundDatabaseMessageId?: string | null;
  sourceWhatsAppConfigId?: string | null;
  inboundContentType?: "text" | "image" | "audio" | "location" | "document" | "video";
  knownRequesterName?: string | null;
  transport?: "meta" | "openwa";
  input: ChannelInboundMessage;
}

async function sendReply(db: SupabaseClient, accountId: string, conversationId: string, body: string) {
  await sendMessageToConversation(db, accountId, { conversationId, messageType: "text", contentText: body, senderType: "bot" });
}

function normalized(text: string | null | undefined) {
  return (text ?? "").trim().replace(/\s+/g, " ");
}

function requestIdFromStatus(text: string): string | null {
  const match = /\b(?:status\s+)?(DR(?:MS)?-[A-Z0-9-]+)\b/i.exec(text);
  return match?.[1]?.toUpperCase() ?? null;
}

function statusText(request: IncidentRequestSummary): string {
  const status = request.incident_status.replaceAll("_", " ").toUpperCase();
  return `Request ${request.request_id}\nStatus: ${status}\n\nLast updated: ${new Date(request.updated_at ?? request.created_at ?? Date.now()).toLocaleString()}`;
}

async function loadSession(db: SupabaseClient, accountId: string, conversationId: string) {
  const { data, error } = await db.from("communication_sessions")
    .select("id,state,collected_data,active_request_id,last_inbound_message_id")
    .eq("account_id", accountId).eq("conversation_id", conversationId).eq("channel", "whatsapp").maybeSingle();
  if (error) throw new Error(`Could not load emergency session: ${error.message}`);
  return data as SessionRow | null;
}

async function saveSession(
  db: SupabaseClient,
  input: Pick<WhatsAppEmergencyInbound, "accountId" | "contactId" | "conversationId" | "inboundMessageId">,
  session: SessionRow | null,
  state: string,
  activeRequestId?: string | null,
  collectedData?: Record<string, unknown>,
) {
  const payload = { state, last_inbound_message_id: input.inboundMessageId, ...(activeRequestId === undefined ? {} : { active_request_id: activeRequestId }), ...(collectedData === undefined ? {} : { collected_data: collectedData }) };
  if (session) {
    const { error } = await db.from("communication_sessions").update(payload).eq("id", session.id);
    if (error) throw new Error(`Could not save emergency session: ${error.message}`);
    return;
  }
  const { error } = await db.from("communication_sessions").insert({ account_id: input.accountId, contact_id: input.contactId, conversation_id: input.conversationId, channel: "whatsapp", ...payload });
  if (error) throw new Error(`Could not create emergency session: ${error.message}`);
}

/** Minimal deterministic, one-message citizen intake. Persistence and provider
 * idempotency happen before this adapter, so unmatched messages remain in the
 * shared inbox and a webhook replay cannot create a second request. */
export async function handleWhatsAppEmergencyInbound(input: WhatsAppEmergencyInbound): Promise<{ consumed: boolean }> {
  const originalText = input.input.text ?? "";
  const text = normalized(originalText);
  const command = text.toUpperCase();
  const isStart = isExplicitEmergencyTrigger(text);
  const isStop = ["STOP", "/STOP"].includes(command);
  const isStatus = command === "STATUS" || /^STATUS\s+DR(?:MS)?-[A-Z0-9-]+$/i.test(text);
  const asksForId = ["REQUEST ID", "REQUEST_ID", "ID"].includes(command);
  const session = await loadSession(input.db, input.accountId, input.conversationId);
  if (session?.last_inbound_message_id === input.inboundMessageId) return { consumed: true };

  if (isStart) {
    await saveSession(input.db, input, session, "awaiting_request", null);
    await sendReply(input.db, input.accountId, input.conversationId, BILINGUAL_EMERGENCY_OPENING);
    return { consumed: true };
  }
  if (isStop) {
    await saveSession(input.db, input, session, "stopped", null);
    await sendReply(input.db, input.accountId, input.conversationId, "Emergency request capture has been stopped. Send START whenever you need to create a new request.");
    return { consumed: true };
  }
  if (asksForId) {
    await sendReply(input.db, input.accountId, input.conversationId, "Send STATUS DR-XXXXXX to check a request you created from this WhatsApp number.");
    return { consumed: true };
  }
  if (isStatus) {
    const request = await findCitizenIncident(input.db, input.accountId, input.contactId, requestIdFromStatus(text) ?? undefined);
    await saveSession(input.db, input, session, request ? "waiting_for_coordinator" : (session?.state ?? "start"), request?.id ?? undefined);
    await sendReply(input.db, input.accountId, input.conversationId, request ? statusText(request) : "No matching request was found for this WhatsApp number. Send STATUS followed by your Request ID.");
    return { consumed: true };
  }

  // A citizen must explicitly enter capture. Other content remains available
  // to a human and existing explicitly configured deterministic workflows.
  if (!session || session.state !== "awaiting_request") return { consumed: false };
  const location = input.input.location;
  const hasEvidence = Boolean(text || location || (input.inboundContentType && input.inboundContentType !== "text"));
  if (!hasEvidence) return { consumed: false };
  const locationText = location ? location.name ?? location.address ?? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : "Information missing";
  const request = await createIncidentRequest(input.db, {
    accountId: input.accountId, userId: input.userId, contactId: input.contactId, conversationId: input.conversationId,
    requesterName: normalized(input.knownRequesterName) || "WhatsApp citizen", category: "information", location: locationText,
    peopleAffected: 0, priority: "medium", description: originalText || `Information missing — ${input.inboundContentType ?? "media"} evidence received.`,
    latitude: location?.latitude ?? null, longitude: location?.longitude ?? null,
    sourceWhatsAppConfigId: input.sourceWhatsAppConfigId ?? null, sourceMessageId: input.inboundDatabaseMessageId ?? null,
  });
  await saveSession(input.db, input, session, "waiting_for_coordinator", request.id, {
    ...(session?.collected_data ?? {}), language: classifyCitizenLanguage(originalText),
  });
  const related = await findPossibleRelatedIncidents(input.db, input.accountId, request.id).catch(() => []);
  const relatedLine = related[0] ? "\n\nYour request may relate to an existing response in this area. We will continue to update you here." : "";
  await sendReply(input.db, input.accountId, input.conversationId, `Request received.\n\nRequest ID: ${request.request_id}\n\nOur response team will review your request. You will receive updates here.${relatedLine}`);
  return { consumed: true };
}
