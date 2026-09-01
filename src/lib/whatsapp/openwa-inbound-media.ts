import crypto from "node:crypto";

import { MEDIA_MAX_BYTES, buildMediaPath } from "@/lib/storage/upload-media";

export const OPENWA_INBOUND_BUCKET = "chat-media";
export const OPENWA_INBOUND_FOLDER = "openwa-inbound";

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const AUDIO_MIME_TYPES = new Set(["audio/ogg", "audio/opus", "audio/mpeg", "audio/aac", "audio/mp4", "audio/amr"]);

type OpenWaStorage = {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array | Buffer,
      options: { contentType: string; cacheControl: string; upsert: boolean },
    ): Promise<{ error: { message: string } | null }>;
    getPublicUrl(path: string): { data: { publicUrl: string } };
  };
};

export type OpenWaInboundImage = {
  bytes: Buffer;
  mimeType: string;
  caption: string | null;
};
export type OpenWaInboundAudio = { bytes: Buffer; mimeType: string };

function normalizedImageMime(value: string | null | undefined): string | null {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mime && IMAGE_MIME_TYPES.has(mime) ? mime : null;
}

function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/**
 * OpenWA gateways may send a media body as a data URL or as bare base64.
 * Decode only image bytes we can identify — never persist the base64 string
 * as a CRM text message or accept an arbitrary blob as evidence.
 */
export function decodeOpenWaInboundImage(input: {
  body?: string | null;
  mimeType?: string | null;
  caption?: string | null;
}): OpenWaInboundImage | null {
  const source = input.body?.trim();
  if (!source) return null;

  const dataUrl = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(source);
  const encoded = (dataUrl?.[2] ?? source).replace(/\s/g, "");
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;

  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MEDIA_MAX_BYTES) return null;

  const sniffed = sniffImageMime(bytes);
  if (!sniffed) return null;
  const declared = normalizedImageMime(dataUrl?.[1] ?? input.mimeType);
  if (declared && declared !== sniffed) return null;

  return {
    bytes,
    mimeType: sniffed,
    caption: input.caption?.trim() || null,
  };
}

function extensionForImageMime(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "jpg";
  }
}

function decodeBase64(input: string | null | undefined): { bytes: Buffer; declaredMime: string | null } | null {
  const source = input?.trim();
  if (!source) return null;
  const dataUrl = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(source);
  const encoded = (dataUrl?.[2] ?? source).replace(/\s/g, "");
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MEDIA_MAX_BYTES) return null;
  return { bytes, declaredMime: dataUrl?.[1]?.split(";", 1)[0]?.trim().toLowerCase() ?? null };
}

/** Decode only bucket-approved voice/audio types. Audio often lacks a reliable
 * magic signature, so both the declared MIME type and bounded base64 payload
 * are required; unknown types are retained as an inbox message but not stored. */
export function decodeOpenWaInboundAudio(input: { body?: string | null; mimeType?: string | null }): OpenWaInboundAudio | null {
  const decoded = decodeBase64(input.body);
  const mimeType = (decoded?.declaredMime ?? input.mimeType?.split(";", 1)[0]?.trim().toLowerCase()) || null;
  if (!decoded || !mimeType || !AUDIO_MIME_TYPES.has(mimeType)) return null;
  return { bytes: decoded.bytes, mimeType };
}

function extensionForAudioMime(mimeType: string) {
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/mp4") return "m4a";
  if (mimeType === "audio/aac") return "aac";
  if (mimeType === "audio/amr") return "amr";
  return "ogg";
}

/** Store a gateway-delivered image in the existing account-scoped CRM bucket. */
export async function storeOpenWaInboundImage(input: {
  storage: OpenWaStorage;
  accountId: string;
  messageId: string;
  image: OpenWaInboundImage;
}): Promise<string | null> {
  const id = crypto.createHash("sha256").update(input.messageId).digest("hex").slice(0, 20);
  const path = buildMediaPath(
    input.accountId,
    `openwa-${id}.${extensionForImageMime(input.image.mimeType)}`,
    null,
    OPENWA_INBOUND_FOLDER,
  );
  const { error } = await input.storage.from(OPENWA_INBOUND_BUCKET).upload(path, input.image.bytes, {
    contentType: input.image.mimeType,
    cacheControl: "3600",
    upsert: true,
  });
  if (error) {
    console.warn("[openwa] inbound image storage failed:", error.message);
    return null;
  }
  const { data } = input.storage.from(OPENWA_INBOUND_BUCKET).getPublicUrl(path);
  return data.publicUrl || null;
}

export async function storeOpenWaInboundAudio(input: { storage: OpenWaStorage; accountId: string; messageId: string; audio: OpenWaInboundAudio }): Promise<string | null> {
  const id = crypto.createHash("sha256").update(input.messageId).digest("hex").slice(0, 20);
  const path = buildMediaPath(input.accountId, `openwa-${id}.${extensionForAudioMime(input.audio.mimeType)}`, null, OPENWA_INBOUND_FOLDER);
  const { error } = await input.storage.from(OPENWA_INBOUND_BUCKET).upload(path, input.audio.bytes, { contentType: input.audio.mimeType, cacheControl: "3600", upsert: true });
  if (error) { console.warn("[openwa] inbound audio storage failed:", error.message); return null; }
  const { data } = input.storage.from(OPENWA_INBOUND_BUCKET).getPublicUrl(path);
  return data.publicUrl || null;
}
