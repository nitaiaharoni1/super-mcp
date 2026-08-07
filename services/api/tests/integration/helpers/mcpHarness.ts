import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { registerTools } from "../../../src/mcp/tools/index.js";
import { MCP_SURFACES } from "../../../src/mcp/surfaces.js";
import type { ToolTextResult } from "../../../src/mcp/tools/shared/result.js";

type RegisteredTool = {
  name: string;
  schema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<ToolTextResult>;
};

/**
 * In-process MCP client: real tool registrars + real service/DB stack, no mocks.
 * Validates args with the same strict Zod schema production advertises.
 *
 * Registers the legacy physical bundle first and the shipped online surface over
 * it, so `optimize_delivery` is reachable and the names both bundles define
 * (`search_products`, `get_product`, `get_promotions`) resolve to the variant
 * production actually serves. Physical-only tools stay callable for the suites
 * that still exercise them; the online surface is the one that ships, so where
 * they disagree it wins.
 */
export function createMcpHarness() {
  const tools = new Map<string, RegisteredTool>();

  const server = {
    registerTool: (
      name: string,
      def: { inputSchema: z.ZodTypeAny },
      handler: (args: unknown) => Promise<ToolTextResult>,
    ) => {
      tools.set(name, { name, schema: def.inputSchema, handler });
    },
  } as unknown as McpServer;

  registerTools(server);
  MCP_SURFACES.online.registerTools(server);

  return {
    toolNames(): string[] {
      return [...tools.keys()];
    },

    async call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`MCP harness: unknown tool "${name}" (have: ${[...tools.keys()].join(", ")})`);
      }

      const parsed = tool.schema.parse(args);
      const result = await tool.handler(parsed);
      const text = result.content[0]?.text ?? "";

      if (result.isError) {
        throw new Error(`MCP tool ${name} error: ${text}`);
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`MCP tool ${name}: response is not JSON: ${text.slice(0, 200)}`);
      }
    },

    /** Call expecting an AppError-style tool error (isError=true). */
    async callExpectError(name: string, args: Record<string, unknown> = {}): Promise<string> {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`MCP harness: unknown tool "${name}"`);
      }
      const parsed = tool.schema.parse(args);
      const result = await tool.handler(parsed);
      if (!result.isError) {
        throw new Error(`MCP tool ${name}: expected error, got success`);
      }
      return result.content[0]?.text ?? "";
    },
  };
}

export type McpHarness = ReturnType<typeof createMcpHarness>;
