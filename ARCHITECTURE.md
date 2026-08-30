# wacrm architecture assessment

**Assessment date:** 2026-08-30
**Baseline:** upstream `ArnasDon/wacrm` at `6ed9191`
**Scope:** repository source, migration history, configuration, CI, and package topology. This assessment did not connect to a live Supabase project, Meta application, or production deployment.

## Executive summary

wacrm is a self-hosted, account-scoped WhatsApp CRM. It is a Next.js 16 App Router application with a React client UI, Supabase for authentication, PostgreSQL, storage, and realtime, and Meta's WhatsApp Cloud API as its messaging integration. Optional OpenAI or Anthropic accounts power reply drafting and knowledge retrieval.

The implementation is feature-oriented at the directory level, but a few high-risk integration paths are concentrated in very large files: the inbound WhatsApp webhook (1,244 lines), the automation builder (1,595), the inbox thread (1,203), the flow engine (1,155), and the Meta client (1,057). The codebase has a solid unit-test baseline (79 files / 825 tests) and schema validation in CI, but it has no checked-in browser end-to-end suite or generated database type contract.

The safe modernization strategy is incremental: preserve the public HTTP, database, and webhook contracts; add characterization coverage; move one bounded integration seam at a time; and verify typecheck, unit tests, lint, production build, and relevant manual workflows after every milestone.

## Disaster-response reuse map

| Existing component | Decision | Phase 2–3 use |
| --- | --- | --- |
| Supabase Auth, profiles, accounts, RLS | Reuse unchanged | Coordinator identity, roles, and account isolation remain the operational boundary. |
| Contacts, conversations, messages, inbox | Reuse | A request retains its contact and opens the existing communication history; no second messaging system is introduced. |
| Pipelines, pipeline stages, deals, board | Refactor | `deals` becomes the incident/request record and the board uses the emergency status workflow. |
| Dashboard shell, sidebar, shadcn-style UI primitives | Reuse | Incident filters and the resources/location route use the existing dashboard and UI system. |
| WhatsApp, SMS, webhook, broadcasts | Preserve; future integration | No Phase 2–3 change. A future citizen channel must create/update the same request records. |
| Location and resource registry | New, minimal | Account-scoped locations, teams, vehicles, and relief inventory, with verified availability and coordinate-distance lookup. |
| AI-assistant features | Excluded from operations decisions | No AI determines verification, assignment, availability, or dispatch. |

## Repository inventory

| Area | Observed size / responsibility |
| --- | --- |
| Application source | 377 TypeScript/TSX files, 61,472 production lines |
| UI routes | 22 page routes under `src/app` |
| HTTP surface | 55 route handlers, including a versioned public API at `/api/v1` |
| Client boundary | 118 client components |
| Tests | 79 test files / 825 tests (Vitest) |
| Database evolution | 39 ordered SQL migrations, 36 application tables, 147 RLS policies, 34 PostgreSQL functions, 18 triggers, 73 explicit indexes |
| Deployment | Next standalone output, Dockerfile + Compose, Node 20+, documented managed Node hosting |

## System context

```text
Browser
  |-- React client features, shadcn-style primitives, hooks, next-intl
  |-- direct user-scoped Supabase reads/writes (protected by RLS)
  v
Next.js App Router + Proxy
  |-- pages/layouts and authenticated dashboard shell
  |-- route handlers: validation, role checks, public API, cron entry points
  |-- privileged service-role operations and third-party orchestration
  +---------------------------+-----------------------------+
  |                           |                             |
  v                           v                             v
Supabase                  Meta WhatsApp API       Optional AI providers
Auth / Postgres / RLS     webhook, send, media,   OpenAI / Anthropic
Storage / Realtime        templates, reactions    encrypted per-account key
  |
  +-- Postgres triggers/RPCs --> notifications, aggregation, dedupe,
      invitation/member operations, automation/flow state

Cron caller --> /api/automations/cron and /api/flows/cron
Webhook dispatcher --> account-configured outbound webhook endpoints
```

## Runtime architecture

### Entry, authentication, and tenancy

- `src/app/layout.tsx` establishes the root document, locale, theme, and notification layer. `(auth)`, `(dashboard)`, and `join` layouts provide the three major UI shells.
- The request boundary lives in `src/proxy.ts`. It refreshes Supabase sessions, preserves rotated cookies through redirects, gates protected pages and non-webhook WhatsApp routes, and redirects authenticated users away from auth pages.
- `src/hooks/use-auth.tsx`, `src/hooks/use-can.ts`, and `src/lib/auth/account.ts` expose the account/member model. Roles are `owner`, `admin`, `agent`, and `viewer`.
- Browser-side feature pages often use `src/lib/supabase/client.ts` directly; server handlers use `src/lib/supabase/server.ts` or a service-role client. This is intentional but means the database/RLS contract is part of the application API.

### Application modules and dependency map

| Module | UI / entry points | Core library dependencies | Primary data | External boundary |
| --- | --- | --- | --- | --- |
| Identity and account | auth pages, settings, `/api/account/*`, invitation routes | `lib/auth/*`, `lib/account/members` | profiles, accounts, account_invitations, api_keys | Supabase Auth |
| Contacts | contacts page and detail/form/import components, contact tag route | `lib/contacts/*`, `lib/api/v1/contacts` | contacts, tags, contact_tags, custom fields/values, notes | CSV input, public API |
| Inbox | inbox page, conversation list, message thread/composer/sidebar | `lib/inbox/*`, `lib/media/*`, `lib/whatsapp/send-message` | conversations, messages, reactions, presence | Meta sends/media, Supabase Realtime |
| WhatsApp configuration/templates | settings components, `/api/whatsapp/config`, templates, send, react, media routes | `lib/whatsapp/*`, `lib/storage/upload-media` | whatsapp_config, message_templates, quick_replies | Meta Cloud API, Supabase Storage |
| Pipelines | pipelines page and board/deal/settings components | UI-local mutations and shared types | pipelines, pipeline_stages, deals | Supabase RLS client |
| Broadcasts | broadcast wizard/detail pages and resume/send routes | `lib/whatsapp/broadcast-*`, `hooks/use-broadcast-sending` | broadcasts, broadcast_recipients | Meta template sends |
| Automations | builder, list/editor/log pages, engine and cron routes | `lib/automations/*`, `lib/webhooks/*`, WhatsApp sender | automations, steps, logs, pending executions | Meta, outbound HTTPS webhooks, cron |
| Flows | canvas/builder/editor/run pages, flow routes and cron | `lib/flows/*`, shared Meta sender | flows, nodes, runs, run events | Meta, Supabase Storage, cron |
| AI assistant | agent/settings UI and `/api/ai/*` | `lib/ai/*` | ai_configs, knowledge documents/chunks, usage log | OpenAI / Anthropic |
| Notifications and presence | notification page, presence components/hooks | `lib/presence`, realtime hooks | notifications, member_presence | Supabase Realtime |
| Public API and outbound webhooks | `/api/v1/*` and account API-key routes | `lib/api/*`, `lib/api-keys/*`, `lib/webhooks/*` | api_keys, application domain tables, webhook_endpoints | client APIs, signed outbound HTTPS |

### Dependency direction

```text
app pages / client components
       |                  \
       |                   --> hooks --> browser Supabase client --> RLS data
       v
route handlers --> auth / API context --> domain library --> Supabase / Meta / AI / HTTP
                                      \-> pure validators, mappers, state helpers

database migrations --> tables, RLS, indexes, RPCs, triggers --> all application layers
```

The desired direction is inward: UI and route handlers depend on domain services; domain services depend on ports/adapters; database and third-party clients stay at the edge. Existing `lib/*` is the natural landing place, but some route handlers and pages still contain query/orchestration logic that should move only behind characterization tests.

## Database analysis

### Multi-tenant model

Migration `017_account_sharing.sql` converts the original per-user schema into account tenancy. `accounts` is the tenant root; `profiles` connects an authenticated user to one account and a role; `account_invitations` controls membership onboarding. Most operational tables carry `account_id`; historical `user_id` fields remain useful for attribution and legacy compatibility.

RLS is the core isolation mechanism. The `is_account_member(account_id, min_role)` database helper is used by table policies, with viewer read access, agent operational write access, and admin/owner configuration access. Service-role clients deliberately bypass RLS for the verified Meta webhook, cron execution, and API-key authentication paths, so those paths must explicitly scope every query by account.

### Domain model

```text
auth.users --> profiles --> accounts <-- account_invitations
                         |
                         +--> contacts --< contact_tags >-- tags
                         |       |--< contact_custom_values >-- custom_fields
                         |       +--< contact_notes
                         |
                         +--> conversations --< messages --< message_reactions
                         |        |                  |
                         |        +--< deals          +-- media metadata / replies
                         |
                         +--> pipelines --< pipeline_stages --< deals
                         +--> broadcasts --< broadcast_recipients >-- contacts
                         +--> automations --< automation_steps / logs / pending executions
                         +--> flows --< flow_nodes; flows --< flow_runs --< flow_run_events
                         +--> WhatsApp config, message templates, quick replies
                         +--> AI config --< knowledge documents --< knowledge chunks
                         +--> API keys, webhook endpoints, notifications, member presence
```

### Table groups

| Group | Tables | Notes |
| --- | --- | --- |
| Tenant and security | profiles, accounts, account_invitations, api_keys, member_presence, notifications | Auth and account role are security-critical. API keys are stored hashed and scoped. |
| CRM | contacts, tags, contact_tags, custom_fields, contact_custom_values, contact_notes | Contacts are deduplicated by normalized phone within an account. |
| Messaging | conversations, messages, message_reactions, whatsapp_config, message_templates, quick_replies | High-write path. Composite uniqueness protects inbound message idempotency and account/contact conversation dedupe. |
| Sales and campaigns | pipelines, pipeline_stages, deals, broadcasts, broadcast_recipients | Trigger/RPC-based aggregation preserves broadcast counters. |
| Automation | automations, automation_steps, automation_logs, automation_pending_executions | Cron drains due work; outbound webhook calls use SSRF controls. |
| Flows | flows, flow_nodes, flow_runs, flow_run_events | State-machine runtime, with a single active flow run per account/contact. |
| AI and integrations | ai_configs, ai_knowledge_documents, ai_knowledge_chunks, ai_usage_log, webhook_endpoints | Optional pgvector semantic search; FTS remains the baseline. |

### Migration and operational observations

- Migrations are additive and largely idempotent, with explicit policy/trigger recreation where PostgreSQL lacks `IF NOT EXISTS` support. `supabase/ci/verify-schema.sql` provides a schema assertion layer.
- Important database-side behavior includes signup/account bootstrap, membership RPCs, contact/conversation deduplication, broadcast aggregation and recipient creation, notification generation, profile privilege enforcement, AI reply-slot claims, and full-text/vector retrieval.
- The message/conversation path is the principal data hot path: it supports inbound webhook inserts, outbound sends, read/delivery receipts, reactions, media mirroring, realtime delivery, automations, flows, AI, and broadcasts. Alterations here require idempotency and ordering tests.
- No generated `Database` types were found. `src/types/index.ts` contains application types, but it cannot prove agreement with the evolving SQL schema. Adding a reproducible type-generation/check step is the first data-contract improvement after the framework deprecation migration.
- Live migration application, RLS behavior, storage policies, and Postgres performance were not verified because this workspace has no Supabase project configuration or credentials. They remain explicit release gates, not assumed facts.

## Reusable component and service inventory

| Reuse tier | Assets | Recommended use |
| --- | --- | --- |
| Design primitives | `src/components/ui/*` (Button, Dialog, Sheet, Popover, Tabs, Table, form controls, etc.) | Prefer these for all new controls; keep accessibility and styling behavior centralized. |
| App chrome | `src/components/layout/*`, `dashboard-shell.tsx`, `themed-toaster.tsx` | Shared navigation, account warnings, theme mode, and notifications. |
| Permissions and session | `RequireRole`, `GatedButton`, `useAuth`, `useCan` | Do not reproduce role checks in individual UI surfaces. Server endpoints must still authorize independently. |
| Data interaction | `useRealtime`, `usePresence`, unread hooks, media blob URL hook | Reuse for subscription lifecycle and browser media cleanup. |
| Charts | dashboard metrics/charts and `components/tremor/*` | Preserve the existing chart wrapper rather than adding a competing library. |
| Messaging | composer, bubble, media, reply quote, template picker, interactive builder/preview | These embody WhatsApp-specific rendering and validation constraints. |
| Data/business helpers | `lib/contacts/*`, `lib/whatsapp/*`, `lib/automations/*`, `lib/flows/*`, `lib/ai/*`, `lib/webhooks/*` | Prefer pure helper extraction here before adding new route-local business logic. |

## Identified migration candidates and constraints

1. **Next.js request convention:** the verified build reports that the `middleware` file convention is deprecated. This is a small, behavior-preserving `middleware` to `proxy` migration and is the first implementation milestone.
2. **Database contract drift:** manually maintained application types can diverge from 39 SQL migrations. Introduce generated types and a CI freshness check without changing runtime query behavior.
3. **Webhook concentration:** `src/app/api/whatsapp/webhook/route.ts` coordinates validation, config lookup, inbound parsing, media persistence, status updates, automations, flows, AI, and outbound webhooks. Extract handler units behind the existing route only after route-level characterization tests cover its HTTP contract and idempotency.
4. **Workflow engine concentration:** automation and flow engines contain state transitions, waiting/scheduling, Meta sending, and database writes. Establish explicit ports for storage, clock, and delivery, then migrate one engine at a time.
5. **Client page concentration:** inbox, contacts, settings, and builders blend data queries, mutation orchestration, UI state, and rendering. Move query/mutation logic to feature hooks and leaf presentation components without changing direct-RLS behavior until service boundaries are proven.
6. **Release evidence:** current unit coverage is strong but not enough to prove authentication redirects, RLS, webhook signature processing, storage policies, and external integration behavior. Add local Supabase integration tests plus a small Playwright smoke suite before major module moves.

## Verification baseline

Executed on the assessment baseline:

| Command | Result |
| --- | --- |
| `npm ci` | passed; lockfile installation completed with no reported vulnerabilities |
| `npm run typecheck` | passed |
| `npm test` | passed: 79 files / 825 tests |
| `npm run lint` | passed with 37 pre-existing warnings and zero errors |
| `npm run build` | passed with temporary non-secret placeholder configuration; direct build without variables fails during auth-page prerender because Supabase configuration is intentionally required |

The successful build retains a Next.js deprecation warning for `middleware`, which Milestone 1 addresses. It also notes that Edge runtime disables static generation for relevant pages; this is informational and should be assessed separately from the proxy rename.

## Proposed migration roadmap

The roadmap is intentionally contract-first. It does not include a database rewrite, vendor change, or user-facing feature redesign, because no target platform or data migration has been specified.

| Milestone | Scope | Exit criteria | Status |
| --- | --- | --- | --- |
| 0. Architecture baseline | This assessment, dependency/data map, test and build baseline, plan record | Documents reviewed; known limits and baseline commands recorded | Complete |
| 1. Next.js 16 request-boundary migration | Renamed the deprecated request entry point from `middleware` to `proxy`; preserved matcher, redirects, session refresh, and API gating | typecheck, test, lint, production build; focused auth redirect test | Complete |
| 2. Database contract migration | Generate Supabase database types from migrations/project schema; replace duplicated schema-shaped types incrementally; add freshness verification | migrations apply in an ephemeral project, generated types are current, typecheck/test/build pass | Pending |
| 3. Webhook orchestration migration | Split inbound webhook route into parse/validate/resolve/persist/dispatch handlers under a stable HTTP facade | signature/idempotency/media/status/dispatch characterization tests and webhook route contract pass | Pending |
| 4. Workflow-service migration | Introduce explicit repository/delivery/clock ports; move flows first, then automations | existing engine suites plus clock/retry/cron integration tests pass | Pending |
| 5. Client feature migration | Extract data hooks and presentation leaves from inbox, contacts, settings, builders; keep existing UI primitives and RLS model | route smoke tests, responsive checks, lint warnings do not increase, build passes | Pending |
| 6. Production confidence migration | Add local Supabase integration coverage, Playwright smoke journeys, migration rollback/runbook, and observability for external calls | staging rehearsal and documented release/rollback approval | Pending |

Each milestone is independently releasable. No subsequent milestone should start until its verification evidence is recorded in `PROJECT_PLAN.md`.
