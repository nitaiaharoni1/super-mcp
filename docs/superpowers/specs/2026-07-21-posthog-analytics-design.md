# Super MCP × PostHog Analytics Design

**Date:** 2026-07-21  
**Status:** Approved for implementation  
**PostHog project:** Baliprop + Reflex (EU, id `194876`) — filter all insights with `product = super_mcp`

## Goals (v1)

Thin dual-surface analytics:

1. Marketing funnel on `apps/web` (pageviews + ~6 custom connect/CTA events)
2. Product usage on `services/api` (MCP tools + REST shopping routes)

## Non-goals (v1)

- Dedicated PostHog project
- Session replay
- Reverse proxy / ingest rewrite
- Feature flags / experiments
- Web ↔ API person linking
- Free-text queries, product names, or raw bodies in event properties
- Admin / health / OpenAPI instrumentation

## Architecture

Dual SDK, shared event-name constants only (no SDK in `@super-mcp/shared`):

| Surface | SDK | Init |
|---|---|---|
| Web | `posthog-js` | `src/instrumentation-client.ts` |
| API | `posthog-node` | Lazy singleton; no-op without `POSTHOG_KEY` |

Hard rules:

- Every event includes `product: "super_mcp"`
- `environment`: `development` \| `production`
- `surface`: `web` \| `mcp` \| `rest`
- Capture never throws into the request path
- Missing key = silent no-op

### Capture points

1. **MCP:** wrap `registerTool` handlers; auth via WeakMap bound to each `McpServer` (+ ALS backup) on `/mcp` POST
2. **REST:** extend existing `onResponse` hook for `/v1/*` except `/v1/admin/*` (body + query metadata)
3. **Web:** autocapture `$pageview` + explicit captures on Access / Hero / Header CTAs and copy actions
4. **Shutdown:** Fastify `onClose` flushes `posthog-node`

### Identity

| Surface | `distinct_id` |
|---|---|
| Web | Anonymous PostHog cookie (default) |
| API | `api_key:{apiKeyId}` (never the raw secret) |

## Event taxonomy

### Global properties

`product`, `environment`, `surface`

### Web events

| Event | Trigger |
|---|---|
| `$pageview` | Autocapture |
| `marketing_cta_clicked` | Hero / header / access primary CTA (`cta_id`, `location`) |
| `access_mailto_clicked` | Mailto access CTA (`location`) |
| `mcp_url_copied` | Copy MCP URL |
| `mcp_json_copied` | Copy MCP JSON |
| `access_details_opened` | “Already have a key” details opened |
| `self_host_docs_clicked` | Self-host README CTA |

### Server event

`api_operation` with metadata-only properties:

`operation`, `status` (`ok`\|`error`), `http_status` (REST), `error_code`, `latency_ms`, `item_count`, `has_city`, `has_near`, `has_location`, `basket_status` (`complete`\|`needs_confirmation`\|`error` when known), `api_key_role`

## Env

**Web:** `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`  
**API:** `POSTHOG_KEY`, `POSTHOG_HOST=https://eu.i.posthog.com`

Use the Baliprop + Reflex project token. Host must be EU.

## Testing

- Unit tests for request metadata extraction (no PII leakage)
- Unit tests that capture is a no-op without key / never throws
- Manual: load marketing page + one MCP tool call; filter PostHog live events by `product = super_mcp`
