import { describe, expect, it } from "vitest";

import { parseOpenWaInboundPayload, type OpenWaWebhookEvent } from "./openwa";

function event(data: OpenWaWebhookEvent["data"]): OpenWaWebhookEvent {
  return { event: "message.received", sessionId: "session", idempotencyKey: "key", deliveryId: "delivery", timestamp: "2026-08-31T00:00:00.000Z", data };
}

describe("parseOpenWaInboundPayload", () => {
  it("turns an OpenWA map pin into CRM-safe coordinates and display text", () => {
    expect(parseOpenWaInboundPayload(event({
      id: "location-1", type: "location", lat: 27.7172, lng: 85.324,
      loc: "Kathmandu Durbar Square", address: "Kathmandu, Nepal",
    }))).toEqual({
      contentType: "location",
      contentText: "Kathmandu Durbar Square - Kathmandu, Nepal - 27.7172,85.324",
      location: { latitude: 27.7172, longitude: 85.324, name: "Kathmandu Durbar Square", address: "Kathmandu, Nepal" },
      image: null,
      audio: null,
    });
  });

  it("keeps a gateway image body out of the text channel", () => {
    expect(parseOpenWaInboundPayload(event({ id: "image-1", type: "image", body: "/9j/4AAQ", mimeType: "image/jpeg", caption: "Damaged road" }))).toEqual({
      contentType: "image",
      contentText: "Damaged road",
      location: null,
      image: { body: "/9j/4AAQ", mimeType: "image/jpeg", caption: "Damaged road" },
      audio: null,
    });
  });

  it("keeps an OpenWA voice payload out of message text", () => {
    expect(parseOpenWaInboundPayload(event({ id: "audio-1", type: "voice", body: "T2dnUw==", mimeType: "audio/ogg" }))).toMatchObject({ contentType: "audio", contentText: "", image: null, audio: { mimeType: "audio/ogg" } });
  });
});
