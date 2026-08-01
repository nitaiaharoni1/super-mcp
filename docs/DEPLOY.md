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
| `SUPER_MCP_SURFACES` | server (optional). Unset serves both MCP surfaces; `stores` or `online` splits them across deployments. See below. |
| `NOMINATIM_USER_AGENT` | **server (required)**. OSM returns 403 to the placeholder default, so address geocoding silently degrades to city centroids. See below. |
| `SUPER_MCP_NO_CAP` | **ingest job (required, `1`)**. Without it the ingest silently covers ~1% of stores. See below. |
| `NEXT_PUBLIC_MCP_URL` | web hosting only |
| `NEXT_PUBLIC_POSTHOG_KEY` | web hosting only (Baliprop + Reflex project token) |
| `NEXT_PUBLIC_POSTHOG_HOST` | web hosting only (`https://eu.i.posthog.com`) |
| `POSTHOG_KEY` | API/MCP server (same project token) |
| `POSTHOG_HOST` | API/MCP server (`https://eu.i.posthog.com`) |

Filter PostHog insights with `product = super_mcp`. Design: [docs/superpowers/specs/2026-07-21-posthog-analytics-design.md](./superpowers/specs/2026-07-21-posthog-analytics-design.md).

Self-hosters clone this repo and supply **their own** values; they receive no access to the operator’s cloud.

## NOMINATIM_USER_AGENT: unset means silently wrong distances

OpenStreetMap's usage policy requires an identifying User-Agent with a real
contact. The built-in default carries a placeholder address, and OSM answers it
with **403**. Geocoding then reports `unavailable` and falls back to the city
centroid, which is the honest thing for it to do but leaves every distance
measured from the middle of town.

That is exactly what happened on the first deploy of the precise-geocoding change:
the code was right, the tests passed, and production still returned

    "Geocoding temporarily unavailable (http_403); using city centroid"

Measured for "מנדלסון 1, תל אביב": the centroid sits about 600m from the address,
enough to reorder which branches look nearest, on a product whose whole promise is
which shop is closest. Verified after setting the variable: `precision: "address"`,
`provider: "nominatim"`, and a second identical request came back `cached: true`,
which also keeps us inside OSM's one-request-per-second policy.

Set it on the Cloud Run **service**. It is also set on the ingest job, which does
not call Nominatim today (its geocoding step is the offline centroid backfill) but
would hit the same silent 403 the moment someone adds the address tier there.

## The ingest job MUST set SUPER_MCP_NO_CAP=1

`ingestCaps.ts` defaults to **2 stores per chain** for fast local smoke runs, and
`expectedChains.ts` narrows Cerberus to `CERBERUS_CHAINS.slice(0, 2)`. Both defaults
apply unless `SUPER_MCP_NO_CAP=1` or `SUPER_MCP_FULL=1` is set.

This bit production for a week. The Cloud Run job `super-mcp-ingest` had neither flag,
so every nightly run refreshed **8 of 898 stores**: 2 stores each for the first two
Cerberus chains (Rami Levy, Yohananof) plus Shufersal and Carrefour, and nothing at all
for Osher Ad, Keshet Taamim, Fresh Market, Tiv Taam, Stop Market and Salach Dabach. Six
chains sat at the same prices for seven days.

It was invisible because every signal said the run was healthy: `status: "success"`,
`rowsError: 0`, no alert. The chain-coverage gate could not catch it either, since
`expectedChainIdsForSource` deliberately mirrors what the adapter ATTEMPTS, so the
expectation shrank to match the degraded mode.

The run summary now carries `coverageMode` (`full` | `capped_smoke`) and `storeCap`, and
a capped run against a database holding more than 50 stores logs a WARNING
`ingestion_capped_run` naming the flag to set. Verify freshness after any ingest change:

```sql
SELECT c.name_he,
       count(DISTINCT s.id) AS stores,
       count(DISTINCT CASE WHEN sp.ingested_at::date = current_date THEN s.id END) AS refreshed_today
FROM chain c JOIN store s ON s.chain_id = c.id
LEFT JOIN store_price sp ON sp.store_id = s.id
GROUP BY 1 ORDER BY 3 DESC;
```

`refreshed_today` in the low single digits per chain means the caps are still in force.

`SUPER_MCP_REGION_FILTER` is a separate, deliberate scope limit (Gush Dan/Sharon,
Jerusalem, Haifa, Beersheva). Leave it on unless you want national coverage.

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

### ANALYZE after any bulk classification or backfill

A large write to `product_class_map` or `product` leaves the planner's statistics
stale, and the request path degrades badly rather than failing visibly. Measured
right after classifying 10,624 names: the fixture-basket median went from 992ms to
**11,211ms**, an 11x regression that showed up only as a perf-test failure. One
`VACUUM ANALYZE` restored it.

So after `classifyProducts.ts`, `backfillPackMetadata.ts`, or any bulk import:

```bash
psql "$DATABASE_URL" -c 'VACUUM ANALYZE product_class_map;'
psql "$DATABASE_URL" -c 'VACUUM ANALYZE product;'
psql "$DATABASE_URL" -c 'ANALYZE listing;'
```

Run them as separate statements: VACUUM cannot run inside a transaction block, so a
multi-statement `-c` fails.

### Cloud Run note

Fast-mode geocoding answers from a city centroid and resolves the real address in
a detached promise so the next call for that place is address-precise. Cloud Run
throttles CPU outside a request unless CPU-always-on is set, so that warm-up may
not complete there; the request path is unaffected (it never awaits it), but
addresses will keep resolving at city precision until the cache is warmed some
other way.

## Two MCP surfaces, one image

`/mcp` (physical stores) and `/mcp/online` (delivery) are served by the same process by default, so a
single Cloud Run service answers both URLs and nothing changes for existing clients: `/mcp` keeps its
path, its tool set, and its `basket-optimize-fast-v2` protocol id.

`SUPER_MCP_SURFACES` splits them without a second codebase. Deploy the same image twice:

```bash
gcloud run deploy super-mcp        --set-env-vars SUPER_MCP_SURFACES=stores  ...
gcloud run deploy super-mcp-online --set-env-vars SUPER_MCP_SURFACES=online  ...
```

Both still need the same `DATABASE_URL`: the surfaces share one catalogue, and the online surface's
`compare_in_store` option prices the basket at physical branches too. Splitting them is a scaling and
blast-radius decision, not a data one.

A typo in the variable throws at boot rather than serving no MCP at all.

### Delivery terms need their own refresh

Item prices arrive with the normal ingest. Delivery fees, minimums and service areas do not: they live
in `services/ingestion/src/fulfillment/catalog.ts` and reach the database only via

```bash
pnpm ingest:fulfillment            # --dry-run to see what would change
```

Run it after any deploy that changes the catalogue, and after the first Stores ingest on a fresh
database (the sync skips a storefront whose `store` row does not exist yet and exits non-zero saying so).

Terms decay deliberately: a figure older than 90 days reports `confidence: "unknown"` and stops being
quoted. If `/v1/delivery/options` starts returning `unknown` across the board, the catalogue is overdue
for a human re-read, not broken.
