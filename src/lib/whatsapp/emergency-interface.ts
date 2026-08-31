import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelInboundMessage, ChannelReply } from "@/lib/communications/channel";
import { createIncidentRequest, findCitizenIncident, type IncidentRequestSummary } from "@/lib/incidents/request-service";
import {
  hasDeterministicEmergencyIntent,
  incidentPriority,
  isUsableCitizenName,
  transitionIntake,
  type ChannelPrompt,
  type IntakeData,
  type IntakeState,
} from "@/lib/incidents/intake-state-machine";
import { sendMessageToConversation } from "./send-message";
import { findNearestVerifiedLocations } from "@/lib/resources/nearby-information";

type SessionRow = {
  id: string;
  state: IntakeState;
  collected_data: IntakeData;
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
  /** Existing contact name, only for this same conversation/account. */
  knownRequesterName?: string | null;
  /** OpenWA's MVP transport accepts text, so it uses deterministic numeric
   * and YES/NO fallbacks for the existing menu/confirmation prompts. */
  transport?: "meta" | "openwa";
  input: ChannelInboundMessage;
}

function isExplicitEmergencyStart(input: ChannelInboundMessage): boolean {
  const value = (input.interactionId ?? input.text ?? "").trim().toLowerCase();
  return value === "start" || value === "help" || value === "/start" || value === "emergency" || value.startsWith("emergency:");
}

function asWhatsAppReply(prompt: ChannelPrompt): ChannelReply {
  return prompt;
}

async function sendReply(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  prompt: ChannelReply,
  transport: "meta" | "openwa" = "meta",
) {
  if (transport === "openwa" && prompt.kind !== "text") {
    const rows = prompt.sections?.flatMap((section) => section.rows) ?? [];
    const isPeoplePicker = rows.some((row) => row.id.startsWith("emergency:people:"));
    const fallback = prompt.kind === "buttons"
      ? `${prompt.body}\n\n${prompt.buttons?.map((button, index) => `${index + 1}. ${button.title}`).join("\n") ?? ""}\n\nReply with a number.`
      : isPeoplePicker
        ? `${prompt.body}\n\nReply with the exact number of people affected.`
        : `${prompt.body}\n\n${rows.map((row, index) => `${index + 1}. ${row.title}${row.description ? ` — ${row.description}` : ""}`).join("\n")}\n\nReply with a number.`;
    await sendMessageToConversation(db, accountId, { conversationId, messageType: "text", contentText: fallback, senderType: "bot" });
    return;
  }
  if (prompt.kind === "text") {
    await sendMessageToConversation(db, accountId, { conversationId, messageType: "text", contentText: prompt.body, senderType: "bot" });
    return;
  }
  if (prompt.kind === "buttons") {
    await sendMessageToConversation(db, accountId, {
      conversationId,
      messageType: "interactive",
      senderType: "bot",
      interactivePayload: { kind: "buttons", body: prompt.body, buttons: prompt.buttons ?? [] },
    });
    return;
  }
  await sendMessageToConversation(db, accountId, {
    conversationId,
    messageType: "interactive",
    senderType: "bot",
    interactivePayload: { kind: "list", body: prompt.body, button_label: "Choose service", sections: prompt.sections ?? [] },
  });
}

function normalizeOpenWaInput(
  state: IntakeState | null,
  input: ChannelInboundMessage,
): ChannelInboundMessage {
  const value = input.text?.trim().toLowerCase();
  if (!value || input.interactionId) return input;
  if (!state || state === "start" || state === "edit_service") {
    const choice: Record<string, string> = {
      "1": "emergency:service:rescue",
      "2": "emergency:service:food_water",
      "3": "emergency:service:medicine",
      "4": "emergency:service:shelter",
      "5": "emergency:service:missing_person",
      "6": "emergency:service:information",
      "7": "emergency:status",
    };
    if (choice[value]) return { ...input, interactionId: choice[value] };
  }
  if (state === "confirm_request") {
    if (value === "1") return { ...input, interactionId: "emergency:confirm" };
    if (value === "2") return { ...input, interactionId: "emergency:edit" };
    if (value === "3") return { ...input, interactionId: "emergency:cancel" };
    if (["yes", "y", "submit", "confirm"].includes(value)) return { ...input, interactionId: "emergency:confirm" };
    if (["no", "n", "cancel"].includes(value)) return { ...input, interactionId: "emergency:cancel" };
  }
  if (state === "edit_menu") {
    const choices: Record<string, string> = {
      "1": "emergency:edit:service", "2": "emergency:edit:location", "3": "emergency:edit:people",
      "4": "emergency:edit:details", "5": "emergency:cancel",
    };
    if (choices[value]) return { ...input, interactionId: choices[value] };
  }
  if (state === "restart_choice") {
    const choices: Record<string, string> = { "1": "emergency:restart", "2": "emergency:continue", "3": "emergency:cancel" };
    if (choices[value]) return { ...input, interactionId: choices[value] };
  }
  return input;
}

function statusText(request: IncidentRequestSummary): string {
  const status = request.incident_status.replaceAll("_", " ").toUpperCase();
  return `Request ${request.request_id}\nService: ${request.category.replaceAll("_", " ")}\nStatus: ${status}`;
}

async function loadSession(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<SessionRow | null> {
  const { data, error } = await db
    .from("communication_sessions")
    .select("id,state,collected_data,active_request_id,last_inbound_message_id")
    .eq("account_id", accountId)
    .eq("conversation_id", conversationId)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (error) throw new Error(`Could not load emergency session: ${error.message}`);
  return (data as SessionRow | null) ?? null;
}

async function createSession(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId: string,
): Promise<SessionRow> {
  const { data: created, error: createError } = await db
    .from("communication_sessions")
    .insert({ account_id: accountId, contact_id: contactId, conversation_id: conversationId, channel: "whatsapp" })
    .select("id,state,collected_data,active_request_id,last_inbound_message_id")
    .single();
  if (createError || !created) throw new Error(`Could not create emergency session: ${createError?.message ?? "unknown error"}`);
  return created as SessionRow;
}

async function saveSession(
  db: SupabaseClient,
  sessionId: string,
  state: IntakeState,
  data: IntakeData,
  inboundMessageId: string,
  activeRequestId?: string | null,
) {
  const update: Record<string, unknown> = { state, collected_data: data, last_inbound_message_id: inboundMessageId };
  if (activeRequestId !== undefined) update.active_request_id = activeRequestId;
  const { error } = await db.from("communication_sessions").update(update).eq("id", sessionId);
  if (error) throw new Error(`Could not save emergency session: ${error.message}`);
}

/**
 * WhatsApp channel adapter for the deterministic, transport-neutral intake
 * state machine. The inbound webhook has already persisted the customer
 * message before this runs, so a Meta replay cannot create a second request.
 */
export async function handleWhatsAppEmergencyInbound(input: WhatsAppEmergencyInbound): Promise<{ consumed: boolean }> {
  const transport = input.transport ?? "meta";
  let session = await loadSession(input.db, input.accountId, input.conversationId);
  // OpenWA renders the list and confirmation prompts as deterministic text
  // fallbacks. Normalize those replies *before* checking whether this is an
  // emergency start/continuation: otherwise its documented "Reply with a
  // number" response is rejected while the persisted session is still in
  // `start`, so the conversation can never advance past the first message.
  const channelInput = transport === "openwa"
    ? normalizeOpenWaInput(session?.state ?? null, input.input)
    : input.input;
  const beginsEmergencyIntake = isExplicitEmergencyStart(channelInput) || hasDeterministicEmergencyIntent(channelInput.text);
  if (!session && !beginsEmergencyIntake) return { consumed: false };
  session ??= await createSession(input.db, input.accountId, input.contactId, input.conversationId);
  if (session.last_inbound_message_id === input.inboundMessageId) return { consumed: true };
  const sessionData = session.collected_data ?? {};
  const dataWithKnownName = !isUsableCitizenName(sessionData.requesterName) && isUsableCitizenName(input.knownRequesterName)
    ? { ...sessionData, requesterName: input.knownRequesterName!.trim() }
    : sessionData;
  const activeSession = session.state !== "start" && session.state !== "waiting_for_coordinator";
  if (!activeSession && !beginsEmergencyIntake) return { consumed: false };
  const locationText = channelInput.location
    ? channelInput.location.name ?? channelInput.location.address ?? `${channelInput.location.latitude.toFixed(5)}, ${channelInput.location.longitude.toFixed(5)}`
    : channelInput.text;
  const transition = transitionIntake(session.state, dataWithKnownName, {
    text: locationText,
    interactionId: channelInput.interactionId,
    latitude: channelInput.location?.latitude,
    longitude: channelInput.location?.longitude,
  });
  if (!transition) return { consumed: false };

  if (transition.action === "create_request") {
    const data = transition.data;
    if (!data.category || !data.requesterName || !data.location || !data.description || !data.peopleAffected) {
      await saveSession(input.db, session.id, "start", {}, input.inboundMessageId);
      await sendReply(input.db, input.accountId, input.conversationId, { kind: "text", body: "Your request details were incomplete. Reply START to begin again." }, transport);
      return { consumed: true };
    }
    const request = await createIncidentRequest(input.db, {
      accountId: input.accountId,
      userId: input.userId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      requesterName: data.requesterName,
      category: data.category,
      location: data.location,
      peopleAffected: data.peopleAffected,
      priority: incidentPriority(data),
      description: data.description,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
    });
    await saveSession(input.db, session.id, "waiting_for_coordinator", data, input.inboundMessageId, request.id);
    await sendReply(input.db, input.accountId, input.conversationId, { kind: "text", body: `✅ Request received.\n\nRequest ID: ${request.request_id}\n\nWe are checking your request. Please keep this number for reference.` }, transport);
    if (data.category === "information" && data.latitude != null && data.longitude != null) {
      const nearby = await findNearestVerifiedLocations(input.db, input.accountId, { latitude: data.latitude, longitude: data.longitude });
      const lines = [
        nearby.reliefCenter && `Nearest available relief center: ${nearby.reliefCenter.name} (${nearby.reliefCenter.distanceKm.toFixed(1)} km)`,
        nearby.shelter && `Nearest available shelter: ${nearby.shelter.name} (${nearby.shelter.distanceKm.toFixed(1)} km)`,
        nearby.medicalFacility && `Nearest medical facility: ${nearby.medicalFacility.name} (${nearby.medicalFacility.distanceKm.toFixed(1)} km)`,
      ].filter(Boolean);
      if (lines.length) await sendReply(input.db, input.accountId, input.conversationId, { kind: "text", body: lines.join("\n") }, transport);
    }
    return { consumed: true };
  }

  if (transition.action === "check_active_request" || transition.action === "check_request_id") {
    const request = await findCitizenIncident(
      input.db,
      input.accountId,
      input.contactId,
      transition.action === "check_request_id" ? transition.data.description : undefined,
    );
    if (request) {
      await saveSession(input.db, session.id, "waiting_for_coordinator", transition.data, input.inboundMessageId, request.id);
      await sendReply(input.db, input.accountId, input.conversationId, { kind: "text", body: statusText(request) }, transport);
    } else if (transition.action === "check_active_request") {
      await saveSession(input.db, session.id, "collect_request_id", transition.data, input.inboundMessageId);
      await sendReply(input.db, input.accountId, input.conversationId, { kind: "text", body: "No active request was found for this WhatsApp number. Enter your Request ID." }, transport);
    } else {
      await saveSession(input.db, session.id, "collect_request_id", transition.data, input.inboundMessageId);
      await sendReply(input.db, input.accountId, input.conversationId, { kind: "text", body: "That Request ID was not found for this WhatsApp number. Check it and try again." }, transport);
    }
    return { consumed: true };
  }

  await saveSession(input.db, session.id, transition.state, transition.data, input.inboundMessageId);
  await sendReply(input.db, input.accountId, input.conversationId, asWhatsAppReply(transition.prompt), transport);
  return { consumed: true };
}
