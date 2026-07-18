-- DB-backed API-key roles, lifecycle metadata, and durable privileged auditing.

ALTER TABLE api_key
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by_api_key_id UUID REFERENCES api_key(id),
  ADD COLUMN IF NOT EXISTS revoked_by_api_key_id UUID REFERENCES api_key(id),
  ADD COLUMN IF NOT EXISTS rotated_from_api_key_id UUID REFERENCES api_key(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'api_key'::regclass AND conname = 'api_key_role_check'
  ) THEN
    ALTER TABLE api_key
      ADD CONSTRAINT api_key_role_check CHECK (role IN ('standard', 'master'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS api_key_active_hash_idx
  ON api_key (key_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS privileged_audit_event (
  id BIGSERIAL PRIMARY KEY,
  api_key_id UUID NOT NULL REFERENCES api_key(id),
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  status_code INT,
  latency_ms INT,
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT privileged_audit_route_redacted CHECK (position('?' IN route) = 0)
);

CREATE INDEX IF NOT EXISTS privileged_audit_key_started_idx
  ON privileged_audit_event (api_key_id, started_at DESC);

CREATE OR REPLACE FUNCTION protect_privileged_audit_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'privileged audit events cannot be deleted';
  END IF;
  IF OLD.api_key_id IS DISTINCT FROM NEW.api_key_id
     OR OLD.method IS DISTINCT FROM NEW.method
     OR OLD.route IS DISTINCT FROM NEW.route
     OR OLD.started_at IS DISTINCT FROM NEW.started_at
     OR OLD.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'privileged audit event is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS privileged_audit_event_protect_trg ON privileged_audit_event;
CREATE TRIGGER privileged_audit_event_protect_trg
  BEFORE UPDATE OR DELETE ON privileged_audit_event
  FOR EACH ROW EXECUTE FUNCTION protect_privileged_audit_event();
