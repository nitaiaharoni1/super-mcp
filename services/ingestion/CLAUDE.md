<!-- Keep this file and docs/ updated when this subproject's conventions change -->

# @super-mcp/ingestion

Ingests Israeli price-transparency feeds (Cerberus FTP, Shufersal, Carrefour/PublishPrice, laibcatalog) plus a separate online/scraped flow, and syncs the curated fulfillment catalog. Part of the super-mcp monorepo. Built with TypeScript, `basic-ftp`, and `fast-xml-parser`.

## Commands

```bash
pnpm build              # tsc -p tsconfig.json
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest run
pnpm start              # full ingest run
pnpm start:online       # online/scraped store flow
pnpm sync-fulfillment   # push the curated delivery-terms catalog to the DB
```

Run these from the repo root instead (`pnpm ingest`, `pnpm ingest:online`, `pnpm ingest:fixture`,
`pnpm ingest:fulfillment`) — those wrappers build `@super-mcp/db` and `@super-mcp/shared` first,
which this package imports through their `dist/` output.

## Documentation

Read the doc that matches the change — not all of them. Root `.claude/docs/coding-guidelines.md`
applies to code in every package.

| Changing | Read first |
|---|---|
| Tests | `docs/testing.md` |
| Module structure or data flow | `docs/architecture.md` |
| Where a new module belongs | root `docs/folder-conventions.md` |

## Gotchas

- Retailer storefronts are deliberately not scraped for the regulated feed (Cloudflare bot management, Shufersal's crawl window, Rami Levy's robots.txt). The filed feeds are the legal basis of the product; the `src/online/` flow is a separate, explicitly-marked path.
- Anything read from a website is stamped `price_source = 'scraped'` so it can never be mistaken for a legally filed price.
- Delivery terms in `src/fulfillment/catalog.ts` carry `verifiedAt` plus a confidence level and decay to `unknown` after 90 days. Numbers must go stale loudly rather than lie quietly.
- The pipeline never imports API code, and adapters implement the `SourceAdapter` contract from `@super-mcp/shared`.
- `pipeline.ts`, `xml.ts`, and `adapters/index.ts` at the top of `src/` are thin re-export shims kept for legacy import paths. New code should import from `pipeline/`, `xml/`, and `sources/` directly.
