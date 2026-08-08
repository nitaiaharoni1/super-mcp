import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AppError } from "@super-mcp/shared";
import { captureMcpToolOperation } from "../../analytics/capture.js";
import { resolveAnalyticsContext } from "../../analytics/context.js";
import { errorResult, textResult } from "./shared/result.js";

/**
 * Write a failed tool call to the log, because `errorResult` deliberately does not.
 *
 * Hiding pg/SQL text from the client is right, but until now that was the ONLY
 * thing that happened to an unexpected failure: nothing reached Cloud Logging at
 * any severity. get_promotions was consequently dead for every caller on every
 * browse request, and the outage was invisible. It surfaced only because someone
 * happened to call the tool by hand, and the cause had to be found by running the
 * service code against the production database.
 *
 * AppError is the expected, client-safe path (validation, rate limit, not found),
 * so it logs at WARNING and stays out of the error budget. Anything else is a bug
 * on our side and logs at ERROR with its stack, which is what makes an alert
 * policy on severity>=ERROR meaningful.
 *
 * Deliberately no tool arguments. The analytics module is metadata-only on
 * purpose, and a shopping list plus an address is exactly the payload that should
 * not be duplicated into logs to debug a stack trace. The tool name and the stack
 * are what identify the bug.
 */
function logToolFailure(toolName: string, err: unknown, startedAt: number): void {
  const expected = err instanceof AppError;
  const entry: Record<string, unknown> = {
    severity: expected ? "WARNING" : "ERROR",
    msg: "mcp tool failed",
    tool: toolName,
    durationMs: Date.now() - startedAt,
  };
  if (err instanceof Error) {
    entry.errName = err.name;
    entry.errMessage = err.message;
    if (!expected) entry.stack = err.stack;
  } else {
    entry.errMessage = String(err);
  }
  // Structured JSON on stderr: Cloud Run parses it and honours `severity`, and it
  // matches the shape the Fastify logger already emits elsewhere.
  console.error(JSON.stringify(entry));
}

type ToolMeta<T extends z.ZodRawShape> = {
  title: string;
  description: string;
  inputSchema: T;
};

/**
 * Behaviour hints every tool on this surface shares.
 *
 * `readOnlyHint` is a statement of fact, not a preference: SuperMCP answers questions
 * about a price catalogue it ingests elsewhere. No tool here places an order, holds a
 * basket, or writes anything a caller could observe later. Clients and connector
 * reviewers weigh destructive capability, and a server that cannot destroy anything
 * should say so rather than leave them to assume.
 *
 * `openWorldHint` is the honest counterpart: the catalogue is millions of rows that
 * change daily, and an address goes out to a geocoder, so the same call tomorrow can
 * legitimately answer differently. That is an open world, not a fixed lookup table.
 *
 * `destructiveHint` and `idempotentHint` are deliberately absent. The spec defines both
 * as meaningful only when `readOnlyHint` is false, so setting them here would be noise
 * that implies a write path exists.
 *
 * ANY tool that writes must stop sharing this constant, or it will ship a lie.
 */
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  openWorldHint: true,
} as const;

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
      logToolFailure(name, err, startedAt);
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
    {
      title: meta.title,
      description: meta.description,
      inputSchema: strictSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    toolHandler as Parameters<McpServer["registerTool"]>[2],
  );
}
