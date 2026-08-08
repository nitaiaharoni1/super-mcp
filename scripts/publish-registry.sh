#!/usr/bin/env bash
#
# Publish this server's metadata to the official MCP Registry.
#
# The registry entry has to name the real production URL, and docs/DEPLOY.md rule 5
# forbids committing production hostnames. So the tracked file is a template and the
# rendered server.json is gitignored: the host only ever exists on the machine that
# runs this script.
#
# Usage:
#   SUPER_MCP_PUBLIC_MCP_URL=https://<host>/mcp \
#   SUPER_MCP_PUBLIC_SITE_URL=https://<site> \
#   scripts/publish-registry.sh
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template="$repo_root/server.template.json"
rendered="$repo_root/server.json"

for var in SUPER_MCP_PUBLIC_MCP_URL SUPER_MCP_PUBLIC_SITE_URL; do
  if [[ -z "${!var:-}" ]]; then
    echo "error: $var is not set. See the header of this script." >&2
    exit 1
  fi
done

if ! command -v mcp-publisher >/dev/null 2>&1; then
  echo "error: mcp-publisher not found. Install it with: brew install mcp-publisher" >&2
  exit 1
fi

# The registry rejects a remote it cannot reach, and an unreachable entry is worse
# than no entry: clients would list SuperMCP and fail on connect. Check first.
echo "Checking $SUPER_MCP_PUBLIC_MCP_URL is reachable..."
status="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  "$SUPER_MCP_PUBLIC_MCP_URL" || echo 000)"
case "$status" in
  200|401|403) echo "  reachable (HTTP $status)" ;;
  000) echo "error: could not reach $SUPER_MCP_PUBLIC_MCP_URL" >&2; exit 1 ;;
  *) echo "error: unexpected HTTP $status from $SUPER_MCP_PUBLIC_MCP_URL" >&2; exit 1 ;;
esac

SUPER_MCP_PUBLIC_MCP_URL="$SUPER_MCP_PUBLIC_MCP_URL" \
SUPER_MCP_PUBLIC_SITE_URL="$SUPER_MCP_PUBLIC_SITE_URL" \
  envsubst '${SUPER_MCP_PUBLIC_MCP_URL} ${SUPER_MCP_PUBLIC_SITE_URL}' \
  < "$template" > "$rendered"

echo "Rendered $rendered"

# Before the login, not after: the device flow is a browser round-trip, and finding out
# afterwards that the schema rejects the file wastes it. The registry caps `description`
# at 100 characters, which the first version of the template silently exceeded.
echo "Validating $rendered against the registry schema..."
mcp-publisher validate

# GitHub device-flow auth. The io.github.nitaiaharoni1/ namespace in the template is
# what this login authorises; a different account cannot publish under it.
mcp-publisher login github
mcp-publisher publish

echo
echo "Published. Verify with:"
echo "  curl 'https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.nitaiaharoni1/super-mcp'"
