# Architecture

## Overview

A single-page Next.js 15 App Router marketing site: one server-rendered route composed of section components, with all copy centralized and the only interactive path being an access-request form that POSTs to the API.

## Directory Map

| Directory | Purpose |
|-----------|---------|
| `src/content/` | `he.ts` — every Hebrew string and published figure on the site. Components never hard-code copy |
| `src/components/marketing/` | Page sections in reading order (`Hero`, `PriceLedger`, `Coverage`, `Connect`, `Integrity`, `Faq`, …) |
| `src/components/shared/` | Cross-section pieces: `Container`, `Reveal`, `CodeBlock`, `CopyButton`, `TrackedAnchor`, doodles |
| `src/components/ui/` | The primitive layer (`button.tsx`) using class-variance-authority |
| `src/lib/` | `mcp.ts` and `mcpInstall.ts` build the per-assistant install links; `analytics.ts` wraps PostHog; `utils.ts` is the `cn` merge helper |
| `firebase-hosting/` | Generated from `public/` at deploy time — gitignored except `.gitkeep`, never hand-edited |

## Data Flow

- `src/app/layout.tsx` → `page.tsx` composes the marketing sections; all of it renders on the server, and copy comes from `content/he.ts`.
- `NEXT_PUBLIC_MCP_URL` is read at build time and drives both the install links (`lib/mcpInstall.ts`) and the API base URL, which is derived by stripping `/mcp` or the legacy `/mcp/online`.
- `AccessRequestForm` POSTs cross-origin to `POST /v1/access-requests`, so the API's `CORS_ORIGINS` must list this app's origin.
- `instrumentation-client.ts` initializes PostHog; events are defined in `@super-mcp/shared/analytics` so web and API agree on names.

## Key Patterns

- Copy and code are separated so a wording change never touches a component, and so `tests/content/` can assert on what the site claims.
- Install links are computed, not hand-written: each assistant target is built from one URL, which is why a new target needs a matching copy entry in `he.ts` (a test enforces this).
- Progressive disclosure is CSS-only (`Reveal`), so no copy is hidden behind JavaScript.
- Deployed to Cloud Run behind Firebase Hosting, which serves `public/` assets before rewriting to the app.

## Dependencies Between Modules

- Depends only on `@super-mcp/shared` (analytics event definitions) — never on `@super-mcp/db` or `@super-mcp/api`. The site talks to the API over HTTP like any other client.
- `components/marketing/` may use `components/shared/` and `components/ui/`; the dependency never runs the other way.
- Everything imports copy from `content/he.ts`; `content/` imports nothing.
