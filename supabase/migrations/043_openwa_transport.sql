-- OpenWA transport support for the existing account-scoped WhatsApp config.
--
-- Meta remains the default and existing rows stay valid. OpenWA credentials
-- are deployment secrets, while the session id is an account routing key that
-- lets signed inbound events resolve to the same CRM account.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS transport TEXT NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS openwa_session_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_transport_check'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_transport_check
      CHECK (transport IN ('meta', 'openwa'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_openwa_requires_session'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_openwa_requires_session
      CHECK (transport <> 'openwa' OR openwa_session_id IS NOT NULL);
  END IF;
END $$;

-- A Meta phone id/token is not meaningful for an OpenWA account. Existing
-- Meta rows remain NOT NULL in practice; only OpenWA rows may leave them null.
ALTER TABLE whatsapp_config
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_openwa_session
  ON whatsapp_config (openwa_session_id)
  WHERE transport = 'openwa';
