# Data sources and redistribution

## What this project uses

Super MCP ingests **Israeli supermarket price-transparency feeds** that chains publish under national transparency rules (Cerberus/FTP portals, HTTPS portals such as Shufersal and PublishPrice-style sites). Public FTP usernames with empty passwords on Cerberus-style hosts are **intentional public credentials**, not private secrets.

## What ships in this repository

| Content | In git? | Notes |
|---------|---------|--------|
| Small XML fixtures under `data/fixtures/` | Yes | Offline tests and demos |
| Raw feed archives under `data/raw/` | **No** (gitignored) | Local/operator cache only |
| Normalized Postgres catalog | **No** | Built by migrate/seed/ingest on your machine or host |
| Production API responses / dumps | **No** | Do not commit exports from a live host |

## Freshness

Prices and promotions change continuously. Treat any cached or fixture price as possibly stale. Hosted and self-hosted deployments should surface source timestamps (`source_ts` / ingest time) when present.

## Legal stance (v1)

Accessing mandated public transparency feeds for personal or research use is the product’s baseline assumption. **Commercial redistribution terms for a normalized API over that data are not confirmed.** Before charging for redistribution or bulk resale of the normalized dataset, get a proper legal read for your jurisdiction and use case.

Self-host and use this software **at your own risk**. This document is not legal advice.

## Operator responsibility

If you run a public hosted instance:

- Do not publish raw feed dumps from your archive bucket in this repo.
- Rate-limit and key-gate expensive endpoints.
- Keep geocoding and continuation HMAC secrets strong and unique per environment.
