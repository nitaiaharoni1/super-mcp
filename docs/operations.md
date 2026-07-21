# Operations — basket fast one-call rollout

Operator checklist for the `basket-optimize-fast-v2` default. Deploy boundary and secrets: [DEPLOY.md](./DEPLOY.md). Public examples: [README.md](../README.md).

## Migration

```text
Old default: strict confirmation when material candidate ambiguity remains.
New default: fast best-effort completion.
Compatibility: set resolution_mode=strict for old behavior.
Deprecated: verbose; use response_detail=debug.
```

## Pre-deploy verification

```bash
pnpm build
pnpm -r run typecheck
pnpm -r run test
pnpm --filter @super-mcp/api canary:mcp-contract
```

`canary:mcp-contract` asserts (in-process without `SUPER_MCP_URL`, or against a live MCP URL):

- protocol `basket-optimize-fast-v2`;
- `optimize_basket` registered first;
- `resolution_mode` and `response_detail` in schema;
- title/description contain one-call shopping-list keywords;
- legacy `prepare_basket` absent.

Against a deployed endpoint:

```bash
SUPER_MCP_URL=https://<host>/mcp \
  SUPER_MCP_API_KEY=... \
  EXPECTED_BUILD_REVISION=$(git rev-parse HEAD) \
  pnpm --filter @super-mcp/api canary:mcp-contract
```

## Post-deploy live smoke (populated DB)

```bash
CANARY_BASKET_LOCATION="רחוב בן גוריון, תל אביב" \
  pnpm --filter @super-mcp/api canary:basket

pnpm --filter @super-mcp/api canary:geocode
```

Expected gates:

- one initial basket call;
- `status: "complete"`;
- city fallback warning, no geocoding error;
- no product-search recovery;
- no out-of-radius recommendations;
- response under 15 KB;
- warm elapsed time at or below 3 seconds.

Strict-mode regression (optional):

```bash
CANARY_BASKET_RESOLUTION_MODE=strict CANARY_BASKET_AUTO_RESUME=1 \
  pnpm --filter @super-mcp/api canary:basket
```

## Rollout checklist

1. Confirm `BASKET_CONTINUATION_SECRET` and `GEOCODING_CACHE_SECRET` (≥32 bytes each) are set in the target environment.
2. Deploy revision; set `SUPER_MCP_BUILD_REVISION` / `GIT_COMMIT_SHA` so MCP instructions are not stuck on `build=dev`.
3. Run `canary:mcp-contract` against the live MCP URL with `EXPECTED_BUILD_REVISION`.
4. Run `canary:basket` with `CANARY_BASKET_LOCATION="רחוב בן גוריון, תל אביב"` and `canary:geocode`.
5. Spot-check: one `optimize_basket` discovery + call for a Hebrew staples list near Tel Aviv returns compact `complete` with assumptions; `resolution_mode=strict` still returns validated resumable questions when material ambiguity remains.
