import { describe, expect, it } from "vitest";

import {
  OPENWA_INBOUND_BUCKET,
  decodeOpenWaInboundImage,
  storeOpenWaInboundImage,
} from "./openwa-inbound-media";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("OpenWA inbound image handling", () => {
  it("decodes the bare JPEG base64 produced by the connected gateway", () => {
    const image = decodeOpenWaInboundImage({ body: JPEG.toString("base64") });
    expect(image).toMatchObject({ mimeType: "image/jpeg", bytes: JPEG });
  });

  it("rejects non-image base64 rather than allowing it into a text field", () => {
    expect(decodeOpenWaInboundImage({ body: Buffer.from("not a photo").toString("base64") })).toBeNull();
  });

  it("stores a decoded image at a stable account-scoped path", async () => {
    const uploaded: Array<{ bucket: string; path: string; type: string; upsert: boolean }> = [];
    const storage = {
      from(bucket: string) {
        return {
          async upload(path: string, _bytes: Buffer, options: { contentType: string; cacheControl: string; upsert: boolean }) {
            uploaded.push({ bucket, path, type: options.contentType, upsert: options.upsert });
            return { error: null };
          },
          getPublicUrl(path: string) { return { data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }; },
        };
      },
    };
    const image = decodeOpenWaInboundImage({ body: JPEG.toString("base64") })!;
    const result = await storeOpenWaInboundImage({ storage, accountId: "account-1", messageId: "message-1", image });

    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({ bucket: OPENWA_INBOUND_BUCKET, type: "image/jpeg", upsert: true });
    expect(uploaded[0].path).toMatch(/^account-account-1\/openwa-inbound\/openwa-[a-f0-9]{20}\.jpg$/);
    expect(result).toContain("/chat-media/account-account-1/openwa-inbound/");
  });
});
