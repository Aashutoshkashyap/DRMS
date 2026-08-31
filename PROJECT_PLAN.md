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

| Phase 6 verification | Result | Notes |
| --- | --- | --- |
| `npm run lint` | Passed | 0 errors; 35 inherited warnings remain outside this milestone. |
| `npm run typecheck` | Passed | TypeScript compilation clean. |
| `npm test` | Passed | 87 files / 851 tests, including Meta/OpenWA intake and new demo/follow-up unit coverage. |
| `npm run build` | Environment-blocked | Next.js 16 reached “Creating an optimized production build”, then could not complete in this workspace because `next/font/google` must fetch Inter and outbound DNS/network access is restricted. No source build error was reported. |
| OpenWA pin/photo follow-up | Passed locally | 90 test files / 859 tests; map pins reach incident coordinates, image base64 is stored in the existing `chat-media` bucket, and the full typecheck/lint pass with the pre-existing 35 warnings. A production build was retried but remained blocked at Next’s external font-fetch step in this workspace. |
