# DRMS stakeholder acceptance testing

Use only the separately marked `DEMO DATA` account for fictional CRM scenarios. Do not seed, reset, or edit operational data during this checklist. Demo seed/reset commands never contact Meta, OpenWA, SMS, or official sources.

## Operational boundary

- **CRM state** is the account-scoped record in DRMS: incident, activity, assignment, follow-up, and outbox status.
- **Queued** means DRMS created a status-notification request.
- **Sent** means the provider accepted the request. It is not handset delivery.
- **Failed** means DRMS recorded the provider failure and exposes one explicit coordinator retry when permitted.
- **Delivered** must not be claimed unless the provider supplies a delivery receipt; the current incident outbox does not persist handset receipts.
- Future official data must follow `official source -> validated adapter/import -> DRMS entities`. This prototype contains only fictional DEMO DATA.

## Feature rationalization

| Classification | DRMS feature |
| --- | --- |
| Keep | Citizens, incidents, citizen communications, resources, teams, vehicles, locations, inventory, assignments, follow-up, case notes, activity timeline, notifications, roles and permissions |
| Adapt | Contact details/tags/custom fields, templates, public announcements, response rules, intake flows, and the underlying configurable pipeline |
| Hide from primary navigation | Sales analytics, revenue/value reporting, forecasting, lead/opportunity language, and AI Agents |
| Remove later only by separate approval | Unused inherited sales/marketing and AI implementation surfaces; no destructive deletion is part of acceptance readiness |

## Manual acceptance checklist

### 1. Operations UI and demo safety

1. Sign in as `DEMO DATA`; confirm the sidebar reads Operations Overview, Incidents / Relief Cases, Citizen Communications, Resources & Locations, Follow-up Required, Public Announcements, Response Rules, and Intake Flows.
2. Confirm Operations Overview counts come from the displayed fictional data and every metric opens its relevant incident or follow-up view.
3. Confirm no revenue, currency, forecasting, lead, opportunity, or AI Agent control appears in the primary operations path.
4. Confirm the demo account has fictional critical, new, unassigned, assigned, dispatched, in-progress, resolved, failed-communication, and overdue scenarios; verify operational records are not mixed in.

### 2. Incident and resource workflow

5. Open a verified demo incident. Confirm request ID, priority, category, created time, citizen/contact, location, municipality/district, coordinates, people affected, description, activity, case notes, and follow-up state are visible.
6. Confirm recommendations show only stored-available, compatible resources, ranked by stored-coordinate distance. Check that an unavailable or incompatible nearby resource is not recommended.
7. Select a resource and use **Confirm assignment**. Confirm the incident becomes `ASSIGNED`, the selected resource becomes `ASSIGNED`, and an activity entry is added. Confirm no dispatch occurs automatically.
8. Change response status manually through `DISPATCHED`, `IN PROGRESS`, and `RESOLVED` only after the coordinator decision. Confirm the workflow and timeline record each change.
9. Confirm a status change in the incident case sheet and, where useful, add a coordinator remark. Verify the timeline identifies the coordinator name/email, action time, old/new status, and the optional remark. Board drag-and-drop must request confirmation before changing a status.
10. Open the related-incidents tab for the fictional Aasha Gurung contact. Confirm `DEMO-RESCUE-001` and `DEMO-SHELTER-007` remain distinct incidents and each opens independently.
11. With two demo-account members configured, repeat a status or assignment action under each account. Confirm the shared operational data remains available while the timeline attributes each action to the correct coordinator.
12. Review Resource & Locations for available, assigned, unavailable/limited, team, vehicle, location, and inventory information. It must not claim live GPS tracking.

### 3. Communication and follow-up

13. In Citizen Communications, confirm the citizen, channel, conversation, related incident, and coordinator-only notes are clear. Coordinator notes must not be sent to the citizen.
14. Verify the case timeline distinguishes notification queued, sent, and failed events. Treat **Sent** as provider acceptance only.
15. Open Follow-up Required. Confirm incident ID, priority, location, response status, reason, and next coordinator action are visible.
16. Inspect the simulated failed-delivery demo case. Confirm it is in the communication-failure filter and that retry is an explicit coordinator action. Do not trigger a retry unless a controlled test number and provider are configured.
17. Mark an overdue demo follow-up reviewed. Confirm the item remains until its stored underlying condition is cleared; there is no automatic retry or escalation loop.

### 4. Controlled WhatsApp regression tests

15. Use a controlled test phone attached to the configured Meta or OpenWA transport. Send `START` and complete the multi-message emergency intake: service, requester details, location, people affected, important details, and confirmation.
16. Confirm exactly one request ID is returned and exactly one matching incident, contact/conversation, and inbound history appear in CRM. Repeat delivery of the same inbound event must not create duplicates.
17. Send a map pin and an image in separate controlled messages when prompted; verify stored coordinates/media appear in the existing communication/incident records.
18. From the coordinator case, perform a permitted status change and verify the predefined notification is queued then marked Sent or Failed in CRM. Verify handset receipt independently; do not infer it from Sent.
19. Use the citizen status-query path and confirm it returns only the requesting citizen's own request information.
20. Send an unrelated controlled message and confirm it remains available for human handling rather than being assigned, dispatched, resolved, or interpreted by AI.
21. Repeat the intake and status-notification regression through the alternate configured transport (Meta or OpenWA). Confirm webhook authentication, contact matching, idempotency, and stored conversation history still work.

### 5. Final checks

22. Test dashboard, incident board, case sheet, follow-up, inbox, forms, dialogs, and resource page at a mobile viewport. Verify no horizontal overflow, clipped action, or unreadable case information.
23. Confirm coordinator-only actions are unavailable to unauthorized users, citizen lookup stays contact-scoped, and account-scoped RLS still separates demo and operational accounts.
24. Record the test operator, test phone, timestamp, transport, request ID, CRM outbox status, and independently observed handset result in the stakeholder test record.
