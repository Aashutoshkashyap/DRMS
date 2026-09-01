# Private evidence and operational health

New DRMS evidence received through OpenWA is stored only in the private
`drms-evidence` Supabase Storage bucket. Object paths start with
`account-<account-id>/`, and coordinators access a file through
`/api/evidence/<message-id>` after account authorization. That route issues a
60-second signed URL and never accepts a storage path from the client.

The existing `chat-media` bucket is deliberately unchanged because legacy CRM
and provider media can require a public fetch URL. It must not be used as the
canonical store for new incident evidence.

Each stored evidence object is associated with its account, incident, CRM
conversation, message, MIME type, and timestamp in `incident_evidence`. If an
upload fails, the inbound message and any resulting incident still persist;
the message records the failed evidence state and the operations dashboard
shows a grouped storage alert.

The dashboard health indicator is intentionally conservative. It shows only
observed unresolved `webhook`, `storage`, or `outbound` failures, grouped by
component and fingerprint. A normal page load reports `unknown`, not a false
"healthy" claim. A later successful operation resolves the matching component
alert. Existing failed status-delivery records remain in the follow-up queue.
