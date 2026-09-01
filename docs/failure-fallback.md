# DRMS failure fallback

DRMS prioritizes preserving data, preventing duplicates, showing the actual
state, then allowing a safe retry. A successful provider API call is **sent to
transport**, not confirmed delivered unless the provider sends a delivery
receipt into the CRM.

| Component | Failure and preserved data | Coordinator warning and safe recovery | Manual fallback |
| --- | --- | --- | --- |
| Citizen → OpenWA | OpenWA retains the original phone/session/event while it is connected. | No DRMS confirmation exists until a CRM inbox message appears. Check Railway/OpenWA session and its gateway logs. | Ask the citizen to resend or collect the report by phone and create a manual incident. |
| OpenWA → DRMS webhook | Once the session is identified, the webhook returns `500` on persistence failure so the gateway can retry the same idempotency/message ID. | **Inbound WhatsApp processing delayed** appears when the database is available enough to record it. No duplicate incident is created on retry. | Inspect the gateway delivery log and manually record the sender, timestamp, and content if retry cannot complete. |
| DRMS → Supabase / temporary database outage | No write is claimed as saved. The browser retains an unsent inbox text draft for the tab session. | **DRMS data unavailable. Your changes are not confirmed.** Reconnect and retry the exact action. | Record the incident details outside DRMS under the request time, then enter one manual incident after recovery. |
| Supabase Storage | The inbound message and resulting incident persist even when image/audio upload fails. | **Evidence unavailable** is shown on the incident and a grouped storage alert is raised. | Ask the citizen to resend the media or attach/record evidence manually. |
| WhatsApp outbound | The incident state and queued delivery record stay authoritative; a failure is `FAILED`. | **WhatsApp communication unavailable; citizen notification failed** appears in Follow-up with one explicit retry. | Contact the citizen by phone/another approved channel and record the action in the case notes. |
| Authentication / email | No account is created or changed by a failed callback/reset. | The existing account-access alert explains the account problem and offers retry. Production callbacks use the configured production URL, never localhost. | Use the production reset/sign-in page; an administrator corrects Supabase Auth Site URL, redirect URLs, and SMTP configuration if needed. |
| Vercel application | Browser requests cannot be processed while the app is unavailable. | A browser/network failure is not represented as an incident success. | Check Vercel deployment/status, keep an offline incident log, then enter each report once the app returns. |
| Railway/OpenWA service | Existing stored CRM data remains intact; outbound requests fail rather than being marked delivered. | Grouped WhatsApp communication alerts distinguish transport failure from evidence storage or inbound processing. | Check the OpenWA session/QR and Railway service logs; use phone contact/manual case entry until restored. |
| Coordinator network interruption | Typed text replies are retained in this browser session; no unsaved CRM update is called successful. | **Waiting for connection** appears globally. Reconnect, then send or retry deliberately. | Do not close the tab if the draft matters; record urgent details through the approved offline procedure. |

Repeated webhook, storage, and outbound failures are grouped in **System status /
attention**. A coordinator should open the linked inbox, incident, or Follow-up
queue, verify stored state, and retry only the explicit action. Never alter an
incident status merely because a citizen notification failed.
