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
  http://localhost:8787/v1/basket/optimize
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

**Agent / MCP flow (required):** call `optimize_basket` once with the shopping list near `city`/`near`. If `status` is `needs_confirmation`, answer every required `question` and call again with only `{continuation, answers}` — do not reconstruct items. If `status` is `complete`, use `bestSingleStore` / `cheapestCompleteStore` / `multiStore`. Questions include real nearby availability and at most three compact options. Pricing runs only after confirmation clears.

REST is the same single endpoint: `POST /v1/basket/optimize` (initial items+location, or resume with continuation+answers). Use `pack_qty` for shelf packs and `amount` + `unit` for weighed/counted goods — for example, 20 pitas is `{"amount":20,"unit":"יח"}`, not 20 packs. Deprecated `qty` is rejected.

Requires `BASKET_CONTINUATION_SECRET` (≥32 bytes) for signed continuations. Live canary:

```bash
BASKET_CONTINUATION_SECRET=test-only-basket-continuation-secret-ok \
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
- `GET /v1/products/:id/prices` — compare nearby (default **10km**); `?sort=unit_price` for cheaper per 100g/ml
- `GET /v1/products/:id/substitutes` — cheaper similar products by unit price
- `GET /v1/products/:id/history`
- `GET /v1/chains` · `GET /v1/stores` — returns `{ stores, location }` (not a bare array); `?near=` defaults to **10km** radius
- `GET /v1/promotions`
- `POST /v1/basket/optimize` — resumable: initial `{items, city|near}` or resume `{continuation, answers}`; returns `needs_confirmation` or `complete` with `bestSingleStore` / `cheapestCompleteStore` / `multiStore`
- `GET /v1/usage`

## MCP tools

`search_products` · `resolve_products` · `get_product` · `compare_prices` · `suggest_substitutes` · `optimize_basket` · `list_stores` · `get_promotions`

Shopping lists: call `optimize_basket` with `{query, pack_qty}` or `{query, amount, unit}`. If confirmation is required, resume with `{continuation, answers}` only. Do not search each line first.
