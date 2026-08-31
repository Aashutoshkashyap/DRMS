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
    /**
     * Best-effort E.164/MSISDN supplied by OpenWA when it resolves a
     * WhatsApp privacy identifier (`@lid`). It can be absent when the
     * provider cannot establish a trustworthy phone mapping.
     */
    senderPhone?: string | null;
    body?: string;
    type?: string;
    timestamp?: number;
    fromMe?: boolean;
    isGroup?: boolean;
  };
};

type OpenWaWebhook = {
  id: string;
  url: string;
  events?: string[];
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

function requiredWebhookSecret(): string {
  const secret = process.env.OPENWA_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error('OPENWA_WEBHOOK_SECRET is not configured');
  return secret;
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

/**
 * Create or repair the single DRMS inbound webhook for an OpenWA session.
 * The signing secret never leaves the server: it is read from Vercel's
 * runtime environment and sent directly to the configured gateway.
 */
export async function ensureOpenWaInboundWebhook(input: {
  sessionId: string;
  webhookUrl: string;
}): Promise<{ id: string; created: boolean }> {
  const sessionPath = `/sessions/${encodeURIComponent(input.sessionId)}/webhooks`;
  const listResponse = await fetch(openWaApiUrl(sessionPath), {
    headers: gatewayHeaders(),
    cache: 'no-store',
  });
  const listed = await parseGatewayResponse(listResponse);
  const existing = Array.isArray(listed)
    ? listed.find((webhook): webhook is OpenWaWebhook => (
      !!webhook
      && typeof webhook === 'object'
      && 'id' in webhook
      && 'url' in webhook
      && String(webhook.url) === input.webhookUrl
    ))
    : undefined;

  const body = JSON.stringify({
    url: input.webhookUrl,
    events: ['message.received'],
    secret: requiredWebhookSecret(),
  });
  const response = await fetch(
    openWaApiUrl(existing ? `${sessionPath}/${encodeURIComponent(String(existing.id))}` : sessionPath),
    {
      method: existing ? 'PUT' : 'POST',
      headers: gatewayHeaders(),
      body,
      cache: 'no-store',
    },
  );
  const payload = await parseGatewayResponse(response);
  if (!payload || typeof payload !== 'object' || !('id' in payload) || !payload.id) {
    throw new Error('OpenWA returned an invalid webhook response');
  }
  return { id: String(payload.id), created: !existing };
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
  const [rawId, domain] = chatId.trim().split('@', 2);
  // `@lid` is a WhatsApp privacy identifier, not a phone number. Never
  // coerce its digits into a contact phone: that creates a believable but
  // non-callable number in a disaster coordination record.
  if (domain !== 'c.us' && domain !== 's.whatsapp.net') return null;
  const digits = rawId?.replace(/\D/g, '');
  return digits && isValidE164(digits) ? `+${digits}` : null;
}

function normalizedOpenWaPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = sanitizePhoneForMeta(value);
  return isValidE164(digits) ? `+${digits}` : null;
}

/**
 * Resolve an inbound OpenWA identity to a callable E.164 phone number.
 *
 * OpenWA can emit `@lid` when WhatsApp withholds the normal phone identity.
 * The gateway's contact-phone endpoint performs its supported, best-effort
 * resolution. A null result means the number is genuinely unavailable; the
 * caller must not manufacture one from the LID digits.
 */
export async function resolveOpenWaSenderPhone(input: {
  sessionId: string;
  chatId?: string;
  senderPhone?: string | null;
}): Promise<string | null> {
  const fromPayload = normalizedOpenWaPhone(input.senderPhone);
  if (fromPayload) return fromPayload;

  const direct = phoneFromOpenWaChatId(input.chatId);
  if (direct) return direct;

  const chatId = input.chatId?.trim();
  if (!chatId?.endsWith('@lid')) return null;

  const response = await fetch(
    openWaApiUrl(`/sessions/${encodeURIComponent(input.sessionId)}/contacts/${encodeURIComponent(chatId)}/phone`),
    { headers: gatewayHeaders(), cache: 'no-store' },
  );
  const payload = await parseGatewayResponse(response);
  return payload && typeof payload === 'object' && 'phone' in payload
    ? normalizedOpenWaPhone(payload.phone)
    : null;
}
