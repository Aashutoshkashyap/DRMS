import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessageToConversation: vi.fn(async () => ({ messageId: "local-message", whatsappMessageId: "wamid.bot" })),
  createIncidentRequest: vi.fn(async () => ({ id: "deal-1", request_id: "DRMS-ABC123", category: "rescue", incident_status: "received", assigned_team: null, assigned_resource: null, conversation_id: "conversation-1" })),
  findCitizenIncident: vi.fn(async () => null),
}));

vi.mock("./send-message", () => ({ sendMessageToConversation: mocks.sendMessageToConversation }));
vi.mock("@/lib/incidents/request-service", () => ({ createIncidentRequest: mocks.createIncidentRequest, findCitizenIncident: mocks.findCitizenIncident }));

import { handleWhatsAppEmergencyInbound } from "./emergency-interface";

type Session = { id: string; state: string; collected_data: Record<string, unknown>; active_request_id: string | null; last_inbound_message_id: string | null } | null;

function sessionDb() {
  let session: Session = null;
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: session, error: null }),
        insert: (row: Record<string, unknown>) => {
          session = { id: "session-1", state: "start", collected_data: {}, active_request_id: null, last_inbound_message_id: null, ...row } as Session;
          return builder;
        },
        single: async () => ({ data: session, error: null }),
        update: (update: Record<string, unknown>) => {
          session = { ...session!, ...update };
          return builder;
        },
      };
      if (table !== "communication_sessions") throw new Error(`Unexpected table ${table}`);
      return builder;
    },
  } as never;
}

describe("WhatsApp emergency adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates one rescue request and sends its database Request ID", async () => {
    const db = sessionDb();
    const base = { db, accountId: "account-1", userId: "owner-1", contactId: "contact-1", conversationId: "conversation-1" };

    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m1", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m2", input: { interactionId: "emergency:service:rescue" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m3", input: { text: "Sita Rai" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m4", input: { text: "Bhaktapur Ward 5" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m5", input: { text: "3" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m6", input: { text: "Trapped after landslide" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m7", input: { interactionId: "emergency:confirm" } });

    expect(mocks.createIncidentRequest).toHaveBeenCalledTimes(1);
    expect(mocks.createIncidentRequest).toHaveBeenCalledWith(db, expect.objectContaining({ category: "rescue", requesterName: "Sita Rai", peopleAffected: 3 }));
    expect(mocks.sendMessageToConversation).toHaveBeenLastCalledWith(db, "account-1", expect.objectContaining({ senderType: "bot", contentText: expect.stringContaining("DRMS-ABC123") }));

    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m7", input: { interactionId: "emergency:confirm" } });
    expect(mocks.createIncidentRequest).toHaveBeenCalledTimes(1);
  });

  it("continues an OpenWA numeric service selection through to one request", async () => {
    const db = sessionDb();
    const base = {
      db,
      accountId: "account-1",
      userId: "owner-1",
      contactId: "contact-1",
      conversationId: "conversation-1",
      transport: "openwa" as const,
    };

    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m1", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m2", input: { text: "1" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m3", input: { text: "Sita Rai" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m4", input: { text: "Bhaktapur Ward 5" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m5", input: { text: "3" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m6", input: { text: "Trapped after landslide" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m7", input: { text: "YES" } });

    expect(mocks.createIncidentRequest).toHaveBeenCalledTimes(1);
    expect(mocks.createIncidentRequest).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ category: "rescue", requesterName: "Sita Rai", peopleAffected: 3 }),
    );
    expect(mocks.sendMessageToConversation).toHaveBeenLastCalledWith(
      db,
      "account-1",
      expect.objectContaining({ contentText: expect.stringContaining("DRMS-ABC123") }),
    );
  });

  it("uses a WhatsApp map pin as the incident location and preserves its coordinates", async () => {
    const db = sessionDb();
    const base = {
      db,
      accountId: "account-1",
      userId: "owner-1",
      contactId: "contact-1",
      conversationId: "conversation-1",
      transport: "openwa" as const,
    };

    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m1", input: { text: "START" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m2", input: { text: "1" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m3", input: { text: "Sita Rai" } });
    await handleWhatsAppEmergencyInbound({
      ...base,
      inboundMessageId: "m4",
      input: { location: { latitude: 27.7172, longitude: 85.324, name: "Kathmandu Durbar Square" } },
    });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m5", input: { text: "3" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m6", input: { text: "Trapped after landslide" } });
    await handleWhatsAppEmergencyInbound({ ...base, inboundMessageId: "m7", input: { text: "YES" } });

    expect(mocks.createIncidentRequest).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        location: "Kathmandu Durbar Square",
        latitude: 27.7172,
        longitude: 85.324,
      }),
    );
  });

  it("keeps non-emergency WhatsApp conversations on the existing path", async () => {
    const result = await handleWhatsAppEmergencyInbound({ db: sessionDb(), accountId: "account-1", userId: "owner-1", contactId: "contact-1", conversationId: "conversation-1", inboundMessageId: "ordinary", input: { text: "Hello there" } });
    expect(result).toEqual({ consumed: false });
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });
});
