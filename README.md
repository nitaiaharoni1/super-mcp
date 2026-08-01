# super-mcp

Canonical, queryable, agent-native layer over Israeli supermarket price transparency feeds.

**Stack:** TypeScript monorepo · Postgres · Fastify REST · remote MCP (Streamable HTTP)

License: [Apache-2.0](./LICENSE) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [Data](./DATA.md) · [Issues](https://github.com/nitaiaharoni1/super-mcp/issues)

See [docs/SPEC.md](./docs/SPEC.md) for the full product/engineering plan.

## Hosted vs self-host

| Mode | What you get |
|------|----------------|
| **Hosted** (operator-run MCP/API) | Issued **standard** API keys for the operator’s endpoint. You do **not** get cloud credentials, database access, or deploy rights to that environment. |
| **Self-host** (this repo) | Run your own Postgres, secrets, and deploy. The open-source tree contains **no** path into the operator’s cloud. |

Production hostnames and secrets are configured in the hosting environment only — never required defaults in git. Deploy boundary: [docs/DEPLOY.md](./docs/DEPLOY.md).

## Local setup

### Requirements

- Node 22+
- pnpm 9+
- Postgres 16+ with [`pgvector`](https://github.com/pgvector/pgvector) (Homebrew, Docker, or other)

### Database

```bash
createdb super_mcp
# Example URL: postgresql://postgres@localhost:5432/super_mcp
```

```bash
cp .env.example .env
# Set DATABASE_URL and a random BASKET_CONTINUATION_SECRET (≥32 bytes).
pnpm install
pnpm db:migrate
pnpm db:seed          # demo catalog + writes API key to .local/api-key.txt
```

### Run API + MCP

```bash
pnpm dev
# http://localhost:8787/health
# http://localhost:8787/openapi.json
# MCP — physical stores:   http://localhost:8787/mcp
# MCP — online delivery:   http://localhost:8787/mcp/online
```

Auth: `Authorization: Bearer $(cat .local/api-key.txt)`

Quick smoke:

```bash
KEY=$(cat .local/api-key.txt)
curl -s http://localhost:8787/health
curl -s -H "Authorization: Bearer $KEY" 'http://localhost:8787/v1/products?q=חלב'
curl -s -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"items":[{"query":"חלב","pack_qty":2},{"gtin":"7290112490463","pack_qty":1}],"city":"תל אביב"}' \
  http://localhost:8787/v1/basket/optimize
curl -s -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"items":[{"query":"חלב","pack_qty":4},{"query":"קוטג","pack_qty":4}],"address":"מנדלסון 1, תל אביב"}' \
  http://localhost:8787/v1/delivery/optimize
```

## Two MCP surfaces: driving there, and having it delivered

A shopper asks two different questions, and one tool answering both has to guess which one they meant.

| | `/mcp` — **super-mcp** | `/mcp/online` — **super-mcp-online** |
| --- | --- | --- |
| lead tool | `optimize_basket` | `optimize_delivery` |
| minimises | basket **+ travel** | basket **+ delivery fee + service fee** |
| cost of distance | ₪/km, a smooth estimate | a published fee, a **step function** of the subtotal |
| feasibility | a branch inside the radius | the storefront delivers to the address **and** the basket clears its minimum |
| "buy the rest elsewhere" | another trip, worth roughly ₪20 | another delivery fee, worth exactly what it says |
| location input | `city` / `near` / `location` + `radius_km` | `address` / `city` / `near` — **no radius** |

They share everything below the objective function: catalogue identity, Hebrew search, line resolution,
unit normalisation, promotion maths, freshness. That is why this is one codebase and one database rather
than a fork — and it is what lets `optimize_delivery` answer `compare_in_store`, which prices the same
basket at nearby branches and reports the delivery premium.

Both surfaces are served by one process by default. `SUPER_MCP_SURFACES=stores` or `=online` splits them
across separate deployments from the same image.

### Where online prices and delivery terms come from

**Prices: the same regulated feeds, not a scraper.** The price-transparency Stores file carries
`<StoreType>` — 1 physical, 2 online, 3 both — and every chain populates it. Thirteen online storefronts
publish full priced catalogues that way: שופרסל ONLINE (15,896 items), רמי לוי מרלוג אינטרנט (15,790),
seven Tiv Taam picking depots, קרפור אונליין / קוויק / יהלומים ביתן, and a Keshet storefront operating
through Wolt. About 139k price rows in all.

**Online prices are not shelf prices, and the gap is not a constant.** Measured against each chain's own
branches: Tiv Taam's depots are 99% identical, שופרסל ONLINE 84.6% identical (and undercuts the שלי
format on ~85% of shared items), רמי לוי is repriced item by item at 22% identical, קרפור אונליין runs
**7.8% below** its own shelves, and the Wolt storefront runs **+25%**. So a storefront's own feed rows
are always used; a nearby branch's price is never substituted.

**Delivery terms: a curated table, because there is no feed for them.** Fee, minimum order,
free-delivery threshold and service area live in
[`services/ingestion/src/fulfillment/catalog.ts`](./services/ingestion/src/fulfillment/catalog.ts),
with the source URL and the date each number was read. Refresh with `pnpm ingest:fulfillment`.

### A separate ingest for online stores

Chains that publish no priced online storefront under the transparency law are reached by a
**second, separate ingestion flow**:

```bash
pnpm ingest:online                                   # every online source
pnpm ingest:online -- --sources=wolt --max-venues=8  # Wolt only
pnpm ingest:online -- --sources=storai               # Victory, Machsanei Hashuk, Yuda, Politzer
```

It shares normalisation and persistence with the feed ingest (product identity and units are the
same problem whatever the source) but nothing else: its own schedule, its own health status, and
its own provenance. A regulated feed going quiet is an incident; a website changing its markup is
a Tuesday, and mixing the two makes the alert on the first one useless. Every store it writes is
stamped `price_source = 'scraped'`, so no caller can mistake a best-effort read of a website for a
price filed under the law.

| source | chains | barcodes? | delivery terms |
| --- | --- | --- | --- |
| `wolt` | Wolt Market, am:pm, Victory-on-Wolt, and the other grocery venues | **yes** (`barcode_gtin`, normalised from GTIN-14 to EAN-13) | derived automatically from the venue payload, including a real ~124-vertex service polygon |
| `storai` | ויקטורי, מחסני השוק, סופר יודה, פוליצר | **no** | not published; reported as unknown |

Two limitations, stated rather than buried. Stor.ai exposes **no barcode at any endpoint**, so
those products are chain-scoped and do not join to the same product at Shufersal, which means they
can be searched and priced within their own chain but cannot take part in cross-chain comparison.
And its product endpoint cannot be paged (a query is mandatory, `limit` caps at 20, `offset` is
ignored), so coverage is whatever
[the query vocabulary](./services/ingestion/src/online/sources/storai/vocabulary.ts) reaches:
a few thousand commonly-shopped items per store, not a full catalogue.

Victory and several others do publish under the transparency law, via portals this repo does not
ingest yet (`laibcatalog.co.il`, the binaprojects family). Adding those as feed adapters would
deliver the same chains **with** barcodes, physical branches and legal footing. The scrapers are
the stopgap, not the destination.

### The two surfaces shop different catalogues

`product.branch_store_count` counts only the physical branches stocking a product, and the
drive-to-the-shop surface filters on it. An online-only item is not something that surface can
offer, and letting it into the candidate pool is not free: the first online ingest added 8,639
online-only products (+7% of catalogue) and a six-line Tel Aviv basket went from ~1.3s to ~11s,
because those products won candidate slots on name score and were then carried through class
equivalence and pricing before being discarded for having no branch price.

Newly ingested products must also be classified, or they fall into the same expensive fallback:

```bash
pnpm --filter @super-mcp/db exec tsx src/scripts/classifyProducts.ts \
  --scope=all --only-missing --project=<gcp-project> --account=<you@example.com>
```

Every fee therefore carries a **confidence** and a **`verifiedAt`**, and decays to `unknown` after 90
days rather than being quoted. This is not ceremony: Rami Levy held ₪29.90 for fifteen years and then
raised it 20% in a single month. A table nobody has re-read since spring looks fine, parses fine, and
quietly lies. Where a fee is unknown the plan reports `deliveryFee: null` and ranks on a clearly labelled
`assumedDeliveryFee` — never a quote.

**We deliberately do not scrape retailer storefronts.** Six chains run Cloudflare bot management on
their own domains, Shufersal publishes a crawl window a real catalogue crawl cannot honour, and Rami
Levy's robots.txt disallows its API path. The regulated feeds give us the prices legally and daily,
which is the whole basis of the project; routing around a control a retailer deliberately deployed
would trade that for nothing we need.

**Known gaps, stated plainly:** Victory, Yochananof (pickup only), Osher Ad, Hazi Hinam, Machsanei
Hashuk, am:pm, Stop Market and Fresh Market file no priced online storefront in the feeds, so they
cannot be compared here.

### Semantic retrieval V2 (generic ontology + pgvector)

Semantics are data-driven: vocabulary and attribute policy live in Postgres (`semantic_term`, `semantic_attribute_definition`, `semantic_search_config`). The engine does not branch on Hebrew terms or attribute names.

- **Product embeddings** are computed offline / after catalog changes (dirty queue).
- **Query embeddings** run on cache miss, stored in `semantic_query_embedding`, reused thereafter.
- Search merges **lexical** and **direct query→product ANN** via weighted RRF.
- Explicit shopper constraints use token/phrase matching + generic attribute definitions.

```bash
pnpm db:migrate
pnpm db:semantic-index -- --limit=5000
pnpm db:semantic-index -- --backend=hasher --limit=5000
pnpm db:semantic-index -- --dirty-only
pnpm db:benchmark-semantic
```

Ingest drains `semantic_index_dirty` before reporting success; failures mark the run `degraded` without rolling back feed data. Ontology load / query-embed failures fall back to lexical-only.

### Deterministic-first basket resolution

Free-text basket lines resolve with **deterministic evidence first** (exact name/phrase, form/class gates); embeddings run only when lexical recall is weak. The API warms the query embedder on boot (fire-and-forget) to cut cold latency on the first basket call.

**Agent / MCP flow (required):** call `optimize_basket` once with the full shopping list and `location` (or `city` / `near`). Default `resolution_mode=fast` returns a compact best-effort `complete` result in one call — assumptions are intentional. For exact product control, set `resolution_mode=strict`; then if `status` is `needs_confirmation`, answer every required `question` and call again with only `{continuation, answers}` — do not reconstruct items. When `status` is `complete`, use `bestSingleStore` / `cheapestCompleteStore` / `closestStore` / `multiStore`.

#### Comparing stores: use `comparableTotal`, not `total`

`total` is the money spent **at that store**, and it only covers the lines that store prices. Ranking on it is wrong: the store missing the most expensive item looks cheapest. A live Herzliya basket recommended a store at ₪92.86 over a ₪171.42 rival purely because it did not stock a ₪71.60 tuna line.

Every plan therefore also carries `comparableTotal` — the same basket at every store: what it charges for what it stocks, plus the **median market price** across the compared stores for each resolvable line it does not. `imputedLines` / `imputedTotal` say how much of the figure is estimated, and ranking additionally charges a fixed surcharge when a store leaves lines unpriced, because finishing the list elsewhere is a second trip.

Lines also carry `normalizedUnitPrice` (₪ per 100g / 100ml / piece) so a smaller pack cannot win on shelf price alone.

**Conditional prices are always flagged.** `clubOnly` means the price needs the chain's loyalty card; `couponOnly` means it needs a clipped coupon. Plans report `clubOnlyLines` and `couponOnlyLines`. This matters: the feed carries ~54k active coupon promotions and only ~250 of them are marked as club prices, so they used to be applied silently. A real case priced a ₪5.90 cottage at ₪1 under "קופון קוטג 5% ב 1 שח", which wins any cheapest-store comparison and then surprises the shopper at the till. Set `include_club=false` or `include_coupon=false` for a total that needs neither; on a Herzliya basket that changes both the winning store and the price.

#### Response size

`response_detail=summary` (the default) is tuned for an agent context: it keeps the full line breakdown for one plan only, drops per-line diagnostics (`substitutionReason`, `listingId`, `itemCode`, `originalProductId`) and the prose in `assumptions[].message`, and caps that plan at 25 lines with `linesTruncated: true` when it bites. `pricedLines` always reports the true count, and `standard` / `debug` return everything.

Measured on a Herzliya basket: 12 items ≈ 12KB, 18 items ≈ 16KB, 30 items ≈ 26KB, 50 items (the schema maximum) ≈ 32KB. Response size grows with the number of priced products, so split very large lists if your client has a tight context budget.

#### Travel vs price: `preference`

Shoppers say this out loud, so it is one input rather than three numbers to derive:

| `preference` | Meaning | Distance penalty |
| `cheapest` | "I don't mind driving" — distance ignored entirely | 0 ₪/km |
| `balanced` (default) | Weigh both | 3 ₪/km |
| `closest` | "Price isn't a big factor" — nearest store that still covers enough | 60 ₪/km |

Pair `cheapest` with a larger `radius_km` to search further afield. `distance_penalty_per_km` remains as an advanced override. `multiStore` is distance-aware too: an extra stop must beat both a flat "worth another stop" floor and its own round-trip driving cost, and the plan reports per-stop `distanceKm`, `maxDistanceKm` and `estimatedTravelKm`.

Distances are labelled, never faked. Each store carries `distanceAccuracy`: `branch` (geocoded from the branch address), `city` (a city centroid stood in, so the figure is city-accurate) or `unknown`. Stores placed only at city level are ranked with an uncertainty margin rather than excluded — excluding them previously removed ~45% of the catalog, including entire discount chains.

#### Default one-call example

```json
// Request (MCP optimize_basket or POST /v1/basket/optimize)
{
  "location": "רחוב בן גוריון, תל אביב",
  "items": [
    { "query": "חלב", "pack_qty": 3 },
    { "query": "ביצים תבנית 12", "pack_qty": 1 },
    { "query": "לחם", "pack_qty": 2 },
    { "query": "עגבניות", "amount": 1, "unit": "kg" },
    { "query": "שמן", "amount": 1, "unit": "L" }
  ]
}

// Compact complete response (response_detail=summary default)
{
  "status": "complete",
  "resolutionMode": "fast",
  "assumptions": [
    { "itemIndex": 0, "query": "חלב", "reason": "commodity_peer", "message": "…" }
  ],
  "coverage": { "requestedLines": 5, "pricedLines": 5, "omittedLines": 0 },
  "bestSingleStore": {
    "storeName": "…",
    "total": 84.5,
    "totalScope": "priced_lines_only",
    "pricedLines": 5,
    "requestedLines": 5
  }
}
```

Fast mode may pick representative commodity peers and fall back to a city centroid when precise geocoding is unavailable; assumptions and `coverage` make that explicit. Use `resolution_mode=strict` when the shopper needs exact SKUs instead of best-effort completion.

A free-text `location` is scoped by **radius**, not by city name. The city embedded in the text only qualifies geocoding — applying it as a store filter restricted every address-based basket to same-city branches and hid cheaper stores a few km across a municipal border (in Gush Dan, most of the competition). On a geocode cache miss, fast mode answers immediately from the city centroid and resolves the real address in the background, so the next call for that place is address-precise at no extra latency.

#### Migration

```text
Old default: strict confirmation when material candidate ambiguity remains.
New default: fast best-effort completion.
Compatibility: set resolution_mode=strict for old behavior.
Deprecated: verbose; use response_detail=debug.
```

REST is the same single endpoint: `POST /v1/basket/optimize` (initial items+location, or resume with continuation+answers). Use `pack_qty` for shelf packs and `amount` + `unit` for weighed/counted goods — for example, 20 pitas is `{"amount":20,"unit":"יח"}`, not 20 packs. Deprecated `qty` is rejected. Protocol: `basket-optimize-fast-v2`.

Requires `BASKET_CONTINUATION_SECRET` (≥32 bytes) for signed continuations. Operator canaries and rollout checklist: [docs/operations.md](./docs/operations.md). Live canary:

```bash
CANARY_BASKET_LOCATION="רחוב בן גוריון, תל אביב" \
  pnpm --filter @super-mcp/api canary:basket
```

| Env | Effect |
|-----|--------|
| `SUPER_MCP_EMBED_MODEL` | Active embedding generation (default multilingual MiniLM) |
| `SUPER_MCP_ONTOLOGY_VERSION` | Active ontology id (default `he-retail-v1`) |
| `SUPER_MCP_EMBED_BACKEND=hasher` | Deterministic fallback embedder (tests/CI) |
| `SUPER_MCP_SKIP_SEMANTIC_DRAIN=1` | Skip post-ingest drain |
| `SUPER_MCP_SEMANTIC_BASKET=0` | Master kill switch — disables recall, policy, and V2 shadow |
| `SUPER_MCP_SEMANTIC_V2_RECALL=0` | Disable query-vector recall / RRF (default: on when basket on) |
| `SUPER_MCP_SEMANTIC_V2_POLICY=0` | Disable data-driven constraint gating (default: on when basket on) |
| `SUPER_MCP_SEMANTIC_V2_SHADOW=1` | Compute V2 recall+policy for logs; return lexical / pre-policy results |
| `SUPER_MCP_SEMANTIC_SHADOW=1` | Log lexical vs semantic pick disagreements |

**Staged rollout (production):** backfill embeddings/profiles → set `V2_RECALL=0` `V2_POLICY=0` → enable `V2_SHADOW=1` → when benchmark activation gate passes, enable recall → enable policy → turn shadow off → retire legacy thresholds/fixtures.

**Activation gates** (`pnpm db:benchmark-semantic`): vector/profile coverage above config minimum; unsafe substitution does not regress; fused recall@K ≥ lexical; p95 within budget; `forbiddenHitRate` and Herzliya BBQ `bbqForbiddenHitRate` should stay at 0.

### Deterministic-first basket resolution

Basket free-text resolution prefers **deterministic evidence** (exact name, phrase, token boundaries, ontology gates) and uses embeddings only when lexical recall is weak. Wrong product is worse than unresolved — ambiguous lines return `needs_confirmation` instead of silent guesses.

**Apply migration + semantic index (first time or after ontology changes):**

```bash
pnpm db:migrate
pnpm db:semantic-index -- --backend=hasher --limit=5000
SUPER_MCP_EMBED_BACKEND=hasher pnpm db:benchmark-semantic
```

**Herzliya BBQ re-spin checklist** (18-line golden fixture at `packages/db/tests/fixtures/herzliya-bbq-golden.json`):

```bash
pnpm db:migrate
SUPER_MCP_EMBED_BACKEND=hasher pnpm db:benchmark-semantic
pnpm --filter @super-mcp/api dev
# warm embedder on first request; then optimize (resume with continuation+answers if needed)
KEY=$(cat .local/api-key.txt)
curl -s -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"city":"Herzliya","items":[
    {"query":"פרגיות","amount":1.75,"unit":"kg"},
    {"query":"קבבים","amount":1.5,"unit":"kg"},
    {"query":"אנטרקוט","amount":0.75,"unit":"kg"},
    {"query":"פיתות","amount":20,"unit":"יח"},
    {"query":"חומוס","amount":1.5,"unit":"kg"},
    {"query":"טחינה","amount":0.5,"unit":"kg"},
    {"query":"מלח גס","pack_qty":1},
    {"query":"עגבניות","amount":1,"unit":"kg"},
    {"query":"מלפפונים","amount":1,"unit":"kg"},
    {"query":"פלפל","amount":3,"unit":"יח"},
    {"query":"בצל","amount":3,"unit":"יח"},
    {"query":"חסה","amount":1,"unit":"יח"},
    {"query":"לימון","amount":4,"unit":"יח"},
    {"query":"אבטיח","amount":1,"unit":"יח"},
    {"query":"קוקה קולה 1.5 ליטר","amount":2,"unit":"יח"},
    {"query":"יין","amount":3,"unit":"יח"},
    {"query":"טייסטרס צ׳ויס","pack_qty":1},
    {"query":"שקית קרח","pack_qty":1}
  ]}' \
  http://localhost:8787/v1/basket/optimize
# Or: BASKET_CONTINUATION_SECRET=... pnpm --filter @super-mcp/api canary:basket
```

Manual success criteria:

- zero forbidden auto-picks (no sausage for `פרגיות`, pickled for `מלפפונים`, limoncello for `לימון`, popsicles for `שקית קרח`, etc.);
- `status: "complete"` with `bestSingleStore.pricedLines >= 16` after answering any `needs_confirmation` questions, or a confirmation payload with ≤3 questions;
- warm wall clock under 8s for the initial 18-line call.

| Env | Effect |
|-----|--------|
| `SUPER_MCP_DETERMINISTIC_FIRST=0` | Disable deterministic-first cascade (legacy blended ranking) |
| `SUPER_MCP_DETERMINISTIC_FIRST=1` | Default when semantic basket is on |

### Ingestion

```bash
pnpm ingest:fixture   # offline fixtures (no FTP/portal)
pnpm ingest -- --source=il-cerberus
pnpm ingest -- --source=il-shufersal
pnpm ingest -- --source=il-carrefour
pnpm ingest -- --source=all
```

Price/promo files are limited to stores in **Gush Dan–Sharon (Rishon–Netanya), Jerusalem, Haifa, Beersheva**.  
Disable with `SUPER_MCP_REGION_FILTER=0`. Use `SUPER_MCP_FULL=1` for more stores *within* that region, or `SUPER_MCP_NO_CAP=1` for **all** in-region stores (no per-chain count cap; implies all Cerberus chains). Without those flags, the Cerberus adapter covers only its first 2 chains (Rami Levy, Yohananof), so a default local ingest is 2 chains x 2 stores.

Speed: adapters run in parallel; price files within each adapter use `SUPER_MCP_CONCURRENCY` (default **12**, max 48). Cerberus reuses FTP logins via a per-chain pool. Raise to `24` on a strong machine if CPU/DB keep up.

Raw feeds archive to `data/raw/` (local stand-in for GCS).

#### Store identity and delisting

Several chains publish no `<City>` and a placeholder `<Address>` ("unknown"), putting the locality in the **store name** instead ("חולון המרכבה", "רעננה", 'דיל פ"ת- אליעזר פרדימן'). Both geocode tiers key on `store.city`, so those branches used to be ungeocodable and invisible to every location-scoped query — all 52 Yohananof branches among them. Ingest now derives the city from the branch name when the feed omits it (`resolveStoreCity`), and a `--mode=city` geocode tier repairs existing rows:

```bash
pnpm --filter @super-mcp/db exec tsx src/scripts/geocodeStores.ts --mode=city      # name → city
pnpm --filter @super-mcp/db exec tsx src/scripts/geocodeStores.ts --mode=centroid  # city → centroid (runs the city tier first)
pnpm --filter @super-mcp/db exec tsx src/scripts/geocodeStores.ts --mode=address   # Nominatim branch-level upgrade (rate limited)
```

Feeds also publish online storefronts, pickup points and logistics warehouses as ordinary `<Store>` rows — and those hold the three deepest price catalogs in the data. `store.store_kind` (`branch` / `online` / `pickup` / `warehouse`) marks them so they are never recommended as somewhere to shop.

`store_price` is reconciled against full snapshots: after a store's `PriceFull` file is ingested cleanly, rows the snapshot did not refresh are delisted. `last_seen_at` is the cutoff (always bumped on upsert, unlike the monotonically gated `source_ts`). Four safety gates bias towards keeping stale rows over deleting live ones: full files only (never a delta), no parse errors, a minimum snapshot size, and a refusal to delete more than 35% of a store's catalog in one pass. Counts surface as `pricesReconciled` on the run report.

A configured chain that yields zero files or zero rows now marks the run `degraded` with the chain named, instead of reporting `success`.

### Create API key

```bash
# Standard shopping key
pnpm create-key -- --name=my-agent

# Break-glass master key (CLI only — HTTP admin cannot mint masters)
pnpm create-key -- --name=operations --role=master --expires-at=2026-12-31T23:59:59Z
```

Keys are stored only as SHA-256 hashes. Keep the one-time raw value in a secret
manager and send it as `Authorization: Bearer <key>`; do not put it in config,
URLs, logs, or this repository. Issue **standard** keys to external users. Master
keys can list/rotate/revoke and mint **standard** keys under `/v1/admin/keys`, and
read global usage at `/v1/admin/usage`. Rotation returns the replacement raw key
once and revokes the prior key atomically.

Query-string credentials are rejected by default. Legacy MCP-only query auth
can be explicitly enabled with `SUPER_MCP_ALLOW_MCP_QUERY_API_KEY=1` — never on a
public host.

## Packages

| Path | Package | Role |
|------|---------|------|
| `packages/shared` | `@super-mcp/shared` | Types, units, promo math, embeddings, env config, concurrency |
| `packages/db` | `@super-mcp/db` | Schema, migrations, upserts |
| `services/ingestion` | `@super-mcp/ingestion` | Cerberus FTP + Shufersal + Carrefour (PublishPrice) adapters |
| `services/api` | `@super-mcp/api` | REST + MCP + auth/metering |

See [docs/folder-conventions.md](./docs/folder-conventions.md) for target folder layout and dedup rules.

## REST (v1)

- `GET /v1/products` · `GET /v1/products/:id`
- `GET /v1/products/:id/prices` — compare nearby (default **10km**); `?sort=unit_price` for cheaper per 100g/ml. Physical branches only, and rows carry `clubOnly` / `couponOnly`
- `GET /v1/products/:id/substitutes` — cheaper similar products by unit price
- `GET /v1/products/:id/history`
- `GET /v1/chains` · `GET /v1/stores` — returns `{ stores, location }` (not a bare array); `?near=` defaults to **10km** radius. Each store carries `storeKind` (`branch` / `online` / `pickup` / `warehouse`); only `branch` rows are used for basket recommendations
- `GET /v1/promotions`
- `POST /v1/basket/optimize` — one-call fast default: initial `{items, city|near|location}` returns compact `complete`; opt in with `resolution_mode=strict` for resumable `{continuation, answers}`; plans are `bestSingleStore` / `cheapestCompleteStore` / `closestStore` / `multiStore`. Rank on `comparableTotal`; set `preference` to `cheapest` / `balanced` / `closest`
- `GET /v1/usage`

## MCP tools

`optimize_basket` · `search_products` · `resolve_products` · `get_product` · `compare_prices` · `suggest_substitutes` · `list_stores` · `get_promotions`

Shopping lists: call `optimize_basket` once with `{query, pack_qty}` or `{query, amount, unit}` plus `location` (preferred) / `city` / `near`. Fast mode completes in one call; for exact products set `resolution_mode=strict` and, if confirmation is required, resume with `{continuation, answers}` only. Do not search each line first.
