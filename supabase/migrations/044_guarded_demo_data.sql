-- Guarded, account-scoped registry for fictional DRMS demonstration data.
--
-- This does not seed data on migration and does not change existing operational
-- records. The CLI seed command refuses any account unless `is_demo = true`.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS demo_seed_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reset')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reset_at TIMESTAMPTZ
);

-- A reset is deliberately limited to one recorded run. Keeping a registry of
-- every inserted record means it never needs a broad account/table delete.
CREATE TABLE IF NOT EXISTS demo_seed_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES demo_seed_runs(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, entity_type, entity_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_seed_runs_one_active_account
  ON demo_seed_runs(account_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_demo_seed_records_run_entity
  ON demo_seed_records(run_id, entity_type);

ALTER TABLE demo_seed_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_seed_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS demo_seed_runs_select ON demo_seed_runs;
DROP POLICY IF EXISTS demo_seed_runs_write ON demo_seed_runs;
CREATE POLICY demo_seed_runs_select ON demo_seed_runs
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY demo_seed_runs_write ON demo_seed_runs
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS demo_seed_records_select ON demo_seed_records;
DROP POLICY IF EXISTS demo_seed_records_write ON demo_seed_records;
CREATE POLICY demo_seed_records_select ON demo_seed_records
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY demo_seed_records_write ON demo_seed_records
  FOR ALL USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
