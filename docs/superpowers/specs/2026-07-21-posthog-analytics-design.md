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

---

## Amendment, 2026-08-05: wiring the install funnel

Keyless access (`SUPER_MCP_ALLOW_ANONYMOUS=1`) and the one-click install cards broke three of the
assumptions above. Changes, all additive:

**Identity.** Every keyless caller resolves to the same `ANONYMOUS_API_KEY_ID`, so the v1 rule
(`distinct_id = api_key:{id}`) collapsed all of them into one PostHog person. Keyless callers now
carry `analyticsId` — `anon:{16 hex}`, a keyed HMAC over client address + user-agent, domain-
separated and signed with `BASKET_CONTINUATION_SECRET`. Pseudonymous by design: neither input
leaves the process, and the digest is not walkable back to an address without the secret.

**Rejections are events.** v1 captured only requests that authenticated. A 401 or a keyless 429
never reached PostHog, which hid the single commonest install failure. Both surfaces now emit
`api_operation` with `auth_mode: "rejected"`, `api_key_role: "none"` and the real `http_status`.
MCP captures at its own auth boundary because it hijacks the reply and `onResponse` never fires.

**Web ↔ API stays unlinked, deliberately.** Rather than put a per-person id in the published MCP
URL (which would live on in every reader's config file), calls carry `client_name`, a
low-cardinality bucket whose values are the same ids the cards report in
`mcp_install_clicked.target`. That gives matched cohorts ("Cursor installs" vs "calls from
Cursor"), not per-person conversion. It is a guess from client-controlled strings: a cohort label,
never an access decision.

### Taxonomy delta

| Event | Change |
|---|---|
| `access_details_opened` | **Removed.** Declared in v1, never fired; its UI no longer exists. |
| `access_mailto_clicked` | **Removed.** Declared in v1, never fired. |
| `mcp_install_viewed` | New. Card grid reached the viewport, once per load. Separates "nobody scrolls this far" from "saw them, did not click". |
| `mcp_install_clicked` | New. `{target, kind, requires_key}`. One event for all cards. |
| `mcp_copy_failed` | New. Clipboard write refused, so there is nothing to paste. |
| `mcp_url_copied` / `mcp_json_copied` | Gain `requires_key`. |
| `api_operation` | Gains `auth_mode` (`api_key` \| `anonymous` \| `rejected`), `client_name`, and `credential_presented` on rejections. |

`credential_presented` exists because a key holder over their own limit throws before
`request.auth` is set and so lands on the rejection path too. We cannot name them there without a
database lookup in `onResponse`, but they must not be read as "an install config with no key":
the flag is what separates the two. Public paths are excluded from that path entirely, since
`/v1/access-requests` runs its own submission limiter and its 429 is not an auth failure.

`requires_key` is on every install-surface event on purpose: `NEXT_PUBLIC_MCP_REQUIRES_KEY` is
expected to flip, and without it the before and after are indistinguishable in the same funnel.
