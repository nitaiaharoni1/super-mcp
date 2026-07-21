# Super MCP Marketing Web

Hebrew RTL marketing landing for Super MCP (`apps/web` in the monorepo).

## Local development

From the repo root:

```bash
pnpm --filter @super-mcp/web dev
```

Create `apps/web/.env.local`:

```bash
NEXT_PUBLIC_MCP_URL=http://localhost:8787/mcp
```

`NEXT_PUBLIC_MCP_URL` is baked into the client bundle at build time. The Connect panel reads it for the MCP URL, JSON snippet, and Cursor deeplink.

## TypeScript note

This app uses the TypeScript 6 npm alias for Next.js 15 compatibility:

```json
"typescript": "npm:@typescript/typescript6@^6.0.2"
```

That is an intentional deviation from the rest of the monorepo (Task 1). Do not bump to TypeScript 7 here without verifying Next 15 support.

## Firebase App Hosting

Deploy with [Firebase App Hosting](https://firebase.google.com/docs/app-hosting), not classic static Firebase Hosting export.

Setup:

1. Blaze billing plan required.
2. Connect the GitHub repo in the Firebase console.
3. Set the **app root directory** to `apps/web`.
4. Provide `NEXT_PUBLIC_MCP_URL` for build and runtime.

### Environment variable

`apphosting.yaml` binds `NEXT_PUBLIC_MCP_URL` from a Firebase secret named `NEXT_PUBLIC_MCP_URL` (available at BUILD and RUNTIME).

If secret binding is not set up yet, configure the variable in the Firebase console instead:

- **Name:** `NEXT_PUBLIC_MCP_URL`
- **Example value:** `https://api.example.com/mcp` (your public MCP endpoint)
- **Availability:** BUILD and RUNTIME

Do not commit production URLs or secrets to the repo.

Classic `next export` / static Firebase Hosting is out of scope for this app.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm --filter @super-mcp/web dev` | Dev server on port 3000 |
| `pnpm --filter @super-mcp/web build` | Production build |
| `pnpm --filter @super-mcp/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @super-mcp/web test` | Vitest |

Production build example:

```bash
NEXT_PUBLIC_MCP_URL=https://api.example.com/mcp pnpm --filter @super-mcp/web build
```
