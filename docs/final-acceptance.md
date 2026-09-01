# DRMS prototype final acceptance

This is an evidence record, not a claim that untested live integrations have
passed. DRMS scope is frozen to a WhatsApp-first, human-coordinated disaster
relief platform for Nepal: no AI decision-making, no SMS workflow, and no
automatic dispatch.

| Area | Status | Evidence | Remaining limitation |
| --- | --- | --- | --- |
| Shared account incident board and role isolation | PASS — code/database verified | Account-scoped RLS and coordinator status RPCs; migrations through `052` are applied. | Controlled two-coordinator browser session has not been run in this release. |
| Repeated incidents from one citizen | PASS — code verified | Independent request IDs, contact-scoped history, webhook idempotency, and regression coverage. | Requires a controlled OpenWA device to verify end-to-end. |
| Deterministic WhatsApp intake and original-language preservation | PASS — code verified | OpenWA persists received content unchanged; no AI path is in the intake runtime. | Live Nepali/romanized-Nepali gateway test remains pending. |
| Incident case centre, related-request cues, resources, follow-up | PASS — code/database verified | Existing incident sheet, deterministic matching, coordinator confirmation, activity trail, and explicit retry. | No live resource-operation test in this release. |
| Private evidence | PASS — database/code verified | Private `drms-evidence`, authenticated signed URL route, message/incident association, migrations `051`–`052`. | Controlled photo/audio upload and account-isolation test remain pending. |
| Failure fallback and status semantics | PASS — code verified | [`failure-fallback.md`](failure-fallback.md), grouped health alerts, failed-delivery follow-up, explicit retry, offline banner, retained reply draft. | No simulated Railway/Supabase outage has been run against production. |
| Devanagari-safe typography | PASS — code verified | System-first English/Devanagari stack with no `next/font/google` build dependency. | Visual checks on target Android/iOS devices remain pending. |
| English / नेपाली application-wide toggle | BLOCKED | Current next-intl setup selects a deployment-wide locale and has no Nepali catalog or user-persisted preference. | Requires a reviewed full Nepali catalog and a profile-backed locale preference; it is not safe to label partial translations as application-wide support. |
| Production authentication and email | BLOCKED | `/auth/callback` PKCE path and internal redirect validation are deployed. | Supabase dashboard Site URL, redirect allow-list, SMTP sender, templates, and a real verification/reset email still require manual production confirmation. |
| Vercel production build | PENDING | This release will run the Vercel build after validation. | None once deployment is Ready. |
| Railway/OpenWA session, rate, and provider delivery | BLOCKED | Outbound errors and failed status deliveries are surfaced; no provider receipt is mislabelled as delivered. | Railway/OpenWA console and a controlled recipient/device are required for a live session, capacity, and delivery-receipt check. |

## Safe demonstration order

1. Sign in with the guarded **DEMO DATA** account only.
2. Show Operations, an active incident, its activity, related cues, evidence,
   follow-up, and coordinator-confirmed assignment.
3. Use a controlled WhatsApp device for one `START` request, one location or
   media attachment, and one explicit coordinator status retry.
4. Do not test against an operational citizen or claim delivery without a
   provider-level receipt.
