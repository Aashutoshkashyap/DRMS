-- Private DRMS evidence + compact operational-health stream.
-- Legacy `chat-media` remains untouched because existing Meta transport may
-- need a public fetch URL. Disaster evidence uses this separate private bucket.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS media_storage_status TEXT NOT NULL DEFAULT 'none'
    CHECK (media_storage_status IN ('none', 'stored', 'failed')),
  ADD COLUMN IF NOT EXISTS media_storage_error TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_media_storage_path
  ON messages(media_storage_path) WHERE media_storage_path IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'drms-evidence', 'drms-evidence', FALSE, 16777216,
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/amr',
    'video/mp4', 'video/3gpp', 'video/3gp', 'video/quicktime',
    'application/pdf', 'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "DRMS evidence member read" ON storage.objects;
CREATE POLICY "DRMS evidence member read" ON storage.objects FOR SELECT
  USING (bucket_id = 'drms-evidence' AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
  ));

DROP POLICY IF EXISTS "DRMS evidence member write" ON storage.objects;
CREATE POLICY "DRMS evidence member write" ON storage.objects FOR ALL
  USING (bucket_id = 'drms-evidence' AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
  )) WITH CHECK (bucket_id = 'drms-evidence' AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
  ));

CREATE TABLE IF NOT EXISTS incident_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  storage_bucket TEXT NOT NULL DEFAULT 'drms-evidence' CHECK (storage_bucket = 'drms-evidence'),
  storage_path TEXT NOT NULL,
  media_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deal_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_incident_evidence_account_deal ON incident_evidence(account_id, deal_id, created_at);
ALTER TABLE incident_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incident_evidence_select ON incident_evidence;
DROP POLICY IF EXISTS incident_evidence_write ON incident_evidence;
CREATE POLICY incident_evidence_select ON incident_evidence FOR SELECT USING (is_account_member(account_id));
CREATE POLICY incident_evidence_write ON incident_evidence FOR ALL
  USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS operational_health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  component TEXT NOT NULL CHECK (component IN ('webhook', 'storage', 'outbound')),
  fingerprint TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'degraded' CHECK (severity IN ('degraded', 'incident')),
  message TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count > 0),
  recovered_at TIMESTAMPTZ,
  UNIQUE(account_id, component, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_operational_health_active
  ON operational_health_events(account_id, recovered_at, last_seen_at DESC);
ALTER TABLE operational_health_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_health_events_select ON operational_health_events;
CREATE POLICY operational_health_events_select ON operational_health_events FOR SELECT
  USING (is_account_member(account_id, 'agent'));
