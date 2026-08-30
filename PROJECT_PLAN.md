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
