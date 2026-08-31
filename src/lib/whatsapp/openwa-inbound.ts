import type { SupabaseClient } from '@supabase/supabase-js';

import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { handleWhatsAppEmergencyInbound } from '@/lib/whatsapp/emergency-interface';
import {
  decodeOpenWaInboundImage,
  storeOpenWaInboundImage,
  type OpenWaInboundImage,
} from '@/lib/whatsapp/openwa-inbound-media';

type InboundResult = { duplicate: boolean; conversationId: string; contactId: string };
type OpenWaInboundContentType = 'text' | 'image' | 'location';

async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string,
  legacyLidPhone?: string | null,
) {
  const existing = await findExistingContact(db, accountId, phone);
  if (existing) {
    if (name && name !== existing.name) {
      await db.from('contacts').update({ name, updated_at: new Date().toISOString() }).eq('id', existing.id);
    }
    return { contact: existing, wasCreated: false };
  }

  // Earlier OpenWA intake mistakenly stored the digits of an `@lid` privacy
  // id as a phone number. When the gateway later resolves that same sender,
  // repair the original contact in place so its conversations and incident
  // history remain attached to the now-callable number.
  if (legacyLidPhone) {
    const legacy = await findExistingContact(db, accountId, legacyLidPhone);
    if (legacy) {
      const { data: repaired, error: repairError } = await db
        .from('contacts')
        .update({ phone, name: name || legacy.name || phone, updated_at: new Date().toISOString() })
        .eq('id', legacy.id)
        .select()
        .single();
      if (!repairError && repaired) return { contact: repaired, wasCreated: false };
      if (isUniqueViolation(repairError)) {
        const raced = await findExistingContact(db, accountId, phone);
        if (raced) return { contact: raced, wasCreated: false };
      }
      throw new Error(`Could not repair OpenWA LID contact: ${repairError?.message ?? 'unknown error'}`);
    }
  }

  const { data, error } = await db
    .from('contacts')
    .insert({ account_id: accountId, user_id: ownerUserId, phone, name: name || phone })
    .select()
    .single();
  if (error && isUniqueViolation(error)) {
    const raced = await findExistingContact(db, accountId, phone);
    if (raced) return { contact: raced, wasCreated: false };
  }
  if (error || !data) throw new Error(`Could not create contact: ${error?.message ?? 'unknown error'}`);
  return { contact: data, wasCreated: true };
}

async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
) {
  const { data: existing, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (findError) throw new Error(`Could not find conversation: ${findError.message}`);
  if (existing?.[0]) return { conversation: existing[0], created: false };

  const { data, error } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: ownerUserId, contact_id: contactId })
    .select()
    .single();
  if (error && isUniqueViolation(error)) {
    const { data: raced } = await db
      .from('conversations')
      .select('*')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1);
    if (raced?.[0]) return { conversation: raced[0], created: false };
  }
  if (error || !data) throw new Error(`Could not create conversation: ${error?.message ?? 'unknown error'}`);
  return { conversation: data, created: true };
}

/**
 * Shared CRM persistence shape for OpenWA text webhooks. It deliberately
 * excludes the optional AI dispatcher: OpenWA is connected only to the
 * deterministic DRMS emergency, flow, and automation paths.
 */
export async function persistOpenWaInboundMessage(input: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  messageId: string;
  senderPhone: string;
  /** The prior incorrect number produced by a legacy `@lid` conversion. */
  legacyLidPhone?: string | null;
  senderName?: string | null;
  contentType: OpenWaInboundContentType;
  contentText: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string } | null;
  image?: { body: string; mimeType: string | null; caption: string | null } | null;
  occurredAt: string;
}): Promise<InboundResult> {
  const contactOutcome = await findOrCreateContact(
    input.db,
    input.accountId,
    input.ownerUserId,
    input.senderPhone,
    input.senderName?.trim() || input.senderPhone,
    input.legacyLidPhone,
  );
  const conversationOutcome = await findOrCreateConversation(
    input.db,
    input.accountId,
    input.ownerUserId,
    contactOutcome.contact.id,
  );
  const conversation = conversationOutcome.conversation;

  // The gateway provides image bytes as base64. Store those bytes in the
  // same durable, account-scoped `chat-media` bucket the CRM already uses.
  // Crucially, never let the base64 string reach content_text: it is neither
  // useful to a coordinator nor a valid disaster-intake answer.
  let mediaUrl: string | null = null;
  let mediaType: string | null = null;
  let decodedImage: OpenWaInboundImage | null = null;
  if (input.contentType === 'image' && input.image) {
    decodedImage = decodeOpenWaInboundImage(input.image);
    if (decodedImage) {
      mediaType = decodedImage.mimeType;
      mediaUrl = await storeOpenWaInboundImage({
        storage: input.db.storage,
        accountId: input.accountId,
        messageId: input.messageId,
        image: decodedImage,
      });
    }
  }
  const persistedText = input.contentType === 'image'
    ? (decodedImage?.caption ?? (input.contentText.trim() || null))
    : (input.contentText.trim() || null);
  const previewText = persistedText || `[${input.contentType}]`;

  const { count: priorCustomerMessages } = await input.db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer');

  const { data: inserted, error: messageError } = await input.db
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: input.contentType,
        content_text: persistedText,
        media_url: mediaUrl,
        media_type: mediaType,
        message_id: input.messageId,
        status: 'delivered',
        created_at: input.occurredAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id');
  if (messageError) throw new Error(`Could not store inbound message: ${messageError.message}`);
  if (!inserted?.length) return { duplicate: true, conversationId: conversation.id, contactId: contactOutcome.contact.id };

  if (conversationOutcome.created) {
    await dispatchWebhookEvent(input.db, input.accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactOutcome.contact.id,
    });
  }

  const { error: bumpError } = await input.db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: previewText,
  });
  if (bumpError) throw new Error(`Could not update conversation: ${bumpError.message}`);
  await reopenClosedConversation(input.db, conversation);

  let emergencyConsumed = false;
  try {
    emergencyConsumed = (await handleWhatsAppEmergencyInbound({
      db: input.db,
      accountId: input.accountId,
      userId: input.ownerUserId,
      contactId: contactOutcome.contact.id,
      conversationId: conversation.id,
      inboundMessageId: input.messageId,
      transport: 'openwa',
      input: {
        // A caption is evidence metadata, not a reliable answer to the
        // deterministic intake question. Map pins are the sole non-text
        // answer accepted by the state machine.
        text: input.contentType === 'text' ? input.contentText : null,
        location: input.location ?? null,
      },
    })).consumed;
  } catch (error) {
    console.error('[openwa] emergency intake failed after inbound persistence:', error);
  }

  const flowResult = emergencyConsumed
    ? { consumed: true }
    : await dispatchInboundToFlows({
        accountId: input.accountId,
        userId: input.ownerUserId,
        contactId: contactOutcome.contact.id,
        conversationId: conversation.id,
        message: { kind: 'text', text: persistedText ?? '', meta_message_id: input.messageId },
        isFirstInboundMessage: (priorCustomerMessages ?? 0) === 0,
      });

  const triggers: ('new_contact_created' | 'first_inbound_message' | 'new_message_received' | 'keyword_match')[] = [];
  if (contactOutcome.wasCreated) triggers.push('new_contact_created');
  if ((priorCustomerMessages ?? 0) === 0) triggers.push('first_inbound_message');
  if (!flowResult.consumed) triggers.push('new_message_received', 'keyword_match');
  for (const triggerType of triggers) {
    await runAutomationsForTrigger({
      accountId: input.accountId,
      triggerType,
      contactId: contactOutcome.contact.id,
      context: { message_text: persistedText ?? '', conversation_id: conversation.id },
    }).catch((error) => console.error('[openwa] automation dispatch failed:', error));
  }

  await dispatchWebhookEvent(input.db, input.accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactOutcome.contact.id,
    whatsapp_message_id: input.messageId,
    content_type: input.contentType,
    text: persistedText,
  });
  return { duplicate: false, conversationId: conversation.id, contactId: contactOutcome.contact.id };
}
