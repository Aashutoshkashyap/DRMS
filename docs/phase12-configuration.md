# Phase 12 production configuration

These settings are deliberately not stored in source code or application
environment variables because Supabase Auth owns them.

## Supabase Auth redirect configuration

In **Supabase Dashboard → Authentication → URL Configuration** set:

- **Site URL:** `https://drms-swart.vercel.app`
- **Redirect URLs:**
  - `https://drms-swart.vercel.app/auth/callback`
  - `https://drms-swart.vercel.app/auth/callback?next=/dashboard`
  - `https://drms-swart.vercel.app/auth/callback?next=/reset-password`
  - `https://drms-swart.vercel.app/auth/callback?next=/join/**`
  - `http://localhost:3000/**` for local development only

Keep email confirmation enabled. The application now sends signup and reset
links to `/auth/callback`; that route exchanges the PKCE code and redirects
only to an internal DRMS route.

## Auth email sender and templates

Configure a verified SMTP provider in **Authentication → SMTP Settings**.
Use a verified sender such as `DRMS Coordination <noreply@your-domain>`;
do not set a From address in application code. Configure SPF, DKIM, and DMARC
with the selected provider before enabling it.

In **Authentication → Email Templates**, brand confirmation, invite, and
password-recovery templates as **Disaster Relief Management System**. Use
Supabase's `{{ .ConfirmationURL }}` link in each applicable template so its
configured redirect target is preserved. Send test emails to a non-operational
address before inviting coordinators.

## OpenWA session registry

The following remain server-only Vercel variables: `OPENWA_BASE_URL`,
`OPENWA_API_KEY`, and `OPENWA_WEBHOOK_SECRET`. `NEXT_PUBLIC_SITE_URL` must be
the canonical deployed URL because it is used to register the signed OpenWA
webhook. After migration 050 is applied, an administrator can add additional
ready OpenWA sessions in **Settings → WhatsApp**. Each session is checked at
the gateway and registered to the same `/api/whatsapp/openwa/webhook`; the
session id, not a secret, is stored in the account-scoped configuration row.
