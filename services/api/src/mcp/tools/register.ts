import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { captureMcpToolOperation } from "../../analytics/capture.js";
import { resolveAnalyticsContext } from "../../analytics/context.js";
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
    const startedAt = Date.now();
    const ctx = resolveAnalyticsContext(server);
    try {
      const payload = await handler(args);
      captureMcpToolOperation({
        toolName: name,
        startedAt,
        status: "ok",
        toolArgs: args,
        result: payload,
        ctx,
      });
      return textResult(payload);
    } catch (err) {
      captureMcpToolOperation({
        toolName: name,
        startedAt,
        status: "error",
        error: err,
        toolArgs: args,
        ctx,
      });
      return errorResult(err);
    }
  };

  // Wrap the raw shape into a strict ZodObject so every tool rejects unknown/misspelled
  // arguments with a validation error instead of silently dropping them. The SDK accepts a
  // full ZodObject as inputSchema (not just a raw shape) and validates args against it before
  // invoking the handler; a strict object also emits `additionalProperties: false` in the
  // advertised JSON Schema.
  const strictSchema = z.object(meta.inputSchema).strict();

  server.registerTool(
    name,
    { title: meta.title, description: meta.description, inputSchema: strictSchema },
    toolHandler as Parameters<McpServer["registerTool"]>[2],
  );
}
