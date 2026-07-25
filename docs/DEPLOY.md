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
| `CORS_ORIGINS` | server (required for the marketing access form; comma-separated browser origins) |
| `SUPER_MCP_READY_REQUIRE_AUTH` | server (`1` recommended on public hosts) |
| `SUPER_MCP_ALLOW_MCP_QUERY_API_KEY` | server (must stay unset/`0`) |
| `NOMINATIM_USER_AGENT` | server (identifying contact for OSM policy) |
| `NEXT_PUBLIC_MCP_URL` | web hosting only |
| `NEXT_PUBLIC_POSTHOG_KEY` | web hosting only (Baliprop + Reflex project token) |
| `NEXT_PUBLIC_POSTHOG_HOST` | web hosting only (`https://eu.i.posthog.com`) |
| `POSTHOG_KEY` | API/MCP server (same project token) |
| `POSTHOG_HOST` | API/MCP server (`https://eu.i.posthog.com`) |

Filter PostHog insights with `product = super_mcp`. Design: [docs/superpowers/specs/2026-07-21-posthog-analytics-design.md](./superpowers/specs/2026-07-21-posthog-analytics-design.md).

Self-hosters clone this repo and supply **their own** values; they receive no access to the operator’s cloud.

## Release order for migrations 023 / 024 (breaking if reversed)

`listStores` and the product-prices query both SELECT `store.store_kind`, which
migration 023 adds. Deploying the code before running the migration takes every
store, basket and compare-prices call to a 500. Verified against a database with
the column dropped: `column st.store_kind does not exist`.

So the order is fixed:

1. **Run migrations first**, against the production database, from a machine that
   can reach it: `DATABASE_URL=<prod> pnpm db:migrate`. Applies 023 (adds
   `store.store_kind` and `store_price.last_seen_at`, repairs `chain.source_id`)
   and 024 (reclassifies URL-only-address rows as online). Both are idempotent and
   safe to run against the old code, which simply ignores the new columns. 023
   deliberately does not backfill `last_seen_at`; backfilling rewrote 6.7M rows and
   held the transaction open for 6.5 minutes.
2. **Then deploy the code.**
3. **Then repair store data**, in this order, because each tier depends on the one
   before:
   ```bash
   DATABASE_URL=<prod> pnpm --filter @super-mcp/db exec tsx src/scripts/geocodeStores.ts --mode=city
   DATABASE_URL=<prod> pnpm --filter @super-mcp/db exec tsx src/scripts/geocodeStores.ts --mode=centroid
   NOMINATIM_USER_AGENT="super-mcp-geocode/1.0 (contact: <you>)" \
     DATABASE_URL=<prod> pnpm --filter @super-mcp/db exec tsx src/scripts/geocodeStores.ts --mode=address --overpass
   ```
   The address tier is rate limited to about 1 request/second and takes hours for a
   few hundred stores; it is resumable and safe to stop and restart. Until it runs,
   distances stay city-accurate rather than branch-accurate, which is correct but
   coarse.
4. **Verify** before and after:
   ```sql
   SELECT store_kind, count(*), count(lat) FROM store GROUP BY 1;
   SELECT count(*) FROM store WHERE city IS NULL OR city = '';
   ```
   Locally this took stores with no coordinates from 165 to 12 and Yohananof from
   0 geocoded to 47.

Reverting the code without reverting the migration is safe. Reverting the
migration while the new code is live is not.

### Cloud Run note

Fast-mode geocoding answers from a city centroid and resolves the real address in
a detached promise so the next call for that place is address-precise. Cloud Run
throttles CPU outside a request unless CPU-always-on is set, so that warm-up may
not complete there; the request path is unaffected (it never awaits it), but
addresses will keep resolving at city precision until the cache is warmed some
other way.
