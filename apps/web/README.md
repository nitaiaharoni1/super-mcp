# Super MCP Marketing Web

Hebrew RTL marketing landing for Super MCP (`apps/web` in the monorepo).

Primary CTA is an inline access-request form that POSTs to the API
(`POST /v1/access-requests`). Manual MCP config includes
`Authorization: Bearer <YOUR_API_KEY>` — there is no public one-click Cursor
install without an issued key.

## Local development

From the repo root:

```bash
pnpm --filter @super-mcp/web dev
```

Create `apps/web/.env.local`:

```bash
NEXT_PUBLIC_MCP_URL=http://localhost:8787/mcp
```

And on the API (repo-root `.env`), allow the marketing origin so the browser form can POST:

```bash
CORS_ORIGINS=http://localhost:3000
```

Values prefixed with `NEXT_PUBLIC_` are baked into the client/server bundle at build time.

- `NEXT_PUBLIC_MCP_URL` — Streamable HTTP MCP endpoint (also used to derive the API base URL for the access form by stripping `/mcp`)
- `CORS_ORIGINS` (API) — required for the access form; comma-separated browser origins allowed to call the API

## TypeScript note

This app uses the TypeScript 6 npm alias for Next.js 15 compatibility:

```json
"typescript": "npm:@typescript/typescript6@^6.0.2"
```

That is an intentional deviation from the rest of the monorepo. Do not bump to TypeScript 7 here without verifying Next 15 support.

## Production deploy (Cloud Run)

Operator deploy (project `super-mcp-il`, region `europe-west1`) builds `apps/web/Dockerfile` from the repo root and serves `super-mcp-web`.

```bash
# Build args come from apps/web/.env.local (or Secret Manager) — never commit them.
gcloud builds submit --project=super-mcp-il --config=<(...)  # see ops notes
gcloud run deploy super-mcp-web \
  --project=super-mcp-il \
  --region=europe-west1 \
  --image=europe-west1-docker.pkg.dev/super-mcp-il/super-mcp/web:latest \
  --allow-unauthenticated
```

Ensure the API service has `CORS_ORIGINS` set to the marketing site origin(s).
`apphosting.yaml` remains for an optional Firebase App Hosting path; the live site is Cloud Run. Do not commit production URLs or secrets to the repo.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm --filter @super-mcp/web dev` | Dev server on port 3000 |
| `pnpm --filter @super-mcp/web build` | Production build |
| `pnpm --filter @super-mcp/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @super-mcp/web test` | Vitest |

Production build example:

```bash
NEXT_PUBLIC_MCP_URL=https://api.example.com/mcp \
NEXT_PUBLIC_POSTHOG_KEY=phc_... \
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com \
pnpm --filter @super-mcp/web build
```
