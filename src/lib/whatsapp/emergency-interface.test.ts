import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessageToConversation: vi.fn(async () => ({ messageId: "local-message", whatsappMessageId: "wamid.bot" })),
  createIncidentRequest: vi.fn(async () => ({ id: "deal-1", request_id: "DRMS-ABC123", category: "information", incident_status: "received", assigned_team: null, assigned_resource: null, conversation_id: "conversation-1", created_at: "2026-09-01T00:00:00Z" })),
  findCitizenIncident: vi.fn(async () => null),
  findPossibleRelatedIncidents: vi.fn(async () => []),
}));
vi.mock("./send-message", () => ({ sendMessageToConversation: mocks.sendMessageToConversation }));
vi.mock("@/lib/incidents/request-service", () => ({ ...mocks }));
import { handleWhatsAppEmergencyInbound } from "./emergency-interface";

type Session = { id: string; state: string; collected_data: Record<string, unknown>; active_request_id: string | null; last_inbound_message_id: string | null } | null;
function sessionDb() {
  let session: Session = null;
  return { from(table: string) {
    const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: session, error: null }),
      insert: (row: Record<string, unknown>) => { session = { id: "session-1", state: "start", collected_data: {}, active_request_id: null, last_inbound_message_id: null, ...row } as Session; return builder; },
      update: (row: Record<string, unknown>) => { session = { ...session!, ...row }; return builder; }, single: async () => ({ data: session, error: null }) };
    if (table !== "communication_sessions") throw new Error(`Unexpected table ${table}`); return builder;
  } } as never;
}
const base = (db = sessionDb()) => ({ db, accountId: "account-1", userId: "owner-1", contactId: "contact-1", conversationId: "conversation-1" });

describe("two-step WhatsApp emergency adapter", () => {
  beforeEach(() => vi.clearAllMocks());
  it("asks for location after the request, then creates one incident", async () => {
    const input = base();
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m1", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m2", knownRequesterName: "Sita Rai", inboundDatabaseMessageId: "message-1", sourceWhatsAppConfigId: "wa-a", input: { text: "People trapped near Ward 5" } });
    expect(mocks.createIncidentRequest).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).toHaveBeenLastCalledWith(input.db, "account-1", expect.objectContaining({ contentText: expect.stringContaining("Now send the location") }));

    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m3", input: { text: "Ward 5, Kathmandu" } });
    expect(mocks.createIncidentRequest).toHaveBeenCalledWith(input.db, expect.objectContaining({ requesterName: "Sita Rai", description: "People trapped near Ward 5", sourceMessageId: "message-1", sourceWhatsAppConfigId: "wa-a" }));
    expect(mocks.sendMessageToConversation).toHaveBeenLastCalledWith(input.db, "account-1", expect.objectContaining({ contentText: expect.stringContaining("DRMS-ABC123") }));
  });
  it("uses a map pin as the required second location step", async () => {
    const input = base();
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m1", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m2", input: { text: "People need food and water" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m3", inboundContentType: "location", input: { location: { latitude: 27.7172, longitude: 85.324, name: "Kathmandu Durbar Square" } } });
    expect(mocks.createIncidentRequest).toHaveBeenCalledWith(input.db, expect.objectContaining({ location: "Kathmandu Durbar Square", latitude: 27.7172, longitude: 85.324 }));
  });
  it("stores photo or voice evidence from the request step before asking for location", async () => {
    const input = base();
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m1", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m2", inboundContentType: "image", inboundDatabaseMessageId: "image-message", input: {} });
    expect(mocks.createIncidentRequest).not.toHaveBeenCalled();
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m3", input: { text: "https://maps.google.com/?q=27.7172,85.3240" } });
    expect(mocks.createIncidentRequest).toHaveBeenCalledWith(input.db, expect.objectContaining({ sourceMessageId: "image-message", description: "Citizen image evidence received." }));
  });
  it("does not create an incident from a location sent before the request", async () => {
    const input = base();
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m1", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m2", inboundContentType: "location", input: { location: { latitude: 27.7172, longitude: 85.324 } } });
    expect(mocks.createIncidentRequest).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).toHaveBeenLastCalledWith(input.db, "account-1", expect.objectContaining({ contentText: expect.stringContaining("describe what happened first") }));
  });
  it("lets the same citizen make a second independent request", async () => {
    const input = base();
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m1", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m2", input: { text: "First request" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m3", input: { text: "First location" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m4", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m5", input: { text: "Second request" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m6", input: { text: "Second location" } });
    expect(mocks.createIncidentRequest).toHaveBeenCalledTimes(2);
  });
  it("does not create a duplicate request when a trigger is repeated during active intake", async () => {
    const input = base();
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m1", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m2", input: { text: "SOS!" } });
    expect(mocks.createIncidentRequest).not.toHaveBeenCalled();

    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m3", input: { text: "People need rescue near Ward 5" } });
    expect(mocks.createIncidentRequest).not.toHaveBeenCalled();
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m4", input: { text: "Ward 5" } });
    expect(mocks.createIncidentRequest).toHaveBeenCalledTimes(1);
  });
  it("idempotently ignores a replayed inbound trigger event", async () => {
    const input = base();
    const event = { ...input, inboundMessageId: "same-message", input: { text: "START" } };
    await handleWhatsAppEmergencyInbound(event);
    await handleWhatsAppEmergencyInbound(event);
    expect(mocks.createIncidentRequest).not.toHaveBeenCalled();
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(1);
  });
  it.each(["START", "start!", "HELP", "SOS!", "EMERGENCY", "RESCUE", "सहयोग", "मद्दत", "उद्धार", "आपतकाल", "आपतकालीन", "sahayog", "maddat", "uddhar", "apatkal", "apatkaal"])("starts the same bilingual intake for %s", async (trigger) => {
    const input = base();
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: `trigger-${trigger}`, input: { text: trigger } });
    expect(mocks.sendMessageToConversation).toHaveBeenCalledWith(input.db, "account-1", expect.objectContaining({ contentText: expect.stringContaining("राहत/उद्धार") }));
  });
  it.each([
    "मेरो घरमा पानी पस्यो",
    "mero ghar ma pani pasyo",
    "Ward 5 मा rescue चाहियो",
  ])("preserves the original citizen text for %s", async (requestText) => {
    const input = base();
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m1", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m2", input: { text: requestText } });
    await handleWhatsAppEmergencyInbound({ ...input, inboundMessageId: "m3", input: { text: "Kathmandu" } });
    expect(mocks.createIncidentRequest).toHaveBeenLastCalledWith(input.db, expect.objectContaining({ description: requestText }));
  });
  it.each(["Hello there", "flood", "water", "fire", "earthquake", "landslide", "ambulance", "hospital", "injured", "पानी", "बाढी", "आगो", "भूकम्प", "पहिरो"])("keeps ordinary content %s in the human/configured path", async (text) => {
    expect(await handleWhatsAppEmergencyInbound({ ...base(), inboundMessageId: `ordinary-${text}`, input: { text } })).toEqual({ consumed: false });
  });
});
