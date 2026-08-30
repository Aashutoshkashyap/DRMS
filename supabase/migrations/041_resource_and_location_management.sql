-- Lightweight operational resource and location registry.
-- Availability is coordinator-maintained operational data; no trigger or
-- workflow automatically assigns or dispatches a resource.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_availability_enum') THEN
    CREATE TYPE resource_availability_enum AS ENUM ('available', 'limited', 'unavailable', 'maintenance');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operational_location_type_enum') THEN
    CREATE TYPE operational_location_type_enum AS ENUM ('relief_center', 'shelter', 'medical_facility', 'team_location');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS operational_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_type operational_location_type_enum NOT NULL,
  address TEXT,
  landmark TEXT,
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  contact TEXT,
  availability resource_availability_enum NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE IF NOT EXISTS response_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact TEXT,
  location_id UUID REFERENCES operational_locations(id) ON DELETE SET NULL,
  availability resource_availability_enum NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL,
  identifier TEXT NOT NULL,
  team_id UUID REFERENCES response_teams(id) ON DELETE SET NULL,
  location_id UUID REFERENCES operational_locations(id) ON DELETE SET NULL,
  contact TEXT,
  availability resource_availability_enum NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, identifier)
);

CREATE TABLE IF NOT EXISTS relief_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_category TEXT NOT NULL CHECK (item_category IN ('food', 'water', 'medicine', 'relief_package')),
  item_name TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit TEXT NOT NULL,
  location_id UUID REFERENCES operational_locations(id) ON DELETE SET NULL,
  availability resource_availability_enum NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operational_locations_account_availability ON operational_locations(account_id, availability);
CREATE INDEX IF NOT EXISTS idx_response_teams_account_availability ON response_teams(account_id, availability);
CREATE INDEX IF NOT EXISTS idx_vehicles_account_availability ON vehicles(account_id, availability);
CREATE INDEX IF NOT EXISTS idx_relief_inventory_account_availability ON relief_inventory(account_id, availability);

ALTER TABLE operational_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE relief_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY operational_locations_select ON operational_locations FOR SELECT USING (is_account_member(account_id));
CREATE POLICY operational_locations_write ON operational_locations FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY response_teams_select ON response_teams FOR SELECT USING (is_account_member(account_id));
CREATE POLICY response_teams_write ON response_teams FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY vehicles_select ON vehicles FOR SELECT USING (is_account_member(account_id));
CREATE POLICY vehicles_write ON vehicles FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY relief_inventory_select ON relief_inventory FOR SELECT USING (is_account_member(account_id));
CREATE POLICY relief_inventory_write ON relief_inventory FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON operational_locations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON response_teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON relief_inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
