# How super-mcp works (plain-English guide)

This document explains what super-mcp is, why it exists, and how every part of it
works, in plain language with concrete examples. If you've never seen the codebase,
start here. For the formal product/engineering plan, see [SPEC.md](./SPEC.md).

---

## 1. The one-sentence version

**super-mcp turns the messy, legally-mandated price files that every Israeli
supermarket publishes into one clean database that an AI agent can ask questions
like "where is my 18-item BBQ shopping list cheapest near Herzliya?" and get a
correct, promo-aware answer.**

---

## 2. The problem we solve

By Israeli law (the Price Transparency regulations, 2014), every major grocery
chain must publish its full price list and promotions as public files. That sounds
great, but the reality is ugly:

- The files are **raw XML dumps**, one per store, updated on each chain's own schedule.
- Every chain uses **different formats, field names, and quirks**.
- The same physical product (say, a 3-liter bottle of Coca-Cola) has a **different
  internal code and a slightly different name in every chain**. There is no shared ID.
- Prices are in Hebrew, quantities are inconsistent ("1.5 ל'" vs "1500 מ״ל"), and the
  "unit price" fields the chains provide are often wrong.

So today, every developer who wants to build a shopping, budgeting, or nutrition
agent has to re-scrape and re-clean the same data badly, or just gives up on grocery
use cases. **We do that normalization once, well, and expose it as an API and an MCP
server.** The moat isn't access to the data (it's public), it's the quality of the
cleanup and the agent-friendly interface.

**Concrete example of the mess we hide:**

| Chain | Their name for the product | Their code | Their "quantity" field |
|-------|---------------------------|-----------|------------------------|
| Rami Levy | `קוקה קולה 1.5 ליטר` | `7290...463` | `1.5 ל` |
| Shufersal | `קוקה-קולה בקבוק 1.5L` | `P_887...` | `1500` |
| Victory | `Coca Cola 1.5` | `99123` | `1.5L` |

All three are the **same barcode** `7290112490463`. We collapse them into one
canonical product, keep each chain's own name as a "listing," and recompute a
trustworthy price-per-100ml so an agent can actually compare them.

---

## 3. The big picture

```
[Chain price/promo feeds]                        [AI agent / app developer]
        │                                                    │
        │  SourceAdapter (one per portal)                    │ MCP or REST + API key
        ▼                                                    ▼
  INGESTION  ──►  NORMALIZATION  ──►   POSTGRES   ◄──   SERVICE LAYER
  discover/fetch   GTIN identity,    (canonical      (search, basket,
  /parse feeds     units, promos,     schema +        pricing, promos)
                   categories         history)              │
                                                     ┌──────┴───────┐
                                                     ▼              ▼
                                                 REST API      MCP server
                                                 (Fastify)   (Streamable HTTP)
```

The core product bet is the last line: **one service layer, two protocols.** Every
piece of business logic (search, price comparison, basket optimization) is written
once as a plain function. The REST API and the MCP server are both thin wrappers
that call the same functions. Adding the MCP surface costs almost nothing, and an AI
agent gets exactly the same capabilities a traditional app developer gets.

### The monorepo layout

The code is a TypeScript pnpm monorepo with four packages:

| Path | Package | What it does |
|------|---------|--------------|
| `packages/shared` | `@super-mcp/shared` | Shared types, unit math, promo math, embeddings, config, the intent/matching engine |
| `packages/db` | `@super-mcp/db` | Postgres schema, migrations, and all SQL queries |
| `services/ingestion` | `@super-mcp/ingestion` | The adapters that pull chain feeds and load them |
| `services/api` | `@super-mcp/api` | The REST API + the MCP server + auth/metering |

Rule of thumb: **business logic lives in `services/api/src/services/`, is exposed by
both `routes/` (REST) and `mcp/tools/` (MCP), and reads/writes through `packages/db`.**

---

## 4. The data model (how the database is shaped)

Everything hangs off six core tables. Understanding these makes the rest obvious.

```
chain ──< store ──< store_price >── listing >── product
                          │             │
                          │             └─< price_point (history)
                          └── promotion ──< promotion_item
```

Read the diamond in the middle from both ends:

- **`product`** is the *canonical* thing, keyed by **GTIN (barcode)**. One row per
  real-world product across all of Israel. Holds the elected display name, brand,
  canonical size (grams/ml/unit), and a full-text `search_vector`.
- **`chain`** is a supermarket brand (Rami Levy, Shufersal…). Its ID is the chain's
  legal barcode; `source_id` says which adapter feeds it (e.g. `il-shufersal`).
- **`store`** is one physical branch of a chain, with a city and lat/lng coordinates.
- **`listing`** is the join of *one product × one chain*: "how Rami Levy refers to
  this Coke." It keeps the chain's own item code, name, and raw quantity. Non-GTIN
  items (loose produce with chain-internal codes) live as chain-scoped listings with
  no canonical product.
- **`store_price`** is the *current* price of a listing at a specific store. This is
  the table basket math reads. It also stores the recomputed `unit_price` (per
  100g/100ml/unit) and the source freshness timestamp.
- **`price_point`** is append-only price *history*, partitioned by month. Powers
  "show me the price trend" and price-drop detection. Unchanged prices are not
  re-written, so history doesn't bloat.
- **`promotion`** + **`promotion_item`** store deals: a typed mechanic (see §8) plus
  which item codes it applies to.

Supporting tables: `api_key` and `usage_event` (auth + metering), `ingestion_run`
(one row per ingestion job, for observability), plus the semantic tables in §7.

**Worked example.** Coca-Cola 1.5L is *one* `product` row. It has three `listing`
rows (Rami Levy, Shufersal, Victory). Each listing has many `store_price` rows (one
per branch that stocks it). When an agent asks "where's Coke cheapest near me," we
walk product → listings → store_prices at nearby stores → cheapest.

---

## 5. How data gets in (ingestion)

Ingestion is a pipeline: **discover → fetch → parse → normalize → persist.** The
magic is the **adapter contract** that makes "add a new chain" mean "write one
adapter, change nothing else."

### The adapter contract

Every source implements the same tiny interface:

```ts
interface SourceAdapter {
  sourceId: string;                                 // "il-shufersal"
  discover(): Promise<FeedFile[]>;                  // what files exist?
  fetch(file): Promise<RawBlob>;                    // download one
  parse(blob): AsyncIterable<RawRecord>;            // stream normalized records
}
```

The only thing the rest of the system ever sees is a `RawRecord`, a tagged union of
exactly three shapes: `{kind: "store"}`, `{kind: "price"}`, or `{kind: "promo"}`. A
Shufersal feed and a future scraped US chain both boil down to the same three record
types, so normalization and everything downstream never changes.

Because most Israeli chains publish through a few shared portals, **~3 adapters cover
8+ chains** (`services/ingestion/src/sources/`):

- **`cerberus`** — the `publishedprices.co.il` FTP portal (Rami Levy, Yohananof, Osher
  Ad, Tiv Taam, Hazi Hinam, …). Per-chain credentials are config, not code. Reuses
  FTP logins via a per-chain connection pool.
- **`shufersal`** — Shufersal's own web portal.
- **`carrefour`** — Carrefour IL (the stor.ai / PublishPrice platform).
- **`fixture`** — offline canned files for tests and local dev (no network).

### Normalization: the actually-hard part

Once a record is parsed, normalization does the real work:

1. **Identity (GTIN-first).** If the item carries a real barcode, it maps to one
   canonical `product` (creating it if new). Two chains reporting barcode
   `7290112490463` resolve to the *same* product row — that's the whole point.
   Chain-internal codes (loose produce) stay chain-scoped for now.
2. **Canonical naming.** When chains disagree on the name for one GTIN, we keep every
   chain's name on its listing and elect a canonical display name (longest/most
   complete wins in v1).
3. **Units & unit price.** We parse "1.5 ל" / "1500 מ״ל" / "1.5L" into a canonical
   quantity (ml/g/unit) and **recompute** price-per-100ml ourselves, because the
   feeds' own unit-price fields are unreliable. Unparseable quantities are *flagged*,
   never guessed.
4. **Promos** get normalized into a small typed enum (`simple_discount`,
   `n_for_price`, `second_unit_pct`, `club_price`, `spend_threshold`, `other`) plus
   parameters, so basket math can apply them programmatically. Anything weird lands
   in `other` with its raw text preserved — nothing is silently dropped.
5. **Prices** are change-detected: `store_price` gets the current snapshot, and a new
   `price_point` history row is written only if the price actually changed.

### Freshness, regions, and honesty

- Every price carries a **source timestamp** and an **ingested-at** time, so an agent
  can qualify its answers ("as of this morning").
- By default ingestion is filtered to a **geographic region** (Gush Dan–Sharon,
  Jerusalem, Haifa, Beersheva) to keep local runs fast. Flags widen it:
  `SUPER_MCP_REGION_FILTER=0`, `SUPER_MCP_FULL=1`, `SUPER_MCP_NO_CAP=1`.
- Each run writes an `ingestion_run` row with files/rows/errors and a status
  (`success` / `degraded` / `failed` / `empty`), so a silently-broken feed is caught
  within one cycle. A run that ingests prices but fails to refresh the semantic index
  is marked `degraded` rather than lying that it succeeded.
- Raw feed files are archived to `data/raw/` (a local stand-in for a cloud bucket)
  for replay and debugging.

---

## 6. How you talk to it (REST + MCP)

Both surfaces authenticate the same way: `Authorization: Bearer <api_key>`.

### REST (for classic app developers)

```
GET  /v1/products?q=חלב                  search products (Hebrew or English)
GET  /v1/products/:id                     one product + all its per-chain listings
GET  /v1/products/:id/prices?near=lat,lng compare across nearby stores (default 10km)
GET  /v1/products/:id/substitutes         cheaper similar products by unit price
GET  /v1/products/:id/history             price trend
GET  /v1/chains  ·  /v1/stores            chains and (nearby) branches
GET  /v1/promotions                       active deals
POST /v1/basket/optimize                  resumable shopping list (see §9)
GET  /v1/usage                            your own usage
```

OpenAPI JSON is served at `/openapi.json`; health at `/health`.

### MCP (for AI agents)

The MCP server exposes the exact same capabilities as tools, over Streamable HTTP at
`/mcp`. The tools:

```
search_products · resolve_products · get_product · compare_prices ·
suggest_substitutes · optimize_basket · list_stores · get_promotions
```

Each tool's description is written *for an LLM* — it says when to use it, what
"location" accepts, and what freshness caveats apply. An agent that has only the MCP
URL and a key can complete a real cross-chain basket comparison unassisted.

---

## 7. Search & matching (how "חלב" finds the right milk)

Hebrew is hard to search: no reliable stemming, lots of synonyms, and shoppers type
loose free text ("קולה", "פרגיות"). The system layers several techniques and,
crucially, **prefers deterministic evidence over fuzzy guessing.**

The layers (in `packages/shared/src/intent/` and `services/api/src/services/search/`):

1. **Lexical search** — Postgres `tsvector` full-text plus `pg_trgm` trigram matching
   on names. Catches exact and near-exact hits, cheaply.
2. **Semantic search (V2)** — every product has an **embedding** (a vector capturing
   meaning). A query like "פרגיות" (chicken thigh cuts) is embedded and matched by
   approximate-nearest-neighbor (ANN) via `pgvector`. Product embeddings are computed
   offline after catalog changes (a "dirty queue"); query embeddings are computed on
   cache miss and then cached in `semantic_query_embedding` for reuse.
3. **Fusion** — lexical and semantic result lists are merged with weighted **RRF**
   (Reciprocal Rank Fusion), so a hit that both methods like ranks highest.
4. **Constraint gating** — explicit shopper constraints ("500g", "כשר", a specific
   brand) are enforced with token/phrase matching against generic, data-driven
   attribute definitions.

**The ontology is data, not code.** The vocabulary, synonyms, and attribute policy
live in Postgres tables (`semantic_term`, `semantic_attribute_definition`,
`semantic_search_config`). The engine never hard-codes Hebrew words or attribute
names — you tune behavior by editing data, not by branching in TypeScript.

**Deterministic-first, because wrong is worse than empty.** When resolving a free-text
basket line, the system first looks for hard evidence: exact name match, phrase match,
token boundaries, and form/class gates (e.g. "is this actually a *fresh chicken* and
not a *chicken-flavored sausage*?"). Embeddings only kick in when that lexical recall
is weak. The guiding principle: **auto-picking the wrong product is worse than leaving
a line unresolved and asking.** This is why `פרגיות` must never silently become
merguez sausage, `לימונים` must never become limoncello, and `קרח` (ice) must never
become popsicles. A golden 18-line "Herzliya BBQ" fixture
(`packages/db/tests/fixtures/herzliya-bbq-golden.json`) is the regression guard for
exactly these traps, and a benchmark tracks a `forbiddenHitRate` that must stay at 0.

Everything here can be dialed with env flags (`SUPER_MCP_SEMANTIC_BASKET`,
`SUPER_MCP_SEMANTIC_V2_RECALL`, `..._V2_POLICY`, `..._V2_SHADOW`,
`SUPER_MCP_DETERMINISTIC_FIRST`), which supports a careful staged rollout: backfill
embeddings → run V2 in "shadow" mode (compute but don't use, just log disagreements)
→ enable recall → enable policy → turn shadow off.

---

## 8. Promotions (turning "2 for 30₪" into real math)

List prices aren't what you pay. The chains publish promotions, and we normalize each
into a **typed mechanic** so basket math can compute the real shelf outcome:

| Mechanic | Meaning | Example |
|----------|---------|---------|
| `simple_discount` | flat price cut | ₪12 → ₪9.90 |
| `n_for_price` | N units for a total | 3 for ₪30 |
| `second_unit_pct` | % off the next unit | 2nd at 50% |
| `club_price` | members-only price | ₪8 with club card |
| `spend_threshold` | discount above a spend | ₪20 off ₪150 |
| `other` | anything unparseable | raw text kept verbatim |

When pricing a basket line, the engine checks whether an active promotion covers that
listing at that store and applies the mechanic to the quantity requested. Club prices
are included by default (`includeClub: true`) and can be turned off. The
`BasketLine` in the response carries `promoApplied` and `promoDescription` so the
agent can explain *why* a price is what it is.

---

## 9. The basket flow (the crown jewel)

This is what the whole system builds toward: an agent hands over a shopping list and a
location, and gets back priced store plans with promos applied and honest handling of
anything ambiguous.

`optimize_basket` is a **resumable two-state protocol**. Generic lists finish in one
call; ambiguous lists return questions plus a signed continuation, then finish on a
second call that must not reconstruct the original items.

### Initial call — resolve (and price only when safe)

```json
{
  "city": "Herzliya",
  "items": [
    {"query": "פרגיות", "amount": 1.75, "unit": "kg"},
    {"query": "פיתות",  "amount": 20,   "unit": "יח"},
    {"query": "קוקה קולה 1.5 ליטר", "amount": 2, "unit": "יח"},
    {"query": "מלח גס", "pack_qty": 1}
  ]
}
```

Quantity modes:

- **`pack_qty`** — number of shelf packs (1 bag of coarse salt).
- **`amount` + `unit`** — physical need (1.75 kg chicken; 20 pitas as
  `"amount":20,"unit":"יח"`). Piece counts convert that need into packs
  (10-pita bag → `qty: 2`, `qtyMode: "packs"`).
- Deprecated **`qty`** is rejected at the public boundary.

If every line is safe, the response is `status: "complete"` with plans (below).

If any line needs a human, the response is `status: "needs_confirmation"`:

```json
{
  "status": "needs_confirmation",
  "continuation": "<opaque HMAC token, ~30 min TTL>",
  "questions": [
    {
      "itemIndex": 2,
      "id": "basket-item-2-product",
      "selectionEffect": "pin",
      "options": [
        {"productId": "…", "name": "קוקה קולה 1.5L", "nearbyPricedStores": 8}
      ]
    }
  ],
  "preview": {
    "resolvedLines": 3,
    "requestedLines": 4,
    "candidateStores": 12
  }
}
```

No store plans are returned in this state. Options carry real nearby availability.
`selectionEffect` is `representative` (keep commodity intent) or `pin` (exact SKU).

### Resume call — answers only

```json
{
  "continuation": "<token from needs_confirmation>",
  "answers": [
    {"item_index": 2, "product_id": "…chosen…"}
  ]
}
```

Do **not** resend items/location. The continuation preserves the original query and
intent; answers must match offered product IDs.

### Complete plans

A `status: "complete"` response includes three recommendation meanings:

| Field | Meaning |
|-------|---------|
| `bestSingleStore` | Best overall single store (coverage first, then total/distance). |
| `cheapestCompleteStore` | Cheapest store that can cover every resolvable line, or null. |
| `multiStore` | Cheapest-per-item across stores, with coverage of what was priced. |

Every plan total includes `pricedLines`, `resolvableLines`, `requestedLines`, and
`coverageRatio`. Missing lines stay in `missingItems` / `missingItemIndexes` — never
silently dropped. Chain-local equivalents may substitute (`substituted: true`) when
the request intent allows commodity matching.

### Per-item storefront links (the handoff)

We deliberately do **not** place orders on retailer sites (ToS/automation risk). But
there's no shareable "cart URL" on Israeli chains for anonymous users either. So each
priced `BasketLine` carries a **`link`**: a direct storefront URL that opens *that
product* on *that chain's* site — usually a search-by-barcode or search-by-name deep
link (verified per chain: Shufersal, Carrefour, Keshet Taamim, Tiv Taam, Big Dabach,
Non-Stop Market, and others). Zero install, works best for small baskets: the user
clicks each link and adds items themselves. `link` is `null` for chains with no online
store.

---

## 10. Auth, keys, and metering

- API keys are created with a script (`pnpm create-key -- --name=my-agent`). Only the
  **SHA-256 hash** is stored; the raw key is printed once and must be kept in a secret
  manager. It travels as `Authorization: Bearer <key>` — never in URLs or logs.
  (Query-string credentials are rejected by default.)
- Keys have **roles**. A `master` key can create/list/rotate/revoke keys under
  `/v1/admin/keys` and read global usage at `/v1/admin/usage`. Rotation returns the
  replacement key once and atomically revokes the old one.
- Every request writes a `usage_event` (route, status, latency) for **per-key
  metering and rate limiting** (429 on limit). Agents can read their own usage at
  `/v1/usage`.

---

## 11. Running it locally (the 60-second tour)

```bash
pnpm install
pnpm db:migrate                 # apply schema migrations
pnpm db:seed                    # demo catalog + writes an API key to .local/api-key.txt
pnpm dev                        # API + MCP on http://localhost:8787

# smoke test
KEY=$(cat .local/api-key.txt)
curl -s -H "Authorization: Bearer $KEY" 'http://localhost:8787/v1/products?q=חלב'

# load real data (offline fixtures, no network needed)
pnpm ingest:fixture
# or a real chain:
pnpm ingest -- --source=il-cerberus

# build semantic index + verify quality gates
pnpm db:semantic-index -- --backend=hasher --limit=5000
pnpm db:benchmark-semantic
```

The MCP endpoint is `http://localhost:8787/mcp`; point any MCP client at it with the
same bearer key.

---

## 12. The design principles that explain most decisions

If you remember five things about this system:

1. **One service layer, two protocols.** REST and MCP are thin wrappers over the same
   functions. Never put logic in a route or a tool.
2. **GTIN is truth.** Barcode is the join key that unifies chains. Everything canonical
   hangs off it; non-GTIN items stay chain-scoped for now.
3. **Adding a chain = one adapter.** The `RawRecord` contract means schema, API, and
   MCP never change when a new source arrives.
4. **Wrong is worse than empty.** Deterministic-first resolution, forbidden-match
   guards, and the resumable `needs_confirmation` gate all exist so the system asks
   or abstains rather than confidently returning the wrong product.
5. **Everything is dated and metered.** Every price carries freshness; every request is
   logged; every ingestion run reports its health. An agent can always qualify its
   answer, and a broken feed surfaces within one cycle.
```
