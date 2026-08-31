import crypto from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  openWaApiUrl,
  openWaChatId,
  ensureOpenWaInboundWebhook,
  openWaPhoneMatchesConfiguredNumber,
  phoneFromOpenWaChatId,
  verifyOpenWaWebhookSignature,
} from './openwa';

describe('OpenWA transport helpers', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('normalizes the gateway URL and WhatsApp chat id', () => {
    vi.stubEnv('OPENWA_BASE_URL', 'https://gateway.example/api/');
    vi.stubEnv('OPENWA_API_KEY', 'test-key');
    expect(openWaApiUrl('/sessions/a')).toBe('https://gateway.example/api/sessions/a');
    expect(openWaChatId('+15551234567')).toBe('15551234567@c.us');
  });

  it('verifies a raw-body signature and extracts contact phone', () => {
    vi.stubEnv('OPENWA_WEBHOOK_SECRET', 'a-very-long-test-secret');
    const raw = '{"event":"message.received"}';
    const signature = 'sha256=' + crypto.createHmac('sha256', process.env.OPENWA_WEBHOOK_SECRET!).update(raw).digest('hex');
    expect(verifyOpenWaWebhookSignature(raw, signature)).toBe(true);
    expect(verifyOpenWaWebhookSignature(raw, 'sha256=bad')).toBe(false);
    expect(phoneFromOpenWaChatId('15551234567@c.us')).toBe('+15551234567');
  });

  it('requires the server-configured WhatsApp number to match the gateway session', () => {
    expect(openWaPhoneMatchesConfiguredNumber('+15551234567')).toBe(false);
    vi.stubEnv('WHATSAPP_PHONE_NUMBER', '+15551234567');
    expect(openWaPhoneMatchesConfiguredNumber('+1 555 123 4567')).toBe(true);
    expect(openWaPhoneMatchesConfiguredNumber('+15557654321')).toBe(false);
  });

  it('creates the signed inbound webhook when the session has none', async () => {
    vi.stubEnv('OPENWA_BASE_URL', 'https://gateway.example');
    vi.stubEnv('OPENWA_API_KEY', 'gateway-key');
    vi.stubEnv('OPENWA_WEBHOOK_SECRET', 'webhook-secret');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'webhook-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(ensureOpenWaInboundWebhook({
      sessionId: 'session-1',
      webhookUrl: 'https://drms.example/api/whatsapp/openwa/webhook',
    })).resolves.toEqual({ id: 'webhook-1', created: true });

    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'https://gateway.example/api/sessions/session-1/webhooks',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      url: 'https://drms.example/api/whatsapp/openwa/webhook',
      events: ['message.received'],
      secret: 'webhook-secret',
    });
  });
});
