# Project plan

## Objective

Make the cloned wacrm repository easier to evolve without breaking its account isolation, WhatsApp webhook contract, public API, or existing CRM behavior. The plan is a staged architectural migration, not a database/vendor migration: no destination platform or data-transfer requirement was supplied.

## Guardrails

- Preserve all public route paths and payload contracts unless a separately approved versioning plan says otherwise.
- Treat Supabase RLS and `account_id` scoping as security boundaries; service-role code must scope explicitly by account.
- Preserve Meta webhook verification, duplicate-delivery idempotency, message ordering, broadcast counters, and media fallback behavior.
- Do not change SQL migrations already applied in a deployed database. Add forward-only migrations and verify them in an ephemeral Supabase project.
- Do not claim live Supabase, Meta, storage, cron, or deployment verification without the required access and evidence.
- After every code milestone run: `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` with non-secret build configuration. Run focused manual/smoke checks for the changed route or UI.

## Baseline evidence

| Check | Result | Date |
| --- | --- | --- |
| Dependency installation | `npm ci` passed | 2026-08-30 |
| Static types | `npm run typecheck` passed | 2026-08-30 |
| Unit tests | `npm test` passed: 79 files / 825 tests | 2026-08-30 |
| Lint | `npm run lint` completed: 0 errors, 37 existing warnings | 2026-08-30 |
| Production build | passed with temporary, non-secret Supabase/secret placeholders; absent configuration causes intentional Supabase prerender failure | 2026-08-30 |

## Milestones

### M0 — Architecture baseline

**Status:** Complete
**Deliverable:** `ARCHITECTURE.md`

Completed work:

- Audited source, routes, configuration, migrations, test inventory, CI, and deployment configuration.
- Documented the system context, dependency map, database model, reuse inventory, risks, and staged roadmap.
- Established test, typecheck, lint, and production-build behavior.

### M1 — Next.js 16 request-boundary migration

**Status:** Complete
**Scope:** Moved the deprecated `src/middleware.ts` convention to the current Next.js 16 `proxy` convention without changing request behavior.

Acceptance criteria:

- The matcher and all current redirect/API-auth rules behave identically.
- Session-refresh cookies are still copied to every redirect/JSON response.
- The Next build no longer emits the middleware-convention deprecation warning.
- Typecheck, tests, lint, placeholder-config build, and focused authenticated/unauthenticated route checks pass.

Completed work:

- Renamed the framework entry point to `src/proxy.ts` and its named export to `proxy`.
- Kept the matcher, redirect rules, API gating, and rotated-cookie handling unchanged.
- Updated the focused request-boundary test to exercise the proxy export.

### M2 — Database contract migration

**Status:** Pending
**Scope:** Introduce reproducible Supabase database type generation and schema freshness checks. Do not rewrite query behavior in the same milestone.

### M3 — Webhook orchestration migration

**Status:** Pending
**Scope:** Keep `/api/whatsapp/webhook` stable while extracting parsing, validation, persistence, media mirroring, status handling, and asynchronous dispatch into independently tested handlers.

### M4 — Workflow-service migration

**Status:** Pending
**Scope:** Establish explicit persistence/delivery/clock boundaries and migrate the flow runtime first, followed by automations.

### M5 — Client feature migration

**Status:** Pending
**Scope:** Separate data orchestration from presentation in the largest client pages/components, beginning with inbox and contacts; preserve current primitives and responsive behavior.

### M6 — Production confidence

**Status:** Pending
**Scope:** Add local Supabase integration tests, browser smoke coverage, release and rollback runbooks, and external-call observability.

## Decision needed before M2

If the intended work is instead a migration to a different stack, database, host, tenancy model, or branded product, record the exact target here before M2. The current repository is already a functioning Next.js 16 + Supabase + Meta CRM, so assuming a different destination would create avoidable product and data risk.

## Milestone evidence log

| Milestone | Verification | Result | Notes |
| --- | --- | --- | --- |
| M0 | typecheck, unit tests, lint, placeholder-config production build | Passed | Build requires Supabase configuration during prerender; temporary values were used only in process environment and not saved. |
| M1 | focused proxy test, typecheck, full unit suite, lint, placeholder-config production build | Passed | 4 focused tests and 825 total tests passed. The Next.js middleware-convention warning is absent; the build retains only the existing Edge-runtime static-generation notice. |
| Phase 2–3 | typecheck, full unit suite, lint, placeholder-config production build | Passed | 80 test files / 828 tests passed. Lint has 0 errors and 35 warnings in legacy areas not modified by Phase 2–3. The production build includes `/pipelines` and `/resources`. No live Supabase migration or authenticated browser smoke test was possible without project credentials. |
| Phase 4 | typecheck, full unit suite, lint, local-config production build | Passed | 82 test files / 833 tests passed. The focused suite covers deterministic rescue intake, invalid input, status lookup, database Request ID confirmation, duplicate delivery, and ordinary-message pass-through. Live Meta delivery and database migration remain manual setup. |

## Disaster coordination delivery

### Phase 13C — Shared-workspace access repair

**Status:** Complete and deployed.

- Production audit confirmed that the reported empty dashboard belonged to a separate, newly-created personal account. Existing operational account-scoped RLS policies correctly prevented it from seeing another workspace.
- The underlying defect is invite onboarding: opening the dashboard creates only the stock `Disaster Response Coordination` pipeline, but the invitation redemption function previously treated that harmless scaffold as user data and refused the join.
- Migration `054_allow_bootstrap_workspace_join.sql` permits cleanup only for that exact six-stage stock scaffold, while conservatively rejecting any contacts, conversations, incidents, settings, integrations, resources, activity, evidence, or other saved account data. Follow-up migration `055_fix_bootstrap_workspace_validator.sql` corrects the validator alias without changing account data or RLS.
- The dashboard now distinguishes an unjoined private workspace from a shared operational workspace and does not present all-zero incident counters as a successful shared board.
- Production acceptance used authenticated sessions for the primary workspace owner and a repaired shared administrator: both returned the same 7 incidents, 8 contacts, 8 conversations, 43 activity records, and 1 follow-up. A separate DEMO DATA session could not query a selected primary-workspace incident, its activity, or its follow-up.
- A demo-only controlled coordinator and outsider verified shared operations without touching the primary WhatsApp workspace: owner and coordinator observed the same forward-only status transitions, assignment, internal note, and six stored conversations; activity included each actor and their configured demo response team; the outsider could not read the demo incident or conversations.
- The repaired Test Gravity account was moved non-destructively into the primary shared workspace as an admin. Its verified empty bootstrap account was retained because production-account deletion requires separate authorization; the corrected invitation flow removes the exact empty scaffold atomically for future joins.

### Phase 14 — Final product hardening and demo readiness

**Status:** Implemented locally; release validation is recorded with the deployment.

- Keep the existing signed Meta/OpenWA webhooks, CRM persistence, idempotency, session model, shared-workspace RLS, and human-controlled workflow unchanged. Add only explicit panic-friendly entry aliases (`URGENT`, `RELIEF`, `MADAD`, `बचाऊ`, and `bachau`) to the compact existing trigger set; ordinary descriptions still do not start intake.
- The bilingual opening now explicitly accepts text, photos, voice messages, and WhatsApp locations, while the existing state machine creates a Request ID only after stored request/evidence and location input. Repeated triggers continue/restart an active session without creating a duplicate incident.
- Add a visible, device-persisted `English | नेपाली` selector. It changes the high-frequency operational shell labels through reviewed translations without changing original citizen messages. Detailed page translation remains a separately reviewed catalog task rather than presenting machine-generated text as production-ready Nepali.
- Report `Operational` only when the authenticated dashboard database check succeeds and there are no unresolved recorded webhook, evidence-storage, or outbound WhatsApp failures for that workspace. This is an observed-record status, not a claim that an external WhatsApp device is online.

### Phase 2 — Disaster Coordination Core

**Status:** Implemented; final validation recorded below.

- Repurpose the existing `deals` and configurable pipeline engine as incident requests; preserve contacts, conversations, authentication, roles, dashboard shell, and account-scoped database infrastructure.
- Add the fixed emergency lifecycle: `RECEIVED → VERIFIED → ASSIGNED → DISPATCHED → IN PROGRESS → RESOLVED` while retaining custom pipelines.
- Capture request ID, category, requester/contact, location and coordinates, people affected, priority, description, team/resource assignment, lifecycle timestamps, and existing conversation history.
- Keep all status movement and assignments coordinator-controlled. No WhatsApp/SMS work or automated dispatch is part of this phase.

### Phase 3 — Resource and Location Management

**Status:** Implemented; final validation recorded below.

- Add account-scoped response teams, vehicles, relief inventory, and operational locations (relief centers, shelters, medical facilities, and team locations).
- Record a coordinator-managed availability state and coordinates where applicable; associate vehicles, teams, and inventory with operational locations.
- Add a resource route that ranks only verified `available` ambulances and relief centers by basic coordinate distance. It provides a suggestion for coordinator review and never changes an incident, assigns, or dispatches a resource.

### Phase 4 — Two-way WhatsApp emergency interface

**Status:** Implemented; requires database migration and Meta WhatsApp configuration.

- Reuse the signed, idempotent inbound webhook and existing contact, conversation, message, interactive-send, and incident-pipeline infrastructure.
- Add a deterministic channel-neutral intake session with a WhatsApp adapter for service selection, minimum detail collection, request creation, confirmation, follow-up messages, and citizen-owned status lookup.
- Queue coordinator-created incident status changes in the database and send the corresponding WhatsApp update through an authenticated server route. No citizen input can verify, assign, dispatch, or resolve an incident.

### Phase 4A — OpenWA transport gateway

**Status:** Implemented; requires migration 043, persistent OpenWA hosting, and manual WhatsApp pairing.

- Preserve the existing Meta transport and account-scoped WhatsApp configuration; add OpenWA as an explicit per-account transport choice.
- Reuse the existing CRM contact, conversation, message, deterministic emergency intake, coordinator reply, and incident-status delivery paths.
- Use signed, idempotent `message.received` webhooks at `/api/whatsapp/openwa/webhook`; process plain text only and never invoke the optional AI reply system for OpenWA inbound traffic.
- Keep OpenWA API credentials and webhook HMAC secret in server-side deployment configuration. Store only the non-secret gateway session id in the existing `whatsapp_config` row.
- Run OpenWA separately from Vercel on a persistent host. Its session state is transport infrastructure; Supabase remains the single source of operational truth.
- Accept inbound OpenWA map pins during emergency intake, preserve their coordinates on the resulting incident, and render their CRM message with an openable map link. Persist OpenWA evidence photos in the existing account-scoped `chat-media` bucket; never place provider base64 image data in form fields or message text. No new table or migration is required.

### Phase 4B — Vercel scheduling

**Status:** Implemented; requires a `CRON_SECRET` in Vercel production settings.

- Register the existing automation-wait and flow-timeout sweep routes as Vercel Cron jobs.
- Accept Vercel's `Authorization: Bearer $CRON_SECRET` while preserving the existing external scheduler header for Docker deployments.
- Use daily schedules compatible with Vercel Hobby; change the committed schedule to every five minutes after upgrading to Pro if short Wait-step precision is required.

### Phase 5 — Deterministic WhatsApp automation safety

**Status:** Implemented; validated by the application test suite.

- Keep inbound WhatsApp on the existing authentication, contact/conversation/message persistence, idempotency, deterministic emergency-intake, Flow, and configured automation paths.
- Remove the reachable inherited Meta AI auto-reply dispatch from the inbound webhook. OpenWA inbound already had no AI dispatch.
- Preserve the existing human inbox for unmatched messages, the current WhatsApp transport, and configured non-AI automation. No SMS code, route, schema, or configuration is changed.
- Status communications remain predefined templates, use current database-verified assignment data only, and record delivery idempotently.

### Phase 6 — Guarded demo and DRMS operations UX

**Status:** Implemented locally; migrations 044–045 must be applied before the new database-backed surfaces are used.

- Fix the OpenWA multi-message state-machine defect by normalizing numeric service selections before the active-session gate; retain Meta behavior and exactly-once request creation.
- Add `demo:seed` and `demo:reset`, both restricted to an explicitly flagged `accounts.is_demo = TRUE` account, an explicit member actor, and the `DEMO DATA` confirmation phrase. The seed tracks each created ID per run so reset has no broad delete path.
- Add only fictional Nepal-context demo contacts, incidents, conversations, resources, teams, vehicles, relief centres, inventory, assignments, and a simulated failed status-delivery record. The seed never invokes WhatsApp, SMS, OpenWA, Meta, or a government source.
- Refine coordinator terminology and primary navigation; hide inherited AI Agents from primary DRMS navigation without deleting inherited settings or code.
- Replace revenue/value sales dashboard surfaces with the stored-data Operations Overview, active/critical/new/unassigned/dispatched/resolved counts, location summary, recent citizen communications, response status, and operational attention.
- Add case-scoped `incident_notes`, resource/vehicle recommendations from coordinator-maintained availability and stored coordinates, coordinator-confirmed assignment inputs, and Follow-up Required for unassigned cases, failed deliveries, and only explicit age rules.
- Document the strict `DEMO DATA -> normalized DRMS entities` boundary and the future official-data adapter boundary in `docs/demo-data.md`; no official-source integration is implemented.

### Phase 7 — Streamlined deterministic citizen intake

**Status:** Implemented locally; no database migration required.

- Retain the existing signed, idempotent Meta/OpenWA webhook path, session records, CRM conversations, Request ID generation, status lookup, and human-coordinator handoff.
- Replace the fixed name/location/people/details sequence with progressive collection: deterministic service aliases, explicit people-count patterns, fixed Nepal locality aliases, coordinates, and incoming WhatsApp location pins fill only missing fields.
- Reuse a valid name already attached to the same contact/conversation; a phone-looking placeholder is never treated as a citizen name. New citizens are asked only for the missing name.
- Use concise Meta lists/buttons and OpenWA numeric fallbacks. Before creation, present a concise request summary with Confirm, Edit, and Cancel; edit changes one selected field and returns to that summary.
- Keep rescue, medical, and missing-person detail prompts where operationally required. Food/water, shelter, and information receive an explicit deterministic default description when the citizen supplied no additional detail.
- Preserve numeric OpenWA service selection, Meta interactive replies, map-pin coordinates, duplicate-message protection, and the no-AI runtime guarantee. No SMS code or transport behavior is changed.

### Phase 8 — Operational Response Intelligence

**Status:** Implemented. Migrations `046`–`047` are applied to the linked Supabase project; fictional records were seeded only into the explicitly flagged `DEMO DATA` account.

- Keep `deals` as the incident model and extend it only with optional municipality/district and durable references to the already-existing team, vehicle, location, and inventory records. Existing text assignments remain for compatibility.
- Add deterministic category-compatible recommendations from stored inventory categories, location types, team names, vehicle types, verified availability, and Haversine distance. Unknown or incompatible records are not recommended.
- Require an authenticated coordinator to confirm a selection through one database transaction. It locks only the requested incident/resource rows, rejects stale availability, records an append-only activity entry, marks only selected records `ASSIGNED`, and moves the incident only to `ASSIGNED` after `VERIFIED`. It never dispatches, resolves, or sends a new message by itself.
- Add append-only `incident_activity` records for incident creation, status movement, coordinator confirmation, case notes, and queued/sent/failed status communications. Existing status-delivery idempotency and failure handling remain unchanged.
- Expand the existing incident sheet into the operational case centre with citizen communication, coordinates, deterministic resource review, assignment confirmation, visible workflow, timeline, notes, and location metadata. The dashboard now derives every requested response-status count and groups by exact location, municipality, or district.
- Extend the guarded demo script with fictional compatible/assigned/unavailable resources, multiple distances, a critical medical case, locality data, status history, and a simulated failed delivery. The seed contacted no external service.

### Phase 9 — Follow-up, Escalation & Coordinator Attention

**Status:** Implemented. Migration `048` is applied to the linked Supabase project; fictional records were refreshed only in the explicitly flagged `DEMO DATA` account.

- Keep the existing `deals` incident model, `incident_status_deliveries` outbox, `incident_activity` timeline, account-scoped RLS, and follow-up policy settings. Add only `incident_follow_ups` to retain coordinator review/clear lifecycle metadata for one incident attention item, rather than creating generic CRM tasks or duplicate reminder systems.
- Derive the active queue once from current stored state: `UNASSIGNED` only for `VERIFIED` incidents without a coordinator/team/resource; `COMMUNICATION_FAILED` only when the latest stored citizen status delivery for an incident failed; and `OVERDUE` only when its matching explicit account threshold is exceeded. There is currently no stored workflow signal for `COORDINATOR_ACTION_REQUIRED`, so the system does not fabricate that condition.
- A review is recorded as `reviewed` but never suppresses an unresolved condition. When the source condition clears, reconciliation marks the persistent row cleared and records append-only activity. The dashboard, `/follow-up`, and case centre all consume the same deterministic attention definition.
- Reuse the existing authenticated WhatsApp status-delivery service for one explicit retry action. A failed delivery must first be atomically returned to its existing `pending` outbox state, so a second coordinator click cannot create a second explicit retry; there is no background retry loop or automatic citizen messaging.
- Add the requested fictional queue scenarios to guarded demo data: critical unassigned, high unassigned with a simulated failed communication, a configured two-hour dispatched overdue case reviewed but unresolved, a normal assigned case, and a resolved case. The seed has no external side effects.

### Phase 10 — Demonstration-ready operations UI

**Status:** Implemented locally; no schema or transport changes.

- Keep the established incident, resource, communication, follow-up, account/RLS, and WhatsApp paths intact while refining the primary coordinator interface for disaster-relief operations.
- Rename visible sales-centric primary UI language to incident, citizen, response workflow, coordinator, and related-incident terminology without renaming the backward-compatible `deals` database model.
- Make every dashboard metric a navigable operational action, retain the deterministic follow-up queue, and show request ID, priority, requester, location, people affected, assignment, and explicit follow-up attention on incident cards.
- Keep resource suggestions explicitly non-authoritative: only a coordinator can confirm an assignment, assignment never dispatches, and stored availability is not presented as live tracking.
- Remove inherited AI drafting and auto-reply controls from the primary inbox surface. The retained emergency intake, Flow, and explicitly configured automation paths are deterministic; no WhatsApp transport, inbound webhook, or provider configuration changes are made.
- Keep coordinator-only notes clearly separate from citizen communication and make incident context visible in the inbox contact panel. The demo data remains fictional and isolated to the explicitly flagged `DEMO DATA` account.
- Add the final acceptance-facing dashboard communication-failure action, case identity summary, operations-first navigation ordering, and [`docs/acceptance-testing.md`](docs/acceptance-testing.md). This runbook distinguishes CRM state from provider-confirmed delivery and preserves the official-data adapter boundary.

### Phase 10A — Multi-coordinator accountability and repeated citizen requests

**Status:** Implemented and released. Migration `049` is applied to the linked Supabase project and the Vercel production deployment is live.

- Preserve the existing account/member/RLS architecture and add no account hard-coding. Status changes now pass through one coordinator-authenticated, pipeline-scoped RPC; the existing status trigger and delivery outbox remain the source of workflow and citizen-notification history.
- Extend only the existing append-only `incident_activity` trail with attributed coordinator ownership, action-linked optional remarks, and timeline display categories. No second audit system, dispatch automation, or citizen transport change is introduced.
- Keep one citizen/contact able to hold independent incidents. A new `START` after completion remains an independently created request; duplicate inbound event protection remains unchanged. Citizen status lookup remains account and contact scoped.
- Make the contact related-incidents list open each incident independently, and extend guarded DEMO DATA with two separate fictional incidents for one fictional citizen plus optional second-coordinator attribution.

### Phase 12 — WhatsApp-first operations simplification

**Status:** Implemented locally; migration `050_whatsapp_first_operations.sql` and the manual Supabase Auth configuration in [`docs/phase12-configuration.md`](docs/phase12-configuration.md) must be applied before release.

- Replace the long deterministic intake questionnaire with `START`/`HELP`, followed by a citizen request/evidence message and then an explicit location step; preserve unmatched messages for human/configured deterministic handling.
- Add a PKCE `/auth/callback`, internal-only redirect validation, reset-password destination, and DRMS metadata. Production redirect/email sender settings remain Supabase dashboard work.
- Preserve originating WhatsApp configuration per conversation/request, add safe OpenWA session registry records, durable evidence links, coordinator notifications, related-report review records, and active-vs-resolved board separation.
- Keep the account/team as the operational owner; existing invitations, role/RLS, lifecycle timeline, status outbox, resource confirmation, and conversation infrastructure are reused without AI, SMS, or automatic dispatch.

### Phase X — Private evidence and operational resilience

**Status:** Implemented; migrations `051_private_incident_evidence_and_health.sql` and `052_operational_health_agent_write.sql` are applied to the linked Supabase project.

- Store new OpenWA image/audio evidence in the private, account-scoped `drms-evidence` bucket. The legacy public `chat-media` bucket remains untouched for backwards-compatible provider media, and is not the canonical DRMS evidence store.
- Associate stored evidence with its CRM message, conversation, incident, account, media type, and timestamp. Coordinators open evidence through an authenticated route that creates a short-lived signed URL; no storage path is accepted from the browser.
- Preserve the citizen message and incident path if storage fails, while recording grouped, recoverable storage/webhook/outbound operational alerts for coordinators. The dashboard reports only observed degraded/incident signals and never declares green health from a page load.
- Keep existing idempotency, deterministic intake, human assignment/dispatch control, WhatsApp transport, and SMS scope unchanged.

### Phase AD — Failure fallback visibility

**Status:** Implemented locally; no database migration is required.

- Preserve an unsent coordinator text reply in browser session storage until the existing transport plus CRM persistence path succeeds; show an explicit offline state rather than silently discarding it.
- Make storage failures visible in the incident evidence panel without losing the message/request, make dashboard data failure explicit, and label WhatsApp transport acceptance separately from delivery confirmation.
- Keep the existing idempotent OpenWA retry, failed-notification follow-up, explicit coordinator retry, account-access warning, and manual recovery paths. [`docs/failure-fallback.md`](docs/failure-fallback.md) documents the operational matrix without adding a separate recovery platform.

### Final prototype consolidation

**Status:** Consolidated locally; release validation is required after this update.

- Lock the primary operational surface to Operations, Incidents, Citizen Communications, Follow-up, team membership, and Settings. Inherited CRM, AI, flow, broadcast, and resource-management infrastructure remains outside the primary navigation and is not part of the DRMS operating workflow.
- Replace the build-time external Google-font dependency with a production-safe English/Devanagari system font stack. Database enums and citizen text remain unchanged; citizen content is never translated or rewritten.
- Record the evidence-bound final acceptance state in [`docs/final-acceptance.md`](docs/final-acceptance.md). A complete, user-persisted Nepali UI catalog and authenticated controlled-device/provider tests remain explicitly unverified rather than being represented as complete.

### Explicit emergency entry triggers

**Status:** Implemented locally; no migration required.

- Accept only a compact explicit English, Nepali Unicode, and Romanized Nepali trigger set, after trimming simple surrounding punctuation. Ordinary message content never starts intake automatically.
- Use one bilingual opening instruction, keep active-session/idempotency behavior intact, create a new independent incident only after a completed request receives a later explicit trigger, and preserve the original citizen request text.
- Record a conservative `ne`/`en`/`mixed`/`unknown` script characteristic in the existing communication-session data without translation or rewriting.

### Two-step citizen intake and administrator directory

**Status:** Implemented locally; no migration or transport change required.

- After an approved emergency trigger, first collect the citizen's written request or photo/voice evidence. Preserve its original text, persisted CRM-message link, source WhatsApp configuration, requester identity, and language characteristic in the existing `communication_sessions` record.
- Then request a WhatsApp map pin, locality/landmark, or Google Maps link. Create the incident and its Request ID only after that location step. A location sent before a request does not create an incident.
- Add a dashboard “Available administrators” card with live member presence. It lists owner/admin name, role, and email only to authenticated members of the same account; it is not a citizen-facing or public directory.
- Move test-only parser exports out of two API route modules so the current Next.js route contract validates during a production build; operational behavior of those routes is unchanged.

### Phase 13B — Shared coordination, accountability and navigation

**Status:** Implemented and migration `053_shared_coordination_workspaces.sql` is applied to the linked Supabase project; release deployment is pending.

- Preserve `accounts`, `profiles.account_id/account_role`, account invitations, the existing incident/deal model, the existing `incident_activity` stream, and all account-scoped RLS policies. Authorized members of one workspace continue to share the same incident, contact, conversation, evidence, assignment, follow-up, resource and archive data; unrelated users remain isolated.
- Correct the invitation journey so Sign up and Sign in from `/join/<token>` retain the token through authentication and email confirmation, returning the new user to the explicit invitation acceptance step instead of silently leaving them in a separate personal workspace.
- Add one normalized `response_team_members` table connecting existing response teams to existing workspace members. It is not an authentication or data-ownership table. RLS permits every workspace member to read the team directory and only admins to change memberships.
- Extend the existing append-only `incident_activity` record with optional `actor_team_id`. A database validation trigger derives the actor’s relevant current team where deterministic, validates actor/team/account consistency, and leaves historic/system/unassigned actions explicitly marked rather than fabricating a team.
- Add shared `/activity` and `/teams` workspace views. Activity is a filterable account-scoped audit surface over the same incident timeline records; Teams is the workspace directory and membership manager. Internal incident notes remain separate from citizen WhatsApp messages and are never routed through the citizen transport.
- Keep the primary navigation DRMS-focused: Operations, Incidents, Citizen Communications, Follow-up, Activity & Accountability, Teams, and Settings. Resource management remains incident-accessible rather than a primary CRM-style module.

| Phase 6 verification | Result | Notes |
| --- | --- | --- |
| `npm run lint` | Passed | 0 errors; 35 inherited warnings remain outside this milestone. |
| `npm run typecheck` | Passed | TypeScript compilation clean. |
| `npm test` | Passed | 87 files / 851 tests, including Meta/OpenWA intake and new demo/follow-up unit coverage. |
| `npm run build` | Environment-blocked | Next.js 16 reached “Creating an optimized production build”, then could not complete in this workspace because `next/font/google` must fetch Inter and outbound DNS/network access is restricted. No source build error was reported. |
| OpenWA pin/photo follow-up | Passed locally | 90 test files / 859 tests; map pins reach incident coordinates, image base64 is stored in the existing `chat-media` bucket, and the full typecheck/lint pass with the pre-existing 35 warnings. A production build was retried but remained blocked at Next’s external font-fetch step in this workspace. |
| Phase 7 | Passed locally | `npm run typecheck`, 90 test files / 866 tests, and lint (0 errors; 35 inherited warnings) pass. Coverage includes a prior multi-message journey, multi-field food request, partial input, known citizen reuse, location pin, edit, invalid field, restart/continue, duplicate confirmation, and existing Meta/OpenWA paths. |
| Phase 8 | Passed locally and migration applied | `npm run typecheck`; 92 test files / 874 tests; lint with 0 errors and the same 35 inherited warnings. Focused coverage verifies category compatibility, nearest compatible ranking, unavailable exclusion, stale-resource rejection, coordinator-only confirmation route, status delivery idempotency, and stored locality grouping. Remote migration history records `046` and `047`; remote schema verification passed. Local Docker validation remains unavailable because Docker/Podman is not installed. |
| Phase 9 | Passed locally and migration applied | `npm run lint` completed with 0 errors and the inherited 35 warnings; `npm run typecheck` passed; `npm test` passed 92 files / 879 tests. Migration `048` applied, remote schema verification passed, and migration history matches through `048`. A production build was not rerun because this workspace's prior Next external Google Fonts/DNS block remains unresolved. The guarded demo run contains 6 incidents, 1 critical unassigned, 1 high unassigned, 1 failed delivery, 1 reviewed overdue follow-up, and 27 timeline entries; no external provider was contacted. |
| Phase 10 | Passed locally except browser/build environment checks | `npm run typecheck` passed; `npm run lint` completed with 0 errors and 36 inherited warnings; `npm test` passed 92 files / 879 tests. The browser agent cannot resolve its required service from this environment, so authenticated browser smoke testing is unavailable. `npm run build` reaches Next.js 16's optimized compilation stage but cannot complete in this restricted workspace; the trace marks the Turbopack build failed without a source-code diagnostic, consistent with the prior external Google Fonts/DNS limitation. |
| Phase 10A | Released | `npm run typecheck` passed; `npm run lint` completed with 0 errors and the same 36 inherited warnings; `npm test` passed 94 files / 883 tests, including multiple independent requests for one citizen, contact-scoped status lookup, and coordinator status-route coverage. `supabase db push --dry-run` selected only `049`; the linked project applied `049` and migration history matches through `049`. Local build again reached optimized compilation but did not complete in the restricted external-font/DNS environment; Vercel production build completed successfully. Stable `/` redirects to `/dashboard` and `/login` returned 200 in production. |
