-- Phase 8 needs a coordinator-confirmed reservation state. Keep this in a
-- dedicated migration because PostgreSQL does not permit a newly added enum
-- value to be used safely until the transaction that adds it has committed.
ALTER TYPE resource_availability_enum ADD VALUE IF NOT EXISTS 'assigned';
