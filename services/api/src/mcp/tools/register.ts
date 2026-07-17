import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { errorResult, textResult } from "./shared/result.js";

type ToolMeta<T extends z.ZodRawShape> = {
  title: string;
  description: string;
  inputSchema: T;
};

/**
 * Registers an MCP tool with shared try/catch and JSON text serialization.
 * Handlers should return a plain payload or throw AppError for client-safe failures.
 */
export function registerTool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  meta: ToolMeta<T>,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<unknown>,
): void {
  const toolHandler = async (args: z.infer<z.ZodObject<T>>) => {
    try {
      return textResult(await handler(args));
    } catch (err) {
      return errorResult(err);
    }
  };

  server.registerTool(
    name,
    { title: meta.title, description: meta.description, inputSchema: meta.inputSchema },
    toolHandler as Parameters<McpServer["registerTool"]>[2],
  );
}
