# super-mcp

Canonical, queryable, agent-native layer over Israeli supermarket price transparency feeds.

**Stack:** TypeScript monorepo · Postgres · Fastify REST · remote MCP (Streamable HTTP)

See [docs/SPEC.md](./docs/SPEC.md) for the full product/engineering plan.

## Local setup

### Requirements

- Node 22+
- pnpm 9+
- Homebrew Postgres 17 (`brew services start postgresql@17`)

### Database

A dedicated local database is used:

```bash
createdb super_mcp   # already created as postgresql://nitai@localhost:5432/super_mcp
```

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed          # demo catalog + writes API key to .local/api-key.txt
```

### Run API + MCP

```bash
pnpm dev
# http://localhost:8787/health
# http://localhost:8787/openapi.json
# MCP (Streamable HTTP): http://localhost:8787/mcp
```

Auth: `Authorization: Bearer $(cat .local/api-key.txt)`

Quick smoke:

```bash
KEY=$(cat .local/api-key.txt)
curl -s http://localhost:8787/health
curl -s -H "Authorization: Bearer $KEY" 'http://localhost:8787/v1/products?q=חלב'
curl -s -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"items":[{"query":"חלב","pack_qty":2},{"gtin":"7290112490463","pack_qty":1}],"city":"תל אביב"}' \
  http://localhost:8787/v1/basket/prepare
```

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

**Agent / MCP flow (required):** call `prepare_basket` first (resolve near `city`/`near`, safe shopping defaults, no pricing), answer every required `question`, then call `optimize_basket` once with `product_id` on confirmed lines. Questions identify their item and include at most five compact product/pack options. Pricing loads **only safely resolved product IDs** — never the full unconfirmed shortlist.

REST has the same two-step flow: `POST /v1/basket/prepare`, confirm required questions, then `POST /v1/basket/optimize`. Both inputs use `pack_qty` for packs; deprecated `qty` remains accepted but cannot be supplied together with `pack_qty`. Use `amount` + `unit` for weighed goods and natural counts—for example, 20 pitas is `{"amount":20,"unit":"יח"}`, not 20 packs.

`POST /v1/basket/optimize` returns a `completeness` block: `resolvedLines`, `needsConfirmationLines`, `unresolvedLines`, and `safeResolutionRatio`. When `safeResolutionRatio` is below `minSafeResolutionRatio` (default **0.7**, from ontology config), `cheapest` and `multiStore` are **null** and `totalsArePartial` is **true**.

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

Basket free-text resolution prefers **deterministic evidence** (exact name, phrase, token boundaries, ontology gates) and uses embeddings only when lexical recall is weak. Wrong product is worse than unresolved — partial basket totals are labeled honestly when safe resolution is below 70%.

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
# warm embedder on first request; then prepare, confirm, and optimize the BBQ items
KEY=$(cat .local/api-key.txt)
curl -s -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"city":"Herzliya","items":[
    {"query":"פרגיות","amount":1.75,"unit":"kg"},
    {"query":"קבבים","amount":1.5,"unit":"kg"},
    {"query":"אנטרקוט","amount":0.75,"unit":"kg"},
    {"query":"פיתות","amount":20,"unit":"יח"},
    {"query":"חומוס","amount":1.5,"unit":"kg"},
    {"query":"טחינה","amount":500,"unit":"g"},
    {"query":"מלח גס","pack_qty":1},
    {"query":"עגבניות","amount":1,"unit":"kg"},
    {"query":"מלפפונים","amount":1,"unit":"kg"},
    {"query":"פלפלים","pack_qty":3},
    {"query":"בצלים","pack_qty":3},
    {"query":"חסה","pack_qty":1},
    {"query":"לימונים","pack_qty":4},
    {"query":"אבטיח","pack_qty":1},
    {"query":"קולה","pack_qty":2},
    {"query":"יין","pack_qty":3},
    {"query":"קפה טייסטרס צ׳ויס","pack_qty":1},
    {"query":"קרח","pack_qty":1}
  ]}' \
  http://localhost:8787/v1/basket/prepare
```

Manual success criteria:

- zero forbidden auto-picks (no sausage for `פרגיות`, pickled for `מלפפונים`, limoncello for `לימונים`, popsicles for `קרח`, etc.);
- `completeness.safeResolutionRatio >= 0.7` or honest partial totals (`totalsArePartial: true`, `cheapest: null`);
- warm wall clock under 8s for 18 lines.

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

### Create API key

```bash
# Standard shopping key
pnpm create-key -- --name=my-agent

# Bootstrap a revocable, expiring master key (raw key prints once)
pnpm create-key -- --name=operations --role=master --expires-at=2026-12-31T23:59:59Z
```

Keys are stored only as SHA-256 hashes. Keep the one-time raw value in a secret
manager and send it as `Authorization: Bearer <key>`; do not put it in config,
URLs, logs, or this repository. Master keys can create, list, rotate, and revoke
keys under `/v1/admin/keys`, and read global usage at `/v1/admin/usage`. Rotation
returns the replacement raw key once and revokes the prior key atomically.

Query-string credentials are rejected by default. Legacy MCP-only query auth
can be explicitly enabled with `SUPER_MCP_ALLOW_MCP_QUERY_API_KEY=1`.

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
- `GET /v1/products/:id/prices` — compare nearby (default **10km**); `?sort=unit_price` for cheaper per 100g/ml
- `GET /v1/products/:id/substitutes` — cheaper similar products by unit price
- `GET /v1/products/:id/history`
- `GET /v1/chains` · `GET /v1/stores` — returns `{ stores, location }` (not a bare array); `?near=` defaults to **10km** radius
- `GET /v1/promotions`
- `POST /v1/basket/prepare` — resolves lines and returns safe assumptions plus required confirmation questions
- `POST /v1/basket/optimize` — requires `city` and/or `near`; response includes `cheapest`, `completeness`, and per-line resolution status
- `GET /v1/usage`

## MCP tools

`search_products` · `resolve_products` · `get_product` · `compare_prices` · `suggest_substitutes` · `prepare_basket` · `optimize_basket` · `list_stores` · `get_promotions`

Shopping lists: call `prepare_basket` with `{query, pack_qty}` or `{query, amount, unit}`, confirm required questions, then call `optimize_basket` once with confirmed `product_id` lines. Do not search each line first.
