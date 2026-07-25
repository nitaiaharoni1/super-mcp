-- Access requests submitted from the marketing site (public form, no auth).
CREATE TABLE IF NOT EXISTS access_requests (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  use_case TEXT,
  source TEXT NOT NULL DEFAULT 'marketing_site',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_requests_created_at_idx
  ON access_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS access_requests_email_idx
  ON access_requests (email);
