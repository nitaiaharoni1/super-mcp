# super-mcp: Supermarket Data API + MCP for AI Agents

**Status:** Draft v1 · **Owner:** Nitai · **Date:** 2026-07-16

## Problem Statement

AI agents (shopping assistants, budget planners, nutrition coaches) have no reliable, structured way to answer "what does this product cost, where, and where is my basket cheapest?" Supermarket data is fragmented across chains, formats, and languages. In Israel every major chain is legally required to publish full price data (Price Transparency regulations under the Food Sector Competition Promotion Law, 2014), but the raw feeds are messy XML dumps with per-chain quirks, no cross-chain product identity, and no query interface. Existing consumer sites (CHP, pricez) serve humans, not programs. The cost of not solving it: every agent developer re-scrapes and re-normalizes the same data badly, and Israeli-market agents simply skip grocery use cases.

## Product Thesis

Be the **canonical, queryable, agent-native layer** over supermarket data: ingestion adapters per source, one normalized schema, exposed as REST API + remote MCP server. Israel first (feed-based, legally published data means reliable access for everyone, so the moat is normalization quality and the agent interface, not raw access). Architected so global markets are "just another adapter."

## Target Users (phased, all eventually)

1. **AI agent developers** (beachhead): building shopping/nutrition/budget agents; consume via MCP or REST, pay per usage.
2. **Consumer app builders**: grocery, fintech, health apps needing product+price infrastructure; classic data-API B2B.
3. **CPG brands / retailers** (later): shelf-price and promo monitoring across chains; higher price point, dashboard-shaped, built on the same API.

## Goals

1. An agent can go from "MCP server URL + key" to a correct cross-chain price comparison in **under 5 minutes**.
2. Cover chains representing **at least 80% of Israeli grocery market share** (Shufersal, Rami Levy, Yochananof, Victory, Tiv Taam, Osher Ad, Hazi Hinam, Machsanei Hashuk) with data freshness of **24h or better** for both prices and promos (feeds allow better).
3. **At least 95% of GTIN-bearing products** correctly unified across chains (same barcode = same canonical product).
4. Adding a new source requires **only a new adapter**: zero changes to schema, API, or MCP.
5. First 10 external API keys actively querying within 60 days of launch.

## Non-Goals (v1)

- **Placing orders / cart automation on retailer sites**: ToS/auth/browser-automation complexity; revisit as P2 once read traffic proves demand.
- **Global markets**: architecture must support them (adapter interface, i18n fields, multi-currency), but no non-Israeli adapter ships in v1.
- **Consumer-facing UI**: no website/app; API and MCP only. A demo agent is a marketing asset, not a product.
- **Loose-produce price unification across chains** (vegetables by weight with chain-internal codes): fuzzy matching is a quality rabbit hole; v1 keeps them chain-scoped, cross-chain unification is P1.
- **Real-time (< 1h) price guarantees**: feeds don't reliably support it; don't promise what sources can't deliver.
- **Historical backfill before launch date**: history accumulates from day one of ingestion; buying/scraping historical data is out.

## User Stories

**Agent developer (P0 persona)**
- As an agent developer, I want my agent to search products by free text (Hebrew or English) so that users can ask about products naturally.
- As an agent developer, I want to compare a product's price across all chains and nearby branches so that my agent can answer "where is this cheapest?"
- As an agent developer, I want to submit a shopping list and get the total basket cost per store (promos applied) so that my agent can recommend where to shop.
- As an agent developer, I want product metadata (brand, size, unit price per 100g/L, categories, GTIN) so that my agent can filter and reason ("cheapest olive oil per liter").
- As an agent developer, I want active promotions with their mechanics (e.g., "2 for 30₪", club-member price) so that my agent computes real shelf outcomes, not just list prices.
- As an agent developer, I want clear errors and a machine-readable freshness timestamp per price so that my agent can qualify its answers.

**App builder (P0 persona, same surface)**
- As an app builder, I want a documented REST API with OpenAPI spec, API keys, and predictable rate limits so that I can build production features on it.
- As an app builder, I want price history per product/store so that I can show trends and detect price hikes.

**CPG analyst (P1 persona)**
- As a brand analyst, I want all listings of my brand's GTINs across chains with prices and promo participation so that I can monitor market pricing without manual checks.

**Operator (internal)**
- As the operator, I want per-adapter ingestion health (last run, files processed, parse errors, row deltas) so that a silently broken feed is caught within one cycle.

## System Design (engineering plan)

### Stack decision

**TypeScript end-to-end, monorepo.** Single runtime for ingestion, API, and MCP (MCP SDK is TS-native). The Israeli feed formats are documented XML, so porting parse logic is straightforward, and the existing Python OSS (`israeli-supermarket-scrapers` by erlichsefi, openisraelisupermarkets) serves as reference for per-chain quirks rather than a runtime dependency.

- **Runtime:** Node 22 + TypeScript, Fastify (REST), `@modelcontextprotocol/sdk` (remote MCP, Streamable HTTP).
- **DB:** Postgres. Start on **Neon** (serverless, cheap, branching for dev); Cloud SQL is the fallback if ingestion write volume outgrows it. Search v1 uses Postgres `pg_trgm` + `tsvector` (Hebrew needs trigram, not stemming); a dedicated search engine (Meilisearch/Typesense) is P1 if quality demands.
- **Compute:** GCP Cloud Run (API/MCP service, scale-to-zero) + Cloud Run Jobs triggered by Cloud Scheduler (ingestion). Tesse GCP project + startup credits.
- **Storage:** GCS bucket for raw fetched feed files (replay/debug/audit).

### Architecture

```
[Chain feeds / future scrapers]
        │  SourceAdapter (per source)
        ▼
  Ingestion pipeline: discover → fetch (raw → GCS) → parse → RawRecord envelope
        │
        ▼
  Normalization: identity resolution (GTIN-first) → unit/price normalization
                 → category mapping → upsert canonical entities + price points
        │
        ▼
  Postgres (canonical schema, price history partitions)
        │
        ▼
  Service layer (shared query/business logic)
     ├── REST API (Fastify, OpenAPI, API keys, rate limits, usage metering)
     └── MCP server (same service calls exposed as tools)
```

### The adapter contract (the "generic" part)

```ts
interface SourceAdapter {
  sourceId: string;                       // e.g. "il-shufersal"
  market: string;                         // "IL"
  discover(): Promise<FeedFile[]>;        // list available files/pages
  fetch(file: FeedFile): Promise<RawBlob>; // download; caller archives to GCS
  parse(blob: RawBlob): AsyncIterable<RawRecord>; // stream, don't buffer
}

// RawRecord is a tagged union, the ONLY thing normalization sees:
type RawRecord =
  | { kind: "store";  chainId; storeId; name; address; city; geo? }
  | { kind: "price";  chainId; storeId; itemCode; itemType; name; brand?;
      qty?; unit?; price; unitPrice?; allowDiscount?; ts }
  | { kind: "promo";  chainId; storeId; promoId; description; mechanic;
      itemCodes[]; startTs; endTs; clubOnly?; ts };
```

Israel v1 adapters (most chains host via shared portals, so ~3 adapter implementations cover 8+ chains):
- `cerberus` adapter (publishedprices.co.il: Rami Levy, Yochananof, Osher Ad, Tiv Taam, Hazi Hinam, and others; per-chain credentials/paths as config, not code)
- `shufersal` adapter (own portal, prices.shufersal.co.il)
- `binaprojects` or other portal adapters as needed (Victory, Machsanei Hashuk group)

A future global market (e.g., a scraped US chain) implements the same interface with `parse` emitting the same `RawRecord`s. Normalization and everything downstream is untouched (Goal 4).

### Normalization & identity (the actual hard problem)

- **Products:** GTIN/barcode is the join key. `itemType` in the feeds distinguishes GTIN items from chain-internal codes. GTIN items map to one canonical `product` row; internal-code items stay chain-scoped (v1, per non-goals). Conflicting names/brands across chains for the same GTIN: keep per-chain `listing` names, elect a canonical display name (longest/most complete heuristic in v1, LLM-assisted cleanup in P1).
- **Units & unit price:** normalize quantity+unit to canonical (g, ml, unit) and compute price-per-100g/100ml/unit; this is what agents actually reason with. Feed `unitPrice` fields are unreliable; recompute.
- **Categories:** one internal taxonomy (~2 levels deep in v1). Feeds have inconsistent or missing categories, so v1 seeds the mapping with rules plus a one-off LLM batch classification of the product catalog (bounded, offline job, not per-request).
- **Promos:** normalize mechanics into a small enum (`simple_discount`, `n_for_price`, `second_unit_pct`, `club_price`, `spend_threshold`, `other`) plus parameters, so basket math can apply them programmatically. `other` keeps raw text so nothing is dropped.
- **Prices:** append-only `price_point(product_listing_id, store_id, price, ts)` partitioned by month; current price materialized per listing/store for query speed. Change-detection on ingest so unchanged prices don't bloat history.

### Core schema (entities)

`chain` → `store` (branch, geo) · `product` (canonical, GTIN) → `listing` (product × chain, per-chain code/name) → `store_price` (current snapshot) · `price_point` (history) · `promotion` + `promotion_item` · `api_key` / `usage_event`.

### API surface (REST, v1)

- `GET /v1/products?q=&category=&brand=&gtin=` (search, Hebrew/English)
- `GET /v1/products/{id}` (canonical product + per-chain listings)
- `GET /v1/products/{id}/prices?city=&near=lat,lng&radius=` (cross-chain/branch comparison, promos applied, freshness ts)
- `GET /v1/products/{id}/history?store_id=&from=&to=`
- `GET /v1/chains` · `GET /v1/stores?chain=&city=&near=`
- `GET /v1/promotions?store_id=&product_id=&active=true`
- `POST /v1/basket/optimize` (body: `[{product_id|gtin|query, qty}]` plus location; returns per-store totals with promo math, missing-item handling, ranked result)
- Auth: `Authorization: Bearer <api_key>` · per-key rate limits + metering · OpenAPI JSON served at `/openapi.json`

### MCP server (v1 tools, thin wrappers over the same services)

- `search_products(query, filters?)`
- `get_product(id | gtin)`
- `compare_prices(product, location?)`
- `optimize_basket(items[], location?)`
- `list_stores(chain?, city?, near?)`
- `get_promotions(store?, product?)`

Tool descriptions written for LLM consumption (when to use, what "location" accepts, freshness caveats). Remote MCP over Streamable HTTP on the same Cloud Run service, same API-key auth. This near-zero-marginal-cost dual surface is the core product bet: **one service layer, two protocols.**

## Requirements

### P0: Must have (v1 ships with these)

| # | Requirement | Acceptance criteria |
|---|---|---|
| 1 | Ingestion for 5+ chains via 2+ portal adapters | Daily scheduled run completes; per-adapter run report (files, rows, errors); raw files archived to GCS |
| 2 | Canonical schema + GTIN identity resolution | Same GTIN from 2+ chains resolves to 1 product with N listings; 95%+ GTIN unification on sampled audit |
| 3 | Unit-price normalization | Every listing with parseable qty/unit has recomputed price-per-100g/ml/unit; unparseable flagged, not guessed |
| 4 | Promo normalization into typed mechanics | 80%+ of active promos parse into a typed mechanic; rest retained as `other` with raw text |
| 5 | REST API: search, product, prices-compare, stores, promos | OpenAPI-documented; Hebrew search returns relevant results for a top-100 grocery queries test set |
| 6 | Basket optimize endpoint | Given a 15-item list + city, returns per-store totals with promos applied and per-item price breakdown; items unavailable at a store are listed, not silently dropped |
| 7 | Remote MCP server with the 6 tools | Claude (or any MCP client) connects with URL+key and completes search, compare, and basket optimize unassisted |
| 8 | API keys, rate limiting, usage metering | Keys creatable (admin script is fine in v1); 429 on limit; usage queryable per key |
| 9 | Freshness metadata | Every price in every response carries source timestamp + ingested-at |
| 10 | Ingestion observability | Failed/empty adapter run alerts within one cycle (Cloud Monitoring alert is enough) |

### P1: Fast follows

- Price-drop **alerts/watchlists + webhooks** (the "operations" stateful layer for agents)
- Dedicated search engine if Postgres search quality caps out; synonym/typo handling for Hebrew
- LLM-assisted canonical naming + category cleanup; product images
- Cross-chain matching for non-GTIN items (produce)
- Self-serve signup + billing (Paddle/Stripe), free tier
- CPG brand views (all my GTINs, promo participation): same API, saved queries/exports
- Remaining Israeli chains (long tail), pharma-grocery (Super-Pharm) if feeds allow

### P2: Future (architectural insurance only)

- Global adapters (HTML/API scrapers; the adapter contract already accommodates them; keep `market`, currency, and locale fields non-IL-hardcoded from day one)
- Ordering/cart automation on retailer platforms
- Embedding-based product matching + semantic search
- Nutrition data enrichment (join GTIN with open food databases)

## Success Metrics

**Leading (first 60 days):** time-to-first-successful-MCP-call for a new key (target under 5 min, measured from key creation to first 200 response); 10+ active external keys; 95%+ GTIN unification (weekly sampled audit); ingestion success rate 99%+ of scheduled runs; p95 API latency under 500ms (search) and under 2s (basket optimize).

**Lagging (quarter):** 3+ keys with sustained weekly usage (retention proxy); first paying customer; basket-optimize share of calls growing (signals real agent workloads, not tire-kicking); zero data-correctness complaints per month that trace to normalization (vs. source).

## Open Questions

1. **[Legal, blocking for commercialization but not for build]** The transparency feeds are legally mandated public data; confirm commercial redistribution terms (CHP/pricez precedent suggests it's fine, but get a proper read before charging).
2. **[Product, non-blocking]** Pricing model: per-request, per-seat key, or MCP-flat + REST-metered? Decide after observing usage shapes from first free keys.
3. **[Eng, non-blocking]** Club-member prices: model as promo mechanic (current plan) or as a parallel price tier? Revisit when basket math meets real promo data.
4. **[Eng, resolve during build]** Feed update cadence per chain varies; pick per-adapter schedules after measuring actual publish times for a week.
5. **[Product, non-blocking]** Does "global later" mean next-market-by-demand or a deliberate expansion? Affects nothing in v1 but shapes P2 priorities.

## Phasing / Timeline

- **Phase 0, Ingestion core (wk 1-2):** monorepo scaffold, adapter contract, cerberus + shufersal adapters (5+ chains), schema, GTIN resolution, GCS archiving, scheduled runs.
- **Phase 1, API + MCP (wk 3-5):** service layer, REST endpoints, MCP server, keys/rate-limits/metering, OpenAPI docs, freshness metadata, monitoring. **Launchable.**
- **Phase 2, Compute value (wk 6-8):** basket optimizer with promo math, price history endpoints, Hebrew search tuning, demo agent for marketing, first external users.
- **Phase 3:** P1 backlog by demand signal.
