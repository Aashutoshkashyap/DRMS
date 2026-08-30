import type { SupabaseClient } from '@supabase/supabase-js';

import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { handleWhatsAppEmergencyInbound } from '@/lib/whatsapp/emergency-interface';

type InboundResult = { duplicate: boolean; conversationId: string; contactId: string };

async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string,
) {
  const existing = await findExistingContact(db, accountId, phone);
  if (existing) {
    if (name && name !== existing.name) {
      await db.from('contacts').update({ name, updated_at: new Date().toISOString() }).eq('id', existing.id);
    }
    return { contact: existing, wasCreated: false };
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
  senderName?: string | null;
  contentText: string;
  occurredAt: string;
}): Promise<InboundResult> {
  const contactOutcome = await findOrCreateContact(
    input.db,
    input.accountId,
    input.ownerUserId,
    input.senderPhone,
    input.senderName?.trim() || input.senderPhone,
  );
  const conversationOutcome = await findOrCreateConversation(
    input.db,
    input.accountId,
    input.ownerUserId,
    contactOutcome.contact.id,
  );
  const conversation = conversationOutcome.conversation;

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
        content_type: 'text',
        content_text: input.contentText,
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
    p_last_message_text: input.contentText || '[text]',
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
      input: { text: input.contentText },
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
        message: { kind: 'text', text: input.contentText, meta_message_id: input.messageId },
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
      context: { message_text: input.contentText, conversation_id: conversation.id },
    }).catch((error) => console.error('[openwa] automation dispatch failed:', error));
  }

  await dispatchWebhookEvent(input.db, input.accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactOutcome.contact.id,
    whatsapp_message_id: input.messageId,
    content_type: 'text',
    text: input.contentText,
  });
  return { duplicate: false, conversationId: conversation.id, contactId: contactOutcome.contact.id };
}
