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

- `NEXT_PUBLIC_MCP_URL` — Streamable HTTP MCP endpoint (also used to derive the API base URL for the access form by stripping `/mcp` or legacy `/mcp/online`)
- `CORS_ORIGINS` (API) — required for the access form; comma-separated browser origins allowed to call the API

## TypeScript note

This app uses the TypeScript 6 npm alias for Next.js 15 compatibility:

```json
"typescript": "npm:@typescript/typescript6@^6.0.2"
```

That is an intentional deviation from the rest of the monorepo. Do not bump to TypeScript 7 here without verifying Next 15 support.

## Testing

```bash
pnpm --filter @super-mcp/web test
```

Vitest, running in the `node` environment (no jsdom). Tests live in `tests/`, mirroring `src/`:
`tests/lib/` covers the MCP install-link builders and `tests/content/` asserts that the Hebrew
copy still matches the online-delivery product surface.

## Production deploy (Cloud Run behind Firebase Hosting)

Operator deploy (region `europe-west1`) builds `apps/web/Dockerfile` from the repo root
and serves `super-mcp-web`. Firebase Hosting sits in front and is the public origin:
`/mcp` and `/v1/**` route to the `super-mcp` API service, everything else to this app.
See [firebase.json](../../firebase.json).

One origin for both means the marketing site calls the API same-origin, so the access
form needs no `CORS_ORIGINS` entry for it.

```bash
# Build args are NEXT_PUBLIC_*, baked in at build time. Do not read them from
# apps/web/.env.local: that file holds dev values and will ship localhost URLs.
# Take them from Secret Manager, or from the values already live on the site.
gcloud builds submit --project=<PROJECT_ID> --region=europe-west1 --config=<(...)  # see ops notes
gcloud run deploy super-mcp-web \
  --project=<PROJECT_ID> \
  --region=europe-west1 \
  --image=europe-west1-docker.pkg.dev/<PROJECT_ID>/super-mcp/web:latest \
  --allow-unauthenticated
firebase deploy --only hosting --project=<PROJECT_ID>
```

`NEXT_PUBLIC_MCP_URL` must be the Hosting origin (`https://<site>.web.app/mcp`), never a
raw `*.run.app` URL: that one carries the project number, so it breaks every saved client
config the next time the project moves. `apphosting.yaml` remains for an optional Firebase
App Hosting path; the live site is Cloud Run. Do not commit production URLs or secrets.

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
