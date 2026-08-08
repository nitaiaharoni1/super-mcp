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
| `SUPER_MCP_ALLOW_ANONYMOUS` | server (optional, `1`). Serves `/mcp` with no credential. Requires migration `035`. See below. |
| `SUPER_MCP_ANONYMOUS_RATE_LIMIT` | server (optional, default 30/min per client address) |
| `SUPER_MCP_ANONYMOUS_GLOBAL_RATE_LIMIT` | server (optional, default 600/min across all keyless traffic) |
| `SUPER_MCP_SURFACES` | server (optional). Unset or `online` serves `/mcp` (+ `/mcp/online` alias). `stores` is rejected. |
| `NOMINATIM_USER_AGENT` | **server (required)**. OSM returns 403 to the placeholder default, so address geocoding silently degrades to city centroids. See below. |
| `SUPER_MCP_NO_CAP` | **ingest job (required, `1`)**. Without it the ingest silently covers ~1% of stores. See below. |
| `SUPER_MCP_PROMO_RETENTION_DAYS` | ingest job (optional). Sweeps promotions that ended this long ago. Unset means no sweep. |
| `SUPER_MCP_USAGE_RETENTION_DAYS` | ingest job (optional). Sweeps `usage_event` rows older than this. Unset means no sweep. See below. |
| `SUPER_MCP_QUERY_CACHE_RETENTION_DAYS` | ingest job (optional). Ages cached search phrases out of `semantic_query_embedding`. Unset means no sweep. See below. |
| `NEXT_PUBLIC_MCP_URL` | **web image build arg, not runtime env**. See below. |
| `NEXT_PUBLIC_SITE_URL` | web image build arg. Public origin, used as `metadataBase` so `og:image` resolves absolutely. |
| `NEXT_PUBLIC_MCP_REQUIRES_KEY` | web image build arg (optional, `1`). Install buttons default to keyless; set `1` unless the API runs with `SUPER_MCP_ALLOW_ANONYMOUS=1`. |
| `NEXT_PUBLIC_POSTHOG_KEY` | web image build arg (Baliprop + Reflex project token) |
| `NEXT_PUBLIC_POSTHOG_HOST` | web image build arg (`https://eu.i.posthog.com`) |
| `POSTHOG_KEY` | API/MCP server (same project token) |
| `POSTHOG_HOST` | API/MCP server (`https://eu.i.posthog.com`) |

Filter PostHog insights with `product = super_mcp`. Design: [docs/superpowers/specs/2026-07-21-posthog-analytics-design.md](./superpowers/specs/2026-07-21-posthog-analytics-design.md).

Self-hosters clone this repo and supply **their own** values; they receive no access to the operator’s cloud.

## Every `NEXT_PUBLIC_*` is frozen into the image, not read from the environment

Setting them on the marketing Cloud Run service does nothing. Next inlines each one into
the compiled bundle as a literal at `next build`, so the values that count are the ones
passed as `--build-arg` to [`apps/web/Dockerfile`](../apps/web/Dockerfile), and the service
itself runs with none of them set.

Getting this wrong fails in the worst direction. `getMcpUrl()` and `getSiteUrl()` fall back
to `http://localhost:8787/mcp` and `http://localhost:3000`, so an image built without the
args starts cleanly, renders a perfect page, and publishes install instructions pointing at
the visitor's own machine while the access form POSTs nowhere. Nothing logs an error.
`gcloud builds submit --tag=...` cannot pass `--build-arg` at all, which makes the correct
command for the API image the wrong one here.

Two guards, because documentation alone did not hold:

- [`apps/web/src/scripts/checkPublicEnv.mjs`](../apps/web/src/scripts/checkPublicEnv.mjs)
  runs inside the Dockerfile and fails the build when a required value is missing, is not
  https, or still points at a development host. A laptop `pnpm build` is untouched.
- [`cloudbuild.web.yaml`](../cloudbuild.web.yaml) is the one blessed way to build the image.
  Its substitutions default to empty, so a forgotten value stops the build instead of
  shipping.

```bash
gcloud builds submit --config=cloudbuild.web.yaml \
  --substitutions=_MCP_URL=<site>/mcp,_SITE_URL=<site>,_POSTHOG_KEY=<key>,_TAG=$(git rev-parse --short HEAD) .
gcloud run deploy <web-service> --region=<region> --image=<image>@<digest>
```

The values are public by definition: they are already inlined in the deployed bundle. If
they are ever lost, read them back out of the live site rather than guessing.

```bash
curl -s <site>/ | grep -o '/_next/static/chunks/[^"]*' | sort -u   # then curl and grep those
```

After any web deploy, confirm the page did not quietly localhost itself:

```bash
curl -s <site>/ | grep -c '<site>/mcp'   # must be non-zero
```

## Privacy retention is opt-in, and the privacy page depends on it

Two sweeps run from the nightly ingest job, both off unless a window is set, so no
deployment starts deleting because it picked up a new image:

- `SUPER_MCP_USAGE_RETENTION_DAYS` prunes `usage_event`. Those rows carry no content
  (`api_key_id`, `route`, `status_code`, `latency_ms`, `created_at`), but they are the one
  per-request table that grows without bound.
- `SUPER_MCP_QUERY_CACHE_RETENTION_DAYS` ages entries out of `semantic_query_embedding`.
  **This is the privacy-relevant one.** That table stores `normalized_query`, the phrase a
  shopper actually typed, and nothing expires it on its own. It ages on `embedded_at`, which
  a cache hit does not refresh, so a phrase expires on a fixed clock however popular it is
  and simply costs one re-embed afterwards.

`access_requests` is deliberately never swept. Those rows are people who asked for access,
and the privacy page says they are kept until deletion is requested.

Two things make this easy to get wrong:

1. **The ingest job does not track `:latest`.** It is pinned to an explicit digest tag, so
   setting the env vars alone changes nothing until the job is re-pointed at an image that
   contains the sweep.
2. **The privacy page must not claim a window that is not running.** `/privacy` currently
   promises deletion on request and states no retention period, which is true with the
   sweeps off. If you enable them, say so on the page, and if you later disable them, take
   it back off. A policy that describes a job nobody runs is the same failure as a policy
   that says the shopping list is not stored.

## The Firebase Hosting front door

Both Cloud Run services sit behind one Hosting site, which is the public origin. This is
not decoration. A raw `*.run.app` URL embeds the **project number**, so every saved client
config breaks the next time the project moves; a Hosting origin survives that. It also puts
the marketing site and the API on the same origin, which is why the access form needs no
`CORS_ORIGINS` entry for its own site.

`firebase.json` is **gitignored** (it names the site and services), so a fresh clone cannot
redeploy Hosting until it is recreated. The shape:

```json
{
  "hosting": {
    "site": "<SITE_ID>",
    "public": "apps/web/firebase-hosting",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "/mcp{,/**}",   "run": { "serviceId": "super-mcp", "region": "europe-west1" } },
      { "source": "/v1/**",       "run": { "serviceId": "super-mcp", "region": "europe-west1" } },
      { "source": "/openapi.json","run": { "serviceId": "super-mcp", "region": "europe-west1" } },
      { "source": "/health",      "run": { "serviceId": "super-mcp", "region": "europe-west1" } },
      { "source": "**",           "run": { "serviceId": "super-mcp-web", "region": "europe-west1" } }
    ]
  }
}
```

Every API path the front door must serve needs its own entry: anything unlisted falls to
the catch-all and is answered by the *marketing site*, which returns a plausible-looking
404 rather than an error. `/openapi.json` and `/health` were missed on the first pass
exactly that way. `/ready` is deliberately absent: it reports catalogue row counts and
freshness, which do not belong on the marketing domain. It stays reachable on the Cloud
Run URL for ops.

Order matters: Hosting takes the first matching rewrite, so the catch-all must stay last.
Deploy with `firebase deploy --only hosting --project=<PROJECT_ID>`. It validates every
rewrite target up front, so both Cloud Run services must already exist or the deploy is
rejected whole.

MCP replies are `text/event-stream`. Verified through Hosting: content type preserved,
no buffering, ~0.4s to first byte. Re-check that after any Hosting change, because a CDN
that buffers SSE breaks every MCP client at once and nothing else on the site would notice.

## SUPER_MCP_ALLOW_ANONYMOUS: what opening the door actually costs

With the flag set, anyone can point an agent at `/mcp` and get answers. Three
things to know before turning it on:

1. **Migration `035` must be applied first.** Keyless traffic is metered against a
   seeded `anonymous` key row. Without it every request still succeeds but each
   `usage_event` insert fails its foreign key, so the metering log goes silent.
2. **Capacity, not billing, is the ceiling.** The service answers from Postgres and
   calls no model, so the marginal cost of a request is CPU-seconds. What breaks
   first is `maxScale` (currently `1`): raise it before inviting a crowd, and note
   the rate-limit windows are per instance and in memory, so N instances mean N
   times the configured ceiling until the limiter moves to shared state.
3. **Nominatim is a shared community service.** Address geocoding is cached, but a
   traffic jump changes the load OSM sees from this host, and their usage policy is
   what governs it. Watch for 403s after opening up.

Turning it off is unsetting the variable: the next request goes back to demanding a
key. No redeploy, no code change.

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

`SUPER_MCP_ONLINE_STORES_ONLY` (default on) limits prices to orderable storefronts.
Under it, a chain with no delivery correctly ingests zero price files, so a chain
sitting at zero is not by itself evidence of a broken feed — check whether it has a
storefront first. `SUPER_MCP_REGION_FILTER` (Gush Dan/Sharon, Jerusalem, Haifa,
Beersheva) only applies once the online filter is off.

## Two ingest env vars that change what production does

Neither has a safe-looking default that is also the right one, so both are worth
stating outright.

| Variable | Set on | Effect when set | Effect when absent |
| --- | --- | --- | --- |
| `SUPER_MCP_EXCLUDE_SOURCES` | `super-mcp-ingest` (europe-west1) = `il-laibcatalog` | Comma-separated source ids dropped from the `all` registry. Excluding every source throws rather than exiting 0 having ingested nothing. | Every source runs. |
| `SUPER_MCP_PROMO_RETENTION_DAYS` | `super-mcp-ingest` (europe-west1) = `14` | After a run, deletes promotions whose `end_ts` is older than this, cascading to `promotion_item`. **Irreversible.** | The sweep does not run at all. |
| `SUPER_MCP_ONLINE_STORES_ONLY` | nowhere; the default is what production wants | `=0` restores the branch sweep and hands scope back to `SUPER_MCP_REGION_FILTER`. | Prices are downloaded only for orderable storefronts. |

`SUPER_MCP_EXCLUDE_SOURCES` exists because `laibcatalog.co.il` silently drops TCP
connects from outside Israel, so the europe-west1 job books a guaranteed failure
every night unless it can leave that one source out. The same source is ingested
by the separate me-west1 job `super-mcp-ingest-il`, which does NOT set the
variable: the exclusion only applies to `--source=all`, so an explicit
`--source=il-laibcatalog` still runs. That asymmetry is the point, and it is the
reason a typo in the variable is not fatal. It is also the reason a typo is easy
to miss: check the `ingestion_sources_excluded` log line names what you meant.

`SUPER_MCP_ONLINE_STORES_ONLY` is the one variable here whose default is the
production setting, which is deliberate: the expensive behaviour should need
asking for. Turning it off restores 7.3M price rows and the nightly job that could
not finish. The failure it guards against is not a crash but a silence, so the
ingest logs `ingestion_orderable_backstop_applied` whenever the database had to
rescue a storefront the day's Stores file no longer described as one.

`SUPER_MCP_PROMO_RETENTION_DAYS` is opt-in so that no deployment starts deleting
history merely by picking up a new image. It buys a smaller working set, not a
smaller bill: Cloud SQL charges for the provisioned disk and that disk cannot
shrink. Values that are not finite and positive disable it silently, which is the
intended fail-safe direction for a destructive knob.

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

The embedding model hit the same trap and cost a user-visible 16s before it was
found, so the rule is worth stating plainly: **on Cloud Run, anything that must be
resident has to be awaited before `listen()`, not fired after it.** Measured on
this service, a warm started after `listen()` took 63s of wall clock for work that
costs 1-2s of CPU, and only finished when an unrelated request handed the instance
CPU back — that request paid the bill. Warming during startup instead costs ~12s,
inside a 240s startup probe, and every request the container serves is warm.

The second half of that bug is subtler and applies to any warm-up: **never warm
through a cache-first accessor.** `getQueryEmbedding` returns early on a cache hit,
so once the warmup string had been embedded once and stored, every later warmup
read it back and loaded nothing, succeeding while doing nothing, silently and
permanently. `warmEmbeddingModel` deliberately calls `embedText` past the cache.
The same reasoning applies to `super-mcp-keepwarm`: its `search_products` ping
exercises the request path but not the model, so it is not evidence the model is
loaded.

## One MCP surface

`/mcp` is SuperMCP for online supermarket delivery (`optimize_delivery`). `/mcp/online` is a
compatibility alias for the same tools. Physical drive-to-store MCP is not mounted; setting
`SUPER_MCP_SURFACES=stores` fails at boot.

One Cloud Run service is enough. If you previously deployed a separate `super-mcp-online` service,
point it (or retire it) at the same image: both URLs now serve online delivery.

### The online ingest is a separate job

`pnpm ingest:online` is deliberately not part of the feed ingest and should be scheduled
separately, less often, and with its own alerting. It reads other people's websites: it runs its
sources sequentially on purpose, and a failure there means a page changed shape, not that a
regulated feed went dark.

After any run that adds products, two follow-ups are required or the PHYSICAL surface slows down:

```bash
# 1. Classify the new products. Unclassified products fall into the expensive
#    equivalence fallback and cost seconds per basket.
pnpm --filter @super-mcp/db exec tsx src/scripts/classifyProducts.ts \
  --scope=all --only-missing --project="$GCP_PROJECT" --account="$GCP_ACCOUNT"

# 2. Refresh the popularity + branch-stock signals, then ANALYZE.
#    refreshProductStoreCounts maintains branch_store_count, which the physical
#    surface filters on. It runs at the end of the ingest but is non-fatal, so
#    verify it did not time out.
psql "$DATABASE_URL" -c "ANALYZE product; ANALYZE listing; ANALYZE store_price; ANALYZE store;"
```

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
