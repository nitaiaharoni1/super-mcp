# Super MCP Marketing Web

Hebrew RTL marketing landing for Super MCP (`apps/web` in the monorepo).

Primary CTA is a hosted-access email request. Manual MCP config includes
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
NEXT_PUBLIC_ACCESS_EMAIL=you@example.com
```

Both values are baked into the client/server bundle at build time.

- `NEXT_PUBLIC_MCP_URL` — Streamable HTTP MCP endpoint shown in the manual setup template
- `NEXT_PUBLIC_ACCESS_EMAIL` — destination for the “בקשו גישת MCP” mailto CTA

If `NEXT_PUBLIC_ACCESS_EMAIL` is missing in development, the Access panel shows a visible configuration alert instead of a fake address.

## TypeScript note

This app uses the TypeScript 6 npm alias for Next.js 15 compatibility:

```json
"typescript": "npm:@typescript/typescript6@^6.0.2"
```

That is an intentional deviation from the rest of the monorepo. Do not bump to TypeScript 7 here without verifying Next 15 support.

## Firebase App Hosting

Deploy with [Firebase App Hosting](https://firebase.google.com/docs/app-hosting), not classic static Firebase Hosting export.

Setup:

1. Blaze billing plan required.
2. Connect the GitHub repo in the Firebase console.
3. Set the **app root directory** to `apps/web`.
4. Provide `NEXT_PUBLIC_MCP_URL` and `NEXT_PUBLIC_ACCESS_EMAIL` for build and runtime.
5. Provide PostHog (optional but recommended): Firebase secret `NEXT_PUBLIC_POSTHOG_KEY`. Host is set in `apphosting.yaml` to `https://eu.i.posthog.com`. Uses the shared Baliprop + Reflex project; every event is tagged `product=super_mcp`.

`apphosting.yaml` binds the key from a Firebase secret (BUILD and RUNTIME).

Do not commit production URLs or secrets to the repo.

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
NEXT_PUBLIC_ACCESS_EMAIL=access@example.com \
NEXT_PUBLIC_POSTHOG_KEY=phc_... \
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com \
pnpm --filter @super-mcp/web build
```
