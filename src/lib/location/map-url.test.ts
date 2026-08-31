import { describe, expect, it } from "vitest";

import { mapUrlFromLocationText } from "./map-url";

describe("mapUrlFromLocationText", () => {
  it("links a persisted WhatsApp map pin", () => {
    expect(mapUrlFromLocationText("Kathmandu - 27.7172,85.3240")).toBe(
      "https://www.google.com/maps/search/?api=1&query=27.7172%2C85.324",
    );
  });

  it("does not create a link from an invalid coordinate pair", () => {
    expect(mapUrlFromLocationText("Somewhere - 127.7,185.3")).toBeNull();
  });
});
