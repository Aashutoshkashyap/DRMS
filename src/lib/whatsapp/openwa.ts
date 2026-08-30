import crypto from 'node:crypto';

import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';

export type OpenWaSession = {
  id: string;
  status: string;
  phone: string | null;
  lastError?: string | null;
};

export type OpenWaWebhookEvent = {
  event: string;
  sessionId: string;
  idempotencyKey: string;
  deliveryId: string;
  timestamp: string;
  data: {
    id?: string;
    from?: string;
    to?: string;
    chatId?: string;
    body?: string;
    type?: string;
    timestamp?: number;
    fromMe?: boolean;
    isGroup?: boolean;
  };
};

function requiredEnv(name: 'OPENWA_BASE_URL' | 'OPENWA_API_KEY'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/** OpenWA's public origin. Accepting a pasted `/api` suffix prevents a
 * doubled path, while all generated requests still use its required prefix. */
export function openWaApiUrl(path: string): string {
  const base = requiredEnv('OPENWA_BASE_URL').replace(/\/+$/, '').replace(/\/api$/, '');
  return `${base}/api${path.startsWith('/') ? path : `/${path}`}`;
}

function gatewayHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-API-Key': requiredEnv('OPENWA_API_KEY'),
  };
}

async function parseGatewayResponse(response: Response): Promise<unknown> {
  const body = await response.text();
  let payload: unknown = null;
  try { payload = body ? JSON.parse(body) : null; } catch { payload = body; }
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'message' in payload
      ? String(payload.message)
      : body || response.statusText;
    throw new Error(`OpenWA request failed (${response.status}): ${detail}`);
  }
  return payload;
}

export async function getOpenWaSession(sessionId: string): Promise<OpenWaSession> {
  const response = await fetch(openWaApiUrl(`/sessions/${encodeURIComponent(sessionId)}`), {
    headers: gatewayHeaders(),
    cache: 'no-store',
  });
  const payload = await parseGatewayResponse(response);
  if (!payload || typeof payload !== 'object' || !('id' in payload) || !('status' in payload)) {
    throw new Error('OpenWA returned an invalid session response');
  }
  const session = payload as OpenWaSession;
  return { id: String(session.id), status: String(session.status), phone: session.phone ? String(session.phone) : null, lastError: session.lastError ?? null };
}

export function openWaChatId(phone: string): string {
  const normalized = sanitizePhoneForMeta(phone);
  if (!isValidE164(normalized)) throw new Error('Invalid contact phone number');
  return `${normalized.replace(/^\+/, '')}@c.us`;
}

export async function sendOpenWaText(input: {
  sessionId: string;
  to: string;
  text: string;
}): Promise<{ messageId: string }> {
  const response = await fetch(
    openWaApiUrl(`/sessions/${encodeURIComponent(input.sessionId)}/messages/send-text`),
    {
      method: 'POST',
      headers: gatewayHeaders(),
      body: JSON.stringify({ chatId: openWaChatId(input.to), text: input.text }),
      cache: 'no-store',
    },
  );
  const payload = await parseGatewayResponse(response);
  if (!payload || typeof payload !== 'object' || !('messageId' in payload) || !payload.messageId) {
    throw new Error('OpenWA returned no message id');
  }
  return { messageId: String(payload.messageId) };
}

export function openWaPhoneMatchesConfiguredNumber(phone: string | null): boolean {
  const configured = process.env.WHATSAPP_PHONE_NUMBER?.trim();
  // This gateway is deliberately bound to the operator-selected number.
  // Refuse a configuration that cannot prove that binding rather than
  // accidentally routing a session for a different WhatsApp account.
  if (!configured) return false;
  if (!phone) return false;
  try {
    return sanitizePhoneForMeta(phone) === sanitizePhoneForMeta(configured);
  } catch {
    return false;
  }
}

/** HMAC check is intentionally over the original string, before parsing. */
export function verifyOpenWaWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.OPENWA_WEBHOOK_SECRET;
  if (!secret || !signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const received = Buffer.from(signature);
  const computed = Buffer.from(expected);
  return received.length === computed.length && crypto.timingSafeEqual(received, computed);
}

export function phoneFromOpenWaChatId(chatId: string | undefined): string | null {
  if (!chatId) return null;
  const digits = chatId.split('@')[0]?.replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}
