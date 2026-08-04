/**
 * Deployed MCP contract canary — fails when the running endpoint lags the repo.
 *
 * Usage:
 *   SUPER_MCP_URL=http://localhost:8787/mcp \
 *   SUPER_MCP_API_KEY=... \
 *   EXPECTED_BUILD_REVISION=$(git rev-parse HEAD) \
 *   pnpm --filter @super-mcp/api canary:mcp-contract
 *
 * Without SUPER_MCP_URL, validates the in-process tool registration + instructions
 * (useful for local CI without a live server).
 *
 * Requires:
 * - protocol delivery-optimize-v1
 * - optimize_delivery registered first
 * - physical optimize_basket absent
 * - continuation, answers, resolution_mode and address in schema
 * - title/description identify a shopping-list delivery tool
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { buildMcpServerInstructions } from "../mcp/server.js";
import {
  validateMcpDeliveryContract,
  type McpToolDescriptor,
} from "../mcp/protocolIdentity.js";
import { registerDeliveryTools } from "../mcp/tools/delivery/index.js";
import { registerOnlineProductTools } from "../mcp/tools/products/index.js";
import { registerOnlineStoreTools } from "../mcp/tools/stores/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

/** Keywords that must appear in optimize_delivery title or description. */
const DELIVERY_DISCOVERY_KEYWORDS = ["shopping list", "delivery"] as const;

type ToolSnapshot = McpToolDescriptor & {
  title?: string;
  description?: string;
};

function collectInProcessTools(): {
  toolNames: string[];
  tools: ToolSnapshot[];
  instructions: string;
} {
  const tools: ToolSnapshot[] = [];
  const server = {
    registerTool: (
      name: string,
      def: {
        title?: string;
        description?: string;
        inputSchema?: { shape?: Record<string, unknown> };
      },
    ) => {
      // registerTool wraps the shape in z.object(...).strict() before calling us.
      const shape = def.inputSchema?.shape ?? {};
      const properties: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) properties[key] = {};
      tools.push({
        name,
        title: def.title,
        description: def.description,
        inputSchema: { properties },
      });
    },
  } as unknown as Parameters<typeof registerDeliveryTools>[0];

  // Match production registerTools order: delivery first for discovery.
  registerDeliveryTools(server);
  registerOnlineProductTools(server);
  registerOnlineStoreTools(server);

  return {
    toolNames: tools.map((t) => t.name),
    tools,
    instructions: buildMcpServerInstructions(),
  };
}

async function fetchRemoteTools(url: string, apiKey: string): Promise<{
  toolNames: string[];
  tools: ToolSnapshot[];
  instructions: string;
}> {
  // Minimal JSON-RPC tools/list against Streamable HTTP MCP.
  const init = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "super-mcp-canary", version: "0.1.0" },
      },
    }),
  });
  if (!init.ok) {
    throw new Error(`MCP initialize failed: HTTP ${init.status}`);
  }
  const initBody = (await init.json()) as {
    result?: { instructions?: string; serverInfo?: { version?: string } };
  };
  const instructions =
    initBody.result?.instructions ??
    `protocol=missing; build=${initBody.result?.serverInfo?.version ?? "unknown"}`;

  const listed = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });
  if (!listed.ok) {
    throw new Error(`MCP tools/list failed: HTTP ${listed.status}`);
  }
  const listBody = (await listed.json()) as {
    result?: {
      tools?: Array<{
        name: string;
        title?: string;
        description?: string;
        inputSchema?: McpToolDescriptor["inputSchema"];
      }>;
    };
  };
  const remoteTools = listBody.result?.tools ?? [];
  return {
    toolNames: remoteTools.map((t) => t.name),
    tools: remoteTools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    instructions,
  };
}

/** Extra discovery checks beyond validateMcpDeliveryContract. */
function validateOptimizeDeliveryDiscoveryCopy(tools: ToolSnapshot[]): string[] {
  const errors: string[] = [];
  const optimize = tools.find((t) => t.name === "optimize_delivery");
  if (!optimize) return errors;

  const haystack = `${optimize.title ?? ""} ${optimize.description ?? ""}`.toLowerCase();
  for (const keyword of DELIVERY_DISCOVERY_KEYWORDS) {
    if (!haystack.includes(keyword)) {
      errors.push(
        `optimize_delivery title/description must contain "${keyword}"`,
      );
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const url = process.env.SUPER_MCP_URL?.trim();
  const apiKey = process.env.SUPER_MCP_API_KEY?.trim() ?? process.env.SUPER_MCP_MASTER_API_KEY?.trim();
  const expectedBuild = process.env.EXPECTED_BUILD_REVISION?.trim() || null;
  const requireDeployed =
    process.env.SUPER_MCP_REQUIRE_BUILD_REVISION === "1" || process.env.NODE_ENV === "production";

  const snapshot = url
    ? await (async () => {
        if (!apiKey) throw new Error("SUPER_MCP_API_KEY required when SUPER_MCP_URL is set");
        return fetchRemoteTools(url, apiKey);
      })()
    : collectInProcessTools();

  const result = validateMcpDeliveryContract({
    ...snapshot,
    expectedBuild,
    requireDeployedRevision: requireDeployed,
  });

  const discoveryErrors = validateOptimizeDeliveryDiscoveryCopy(snapshot.tools);
  const errors = [...result.errors, ...discoveryErrors];
  const ok = errors.length === 0;

  console.log(
    JSON.stringify(
      {
        event: "canary_mcp_contract",
        mode: url ? "remote" : "in-process",
        url: url ?? null,
        identity: result.identity,
        expectedBuild,
        ok,
        errors,
        toolNames: snapshot.toolNames,
      },
      null,
      2,
    ),
  );

  if (!ok) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
