import { AppError } from "@super-mcp/shared";

export type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

export function textResult(payload: unknown): ToolTextResult {
  // Compact JSON — MCP payloads can be large; pretty-print wastes bandwidth.
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export function errorResult(err: unknown): ToolTextResult & { isError: true } {
  // Mirror REST: only AppError messages are safe for clients; never leak pg/SQL text.
  const message = err instanceof AppError ? err.message : "Internal server error";
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
