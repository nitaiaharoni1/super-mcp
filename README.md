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
  -d '{"items":[{"query":"חלב","qty":2},{"gtin":"7290112490463","qty":1}],"city":"תל אביב"}' \
  http://localhost:8787/v1/basket/optimize
```

### Ingestion

```bash
pnpm ingest:fixture   # offline fixtures (no FTP/portal)
pnpm ingest -- --source=il-cerberus
pnpm ingest -- --source=il-shufersal
pnpm ingest -- --source=il-carrefour
pnpm ingest -- --source=all
```

Price/promo files are limited to stores in **Gush Dan–Sharon (Rishon–Netanya), Jerusalem, Haifa, Beersheva**.  
Disable with `SUPER_MCP_REGION_FILTER=0`. Use `SUPER_MCP_FULL=1` for more stores *within* that region. Without `SUPER_MCP_FULL=1`, the Cerberus adapter also covers only its first 2 chains (Rami Levy, Yohananof), so a default local ingest is 2 chains x 2 stores.

Raw feeds archive to `data/raw/` (local stand-in for GCS).

### Create API key

```bash
pnpm create-key -- --name=my-agent
```

## Packages

| Path | Package | Role |
|------|---------|------|
| `packages/shared` | `@super-mcp/shared` | Adapter contract, units, promo math |
| `packages/db` | `@super-mcp/db` | Schema, migrations, upserts |
| `services/ingestion` | `@super-mcp/ingestion` | Cerberus FTP + Shufersal + Carrefour (PublishPrice) adapters |
| `services/api` | `@super-mcp/api` | REST + MCP + auth/metering |

## REST (v1)

- `GET /v1/products` · `GET /v1/products/:id`
- `GET /v1/products/:id/prices` — compare nearby (default **10km**); `?sort=unit_price` for cheaper per 100g/ml
- `GET /v1/products/:id/substitutes` — cheaper similar products by unit price
- `GET /v1/products/:id/history`
- `GET /v1/chains` · `GET /v1/stores` — `?near=` defaults to **10km** radius
- `GET /v1/promotions`
- `POST /v1/basket/optimize` — requires `city` and/or `near`; response includes `cheapest`
- `GET /v1/usage`

## MCP tools

`search_products` · `get_product` · `compare_prices` · `suggest_substitutes` · `optimize_basket` · `list_stores` · `get_promotions`
