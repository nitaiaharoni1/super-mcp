-- Fixed identity for keyless (anonymous) callers.
--
-- usage_event.api_key_id and privileged_audit_event.api_key_id are NOT NULL foreign keys, so
-- keyless traffic needs a row to meter against. This row must never authenticate anyone:
--   * key_hash is not a 64-char hex digest, so no sha256(raw key) can ever equal it;
--   * revoked_at is set, and resolveApiKey filters on revoked_at IS NULL.
-- Both guards are deliberate belt-and-braces. The id is pinned because the API hard-codes it
-- (ANONYMOUS_API_KEY_ID in services/api/src/auth.ts).

INSERT INTO api_key (id, name, key_hash, key_prefix, role, rate_limit_per_minute, revoked_at)
VALUES (
  '00000000-0000-0000-0000-0000000000a1',
  'anonymous',
  'anonymous:not-a-credential',
  'anon',
  'standard',
  0,
  now()
)
ON CONFLICT (id) DO NOTHING;
