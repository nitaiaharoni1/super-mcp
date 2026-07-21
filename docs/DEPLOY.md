# Deploy boundary (private ops)

The **public GitHub repository** must never be able to deploy to or authenticate against the operator’s production cloud.

## Rules

1. **No secrets in YAML or source** — database URLs, API keys, `BASKET_CONTINUATION_SECRET`, `GEOCODING_CACHE_SECRET`, service-account JSON, and Firebase/App Hosting bindings live in Secret Manager / GitHub Environment secrets only.
2. **No real GCP/Firebase project IDs in the public tree** — use placeholders in docs; real IDs stay in private ops config.
3. **Public CI is test-only** — [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs unit tests, gitleaks, and ephemeral Postgres benchmarks. It must not deploy.
4. **Deploy via private authority** — prefer one of:
   - GitHub Environment `production` with required reviewers + OIDC to a locked-down Cloud Run deploy service account, **or**
   - A **private** ops repository / workflow that consumes this repo as source.
5. **Marketing / web** — set `NEXT_PUBLIC_MCP_URL` (and any other public URLs) in the hosting environment only; never commit production hostnames as required defaults.
6. **External user keys** — mint **standard** role keys only (HTTP admin or CLI). Masters via CLI break-glass only.

## Suggested production env (names only)

| Variable | Scope |
|----------|--------|
| `DATABASE_URL` | server |
| `BASKET_CONTINUATION_SECRET` | server (≥32 bytes, unique) |
| `GEOCODING_CACHE_SECRET` | server (≥32 bytes, unique) |
| `CORS_ORIGINS` | server (comma-separated allowlist if browsers call the API) |
| `SUPER_MCP_READY_REQUIRE_AUTH` | server (`1` recommended on public hosts) |
| `SUPER_MCP_ALLOW_MCP_QUERY_API_KEY` | server (must stay unset/`0`) |
| `NOMINATIM_USER_AGENT` | server (identifying contact for OSM policy) |
| `NEXT_PUBLIC_MCP_URL` | web hosting only |

Self-hosters clone this repo and supply **their own** values; they receive no access to the operator’s cloud.
