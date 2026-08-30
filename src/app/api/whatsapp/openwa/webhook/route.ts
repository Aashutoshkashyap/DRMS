import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import {
  phoneFromOpenWaChatId,
  type OpenWaWebhookEvent,
  verifyOpenWaWebhookSignature,
} from '@/lib/whatsapp/openwa';
import { persistOpenWaInboundMessage } from '@/lib/whatsapp/openwa-inbound';

export const dynamic = 'force-dynamic';

let adminClient: ReturnType<typeof createClient> | null = null;
function supabaseAdmin() {
  if (!adminClient) {
    adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return adminClient;
}

function eventTimestamp(event: OpenWaWebhookEvent): string {
  if (typeof event.data?.timestamp === 'number') return new Date(event.data.timestamp * 1000).toISOString();
  const parsed = Date.parse(event.timestamp);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyOpenWaWebhookSignature(rawBody, request.headers.get('x-openwa-signature'))) {
    return NextResponse.json({ error: 'Invalid OpenWA signature' }, { status: 401 });
  }

  let event: OpenWaWebhookEvent;
  try {
    event = JSON.parse(rawBody) as OpenWaWebhookEvent;
  } catch {
    return NextResponse.json({ error: 'Malformed OpenWA payload' }, { status: 400 });
  }
  if (!event.event || !event.sessionId || !event.idempotencyKey || !event.data) {
    return NextResponse.json({ error: 'Incomplete OpenWA payload' }, { status: 400 });
  }
  if (event.event === 'test') return NextResponse.json({ ok: true });
  if (event.event !== 'message.received') return NextResponse.json({ ok: true, ignored: event.event });
  if (event.data.fromMe || event.data.isGroup) return NextResponse.json({ ok: true, ignored: 'non-citizen-message' });

  const messageId = event.data.id;
  const senderPhone = phoneFromOpenWaChatId(event.data.from ?? event.data.chatId);
  if (!messageId || !senderPhone) return NextResponse.json({ error: 'Inbound message lacks sender or id' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: configData, error: configError } = await db
    .from('whatsapp_config')
    .select('account_id,user_id')
    .eq('transport', 'openwa')
    .eq('openwa_session_id', event.sessionId)
    .maybeSingle();
  // This client is intentionally untyped: the generated Supabase schema is
  // not checked into the app and therefore cannot know migration 043 yet.
  const config = configData as { account_id: string | null; user_id: string | null } | null;
  if (configError) {
    console.error('[openwa] configuration lookup failed:', configError.message);
    return NextResponse.json({ error: 'Configuration lookup failed' }, { status: 500 });
  }
  if (!config?.account_id || !config.user_id) {
    return NextResponse.json({ error: 'Unknown OpenWA session' }, { status: 404 });
  }

  try {
    const result = await persistOpenWaInboundMessage({
      db,
      accountId: config.account_id,
      ownerUserId: config.user_id,
      messageId,
      senderPhone,
      contentText: event.data.body ?? '',
      occurredAt: eventTimestamp(event),
    });
    return NextResponse.json({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    console.error('[openwa] inbound persistence failed:', error);
    return NextResponse.json({ error: 'Could not persist inbound message' }, { status: 500 });
  }
}
