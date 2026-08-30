# OpenWA transport integration report

## Scope

This is a transport-only Phase 4 addition. The existing CRM, Supabase database,
contacts, conversations, incident records, deterministic intake state machine,
and coordinator workflow remain the source of truth. No AI service, OpenWA
plugin, second CRM database, or business rule is introduced.

## Existing DRMS seams

| Concern | Existing implementation | OpenWA use |
| --- | --- | --- |
| Contact matching | `findExistingContact` matches account-scoped normalized phone numbers | Reuse with sender number parsed from an OpenWA chat id. |
| Conversation and message history | `conversations` and `messages`, with database uniqueness on `(conversation_id, message_id)` | Reuse directly; OpenWA message ids provide the idempotency key. |
| Emergency intake | `src/lib/whatsapp/emergency-interface.ts` invokes the deterministic request state machine after an inbound message is persisted | Reuse after OpenWA inbound persistence. |
| Status notifications | `deliverIncidentStatusUpdate` produces verified, predefined messages | Reuse; delivery selects the configured transport. |
| Coordinator replies | `sendMessageToConversation` persists only after provider acceptance | Add an OpenWA text transport branch; Meta remains untouched. |
| Existing Meta integration | `/api/whatsapp/webhook`, Meta sender and configuration UI | Preserve unchanged for accounts configured with the Meta transport. |

## OpenWA compatibility

OpenWA v0.23.3 exposes a self-hosted REST gateway, per-session signed webhooks,
and stable retry idempotency keys. The MVP processes only `message.received`;
other signed gateway events are acknowledged without changing CRM state. DRMS
verifies the HMAC over the raw body, deduplicates before writing CRM records,
and only acknowledges once the message has been safely persisted.

OpenWA is not deployed on Vercel: it maintains a WhatsApp session and QR/pairing
state, so it needs a persistent Docker/VPS host with a durable data volume. Its
gateway database/session files are transport state only; DRMS Supabase remains
the operational system of record.

## Planned changes

- Add migration `043_openwa_transport.sql` to make the existing
  `whatsapp_config` row transport-aware and map an OpenWA session to one DRMS
  account. Existing Meta rows remain valid.
- Add a server-only OpenWA REST client and HMAC verifier.
- Add `/api/whatsapp/openwa/webhook` for signed OpenWA events. It creates or
  reuses existing contacts/conversations and writes the existing `messages`
  table before invoking deterministic intake.
- Select OpenWA only when an account configuration explicitly sets
  `transport = 'openwa'`; retain all Meta behavior otherwise.
- Add the minimum Settings controls for OpenWA session selection and connection
  health. Access keys and webhook secrets remain Vercel environment variables.

## Required environment variables

| Variable | Location | Purpose |
| --- | --- | --- |
| `WHATSAPP_PHONE_NUMBER` | Vercel | Connected number in E.164 form; server-only and never rendered. |
| `OPENWA_BASE_URL` | Vercel | Public HTTPS origin of the separately hosted OpenWA gateway, without `/api`. |
| `OPENWA_API_KEY` | Vercel | Operator-scoped OpenWA key for DRMS server-to-gateway sends and health checks. |
| `OPENWA_WEBHOOK_SECRET` | Vercel and OpenWA webhook registration | Long random HMAC secret (minimum 16 characters). |
| `ENCRYPTION_KEY` | Vercel | Existing DRMS encrypted-config key; still required for any Meta-configured account. |

The OpenWA session ID is stored in the account-scoped WhatsApp Settings row,
not in frontend JavaScript or an environment variable. The gateway validates
the connected session phone against `WHATSAPP_PHONE_NUMBER` before reporting
it healthy.

## Risks and MVP limits

- OpenWA uses an unofficial WhatsApp connection; the operator is responsible
  for WhatsApp policy compliance and must expect a QR/pairing maintenance path.
- The MVP sends text for OpenWA. Meta-only templates and interactive message
  controls retain their Meta implementation; OpenWA receives a deterministic
  plain-text fallback rather than a fabricated interactive payload.
- No automatic dispatch or resource availability claim is added. Existing
  coordinator-confirmed status changes remain the only notification triggers.

## Validation plan

1. Verify a signed synthetic `message.received` event creates one CRM contact,
   conversation, and message; replay it and verify no duplicate message.
2. Verify an OpenWA text send is accepted by the gateway before the outgoing
   CRM message is marked sent.
3. Exercise `START`, complete one deterministic request, and move its status
   through the existing coordinator UI; verify the resulting predefined
   notification is written to the same conversation.
4. Verify invalid signatures, unknown sessions, malformed events, and gateway
   errors return failure without corrupting CRM state.
